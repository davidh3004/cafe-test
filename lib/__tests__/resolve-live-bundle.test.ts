import { describe, expect, it } from "vitest";
// Request-time live-theme BUNDLE resolution (Finding 4 / Open Q3, MT-04, D-03/D-04).
//
// The deployed public bundle URL was baked at deploy (NEXT_PUBLIC_THEME_BUNDLE_URL),
// so switching Site.liveTheme to a DIFFERENT theme rendered new content but the OLD
// bundle. resolveLiveBundle(site, env) resolves the bundle at REQUEST time from
// Site.liveTheme.builtAssetUrl/name so a different-theme go-live swaps the rendered
// bundle with no redeploy; env vars remain the fallback (migration window /
// single-theme tenant).
//
// Contract under test — resolveLiveBundle(site, env):
//   - live theme's builtAssetUrl/name WIN over env
//   - null liveTheme -> env fallback (themeName defaults to "default")
//   - liveTheme missing builtAssetUrl -> env bundle url, but liveTheme.name still preferred
//   - two different live themes -> two different { themeBundleUrl, themeName }
//
// Phase 17 (PERF-04, D-05/D-06): resolveLiveBundle now also derives the CRITICAL
// stylesheet URL (`themeCssUrl`) and applies a `?v=<lastDeployedAt>` version token
// to all three URLs so they can be cached `immutable` (17-06). Every existing
// assertion below is updated to include the new `themeCssUrl` key.
import { resolveLiveBundle } from "../live-resolve";

const env = {
  NEXT_PUBLIC_THEME_BUNDLE_URL: "https://cdn.example/baked/theme.js",
  NEXT_PUBLIC_THEME_NAME: "baked-theme",
};

describe("resolveLiveBundle — request-time bundle resolution (Finding 4 / Q3, MT-04)", () => {
  it("the live theme's builtAssetUrl/name WIN over env", () => {
    const site = {
      liveTheme: {
        documentId: "theme-live",
        name: "Aurora",
        builtAssetUrl: "https://cdn.example/aurora/theme.js",
      },
    };
    expect(resolveLiveBundle(site, env)).toEqual({
      themeBundleUrl: "https://cdn.example/aurora/theme.js",
      themeName: "Aurora",
      themeCssUrl: "https://cdn.example/aurora/theme.css",
      themeCssDeferredUrl: "https://cdn.example/aurora/theme.deferred.css",
    });
  });

  it("null liveTheme falls back to env (themeName defaults to 'default' when env name absent)", () => {
    const site = { liveTheme: null };
    expect(resolveLiveBundle(site, env)).toEqual({
      themeBundleUrl: "https://cdn.example/baked/theme.js",
      themeName: "baked-theme",
      themeCssUrl: "https://cdn.example/baked/theme.css",
      themeCssDeferredUrl: "https://cdn.example/baked/theme.deferred.css",
    });
    expect(resolveLiveBundle({ liveTheme: null }, { NEXT_PUBLIC_THEME_BUNDLE_URL: "u" })).toEqual({
      themeBundleUrl: "u",
      themeName: "default",
      themeCssUrl: undefined,
      themeCssDeferredUrl: undefined,
    });
  });

  it("liveTheme missing builtAssetUrl falls back to env bundle url but keeps liveTheme.name", () => {
    const site = {
      liveTheme: { documentId: "theme-live", name: "Aurora", builtAssetUrl: null },
    };
    expect(resolveLiveBundle(site, env)).toEqual({
      themeBundleUrl: "https://cdn.example/baked/theme.js",
      themeName: "Aurora",
      themeCssUrl: "https://cdn.example/baked/theme.css",
      themeCssDeferredUrl: "https://cdn.example/baked/theme.deferred.css",
    });
  });

  it("two different live themes resolve to two different bundles (observable go-live)", () => {
    const siteA = {
      liveTheme: { documentId: "a", name: "Aurora", builtAssetUrl: "https://cdn.example/a.js" },
    };
    const siteB = {
      liveTheme: { documentId: "b", name: "Borealis", builtAssetUrl: "https://cdn.example/b.js" },
    };
    const a = resolveLiveBundle(siteA, env);
    const b = resolveLiveBundle(siteB, env);
    expect(a).toEqual({
      themeBundleUrl: "https://cdn.example/a.js",
      themeName: "Aurora",
      themeCssUrl: "https://cdn.example/a.css",
      themeCssDeferredUrl: "https://cdn.example/a.deferred.css",
    });
    expect(b).toEqual({
      themeBundleUrl: "https://cdn.example/b.js",
      themeName: "Borealis",
      themeCssUrl: "https://cdn.example/b.css",
      themeCssDeferredUrl: "https://cdn.example/b.deferred.css",
    });
    expect(a.themeBundleUrl).not.toBe(b.themeBundleUrl);
    expect(a.themeName).not.toBe(b.themeName);
  });

  it("themeBundleUrl undefined -> themeCssUrl/themeCssDeferredUrl are undefined (never 'undefined.deferred.css')", () => {
    const result = resolveLiveBundle({ liveTheme: null }, {});
    expect(result.themeBundleUrl).toBeUndefined();
    expect(result.themeCssUrl).toBeUndefined();
    expect(result.themeCssDeferredUrl).toBeUndefined();
  });

  it("themeBundleUrl not ending in .js -> themeCssUrl/themeCssDeferredUrl are undefined (defensive edge case), but the bundle URL itself passes through unchanged", () => {
    const site = {
      liveTheme: {
        documentId: "theme-live",
        name: "Aurora",
        builtAssetUrl: "https://cdn.example/aurora/theme.css",
      },
    };
    const result = resolveLiveBundle(site, {});
    expect(result.themeBundleUrl).toBe("https://cdn.example/aurora/theme.css");
    expect(result.themeCssUrl).toBeUndefined();
    expect(result.themeCssDeferredUrl).toBeUndefined();
  });
});

/**
 * Phase 17 (PERF-04, D-05/D-06): the version-token contract. `lastDeployedAt`
 * (Strapi `Theme.lastDeployedAt`, written beside `builtAssetUrl` by the deploy
 * status callback) is the cache-bust token appended to all three resolved
 * URLs so 17-06 can mark them `immutable` without pinning a tenant's browser
 * to a stale bundle across a redeploy.
 */
describe("resolveLiveBundle — version token (PERF-04, D-05/D-06)", () => {
  const tokenSite = {
    liveTheme: {
      documentId: "theme-live",
      name: "Aurora",
      builtAssetUrl: "https://cdn.example/aurora/theme.bundle.js",
      lastDeployedAt: "2026-08-08T13:00:00.000Z",
    },
  };

  it("all three URLs carry the same ?v=<token> query and keep their canonical paths", () => {
    const result = resolveLiveBundle(tokenSite, {});
    const token = encodeURIComponent("2026-08-08T13:00:00.000Z");

    expect(result.themeBundleUrl).toBe(
      `https://cdn.example/aurora/theme.bundle.js?v=${token}`
    );
    expect(result.themeCssUrl).toBe(
      `https://cdn.example/aurora/theme.bundle.css?v=${token}`
    );
    expect(result.themeCssDeferredUrl).toBe(
      `https://cdn.example/aurora/theme.bundle.deferred.css?v=${token}`
    );

    expect(new URL(result.themeBundleUrl!).pathname).toBe(
      "/aurora/theme.bundle.js"
    );
    expect(new URL(result.themeCssUrl!).pathname).toBe(
      "/aurora/theme.bundle.css"
    );
    // D-06's named trap, asserted explicitly: the deferred stylesheet's path
    // must still end in theme.bundle.deferred.css, not the bundle path and
    // not undefined.
    expect(new URL(result.themeCssDeferredUrl!).pathname).toBe(
      "/aurora/theme.bundle.deferred.css"
    );
  });

  it("lastDeployedAt absent, null, empty, or non-string appends no version query and matches the pre-token literal output", () => {
    const expected = {
      themeBundleUrl: "https://cdn.example/aurora/theme.bundle.js",
      themeName: "Aurora",
      themeCssUrl: "https://cdn.example/aurora/theme.bundle.css",
      themeCssDeferredUrl: "https://cdn.example/aurora/theme.bundle.deferred.css",
    };

    const base = {
      documentId: "theme-live",
      name: "Aurora",
      builtAssetUrl: "https://cdn.example/aurora/theme.bundle.js",
    };

    expect(resolveLiveBundle({ liveTheme: base }, {})).toEqual(expected);
    expect(
      resolveLiveBundle({ liveTheme: { ...base, lastDeployedAt: null } }, {})
    ).toEqual(expected);
    expect(
      resolveLiveBundle({ liveTheme: { ...base, lastDeployedAt: "" } }, {})
    ).toEqual(expected);
    expect(
      resolveLiveBundle({ liveTheme: { ...base, lastDeployedAt: "   " } }, {})
    ).toEqual(expected);
    expect(
      resolveLiveBundle(
        { liveTheme: { ...base, lastDeployedAt: 12345 as unknown as string } },
        {}
      )
    ).toEqual(expected);
  });

  it("appends the token with & when the bundle URL already carries a query string", () => {
    const site = {
      liveTheme: {
        documentId: "theme-live",
        name: "Aurora",
        builtAssetUrl: "https://cdn.example/aurora/theme.bundle.js?foo=bar",
        lastDeployedAt: "2026-08-08T13:00:00.000Z",
      },
    };
    const result = resolveLiveBundle(site, {});
    const url = new URL(result.themeBundleUrl!);
    expect(url.origin).toBe("https://cdn.example");
    expect(url.pathname).toBe("/aurora/theme.bundle.js");
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.get("v")).toBe("2026-08-08T13:00:00.000Z");
  });

  it("percent-encodes a token containing colons and round-trips through URL.searchParams", () => {
    const result = resolveLiveBundle(tokenSite, {});
    const roundTripped = new URL(result.themeBundleUrl!).searchParams.get("v");
    expect(roundTripped).toBe("2026-08-08T13:00:00.000Z");
  });

  it("calling twice with identical input returns byte-identical strings", () => {
    const first = resolveLiveBundle(tokenSite, {});
    const second = resolveLiveBundle(tokenSite, {});
    expect(first).toEqual(second);
    expect(first.themeBundleUrl).toBe(second.themeBundleUrl);
    expect(first.themeCssUrl).toBe(second.themeCssUrl);
    expect(first.themeCssDeferredUrl).toBe(second.themeCssDeferredUrl);
  });

  it("two sites sharing an identical lastDeployedAt but differing builtAssetUrl produce different bundle URLs", () => {
    const shared = "2026-08-08T13:00:00.000Z";
    const siteA = {
      liveTheme: {
        documentId: "a",
        name: "Aurora",
        builtAssetUrl: "https://cdn.example/a/theme.bundle.js",
        lastDeployedAt: shared,
      },
    };
    const siteB = {
      liveTheme: {
        documentId: "b",
        name: "Borealis",
        builtAssetUrl: "https://cdn.example/b/theme.bundle.js",
        lastDeployedAt: shared,
      },
    };
    const a = resolveLiveBundle(siteA, {});
    const b = resolveLiveBundle(siteB, {});
    expect(a.themeBundleUrl).not.toBe(b.themeBundleUrl);
  });

  it("a builtAssetUrl not ending in .js still receives the token on the bundle URL, but the deferred URL stays undefined", () => {
    const site = {
      liveTheme: {
        documentId: "theme-live",
        name: "Aurora",
        builtAssetUrl: "https://cdn.example/aurora/theme.css",
        lastDeployedAt: "2026-08-08T13:00:00.000Z",
      },
    };
    const result = resolveLiveBundle(site, {});
    const url = new URL(result.themeBundleUrl!);
    expect(url.pathname).toBe("/aurora/theme.css");
    expect(url.searchParams.get("v")).toBe("2026-08-08T13:00:00.000Z");
    expect(result.themeCssDeferredUrl).toBeUndefined();
  });

  it("no builtAssetUrl and no NEXT_PUBLIC_THEME_BUNDLE_URL -> all three URLs undefined, never throws", () => {
    const site = {
      liveTheme: {
        documentId: "theme-live",
        name: "Aurora",
        builtAssetUrl: null,
        lastDeployedAt: "2026-08-08T13:00:00.000Z",
      },
    };
    expect(() => resolveLiveBundle(site, {})).not.toThrow();
    const result = resolveLiveBundle(site, {});
    expect(result.themeBundleUrl).toBeUndefined();
    expect(result.themeCssUrl).toBeUndefined();
    expect(result.themeCssDeferredUrl).toBeUndefined();
  });

  it("NEXT_PUBLIC_THEME_CSS_URL override wins for themeCssUrl and is returned WITHOUT a version token", () => {
    const result = resolveLiveBundle(tokenSite, {
      NEXT_PUBLIC_THEME_CSS_URL: "https://cdn.example/operator/override.css",
    });
    expect(result.themeCssUrl).toBe("https://cdn.example/operator/override.css");
    // The bundle URL and deferred URL are unaffected by the override and
    // still carry the token.
    expect(result.themeBundleUrl).toContain("?v=");
    expect(result.themeCssDeferredUrl).toContain("?v=");
  });
});
