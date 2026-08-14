import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 22 (BLOG-07), Plan 01 Task 1. `fetchSite`'s `getSiteLiveThemeQuery`
 * must select `liveTheme.sectionsManifest` so `resolveBlogSurfaceSupport`
 * (Phase 21) has a real manifest to resolve against on a deployed tenant
 * instead of `undefined` — see RESEARCH Pitfall 1. Because Strapi fails the
 * WHOLE document on one unknown field, this widening MUST carry a
 * manifest-less `GetSiteLiveThemeLegacy` fallback so a tenant whose Theme
 * schema predates the field does not lose its entire site (the 2026-08-04
 * incident recorded in `strapi-client.ts`).
 *
 * Same transport-level capture approach as
 * `strapi-client-seo-selection.test.ts`: `strapiClient.request` is spied on
 * directly and the query STRING actually sent over the wire is asserted
 * against, never source text. `liveTheme { ... }` is extracted by brace
 * matching (mirrors that file's `extractSeoBlock` helper) so the assertion
 * cannot pass on a field that happens to appear elsewhere in the document.
 */

const ENV_VAR = "NEXT_PUBLIC_STRAPI_URL";

describe("strapi-client.ts — getSiteLiveThemeQuery selects liveTheme.sectionsManifest, with a manifest-less legacy fallback (BLOG-07)", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[ENV_VAR];
    process.env[ENV_VAR] = "https://cms.example.com";
    vi.resetModules();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = savedEnv;
    vi.resetModules();
  });

  function extractLiveThemeBlock(query: string): string {
    const start = query.indexOf("liveTheme {");
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let i = start;
    for (; i < query.length; i++) {
      if (query[i] === "{") depth++;
      else if (query[i] === "}") {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    return query.slice(start, i);
  }

  it("primary GetSiteLiveTheme query selects sectionsManifest inside the liveTheme block, with exactly one request on the happy path", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async () => ({
        site: { liveTheme: { documentId: "theme-1", sectionsManifest: null } },
      }));

    const site = await mod.fetchSite();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const query = requestSpy.mock.calls[0][0] as string;
    expect(query).toContain("GetSiteLiveTheme");
    expect(query).not.toContain("GetSiteLiveThemeLegacy");
    const liveThemeBlock = extractLiveThemeBlock(query);
    expect(liveThemeBlock).toContain("sectionsManifest");
    expect(site?.liveTheme?.documentId).toBe("theme-1");
  });

  it("retries once with GetSiteLiveThemeLegacy (manifest-less) when the primary query throws, and returns that result rather than null", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetSiteLiveThemeLegacy")) {
          return { site: { liveTheme: { documentId: "theme-1" } } };
        }
        if (q.includes("GetSiteLiveTheme")) {
          throw new Error('Cannot query field "sectionsManifest" on type "Theme".');
        }
        throw new Error(`unexpected query in mock: ${q.slice(0, 40)}`);
      });

    const site = await mod.fetchSite();

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(site?.liveTheme?.documentId).toBe("theme-1");
    const legacyCall = requestSpy.mock.calls.find((args) =>
      (args[0] as string).includes("GetSiteLiveThemeLegacy")
    );
    expect(legacyCall).toBeDefined();
    expect(legacyCall![0] as string).not.toContain("sectionsManifest");
  });

  it("returns null when both the primary and legacy queries throw (today's build-time-safe behaviour, unchanged)", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi.spyOn(mod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    const site = await mod.fetchSite();

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(site).toBeNull();
  });

  it("the legacy query's liveTheme block carries the same common fields as the primary, minus sectionsManifest", async () => {
    const mod = await import("../strapi-client");
    let primaryQuery = "";
    let legacyQuery = "";
    vi.spyOn(mod.strapiClient, "request").mockImplementation(async (query: unknown) => {
      const q = query as string;
      if (q.includes("GetSiteLiveThemeLegacy")) {
        legacyQuery = q;
        return { site: null };
      }
      primaryQuery = q;
      throw new Error('Cannot query field "sectionsManifest" on type "Theme".');
    });

    await mod.fetchSite();

    const primaryBlock = extractLiveThemeBlock(primaryQuery);
    const legacyBlock = extractLiveThemeBlock(legacyQuery);

    for (const field of ["documentId", "name", "builtAssetUrl", "lastDeployedAt"]) {
      expect(primaryBlock).toContain(field);
      expect(legacyBlock).toContain(field);
    }
    expect(primaryBlock).toContain("sectionsManifest");
    expect(legacyBlock).not.toContain("sectionsManifest");
  });
});
