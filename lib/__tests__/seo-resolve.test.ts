import { describe, expect, it } from "vitest";
// Phase 14, Plan 02: pure resolvers for real page metadata. Mirrors the
// live-resolve test convention — one describe per exported function,
// synthetic StrapiPage/StrapiSite shapes, plain object env values, no
// mocking of anything.
import {
  DEFAULT_LOCALE,
  NOT_FOUND_TITLE,
  resolveSiteOrigin,
  resolveLocale,
  resolveCanonicalPath,
  resolveHomepageSlugFrom,
  absoluteUrl,
  buildLanguageAlternates,
  resolveCanonicalOverride,
  resolveShareImage,
  buildPageMetadataFrom,
  resolveSiteDefaults,
  buildSiteMetadataFrom,
  resolveSiteTitleTemplate,
  resolveVerification,
  normalizeVerificationToken,
} from "../seo-resolve";
import type { StrapiPage, StrapiSite } from "../strapi-client";
// Phase 14, Plan 06 (G-14-4): the rendered-head-tag harness. Drives Next's
// OWN shipped resolvers/generators so this describe block asserts on what a
// browser or crawler actually receives, not on a pure builder's return value.
import { renderHeadTags } from "./helpers/next-head-surface";

describe("resolveSiteOrigin — D-05 precedence, D-07 never a guess", () => {
  it("returns the stored siteUrl as-is when it already has a protocol and no trailing slash", () => {
    expect(resolveSiteOrigin({ siteUrl: "https://acme.com" }, {})).toBe(
      "https://acme.com"
    );
  });

  it("strips a trailing slash from a stored siteUrl", () => {
    expect(resolveSiteOrigin({ siteUrl: "https://acme.com/" }, {})).toBe(
      "https://acme.com"
    );
  });

  it("adds https:// to a bare host via normalizeUrl", () => {
    expect(resolveSiteOrigin({ siteUrl: "acme.com" }, {})).toBe(
      "https://acme.com"
    );
  });

  it("adds http:// to a localhost host via normalizeUrl", () => {
    expect(resolveSiteOrigin({ siteUrl: "localhost:3000" }, {})).toBe(
      "http://localhost:3000"
    );
  });

  it("falls through to the env fallback when the stored value is whitespace-only", () => {
    expect(
      resolveSiteOrigin(
        { siteUrl: "   " },
        { NEXT_PUBLIC_SITE_SUBDOMAIN: "acme", VERCEL_CUSTOM_DOMAIN: "example.dev" }
      )
    ).toBe("https://acme.example.dev");
  });

  it("defaults the env fallback domain to vercel.app when VERCEL_CUSTOM_DOMAIN is unset", () => {
    expect(
      resolveSiteOrigin(null, { NEXT_PUBLIC_SITE_SUBDOMAIN: "acme" })
    ).toBe("https://acme.vercel.app");
  });

  it("returns null when neither a stored value nor an env fallback exists", () => {
    expect(resolveSiteOrigin(null, {})).toBeNull();
    expect(resolveSiteOrigin(undefined, undefined)).toBeNull();
  });

  it("returns null for a stored value that cannot be parsed as a URL", () => {
    expect(resolveSiteOrigin({ siteUrl: "not a url at all" }, {})).toBeNull();
  });

  it("returns null for a stored value whose protocol is neither http nor https", () => {
    expect(resolveSiteOrigin({ siteUrl: "ftp://acme.com" }, {})).toBeNull();
  });

  // Security audit T-14-06 / T-14-18 (sibling of code review CR-02).
  // NEXT_PUBLIC_SITE_SUBDOMAIN carries theme.subdomain, a plain Strapi string
  // writable by any team member through the UpdateTheme mutation. It is
  // INTERPOLATED into `https://${subdomain}.${domain}`, so a value that closes the
  // host position early hands the rest to a path/query/fragment/userinfo and the
  // resulting .origin belongs to the attacker. That origin becomes this tenant's
  // metadataBase, canonical, hreflang, og:url, every sitemap <loc> and the
  // robots.txt Sitemap: line. D-07's "never a guess" promise did not cover these
  // because they are not unparseable — they parse cleanly into the wrong origin.
  //
  // This branch is reached whenever Site.siteUrl is empty: every tenant deployed
  // before the siteUrl write existed, and every tenant whose tenantSiteOrigin
  // failed closed. The platform now sanitizes before writing the env var, but this
  // guard defends already-deployed tenants who cannot be reached without a redeploy.
  describe("T-14-06: a hostile NEXT_PUBLIC_SITE_SUBDOMAIN cannot take over the origin", () => {
    it.each([
      ["path", "evil.com/"],
      ["path segment", "evil.com/x"],
      ["fragment", "evil.com#"],
      ["query", "evil.com?"],
      ["backslash", "evil.com\\"],
      ["userinfo", "evil.com@x"],
      ["port", "evil.com:8080"],
      ["scheme break", "evil.com//x"],
      ["explicit scheme", "https://evil.com"],
    ])("rejects %s rather than resolving to an attacker origin", (_label, hostile) => {
      const resolved = resolveSiteOrigin(null, {
        NEXT_PUBLIC_SITE_SUBDOMAIN: hostile,
      });
      // Either null (refused) or an origin still under the intended domain —
      // never an origin the hostile value chose.
      expect(resolved).not.toBe("https://evil.com");
      if (resolved !== null) {
        expect(resolved.endsWith(".vercel.app")).toBe(true);
        expect(new URL(resolved).origin).toBe(resolved);
        expect(resolved).not.toContain("evil.com/");
      }
    });

    it("rejects a hostile subdomain against a custom domain too", () => {
      expect(
        resolveSiteOrigin(null, {
          NEXT_PUBLIC_SITE_SUBDOMAIN: "evil.com/",
          VERCEL_CUSTOM_DOMAIN: "example.dev",
        })
      ).not.toBe("https://evil.com");
    });

    it("rejects a hostile VERCEL_CUSTOM_DOMAIN as well", () => {
      // The domain half is operator-supplied, but the round trip covers it rather
      // than trusting its source.
      expect(
        resolveSiteOrigin(null, {
          NEXT_PUBLIC_SITE_SUBDOMAIN: "acme",
          VERCEL_CUSTOM_DOMAIN: "example.dev/evil",
        })
      ).toBeNull();
    });

    it("still resolves every ordinary env fallback, round-tripping cleanly", () => {
      for (const [sub, domain, want] of [
        ["acme", undefined, "https://acme.vercel.app"],
        ["acme", "example.dev", "https://acme.example.dev"],
        ["my-theme-2", "staging.example.dev", "https://my-theme-2.staging.example.dev"],
      ] as const) {
        const resolved = resolveSiteOrigin(null, {
          NEXT_PUBLIC_SITE_SUBDOMAIN: sub,
          ...(domain ? { VERCEL_CUSTOM_DOMAIN: domain } : {}),
        });
        expect(resolved).toBe(want);
        expect(new URL(resolved!).origin).toBe(resolved);
      }
    });
  });
});

describe("resolveLocale — D-11 never throws, never blank", () => {
  it("returns a valid stored siteLocale", () => {
    expect(resolveLocale({ siteLocale: "es-MX" })).toBe("es-MX");
  });

  it("falls back to DEFAULT_LOCALE for a whitespace-only value", () => {
    expect(resolveLocale({ siteLocale: "  " })).toBe(DEFAULT_LOCALE);
  });

  it("falls back to DEFAULT_LOCALE for an absent value", () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
  });

  it("falls back to DEFAULT_LOCALE for null/undefined site", () => {
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("falls back to DEFAULT_LOCALE for a value that is not a plausible BCP-47 tag", () => {
    expect(resolveLocale({ siteLocale: "12345" })).toBe(DEFAULT_LOCALE);
  });
});

describe("resolveHomepageSlugFrom — the shared three-tier ladder", () => {
  it("tier 1: prefers an explicitly flagged page over everything else", () => {
    expect(
      resolveHomepageSlugFrom([
        { slug: "about" },
        { slug: "home" },
        { isHomepage: true, slug: "landing" },
      ])
    ).toBe("landing");
  });

  it("tier 2: falls back to a conventionally-named slug when nothing is flagged", () => {
    for (const conventional of ["home", "homepage", "index"]) {
      expect(
        resolveHomepageSlugFrom([{ slug: "about" }, { slug: conventional }])
      ).toBe(conventional);
    }
  });

  it("tier 3: falls back to the first page when neither applies", () => {
    expect(
      resolveHomepageSlugFrom([{ slug: "about" }, { slug: "contact" }])
    ).toBe("about");
  });

  it("returns null for an empty, null or undefined page list", () => {
    expect(resolveHomepageSlugFrom([])).toBeNull();
    expect(resolveHomepageSlugFrom(null)).toBeNull();
    expect(resolveHomepageSlugFrom(undefined)).toBeNull();
  });

  it("ignores a falsy isHomepage without treating it as flagged", () => {
    expect(
      resolveHomepageSlugFrom([
        { isHomepage: false, slug: "about" },
        { isHomepage: true, slug: "real-home" },
      ])
    ).toBe("real-home");
  });
});

describe("resolveCanonicalPath — D-08 collapses the homepage to /", () => {
  it("returns / for an explicitly flagged homepage", () => {
    expect(resolveCanonicalPath({ isHomepage: true, slug: "home" })).toBe("/");
  });

  it("returns /{slug} for a non-homepage page", () => {
    expect(resolveCanonicalPath({ isHomepage: false, slug: "about" })).toBe(
      "/about"
    );
  });

  it("treats a missing isHomepage key as not-homepage", () => {
    expect(resolveCanonicalPath({ slug: "about" })).toBe("/about");
  });

  // CR-01 regression. The canonical decision used to honor only the
  // isHomepage flag while routing used the full three-tier ladder, so a
  // tenant with no flagged page served content at `/` whose canonical
  // pointed at `/{slug}` — the split link authority D-08 exists to close.
  it("returns / for an unflagged page that is the resolved homepage", () => {
    expect(resolveCanonicalPath({ slug: "home" }, "home")).toBe("/");
    expect(resolveCanonicalPath({ isHomepage: false, slug: "home" }, "home")).toBe(
      "/"
    );
  });

  it("still returns /{slug} for a page that is not the resolved homepage", () => {
    expect(resolveCanonicalPath({ slug: "about" }, "home")).toBe("/about");
  });

  it("does not collapse when the resolved homepage slug is absent or null", () => {
    expect(resolveCanonicalPath({ slug: "home" })).toBe("/home");
    expect(resolveCanonicalPath({ slug: "home" }, null)).toBe("/home");
  });

  it("agrees with the ladder for a tenant whose homepage is only conventional", () => {
    const pages = [{ slug: "about" }, { slug: "home" }];
    const homepageSlug = resolveHomepageSlugFrom(pages);
    expect(resolveCanonicalPath({ slug: "home" }, homepageSlug)).toBe("/");
    expect(resolveCanonicalPath({ slug: "about" }, homepageSlug)).toBe("/about");
  });

  it("agrees with the ladder for a tenant relying on the first-page fallback", () => {
    const pages = [{ slug: "landing" }, { slug: "about" }];
    const homepageSlug = resolveHomepageSlugFrom(pages);
    expect(resolveCanonicalPath({ slug: "landing" }, homepageSlug)).toBe("/");
    expect(resolveCanonicalPath({ slug: "about" }, homepageSlug)).toBe("/about");
  });
});

describe("absoluteUrl — trailing-slash policy, byte-for-byte path", () => {
  // AMENDED (Phase 14 Plan 07, G-14-5): the root resolves to the bare
  // origin, matching what Next itself renders for the canonical under the
  // default trailingSlash:false — see absoluteUrl's doc comment.
  it("joins the root path with no trailing slash, matching Next's own root canonical form", () => {
    expect(absoluteUrl("https://acme.com", "/")).toBe("https://acme.com");
  });

  it("joins a non-root path with no trailing slash", () => {
    expect(absoluteUrl("https://acme.com", "/about")).toBe(
      "https://acme.com/about"
    );
  });

  it("passes a percent-escaped or non-ASCII slug through byte-for-byte", () => {
    expect(absoluteUrl("https://acme.com", "/caf%C3%A9")).toBe(
      "https://acme.com/caf%C3%A9"
    );
  });
});

describe("buildLanguageAlternates — D-10 self-referential pair", () => {
  it("returns exactly two keys, the locale and x-default, both the canonical URL", () => {
    const result = buildLanguageAlternates("es", "https://acme.com/about");
    expect(Object.keys(result).sort()).toEqual(["es", "x-default"]);
    expect(result.es).toBe("https://acme.com/about");
    expect(result["x-default"]).toBe("https://acme.com/about");
  });
});

describe("resolveCanonicalOverride — SEOED-05 emission-side re-validation (D-16, 15 D-02)", () => {
  it("returns an absolute https URL with a path exactly as authored", () => {
    expect(resolveCanonicalOverride("https://acme.com/about")).toBe(
      "https://acme.com/about"
    );
  });

  it("returns a bare origin unchanged — a legitimate canonical value", () => {
    expect(resolveCanonicalOverride("https://acme.com")).toBe(
      "https://acme.com"
    );
  });

  it("trims surrounding whitespace and returns the trimmed value", () => {
    expect(resolveCanonicalOverride("  https://acme.com/about  ")).toBe(
      "https://acme.com/about"
    );
  });

  it("returns null for blank, whitespace-only, undefined or null candidates", () => {
    expect(resolveCanonicalOverride("")).toBeNull();
    expect(resolveCanonicalOverride("   ")).toBeNull();
    expect(resolveCanonicalOverride(undefined)).toBeNull();
    expect(resolveCanonicalOverride(null)).toBeNull();
  });

  it("does not upgrade http to https — D-16 is https-only", () => {
    expect(resolveCanonicalOverride("http://acme.com/about")).toBeNull();
  });

  it("rejects a relative path — cannot express canonical's off-origin use case", () => {
    expect(resolveCanonicalOverride("/about")).toBeNull();
  });

  it("rejects a protocol-relative //host value", () => {
    expect(resolveCanonicalOverride("//acme.com/about")).toBeNull();
  });

  it("rejects non-http(s) schemes, including dangerous ones", () => {
    expect(resolveCanonicalOverride("ftp://acme.com")).toBeNull();
    expect(resolveCanonicalOverride("javascript:alert(1)")).toBeNull();
    expect(resolveCanonicalOverride("data:text/html,x")).toBeNull();
  });

  it("does not auto-prefix a bare host — an unrecognized typo never becomes a live canonical", () => {
    expect(resolveCanonicalOverride("not a url")).toBeNull();
    expect(resolveCanonicalOverride("acme.com/about")).toBeNull();
  });

  it("never throws, even for a pathological input", () => {
    const pathological = "https://" + "a".repeat(10000) + ".com/" + "x".repeat(10000);
    expect(() => resolveCanonicalOverride(pathological)).not.toThrow();
  });
});

describe("resolveShareImage — CMS host absolutization, real dimensions only", () => {
  it("returns null for a nullish shareImage", () => {
    expect(resolveShareImage(null, "https://cms.example.com")).toBeNull();
    expect(resolveShareImage(undefined, "https://cms.example.com")).toBeNull();
  });

  it("returns null for a shareImage with no url", () => {
    expect(resolveShareImage({}, "https://cms.example.com")).toBeNull();
  });

  it("returns null for a whitespace-only url", () => {
    expect(
      resolveShareImage({ url: "  " }, "https://cms.example.com")
    ).toBeNull();
  });

  it("absolutizes a Strapi-relative url against the base, carrying width/height", () => {
    expect(
      resolveShareImage(
        { url: "/uploads/card.png", width: 1200, height: 630 },
        "https://cms.example.com"
      )
    ).toEqual({
      url: "https://cms.example.com/uploads/card.png",
      width: 1200,
      height: 630,
    });
  });

  it("uses a provider-hosted absolute url as-is, never re-prefixed", () => {
    expect(
      resolveShareImage(
        { url: "https://cdn.example.com/card.png" },
        "https://cms.example.com"
      )
    ).toEqual({ url: "https://cdn.example.com/card.png" });
  });

  it("returns null for a Strapi-relative path with no known Strapi base", () => {
    expect(
      resolveShareImage({ url: "/uploads/card.png" }, undefined)
    ).toBeNull();
  });

  // WR-01 regression. The base used to be taken as-is (trim + strip trailing
  // slash) with no parse, so an unusable value produced a non-null result
  // whose url was not a valid absolute URL — emitted into og:image as though
  // it had resolved, instead of degrading to D-04's no-image behavior.
  it("normalizes a protocol-less base rather than emitting a scheme-less url", () => {
    expect(
      resolveShareImage({ url: "/uploads/card.png" }, "cms.example.com")
    ).toEqual({ url: "https://cms.example.com/uploads/card.png" });
  });

  it("uses http for a protocol-less localhost base, matching strapi-client", () => {
    expect(
      resolveShareImage({ url: "/uploads/card.png" }, "localhost:1337")
    ).toEqual({ url: "http://localhost:1337/uploads/card.png" });
  });

  it("returns null for a base whose scheme is neither http nor https", () => {
    expect(
      resolveShareImage({ url: "/uploads/card.png" }, "ftp://cms.example.com")
    ).toBeNull();
  });

  it("returns null for an unparseable base", () => {
    for (const base of ["http://", "https://", "://cms.example.com"]) {
      expect(resolveShareImage({ url: "/uploads/card.png" }, base)).toBeNull();
    }
  });

  it("returns null for a blank or whitespace-only base", () => {
    expect(resolveShareImage({ url: "/uploads/card.png" }, "")).toBeNull();
    expect(resolveShareImage({ url: "/uploads/card.png" }, "   ")).toBeNull();
  });

  it("preserves a subpath on the base so a subpath-hosted Strapi still resolves", () => {
    expect(
      resolveShareImage(
        { url: "/uploads/card.png" },
        "https://example.com/cms"
      )
    ).toEqual({ url: "https://example.com/cms/uploads/card.png" });
  });

  it("strips trailing slashes on the base without doubling the separator", () => {
    expect(
      resolveShareImage({ url: "/uploads/card.png" }, "https://cms.example.com///")
    ).toEqual({ url: "https://cms.example.com/uploads/card.png" });
  });

  it("joins a base and a relative url that carries no leading slash", () => {
    expect(
      resolveShareImage({ url: "uploads/card.png" }, "https://cms.example.com")
    ).toEqual({ url: "https://cms.example.com/uploads/card.png" });
  });

  it("every non-null result is a parseable absolute http(s) URL", () => {
    const bases = [
      "https://cms.example.com",
      "cms.example.com",
      "localhost:1337",
      "https://example.com/cms",
      "https://cms.example.com///",
    ];
    for (const base of bases) {
      const result = resolveShareImage({ url: "/uploads/card.png" }, base);
      expect(result).not.toBeNull();
      const parsed = new URL(result!.url);
      expect(["http:", "https:"]).toContain(parsed.protocol);
    }
  });

  it("omits width/height keys entirely when they are null, never zero or guessed", () => {
    const result = resolveShareImage(
      { url: "/uploads/card.png", width: null, height: null },
      "https://cms.example.com"
    );
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("width");
    expect(result).not.toHaveProperty("height");
    expect(result?.url).toBe("https://cms.example.com/uploads/card.png");
  });
});

describe("buildPageMetadataFrom — the full assembled Metadata object", () => {
  const site: StrapiSite = { siteUrl: "https://acme.com", siteLocale: "en" };
  const env = { NEXT_PUBLIC_STRAPI_URL: "https://cms.example.com" };

  const basePage: StrapiPage = {
    documentId: "page-1",
    title: "About Us",
    slug: "about",
    publishedAt: "2026-01-01T00:00:00.000Z",
    isHomepage: false,
  };

  it("returns the not-found title for a nullish page, with no origin-derived fields", () => {
    const result = buildPageMetadataFrom(null, site, env);
    expect(result).toEqual({ title: NOT_FOUND_TITLE });
    expect(result).not.toHaveProperty("metadataBase");
    expect(result).not.toHaveProperty("alternates");
  });

  it("returns the not-found title for a page with a falsy publishedAt", () => {
    const result = buildPageMetadataFrom(
      { ...basePage, publishedAt: null },
      site,
      env
    );
    expect(result).toEqual({ title: NOT_FOUND_TITLE });
  });

  it("uses seo.title when set", () => {
    const page: StrapiPage = { ...basePage, seo: { title: "Custom SEO Title" } };
    const result = buildPageMetadataFrom(page, site, env);
    expect(result.title).toBe("Custom SEO Title");
  });

  it("falls back to page.title when seo.title is absent, null, or whitespace-only", () => {
    expect(buildPageMetadataFrom(basePage, site, env).title).toBe("About Us");
    expect(
      buildPageMetadataFrom({ ...basePage, seo: { title: null } }, site, env).title
    ).toBe("About Us");
    expect(
      buildPageMetadataFrom({ ...basePage, seo: { title: "   " } }, site, env)
        .title
    ).toBe("About Us");
  });

  it("emits the identical string once when seo.title equals page.title", () => {
    const page: StrapiPage = { ...basePage, seo: { title: "About Us" } };
    expect(buildPageMetadataFrom(page, site, env).title).toBe("About Us");
  });

  it("produces no description key at all when seo.description is absent, null, or whitespace-only", () => {
    expect(buildPageMetadataFrom(basePage, site, env)).not.toHaveProperty(
      "description"
    );
    expect(
      buildPageMetadataFrom({ ...basePage, seo: { description: null } }, site, env)
    ).not.toHaveProperty("description");
    expect(
      buildPageMetadataFrom(
        { ...basePage, seo: { description: "   " } },
        site,
        env
      )
    ).not.toHaveProperty("description");
  });

  it("carries a seo.title/description with multi-byte characters unchanged and un-truncated", () => {
    const emoji = "Café ☕️ résumé — 100% naïve façade 🎉".repeat(3);
    const page: StrapiPage = {
      ...basePage,
      seo: { title: emoji, description: emoji },
    };
    const result = buildPageMetadataFrom(page, site, env);
    expect(result.title).toBe(emoji);
    expect(result.description).toBe(emoji);
  });

  // AMENDED (Phase 14 Plan 07, G-14-5): the homepage canonical is now the
  // bare origin, not origin-plus-slash — see absoluteUrl's doc comment.
  it("emits an absolute canonical equal to the bare origin for the homepage regardless of slug", () => {
    const page: StrapiPage = { ...basePage, isHomepage: true, slug: "home" };
    const result = buildPageMetadataFrom(page, site, env) as {
      alternates?: { canonical?: string };
    };
    expect(result.alternates?.canonical).toBe("https://acme.com");
  });

  it("emits an absolute canonical equal to origin/{slug} for a non-homepage page", () => {
    const result = buildPageMetadataFrom(basePage, site, env) as {
      alternates?: { canonical?: string };
    };
    expect(result.alternates?.canonical).toBe("https://acme.com/about");
  });

  // SEOED-05 (Phase 16): canonical override wins across canonical, hreflang
  // and og:url when it is a valid absolute https URL; is ignored (falls back
  // to the computed canonical) when it isn't; and is fully additive (no
  // override changes nothing) when absent.
  describe("canonical override (SEOED-05, D-16)", () => {
    it("emits a valid override across alternates.canonical, openGraph.url and both hreflang entries", () => {
      const page: StrapiPage = {
        ...basePage,
        canonicalUrl: "https://other-domain.com/syndicated",
      };
      const result = buildPageMetadataFrom(page, site, env) as {
        alternates?: { canonical?: string; languages?: Record<string, string> };
        openGraph?: { url?: string };
      };
      expect(result.alternates?.canonical).toBe(
        "https://other-domain.com/syndicated"
      );
      expect(result.openGraph?.url).toBe(
        "https://other-domain.com/syndicated"
      );
      expect(result.alternates?.languages).toEqual({
        en: "https://other-domain.com/syndicated",
        "x-default": "https://other-domain.com/syndicated",
      });
    });

    it("is fully additive — removing the override reproduces the exact no-override result", () => {
      const withOverride: StrapiPage = {
        ...basePage,
        canonicalUrl: "https://other-domain.com/syndicated",
      };
      const withoutOverride: StrapiPage = { ...basePage };
      delete (withoutOverride as { canonicalUrl?: string | null }).canonicalUrl;

      const noOverrideResult = buildPageMetadataFrom(
        withoutOverride,
        site,
        env
      );
      expect(
        (noOverrideResult as { alternates?: { canonical?: string } })
          .alternates?.canonical
      ).toBe("https://acme.com/about");

      // Snapshot the no-override result, then prove the override changes
      // ONLY the canonical/hreflang/og:url — nothing else about the object.
      const withOverrideResult = buildPageMetadataFrom(
        withOverride,
        site,
        env
      ) as Record<string, unknown>;
      const noOverrideCopy = JSON.parse(
        JSON.stringify(noOverrideResult)
      ) as Record<string, unknown>;
      const withOverrideCopy = JSON.parse(
        JSON.stringify(withOverrideResult)
      ) as Record<string, unknown>;

      // Strip the fields the override is EXPECTED to change before comparing.
      delete (noOverrideCopy.alternates as Record<string, unknown>).canonical;
      delete (noOverrideCopy.alternates as Record<string, unknown>).languages;
      delete (noOverrideCopy.openGraph as Record<string, unknown>).url;
      delete (withOverrideCopy.alternates as Record<string, unknown>)
        .canonical;
      delete (withOverrideCopy.alternates as Record<string, unknown>)
        .languages;
      delete (withOverrideCopy.openGraph as Record<string, unknown>).url;
      expect(withOverrideCopy).toEqual(noOverrideCopy);
    });

    it.each([
      ["http (not upgraded)", "http://other-domain.com/x"],
      ["relative path", "/x"],
      ["unparseable", "not a url"],
    ])(
      "ignores an invalid override (%s) and falls back to the computed canonical",
      (_label, invalidOverride) => {
        const page: StrapiPage = { ...basePage, canonicalUrl: invalidOverride };
        const result = buildPageMetadataFrom(page, site, env) as {
          alternates?: { canonical?: string };
          openGraph?: { url?: string };
        };
        expect(result.alternates?.canonical).toBe("https://acme.com/about");
        expect(result.openGraph?.url).toBe("https://acme.com/about");
      }
    );

    it("still collapses the homepage to the bare origin when no override is set", () => {
      const page: StrapiPage = { ...basePage, isHomepage: true, slug: "home" };
      const result = buildPageMetadataFrom(page, site, env) as {
        alternates?: { canonical?: string };
      };
      expect(result.alternates?.canonical).toBe("https://acme.com");
    });

    it("an explicit valid override on the homepage outranks the collapse", () => {
      const page: StrapiPage = {
        ...basePage,
        isHomepage: true,
        slug: "home",
        canonicalUrl: "https://other-domain.com/home-override",
      };
      const result = buildPageMetadataFrom(page, site, env) as {
        alternates?: { canonical?: string };
        openGraph?: { url?: string };
      };
      expect(result.alternates?.canonical).toBe(
        "https://other-domain.com/home-override"
      );
      expect(result.openGraph?.url).toBe(
        "https://other-domain.com/home-override"
      );
    });

    it("does not smuggle a URL past the origin gate — no origin means no metadataBase/alternates/openGraph.url even with a valid override", () => {
      const page: StrapiPage = {
        ...basePage,
        canonicalUrl: "https://other-domain.com/x",
      };
      const result = buildPageMetadataFrom(page, {}, {}) as Record<
        string,
        unknown
      >;
      expect(result).not.toHaveProperty("metadataBase");
      expect(result).not.toHaveProperty("alternates");
      const openGraph = result.openGraph as Record<string, unknown> | undefined;
      expect(openGraph).not.toHaveProperty("url");
    });

    it("an unpublished page still returns only the not-found title, override or not", () => {
      const page: StrapiPage = {
        ...basePage,
        publishedAt: null,
        canonicalUrl: "https://other-domain.com/x",
      };
      expect(buildPageMetadataFrom(page, site, env)).toEqual({
        title: NOT_FOUND_TITLE,
      });
    });
  });

  it("omits metadataBase, alternates and openGraph.url when the origin does not resolve", () => {
    const result = buildPageMetadataFrom(basePage, {}, {}) as Record<
      string,
      unknown
    >;
    expect(result).not.toHaveProperty("metadataBase");
    expect(result).not.toHaveProperty("alternates");
    const openGraph = result.openGraph as Record<string, unknown> | undefined;
    expect(openGraph).not.toHaveProperty("url");

    // No string value anywhere in the object begins with "/" (no relative URL).
    const check = (val: unknown): void => {
      if (typeof val === "string") {
        expect(val.startsWith("/")).toBe(false);
      } else if (Array.isArray(val)) {
        val.forEach(check);
      } else if (val !== null && typeof val === "object") {
        Object.values(val).forEach(check);
      }
    };
    check(result);
  });

  it("emits robots noindex:false,follow:true when seo.noindex is absent, null, or false", () => {
    expect(buildPageMetadataFrom(basePage, site, env).robots).toEqual({
      index: true,
      follow: true,
    });
    expect(
      buildPageMetadataFrom({ ...basePage, seo: { noindex: null } }, site, env)
        .robots
    ).toEqual({ index: true, follow: true });
    expect(
      buildPageMetadataFrom({ ...basePage, seo: { noindex: false } }, site, env)
        .robots
    ).toEqual({ index: true, follow: true });
  });

  it("emits robots noindex:true when seo.noindex is true", () => {
    expect(
      buildPageMetadataFrom({ ...basePage, seo: { noindex: true } }, site, env)
        .robots
    ).toEqual({ index: false, follow: true });
  });

  it("never reads site.seo — a divergent site.seo.title never appears in the result", () => {
    const divergentSite: StrapiSite = {
      ...site,
      seo: { title: "SITE-LEVEL TITLE SHOULD NEVER APPEAR" },
    };
    const result = JSON.stringify(buildPageMetadataFrom(basePage, divergentSite, env));
    expect(result).not.toContain("SITE-LEVEL TITLE SHOULD NEVER APPEAR");
  });

  it("emits og:title/twitter:title identical to the top-level title, even when redundant", () => {
    const result = buildPageMetadataFrom(basePage, site, env) as {
      openGraph?: { title?: string };
      twitter?: { title?: string };
      title?: string;
    };
    expect(result.openGraph?.title).toBe(result.title);
    expect(result.twitter?.title).toBe(result.title);
  });

  it("emits og:type=website, twitter:card=summary and no image keys when there is no share image", () => {
    const result = buildPageMetadataFrom(basePage, site, env) as {
      openGraph?: Record<string, unknown>;
      twitter?: Record<string, unknown>;
    };
    expect(result.openGraph?.type).toBe("website");
    expect(result.twitter?.card).toBe("summary");
    expect(result.openGraph).not.toHaveProperty("images");
    expect(result.twitter).not.toHaveProperty("images");
  });

  it("emits og:image with real width/height and twitter:card=summary_large_image when a share image resolves", () => {
    const page: StrapiPage = {
      ...basePage,
      seo: {
        shareImage: { url: "/uploads/card.png", width: 1200, height: 630 },
      },
    };
    const result = buildPageMetadataFrom(page, site, env) as {
      openGraph?: { images?: Array<{ url: string; width?: number; height?: number }> };
      twitter?: { card?: string; images?: string[] };
    };
    expect(result.openGraph?.images).toEqual([
      {
        url: "https://cms.example.com/uploads/card.png",
        width: 1200,
        height: 630,
      },
    ]);
    expect(result.twitter?.card).toBe("summary_large_image");
    expect(result.twitter?.images).toEqual([
      "https://cms.example.com/uploads/card.png",
    ]);
  });

  it("behaves identically to the no-image case when shareImage is unresolvable (blank url)", () => {
    const page: StrapiPage = { ...basePage, seo: { shareImage: { url: "  " } } };
    const result = buildPageMetadataFrom(page, site, env) as {
      openGraph?: Record<string, unknown>;
      twitter?: Record<string, unknown>;
    };
    expect(result.twitter?.card).toBe("summary");
    expect(result.openGraph).not.toHaveProperty("images");
    expect(result.twitter).not.toHaveProperty("images");
  });

  it("behaves identically to the no-image case when shareImage has no Strapi base", () => {
    const page: StrapiPage = {
      ...basePage,
      seo: { shareImage: { url: "/uploads/card.png" } },
    };
    const result = buildPageMetadataFrom(page, site, {}) as {
      openGraph?: Record<string, unknown>;
      twitter?: Record<string, unknown>;
    };
    expect(result.twitter?.card).toBe("summary");
    expect(result.openGraph).not.toHaveProperty("images");
  });
});

describe("buildPageMetadataFrom — SEOED-06 site-description inheritance tier (D-10)", () => {
  const site: StrapiSite = { siteUrl: "https://acme.com", siteLocale: "en" };
  const env = { NEXT_PUBLIC_STRAPI_URL: "https://cms.example.com" };

  const basePage: StrapiPage = {
    documentId: "page-1",
    title: "About Us",
    slug: "about",
    publishedAt: "2026-01-01T00:00:00.000Z",
    isHomepage: false,
  };

  it("inherits the site default description when the page's own description is blank", () => {
    const page: StrapiPage = { ...basePage, seo: { description: null } };
    const siteWithDescription: StrapiSite = {
      ...site,
      seo: { description: "We make delightful widgets" },
    };
    const result = buildPageMetadataFrom(page, siteWithDescription, env) as {
      description?: string;
      openGraph?: { description?: string };
      twitter?: { description?: string };
    };
    expect(result.description).toBe("We make delightful widgets");
    expect(result.openGraph?.description).toBe("We make delightful widgets");
    expect(result.twitter?.description).toBe("We make delightful widgets");
  });

  it("prefers the page's own description over a site default when both are present (SITE-03 / ordering)", () => {
    const page: StrapiPage = {
      ...basePage,
      seo: { description: "Page-specific description" },
    };
    const siteWithDescription: StrapiSite = {
      ...site,
      seo: { description: "Site default should not win" },
    };
    const result = buildPageMetadataFrom(page, siteWithDescription, env);
    expect(result.description).toBe("Page-specific description");
  });

  it("treats a whitespace-only page description as blank and inherits the site value (SITE-03 / empty)", () => {
    const page: StrapiPage = { ...basePage, seo: { description: "   " } };
    const siteWithDescription: StrapiSite = {
      ...site,
      seo: { description: "We make delightful widgets" },
    };
    const result = buildPageMetadataFrom(page, siteWithDescription, env);
    expect(result.description).toBe("We make delightful widgets");
  });

  it("omits the description key when both page and site descriptions are blank (D-10)", () => {
    const page: StrapiPage = { ...basePage, seo: { description: null } };
    const blankSite: StrapiSite = { ...site, seo: { description: null } };
    const result = buildPageMetadataFrom(page, blankSite, env) as {
      openGraph?: Record<string, unknown>;
      twitter?: Record<string, unknown>;
    };
    expect(result).not.toHaveProperty("description");
    expect(result.openGraph).not.toHaveProperty("description");
    expect(result.twitter).not.toHaveProperty("description");
  });

  it("omits the description key when both page and site descriptions are whitespace-only (SITE-03 / empty)", () => {
    const page: StrapiPage = { ...basePage, seo: { description: "   " } };
    const whitespaceSite: StrapiSite = { ...site, seo: { description: "   " } };
    const result = buildPageMetadataFrom(page, whitespaceSite, env);
    expect(result).not.toHaveProperty("description");
  });

  it("emits the value exactly once with no de-duplication marker when page and site descriptions are byte-identical (SITE-03 / adjacency)", () => {
    const identical = "Exactly the same copy";
    const page: StrapiPage = { ...basePage, seo: { description: identical } };
    const identicalSite: StrapiSite = {
      ...site,
      seo: { description: identical },
    };
    const result = buildPageMetadataFrom(page, identicalSite, env);
    expect(result.description).toBe(identical);
  });

  it("does not change the title resolution — title still hard-falls-back to page.title with no site tier (D-10 asymmetry)", () => {
    const page: StrapiPage = { ...basePage, seo: { title: null } };
    const siteWithTitle: StrapiSite = {
      ...site,
      seo: { title: "Site title should not win" },
    };
    const result = buildPageMetadataFrom(page, siteWithTitle, env);
    expect(result.title).toBe(page.title);
  });
});

describe("resolveSiteDefaults — D-12, whitespace treated as unset, no hard fallback", () => {
  it("returns no keys for null, undefined, or an empty site", () => {
    expect(resolveSiteDefaults(null)).toEqual({});
    expect(resolveSiteDefaults(undefined)).toEqual({});
    expect(resolveSiteDefaults({})).toEqual({});
  });

  it("returns siteName and title (falling back to the bare name) when only name is set", () => {
    expect(resolveSiteDefaults({ name: "Acme" })).toEqual({
      siteName: "Acme",
      title: "Acme",
    });
  });

  it("prefers the site-level seo.title over the bare name", () => {
    expect(
      resolveSiteDefaults({ name: "Acme", seo: { title: "Acme — Widgets" } })
    ).toEqual({ siteName: "Acme", title: "Acme — Widgets" });
  });

  it("treats whitespace-only name/title/description as unset — no keys emitted", () => {
    expect(
      resolveSiteDefaults({ name: "  ", seo: { title: "  ", description: "  " } })
    ).toEqual({});
  });

  it("returns description with no title when only seo.description is set", () => {
    expect(resolveSiteDefaults({ seo: { description: "We make widgets" } })).toEqual(
      { description: "We make widgets" }
    );
  });
});

describe("buildPageMetadataFrom — SITE-02/SEOED-03/SEOED-06 share-image site fallback tier", () => {
  const site: StrapiSite = { siteUrl: "https://acme.com", siteLocale: "en" };
  const env = { NEXT_PUBLIC_STRAPI_URL: "https://cms.example.com" };

  const basePage: StrapiPage = {
    documentId: "page-1",
    title: "About Us",
    slug: "about",
    publishedAt: "2026-01-01T00:00:00.000Z",
    isHomepage: false,
  };

  it("the page image wins when both the page and site tiers resolve", () => {
    const page: StrapiPage = {
      ...basePage,
      seo: { shareImage: { url: "/uploads/page-card.png", width: 1200, height: 630 } },
    };
    const siteWithImage: StrapiSite = {
      ...site,
      seo: { shareImage: { url: "/uploads/site-card.png", width: 800, height: 400 } },
    };
    const result = buildPageMetadataFrom(page, siteWithImage, env) as {
      openGraph?: { images?: Array<{ url: string }> };
    };
    expect(result.openGraph?.images).toEqual([
      { url: "https://cms.example.com/uploads/page-card.png", width: 1200, height: 630 },
    ]);
  });

  it("uses the site fallback, with real width/height carried through, when the page tier is blank", () => {
    const page: StrapiPage = { ...basePage, seo: { shareImage: null } };
    const siteWithImage: StrapiSite = {
      ...site,
      seo: { shareImage: { url: "/uploads/site-card.png", width: 800, height: 400 } },
    };
    const result = buildPageMetadataFrom(page, siteWithImage, env) as {
      openGraph?: { images?: Array<{ url: string; width?: number; height?: number }> };
      twitter?: { card?: string; images?: string[] };
    };
    expect(result.openGraph?.images).toEqual([
      { url: "https://cms.example.com/uploads/site-card.png", width: 800, height: 400 },
    ]);
    expect(result.twitter?.card).toBe("summary_large_image");
    expect(result.twitter?.images).toEqual([
      "https://cms.example.com/uploads/site-card.png",
    ]);
  });

  it("falls through to the site tier when the page tier is present but unresolvable (blank url)", () => {
    const page: StrapiPage = { ...basePage, seo: { shareImage: { url: "  " } } };
    const siteWithImage: StrapiSite = {
      ...site,
      seo: { shareImage: { url: "/uploads/site-card.png" } },
    };
    const result = buildPageMetadataFrom(page, siteWithImage, env) as {
      openGraph?: { images?: Array<{ url: string }> };
    };
    expect(result.openGraph?.images).toEqual([
      { url: "https://cms.example.com/uploads/site-card.png" },
    ]);
  });

  it("falls through to the site tier when the page tier is present but the Strapi base is unusable", () => {
    const page: StrapiPage = {
      ...basePage,
      seo: { shareImage: { url: "/uploads/page-card.png" } },
    };
    const siteWithImage: StrapiSite = {
      ...site,
      seo: { shareImage: { url: "https://cdn.example.com/site-card.png" } },
    };
    // No NEXT_PUBLIC_STRAPI_URL — the page tier's relative url can't resolve,
    // but the site tier's ABSOLUTE url needs no base at all.
    const result = buildPageMetadataFrom(page, siteWithImage, {}) as {
      openGraph?: { images?: Array<{ url: string }> };
    };
    expect(result.openGraph?.images).toEqual([
      { url: "https://cdn.example.com/site-card.png" },
    ]);
  });

  it("omits openGraph.images entirely and sets twitter.card to summary when neither tier resolves", () => {
    const result = buildPageMetadataFrom(basePage, site, env) as {
      openGraph?: Record<string, unknown>;
      twitter?: Record<string, unknown>;
    };
    expect(result.openGraph).not.toHaveProperty("images");
    expect(result.twitter).not.toHaveProperty("images");
    expect(result.twitter?.card).toBe("summary");
  });

  it("emits exactly one image entry with no de-duplication branch when both tiers resolve to the identical URL", () => {
    const page: StrapiPage = {
      ...basePage,
      seo: { shareImage: { url: "/uploads/same-card.png" } },
    };
    const siteWithImage: StrapiSite = {
      ...site,
      seo: { shareImage: { url: "/uploads/same-card.png" } },
    };
    const result = buildPageMetadataFrom(page, siteWithImage, env) as {
      openGraph?: { images?: Array<{ url: string }> };
      twitter?: { images?: string[] };
    };
    expect(result.openGraph?.images).toHaveLength(1);
    expect(result.openGraph?.images).toEqual([
      { url: "https://cms.example.com/uploads/same-card.png" },
    ]);
    expect(result.twitter?.images).toEqual([
      "https://cms.example.com/uploads/same-card.png",
    ]);
  });
});

describe("normalizeVerificationToken — the theme-site's defensive emission-side twin (Pitfall 6, D-02)", () => {
  // Deliberate duplication of lib/seo/normalize-verification-token.ts (Plan
  // 15-02): the dashboard and this template are separate apps with no
  // shared import path, and a value written through Strapi's own admin UI
  // or by an older client never passes through the dashboard's normalizer —
  // D-02's "reject on save AND ignore at emission" defense-in-depth posture
  // for exactly this reason. These cases pin BOTH implementations to the
  // SAME behavior so a future edit to one surfaces as a failure here.
  it("returns a bare token unchanged", () => {
    expect(normalizeVerificationToken("abc123DEF")).toBe("abc123DEF");
  });

  it("trims a padded bare token", () => {
    expect(normalizeVerificationToken("  abc123  ")).toBe("abc123");
  });

  it("extracts the content value from a double-quoted Google snippet", () => {
    expect(
      normalizeVerificationToken(
        '<meta name="google-site-verification" content="abc123" />'
      )
    ).toBe("abc123");
  });

  it("extracts the content value from a single-quoted snippet with no self-closing slash", () => {
    expect(
      normalizeVerificationToken(
        "<meta name='google-site-verification' content='abc123'>"
      )
    ).toBe("abc123");
  });

  it("extracts the content value regardless of attribute order (content before name)", () => {
    expect(
      normalizeVerificationToken(
        '<meta content="abc123" name="google-site-verification" />'
      )
    ).toBe("abc123");
  });

  it("extracts the content value from a Bing (msvalidate.01) snippet", () => {
    expect(
      normalizeVerificationToken('<meta name="msvalidate.01" content="XYZ789" />')
    ).toBe("XYZ789");
  });

  it("extracts the content value from a Yandex (yandex-verification) snippet", () => {
    expect(
      normalizeVerificationToken(
        '<meta name="yandex-verification" content="verifyMe123" />'
      )
    ).toBe("verifyMe123");
  });

  it("returns null when the content attribute is empty", () => {
    expect(
      normalizeVerificationToken('<meta name="google-site-verification" content="" />')
    ).toBeNull();
  });

  it("returns null for blank-ish inputs", () => {
    expect(normalizeVerificationToken("")).toBeNull();
    expect(normalizeVerificationToken("   ")).toBeNull();
    expect(normalizeVerificationToken(null)).toBeNull();
    expect(normalizeVerificationToken(undefined)).toBeNull();
  });

  it("returns null (never the raw text) for unreducible tag-shaped input", () => {
    expect(normalizeVerificationToken("<script>alert(1)</script>")).toBeNull();
  });

  it("returns null for a bare token that happens to contain an angle bracket", () => {
    expect(normalizeVerificationToken("abc<123")).toBeNull();
    expect(normalizeVerificationToken("abc>123")).toBeNull();
  });

  it("never throws for any of these inputs", () => {
    const inputs = [
      "abc123DEF",
      "  abc123  ",
      '<meta name="google-site-verification" content="abc123" />',
      "<script>alert(1)</script>",
      "abc<123",
      "",
      "   ",
      null,
      undefined,
    ];
    for (const input of inputs) {
      expect(() => normalizeVerificationToken(input)).not.toThrow();
    }
  });
});

describe("resolveSiteTitleTemplate — SITE-01 read side", () => {
  it("returns the trimmed titleTemplate when non-blank", () => {
    expect(resolveSiteTitleTemplate({ titleTemplate: "  %s | Brand  " })).toBe(
      "%s | Brand"
    );
  });

  it("returns undefined for a blank, whitespace-only, null, or absent titleTemplate", () => {
    expect(resolveSiteTitleTemplate({ titleTemplate: "" })).toBeUndefined();
    expect(resolveSiteTitleTemplate({ titleTemplate: "   " })).toBeUndefined();
    expect(resolveSiteTitleTemplate({ titleTemplate: null })).toBeUndefined();
    expect(resolveSiteTitleTemplate({})).toBeUndefined();
    expect(resolveSiteTitleTemplate(null)).toBeUndefined();
    expect(resolveSiteTitleTemplate(undefined)).toBeUndefined();
  });
});

describe("resolveVerification — SITE-04, Bing routed through other[\"msvalidate.01\"] (Pitfall 5)", () => {
  it("returns undefined when all three provider fields are blank", () => {
    expect(resolveVerification({})).toBeUndefined();
    expect(
      resolveVerification({
        verificationGoogle: "",
        verificationBing: "   ",
        verificationYandex: null,
      })
    ).toBeUndefined();
  });

  it("maps a non-blank Google value to the first-class google key", () => {
    expect(resolveVerification({ verificationGoogle: "abc" })).toEqual({
      google: "abc",
    });
  });

  it("maps a non-blank Yandex value to the first-class yandex key", () => {
    expect(resolveVerification({ verificationYandex: "ghi" })).toEqual({
      yandex: "ghi",
    });
  });

  it("maps a non-blank Bing value to other[\"msvalidate.01\"] and never emits a bing key", () => {
    const result = resolveVerification({ verificationBing: "def" });
    expect(result).toEqual({ other: { "msvalidate.01": "def" } });
    expect(result).not.toHaveProperty("bing");
  });

  it("emits all three simultaneously when all three are set", () => {
    expect(
      resolveVerification({
        verificationGoogle: "abc",
        verificationBing: "def",
        verificationYandex: "ghi",
      })
    ).toEqual({
      google: "abc",
      yandex: "ghi",
      other: { "msvalidate.01": "def" },
    });
  });

  // Ahrefs (2026-08-10) has no first-class Next Verification key either, so it
  // shares the `other` record with Bing. The merge is the part that matters:
  // two independent `result.other = {...}` assignments would silently drop
  // whichever ran first, and the symptom — one verification quietly never
  // confirming — is invisible from the outside.
  it("maps a non-blank Ahrefs value to other[\"ahrefs-site-verification\"]", () => {
    const result = resolveVerification({ verificationAhrefs: "5c71459c" });
    expect(result).toEqual({ other: { "ahrefs-site-verification": "5c71459c" } });
    expect(result).not.toHaveProperty("ahrefs");
  });

  it("MERGES Bing and Ahrefs into one `other` record rather than clobbering", () => {
    expect(
      resolveVerification({ verificationBing: "def", verificationAhrefs: "5c71459c" })
    ).toEqual({
      other: { "msvalidate.01": "def", "ahrefs-site-verification": "5c71459c" },
    });
  });

  it("emits all four simultaneously", () => {
    expect(
      resolveVerification({
        verificationGoogle: "abc",
        verificationBing: "def",
        verificationYandex: "ghi",
        verificationAhrefs: "jkl",
      })
    ).toEqual({
      google: "abc",
      yandex: "ghi",
      other: { "msvalidate.01": "def", "ahrefs-site-verification": "jkl" },
    });
  });

  it("extracts the Ahrefs token from the whole <meta> snippet the vendor hands you", () => {
    expect(
      resolveVerification({
        verificationAhrefs:
          '<meta name="ahrefs-site-verification" content="5c71459c6db1ebf6f4a8b121d511b8c92b431301f1c640a9d40c1df1c35e71fc">',
      })
    ).toEqual({
      other: {
        "ahrefs-site-verification":
          "5c71459c6db1ebf6f4a8b121d511b8c92b431301f1c640a9d40c1df1c35e71fc",
      },
    });
  });

  it("runs each raw value through the defensive normalizer — a whole <meta> snippet yields the bare token", () => {
    expect(
      resolveVerification({
        verificationGoogle: '<meta name="google-site-verification" content="abc123" />',
      })
    ).toEqual({ google: "abc123" });
  });

  it("emits no key for a provider whose value is unreducible tag-shaped input", () => {
    const result = resolveVerification({
      verificationGoogle: "<script>alert(1)</script>",
      verificationYandex: "ghi",
    });
    expect(result).toEqual({ yandex: "ghi" });
    expect(result).not.toHaveProperty("google");
  });
});

describe("buildSiteMetadataFrom — the root layout's site-level default Metadata", () => {
  it("returns no title, no description, no metadataBase and no openGraph key for a null site", () => {
    const result = buildSiteMetadataFrom(null, {});
    expect(result).not.toHaveProperty("title");
    expect(result).not.toHaveProperty("description");
    expect(result).not.toHaveProperty("metadataBase");
    expect(result).not.toHaveProperty("openGraph");
  });

  it("emits title, a metadataBase whose href is the origin, and openGraph.siteName when the origin resolves", () => {
    const result = buildSiteMetadataFrom(
      { name: "Acme", siteUrl: "https://acme.com" },
      {}
    ) as { title?: string; metadataBase?: URL; openGraph?: { siteName?: string } };
    expect(result.title).toBe("Acme");
    expect(result.metadataBase?.href).toBe("https://acme.com/");
    expect(result.openGraph?.siteName).toBe("Acme");
  });

  it("emits title and openGraph.siteName but no metadataBase when no origin resolves, and no relative URL anywhere", () => {
    const result = buildSiteMetadataFrom({ name: "Acme" }, {}) as Record<
      string,
      unknown
    >;
    expect(result).not.toHaveProperty("metadataBase");
    const openGraph = result.openGraph as Record<string, unknown> | undefined;
    expect(openGraph?.siteName).toBe("Acme");

    const check = (val: unknown): void => {
      if (typeof val === "string") {
        expect(val.startsWith("/")).toBe(false);
      } else if (Array.isArray(val)) {
        val.forEach(check);
      } else if (val !== null && typeof val === "object") {
        Object.values(val).forEach(check);
      }
    };
    check(result);
  });

  // AMENDED (Phase 15, Plan 03): 14-03-D2's containment (the layout builder
  // deliberately emitting NEITHER a title template NOR a verification block)
  // is lifted here. SITE-01/SITE-04 now wire both through this pure builder.
  it("emits title as {template, default} and a verification block when titleTemplate/verification* are set (SITE-01/SITE-04, 14-03-D2 lifted)", () => {
    const site = {
      name: "Acme",
      siteUrl: "https://acme.com",
      titleTemplate: "%s | Acme",
      verificationGoogle: "abc",
      verificationBing: "def",
      verificationYandex: "ghi",
    };
    const result = buildSiteMetadataFrom(site, {}) as {
      title?: { template: string; default: string };
      verification?: Record<string, unknown>;
    };
    expect(result.title).toEqual({ template: "%s | Acme", default: "Acme" });
    expect(result.verification).toEqual({
      google: "abc",
      yandex: "ghi",
      other: { "msvalidate.01": "def" },
    });
    expect(result.verification).not.toHaveProperty("bing");
  });

  it("is byte-identical to the pre-Phase-15 plain-string title behavior when no titleTemplate is set", () => {
    const result = buildSiteMetadataFrom(
      { name: "Acme", siteUrl: "https://acme.com" },
      {}
    ) as Record<string, unknown>;
    expect(result.title).toBe("Acme");
    expect(result).not.toHaveProperty("verification");
  });

  it("returns no alternates and no robots key — those are page-level concerns", () => {
    const result = buildSiteMetadataFrom(
      { name: "Acme", siteUrl: "https://acme.com", siteLocale: "es-MX" },
      {}
    );
    expect(result).not.toHaveProperty("alternates");
    expect(result).not.toHaveProperty("robots");
  });
});

describe("buildPageMetadataFrom — rendered head, og:site_name (G-14-4)", () => {
  // The layout emits metadata.openGraph = { siteName } (buildSiteMetadataFrom),
  // but Next REPLACES openGraph wholesale rather than deep-merging it against a
  // page that defines its own openGraph object — which is every page. These
  // assertions run the PAGE builder's output through Next's own resolvers and
  // generators, the layer where that loss actually happens and where every
  // pure-resolver unit test above is blind to it.
  const namedSite: StrapiSite = {
    name: "Acme Widgets",
    siteUrl: "https://acme.com",
    siteLocale: "en",
  };
  const env = { NEXT_PUBLIC_STRAPI_URL: "https://cms.example.com" };
  const page: StrapiPage = {
    documentId: "page-1",
    title: "About Us",
    slug: "about",
    publishedAt: "2026-01-01T00:00:00.000Z",
    isHomepage: false,
  };

  it("renders og:site_name on a page that also carries its own page-level OpenGraph block", () => {
    const metadata = buildPageMetadataFrom(page, namedSite, env);
    const html = renderHeadTags(metadata, { pathname: "/about" });

    expect(html).toContain('property="og:site_name"');
    expect(html).toContain('content="Acme Widgets"');
    // The page's own OpenGraph fields still render alongside it — proving the
    // page-level block is what carries siteName now, not a separate layout pass.
    expect(html).toContain('property="og:title"');
    expect(html).toContain('property="og:type"');
  });

  it("emits no og:site_name tag at all for a site with no name (null, absent, or whitespace-only)", () => {
    for (const site of [
      { ...namedSite, name: null },
      { siteUrl: namedSite.siteUrl, siteLocale: namedSite.siteLocale },
      { ...namedSite, name: "   " },
    ]) {
      const metadata = buildPageMetadataFrom(page, site, env);
      const html = renderHeadTags(metadata, { pathname: "/about" });
      expect(html).not.toContain("og:site_name");
    }
  });

  // AMENDED (Phase 15, SEOED-06/D-10): the title half of this guard is
  // unchanged — the page builder must still never adopt the site-level SEO
  // TITLE. The description half has deliberately changed: Phase 15 wires the
  // page-to-site-default description fallback chain, so a blank-SEO page's
  // description now DOES inherit the site's seo.description (D-10 asymmetry
  // — title hard-falls-back to page.title with no site tier; description
  // does inherit).
  it("still never adopts the site-level SEO title for a blank-SEO page, but does inherit the site description (SEOED-06)", () => {
    const siteWithSeoAuthored: StrapiSite = {
      ...namedSite,
      seo: {
        title: "SITE-LEVEL TITLE SHOULD NEVER APPEAR",
        description: "Site-level description now inherits per SEOED-06",
      },
    };
    const blankSeoPage: StrapiPage = { ...page, seo: { title: null, description: null } };

    const result = buildPageMetadataFrom(blankSeoPage, siteWithSeoAuthored, env);

    expect(result.title).toBe(page.title);
    expect(result.description).toBe(
      "Site-level description now inherits per SEOED-06"
    );
  });
});
