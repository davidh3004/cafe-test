import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Drift guard for Phase 14 (META-01, META-03, META-05): the shared
 * `PAGE_SCALAR_AND_SEO_FIELDS` / `SEO_FIELDS` consts in `lib/strapi-client.ts`
 * are module-private, so nothing previously pinned that all three page
 * queries (`getPagesQuery`, `getPageBySlugQuery`,
 * `getPageBySlugUnfilteredQuery`) still carry the full `seo { title
 * description noindex shareImage { url width height } }` selection. A future
 * edit that inlines fields into one query and drops `seo` would silently
 * degrade every affected page's title/description/OG tags/noindex with no
 * test failing.
 *
 * APPROACH: transport-level capture, not source-text inspection. `strapiClient`
 * (a `graphql-request` `GraphQLClient` instance) is exported from
 * `strapi-client.ts`, so `strapiClient.request` is spied on directly and its
 * FIRST argument (the real GraphQL query STRING this module actually sends
 * over the wire) is captured per call — proving the wire payload, not the
 * source text, carries the selection. This is preferred over an `fs`
 * source-text fallback specifically because it survives refactors that
 * change how the query string is assembled, as long as the bytes sent over
 * the wire are unchanged.
 *
 * `graphqlEndpoint` (and therefore whether `fetchPages`/`fetchSite`/
 * `fetchPageBySlug` short-circuit before ever calling `strapiClient.request`)
 * is computed from `process.env.NEXT_PUBLIC_STRAPI_URL` at MODULE-LOAD time,
 * so each case below sets that env var and re-imports the module fresh via
 * `vi.resetModules()` + dynamic `import()` — the module's own env read
 * happens exactly once, at that import.
 */

const ENV_VAR = "NEXT_PUBLIC_STRAPI_URL";

describe("strapi-client.ts — page queries carry the full seo selection (drift guard)", () => {
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

  function assertCarriesFullSeoSelection(query: string) {
    expect(query).toContain("seo {");
    expect(query).toContain("title");
    expect(query).toContain("description");
    expect(query).toContain("noindex");
    expect(query).toContain("shareImage {");
    expect(query).toContain("url");
    expect(query).toContain("width");
    expect(query).toContain("height");
  }

  // Phase 16 / SEOED-05 drift guard (ffb5cde precedent — the pure emission
  // logic can stay green whether or not the query ever asks Strapi for the
  // field, so the selection itself needs its own assertion). canonicalUrl
  // must sit on the PAGE selection at the top level, never inside the `seo {
  // ... }` sub-selection (15 D-01: a site-level/component canonical is
  // structurally disallowed).
  // Extracts the full `seo { ... }` sub-selection, respecting the one level
  // of nesting `shareImage { ... }` introduces — a naive non-nesting regex
  // would stop at shareImage's closing brace and silently pass regardless of
  // what's actually inside the seo block.
  function extractSeoBlock(query: string): string {
    const start = query.indexOf("seo {");
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

  function assertCanonicalUrlOnPageNotOnSeo(query: string) {
    expect(query).toContain("canonicalUrl");
    const seoBlock = extractSeoBlock(query);
    expect(seoBlock).not.toContain("canonicalUrl");
  }

  it("getPagesQuery (fetchPages) carries the full seo selection", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async () => ({ pages: [] }));

    await mod.fetchPages();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const query = requestSpy.mock.calls[0][0] as string;
    expect(query).toContain("GetPages");
    assertCarriesFullSeoSelection(query);
    assertCanonicalUrlOnPageNotOnSeo(query);
  });

  it("getPageBySlugQuery (fetchPageBySlug, liveTheme set) carries the full seo selection", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetSiteLiveTheme")) {
          return { site: { liveTheme: { documentId: "theme-1" } } };
        }
        if (q.includes("GetPageBySlug(")) {
          // Empty result: fetchPageBySlug returns null immediately after this
          // call, so no further network calls (metaobjects/image formats) fire.
          return { pages: [] };
        }
        throw new Error(`unexpected query in mock: ${q.slice(0, 40)}`);
      });

    const page = await mod.fetchPageBySlug("some-slug");
    expect(page).toBeNull();

    const bySlugCall = requestSpy.mock.calls.find((args) =>
      (args[0] as string).includes("GetPageBySlug(")
    );
    expect(bySlugCall).toBeDefined();
    assertCarriesFullSeoSelection(bySlugCall![0] as string);
    assertCanonicalUrlOnPageNotOnSeo(bySlugCall![0] as string);
  });

  it("getPageBySlugUnfilteredQuery (fetchPageBySlug, no liveTheme) carries the full seo selection", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetSiteLiveTheme")) {
          // No liveTheme configured -> fetchPageBySlug takes the unfiltered
          // branch directly (no filtered-query attempt, no A2 catch needed).
          return { site: { liveTheme: null } };
        }
        if (q.includes("GetPageBySlugUnfiltered")) {
          return { pages: [] };
        }
        throw new Error(`unexpected query in mock: ${q.slice(0, 40)}`);
      });

    const page = await mod.fetchPageBySlug("some-slug");
    expect(page).toBeNull();

    const unfilteredCall = requestSpy.mock.calls.find((args) =>
      (args[0] as string).includes("GetPageBySlugUnfiltered")
    );
    expect(unfilteredCall).toBeDefined();
    assertCarriesFullSeoSelection(unfilteredCall![0] as string);
    assertCanonicalUrlOnPageNotOnSeo(unfilteredCall![0] as string);
  });
});

/**
 * Phase 15, Plan 03: `getSiteLiveThemeQuery` (fetchSite) must widen to select
 * `titleTemplate` and the three verification fields, via a new
 * `SITE_SCALAR_FIELDS` const interpolated in — SITE-01/SITE-04's read side.
 * Same transport-level capture approach as the page-query guard above: the
 * real GraphQL query string sent over the wire, not source text.
 */
describe("strapi-client.ts — getSiteLiveThemeQuery carries the widened Site scalar selection (SITE-01/SITE-04)", () => {
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

  it("getSiteLiveThemeQuery (fetchSite) selects titleTemplate and all three verification fields", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async () => ({ site: null }));

    await mod.fetchSite();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const query = requestSpy.mock.calls[0][0] as string;
    expect(query).toContain("GetSiteLiveTheme");
    expect(query).toContain("titleTemplate");
    expect(query).toContain("verificationGoogle");
    expect(query).toContain("verificationBing");
    expect(query).toContain("verificationYandex");
    // The wire-visible operation name is unchanged (RESEARCH: renaming a
    // wire string buys nothing) — the const/operation name is still
    // GetSiteLiveTheme, not a new operation.
    expect(query).not.toContain("GetSite ");
  });

  // Phase 17 (17-05, PERF-04): lastDeployedAt is the D-06 cache-bust token
  // resolveLiveBundle applies. A future edit that drops this selection would
  // silently un-version every asset with no test failing elsewhere — pin it
  // directly against the liveTheme sub-selection.
  it("getSiteLiveThemeQuery selects lastDeployedAt inside the liveTheme block", async () => {
    const mod = await import("../strapi-client");
    const requestSpy = vi
      .spyOn(mod.strapiClient, "request")
      .mockImplementation(async () => ({ site: null }));

    await mod.fetchSite();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const query = requestSpy.mock.calls[0][0] as string;
    const liveThemeStart = query.indexOf("liveTheme {");
    expect(liveThemeStart).toBeGreaterThan(-1);
    const liveThemeEnd = query.indexOf("}", liveThemeStart);
    const liveThemeBlock = query.slice(liveThemeStart, liveThemeEnd);
    expect(liveThemeBlock).toContain("lastDeployedAt");
  });
});
