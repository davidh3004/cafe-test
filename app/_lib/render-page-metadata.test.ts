import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Gap G4 fill (Phase 14 validation audit). `buildPageMetadataFrom` (the pure
// builder) is unit-pinned in `lib/__tests__/seo-resolve.test.ts` — this file
// pins the ROUTE SHELL's wiring in `app/_lib/render-page.tsx`: that
// `buildPageMetadata(slug)` really short-circuits a falsy slug before any
// fetch, really degrades on an unresolvable origin with a primitives-only
// payload (T-14-08), and really threads the resolved homepage slug into the
// pure builder so a homepage's canonical collapses to the bare origin
// (D-08 / G-14-5). Mirrors the `vi.mock("@/lib/strapi-client", ...)` style
// used in `app/sitemap.test.ts` / `app/robots.test.ts`.
vi.mock("@/lib/strapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/strapi-client")>();
  return {
    ...actual,
    fetchPageBySlug: vi.fn(),
    fetchSite: vi.fn(),
    fetchPages: vi.fn(),
  };
});
vi.mock("@/lib/seo-report", () => ({
  reportSeoDegrade: vi.fn(),
}));

import { buildPageMetadata } from "./render-page";
import { fetchPageBySlug, fetchSite, fetchPages } from "@/lib/strapi-client";
import { reportSeoDegrade } from "@/lib/seo-report";
import type { StrapiPage } from "@/lib/strapi-client";

const ENV_KEYS = ["NEXT_PUBLIC_SITE_SUBDOMAIN", "VERCEL_CUSTOM_DOMAIN"] as const;

const homePage: StrapiPage = {
  documentId: "1",
  title: "Home",
  slug: "home",
  publishedAt: "2026-01-01T00:00:00Z",
};

const aboutPage: StrapiPage = {
  documentId: "2",
  title: "About",
  slug: "about",
  publishedAt: "2026-01-02T00:00:00Z",
};

describe("app/_lib/render-page.ts buildPageMetadata — route shell wiring", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of ENV_KEYS) delete process.env[key];
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("(a) returns the not-found title and performs no fetch for a null slug", async () => {
    const result = await buildPageMetadata(null);

    expect(result).toEqual({ title: "Page Not Found" });
    expect(fetchPageBySlug).not.toHaveBeenCalled();
    expect(fetchSite).not.toHaveBeenCalled();
    expect(fetchPages).not.toHaveBeenCalled();
  });

  it("(a) returns the not-found title and performs no fetch for an empty-string slug", async () => {
    const result = await buildPageMetadata("");

    expect(result).toEqual({ title: "Page Not Found" });
    expect(fetchPageBySlug).not.toHaveBeenCalled();
    expect(fetchSite).not.toHaveBeenCalled();
    expect(fetchPages).not.toHaveBeenCalled();
  });

  it("(b,c) reports a primitives-only degrade when the origin is unresolvable and a page exists", async () => {
    vi.mocked(fetchPageBySlug).mockResolvedValue(aboutPage);
    vi.mocked(fetchSite).mockResolvedValue(null);
    vi.mocked(fetchPages).mockResolvedValue([aboutPage]);

    await buildPageMetadata("about");

    expect(reportSeoDegrade).toHaveBeenCalledTimes(1);
    const [reason, surface, context] = vi.mocked(reportSeoDegrade).mock.calls[0];
    expect(reason).toBe("origin-unresolvable");
    expect(surface).toBe("page-metadata");
    expect(context).toEqual({
      hasSite: false,
      hasSiteUrl: false,
      hasSubdomainEnv: false,
    });

    // Primitives-only: every value in the recorded context is a boolean, and
    // no planted site field VALUE (e.g. a siteUrl string, a site name, or a
    // token-shaped string) leaks into the recorded call at all.
    for (const value of Object.values(context ?? {})) {
      expect(typeof value).toBe("boolean");
    }
    const allArgs = JSON.stringify(vi.mocked(reportSeoDegrade).mock.calls[0]);
    expect(allArgs).not.toContain("acme");
    expect(allArgs).not.toContain("token");
  });

  it("(b) does NOT report a degrade when the origin resolves even though a page exists", async () => {
    vi.mocked(fetchPageBySlug).mockResolvedValue(aboutPage);
    vi.mocked(fetchSite).mockResolvedValue({ siteUrl: "https://acme.com" });
    vi.mocked(fetchPages).mockResolvedValue([aboutPage]);

    await buildPageMetadata("about");

    expect(reportSeoDegrade).not.toHaveBeenCalled();
  });

  it("(b) does NOT report a degrade when the origin is unresolvable but there is no page", async () => {
    vi.mocked(fetchPageBySlug).mockResolvedValue(null);
    vi.mocked(fetchSite).mockResolvedValue(null);
    vi.mocked(fetchPages).mockResolvedValue([]);

    await buildPageMetadata("missing");

    expect(reportSeoDegrade).not.toHaveBeenCalled();
  });

  it("(d) collapses the canonical to the bare origin for the resolved homepage, but not for an ordinary page", async () => {
    vi.mocked(fetchSite).mockResolvedValue({ siteUrl: "https://acme.com" });
    // Neither page is flagged isHomepage — the homepage is resolved purely by
    // the "home" conventional slug via fetchPages(), which must be threaded
    // into buildPageMetadataFrom's 4th argument for this collapse to happen.
    vi.mocked(fetchPages).mockResolvedValue([homePage, aboutPage]);

    vi.mocked(fetchPageBySlug).mockResolvedValue(homePage);
    const homeResult = await buildPageMetadata("home");
    expect(homeResult.alternates?.canonical).toBe("https://acme.com");

    vi.mocked(fetchPageBySlug).mockResolvedValue(aboutPage);
    const aboutResult = await buildPageMetadata("about");
    expect(aboutResult.alternates?.canonical).toBe("https://acme.com/about");
  });

  it("(e) resolves origin from the site record and env only — no Host header input exists or is consulted", async () => {
    vi.mocked(fetchPageBySlug).mockResolvedValue(aboutPage);
    vi.mocked(fetchSite).mockResolvedValue({ siteUrl: "https://acme.com" });
    // homePage is listed first / flagged as an ordinary page here so "about"
    // is NOT resolved as the homepage by any tier of the ladder.
    vi.mocked(fetchPages).mockResolvedValue([homePage, aboutPage]);

    // buildPageMetadata's signature takes only a slug — there is no
    // request/headers parameter to plant a Host value into. Assert the
    // resolved origin matches the site record even though no such channel
    // was ever offered to the function.
    const result = await buildPageMetadata("about");
    expect(result.alternates?.canonical).toBe("https://acme.com/about");
    expect(String(result.metadataBase)).toBe("https://acme.com/");
  });
});
