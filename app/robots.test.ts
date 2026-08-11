import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Phase 14 Plan 04 gap fill (DISC-03, DISC-04). `buildRobots` itself is
// unit-pinned in `lib/__tests__/discovery-resolve.test.ts` — this file pins
// the ROUTE SHELL's wiring: a resolvable origin really produces
// `buildRobots(origin)`, and an unresolvable origin really fails OPEN (the
// wildcard allow group survives, no crawl-block, no host key, sitemap key
// simply absent) while still reporting the degrade.
vi.mock("@/lib/strapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/strapi-client")>();
  return {
    ...actual,
    fetchSite: vi.fn(),
  };
});
vi.mock("@/lib/seo-report", () => ({
  reportSeoDegrade: vi.fn(),
}));

import robots, { revalidate } from "./robots";
import { fetchSite } from "@/lib/strapi-client";
import { reportSeoDegrade } from "@/lib/seo-report";
import { buildRobots } from "@/lib/discovery-resolve";

const ENV_KEYS = ["NEXT_PUBLIC_SITE_SUBDOMAIN", "VERCEL_CUSTOM_DOMAIN"] as const;

describe("app/robots.ts — route shell wiring", () => {
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

  it("returns buildRobots(origin) for a resolvable origin: wildcard allow plus the sitemap reference", async () => {
    vi.mocked(fetchSite).mockResolvedValue({ siteUrl: "https://acme.com" });

    const result = await robots();

    expect(result).toEqual(buildRobots("https://acme.com"));
    expect(result.sitemap).toBe("https://acme.com/sitemap.xml");
    expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(reportSeoDegrade).not.toHaveBeenCalled();
  });

  it("fails open on an unresolvable origin: allow group retained, sitemap key absent, no block, no host key, degrade reported", async () => {
    vi.mocked(fetchSite).mockResolvedValue(null);

    const result = await robots();

    expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(result).not.toHaveProperty("sitemap");
    expect(result).not.toHaveProperty("host");
    // No crawl-blocking directive of any kind is ever emitted on this path.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("disallow");
    expect(serialized.toLowerCase()).not.toContain('"disallow"');

    expect(reportSeoDegrade).toHaveBeenCalledTimes(1);
    const [reason, surface, context] = vi.mocked(reportSeoDegrade).mock.calls[0];
    expect(reason).toBe("origin-unresolvable");
    expect(surface).toBe("robots");
    expect(context).toEqual({ hasSite: false });
  });
});
