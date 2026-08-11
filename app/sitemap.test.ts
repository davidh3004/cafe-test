import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Phase 14 Plan 04 gap fill (DISC-01, DISC-02, META-05). `buildSitemapEntries`
// itself is thoroughly unit-pinned in `lib/__tests__/discovery-resolve.test.ts`
// — this file instead pins the ROUTE SHELL's wiring: that `app/sitemap.ts`
// really awaits both fetchers, really delegates to the real builder for a
// resolvable origin, and really degrades to `[]` (never a guessed host) plus
// a safe `reportSeoDegrade` call when no origin resolves. Mirrors the
// `vi.mock("@/lib/strapi-client", ...)` style used in
// `app/layout-degrade.test.tsx`.
vi.mock("@/lib/strapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/strapi-client")>();
  return {
    ...actual,
    fetchPages: vi.fn(),
    fetchSite: vi.fn(),
  };
});
vi.mock("@/lib/seo-report", () => ({
  reportSeoDegrade: vi.fn(),
}));

import sitemap, { revalidate } from "./sitemap";
import { fetchPages, fetchSite } from "@/lib/strapi-client";
import { reportSeoDegrade } from "@/lib/seo-report";
import { buildSitemapEntries } from "@/lib/discovery-resolve";
import type { StrapiPage } from "@/lib/strapi-client";

const ENV_KEYS = ["NEXT_PUBLIC_SITE_SUBDOMAIN", "VERCEL_CUSTOM_DOMAIN"] as const;

describe("app/sitemap.ts — route shell wiring", () => {
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

  it("exports revalidate = 10", () => {
    expect(revalidate).toBe(10);
  });

  it("awaits both fetchers and returns exactly buildSitemapEntries(pages, origin) for a resolvable origin", async () => {
    const pages: StrapiPage[] = [
      {
        documentId: "1",
        title: "Home",
        slug: "home",
        publishedAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-02T00:00:00Z",
        isHomepage: true,
      },
      {
        documentId: "2",
        title: "About",
        slug: "about",
        publishedAt: "2026-01-03T00:00:00Z",
      },
    ];
    vi.mocked(fetchPages).mockResolvedValue(pages);
    vi.mocked(fetchSite).mockResolvedValue({ siteUrl: "https://acme.com" });

    const result = await sitemap();

    expect(fetchPages).toHaveBeenCalledTimes(1);
    expect(fetchSite).toHaveBeenCalledTimes(1);
    const expected = buildSitemapEntries(pages, "https://acme.com");
    expect(result).toEqual(expected);
    // Guard against a trivially-true comparison: the real builder must have
    // actually produced non-empty, origin-qualified entries.
    expect(result.length).toBe(2);
    expect(result.every((e) => e.url.startsWith("https://acme.com"))).toBe(true);
    expect(reportSeoDegrade).not.toHaveBeenCalled();
  });

  it("returns [] and reports a safe degrade payload when no origin resolves (site null, no subdomain env)", async () => {
    const pages: StrapiPage[] = [
      {
        documentId: "1",
        title: "Home",
        slug: "home",
        publishedAt: "2026-01-01T00:00:00Z",
      },
    ];
    vi.mocked(fetchPages).mockResolvedValue(pages);
    vi.mocked(fetchSite).mockResolvedValue(null);

    const result = await sitemap();

    expect(result).toEqual([]);
    expect(reportSeoDegrade).toHaveBeenCalledTimes(1);
    const [reason, surface, context] = vi.mocked(reportSeoDegrade).mock.calls[0];
    expect(reason).toBe("origin-unresolvable");
    expect(surface).toBe("sitemap");
    expect(context).toEqual({ hasSite: false, pageCount: 1 });
    // No field value, token, or header ever reaches the degrade channel —
    // only booleans/numbers under the documented key set.
    for (const value of Object.values(context ?? {})) {
      expect(["boolean", "number"]).toContain(typeof value);
    }
  });
});
