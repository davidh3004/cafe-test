import { describe, expect, it } from "vitest";

// Phase 18 (SEO): structured data. Same convention as seo-resolve.test.ts —
// synthetic StrapiPage/StrapiSite shapes, plain-object env, no mocking.
import { buildJsonLdGraph, serializeJsonLd } from "../jsonld";
import { buildPageMetadataFrom } from "../seo-resolve";
import type { StrapiPage, StrapiSite } from "../strapi-client";

const ORIGIN = "https://acme.com";

const site: StrapiSite = {
  name: "Acme",
  siteUrl: ORIGIN,
  siteLocale: "es-MX",
};

const page: StrapiPage = {
  documentId: "page_servicios",
  title: "Servicios",
  slug: "servicios",
  publishedAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-05T12:30:00.000Z",
};

/** The node of a given @type from a built graph. */
function nodeOf(graph: Record<string, unknown> | null, type: string) {
  const nodes = (graph?.["@graph"] ?? []) as Record<string, unknown>[];
  return nodes.find((n) => n["@type"] === type);
}

describe("buildJsonLdGraph — emits nothing rather than something invented", () => {
  it("returns null for a missing page", () => {
    expect(buildJsonLdGraph(null, site, {})).toBeNull();
    expect(buildJsonLdGraph(undefined, site, {})).toBeNull();
  });

  it("returns null for an unpublished page — a 404 must not claim to be a WebPage", () => {
    expect(
      buildJsonLdGraph({ ...page, publishedAt: null }, site, {})
    ).toBeNull();
  });

  it("returns null when no origin resolves — every @id in the graph is absolute", () => {
    expect(buildJsonLdGraph(page, { name: "Acme" }, {})).toBeNull();
    expect(buildJsonLdGraph(page, null, {})).toBeNull();
  });

  it("returns null when the page has no resolvable name", () => {
    expect(
      buildJsonLdGraph({ ...page, title: "   " }, site, {})
    ).toBeNull();
  });

  it("omits the Organization node (and the WebSite's publisher/name) when the site has no name", () => {
    const graph = buildJsonLdGraph(page, { siteUrl: ORIGIN }, {});

    expect(nodeOf(graph, "Organization")).toBeUndefined();
    const website = nodeOf(graph, "WebSite");
    expect(website).toBeDefined();
    expect("publisher" in website!).toBe(false);
    expect("name" in website!).toBe(false);
  });

  it("omits description entirely when neither the page nor the site has one", () => {
    const webPage = nodeOf(buildJsonLdGraph(page, site, {}), "WebPage");
    expect("description" in webPage!).toBe(false);
  });

  it("omits primaryImageOfPage when no share image resolves", () => {
    const webPage = nodeOf(buildJsonLdGraph(page, site, {}), "WebPage");
    expect("primaryImageOfPage" in webPage!).toBe(false);
  });

  it("omits an unparseable date rather than emitting it or substituting now()", () => {
    const webPage = nodeOf(
      buildJsonLdGraph(
        { ...page, publishedAt: "last Tuesday", updatedAt: "   " },
        site,
        {}
      ),
      "WebPage"
    );

    // publishedAt is unparseable but TRUTHY, so the page is still published —
    // the graph is emitted, minus the two date claims.
    expect(webPage).toBeDefined();
    expect("datePublished" in webPage!).toBe(false);
    expect("dateModified" in webPage!).toBe(false);
  });
});

describe("buildJsonLdGraph — the graph's shape", () => {
  it("emits Organization, WebSite and WebPage cross-referenced by @id", () => {
    const graph = buildJsonLdGraph(page, site, {})!;

    expect(graph["@context"]).toBe("https://schema.org");

    const org = nodeOf(graph, "Organization")!;
    const website = nodeOf(graph, "WebSite")!;
    const webPage = nodeOf(graph, "WebPage")!;

    expect(org["@id"]).toBe(`${ORIGIN}/#organization`);
    expect(org).toMatchObject({ name: "Acme", url: ORIGIN });

    expect(website["@id"]).toBe(`${ORIGIN}/#website`);
    expect(website.publisher).toEqual({ "@id": org["@id"] });

    expect(webPage["@id"]).toBe(`${ORIGIN}/servicios#webpage`);
    expect(webPage.isPartOf).toEqual({ "@id": website["@id"] });
  });

  it("carries the resolved locale as inLanguage on both WebSite and WebPage", () => {
    const graph = buildJsonLdGraph(page, site, {})!;

    expect(nodeOf(graph, "WebSite")!.inLanguage).toBe("es-MX");
    expect(nodeOf(graph, "WebPage")!.inLanguage).toBe("es-MX");
  });

  it("emits the page's own dates verbatim, never re-serialized", () => {
    const webPage = nodeOf(buildJsonLdGraph(page, site, {}), "WebPage")!;

    expect(webPage.datePublished).toBe("2026-08-01T10:00:00.000Z");
    expect(webPage.dateModified).toBe("2026-08-05T12:30:00.000Z");
  });

  it("resolves the description through the page-then-site tiers", () => {
    const pageTier = nodeOf(
      buildJsonLdGraph(
        { ...page, seo: { description: "Nuestros servicios" } },
        { ...site, seo: { description: "Acme México" } },
        {}
      ),
      "WebPage"
    )!;
    expect(pageTier.description).toBe("Nuestros servicios");

    const siteTier = nodeOf(
      buildJsonLdGraph(
        { ...page, seo: { description: "  " } },
        { ...site, seo: { description: "Acme México" } },
        {}
      ),
      "WebPage"
    )!;
    expect(siteTier.description).toBe("Acme México");
  });

  it("resolves the image against the CMS host, with real dimensions only", () => {
    const webPage = nodeOf(
      buildJsonLdGraph(
        {
          ...page,
          seo: { shareImage: { url: "/uploads/card.png", width: 1200, height: 630 } },
        },
        site,
        { NEXT_PUBLIC_STRAPI_URL: "https://cms.acme.com" }
      ),
      "WebPage"
    )!;

    expect(webPage.primaryImageOfPage).toEqual({
      "@type": "ImageObject",
      url: "https://cms.acme.com/uploads/card.png",
      width: 1200,
      height: 630,
    });
  });

  it("omits width/height on an image Strapi has no dimensions for", () => {
    const webPage = nodeOf(
      buildJsonLdGraph(
        { ...page, seo: { shareImage: { url: "/uploads/card.png" } } },
        site,
        { NEXT_PUBLIC_STRAPI_URL: "https://cms.acme.com" }
      ),
      "WebPage"
    )!;

    expect(webPage.primaryImageOfPage).toEqual({
      "@type": "ImageObject",
      url: "https://cms.acme.com/uploads/card.png",
    });
  });
});

describe("buildJsonLdGraph — BreadcrumbList", () => {
  it("names the root crumb with the tenant's site name, never a hardcoded 'Home'", () => {
    const crumbs = nodeOf(buildJsonLdGraph(page, site, {}), "BreadcrumbList")!;
    const items = crumbs.itemListElement as Record<string, unknown>[];

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      name: "Acme",
      item: ORIGIN,
    });
    expect(items[1]).toMatchObject({
      position: 2,
      name: "Servicios",
      item: `${ORIGIN}/servicios`,
    });
    expect(JSON.stringify(crumbs)).not.toContain("Home");
  });

  it("emits no BreadcrumbList for the homepage — a single crumb for the page you are on is noise", () => {
    const graph = buildJsonLdGraph({ ...page, isHomepage: true }, site, {});
    expect(nodeOf(graph, "BreadcrumbList")).toBeUndefined();
  });

  it("emits no BreadcrumbList when there is no site name to name the root crumb with", () => {
    const graph = buildJsonLdGraph(page, { siteUrl: ORIGIN }, {});
    expect(nodeOf(graph, "BreadcrumbList")).toBeUndefined();
  });
});

describe("buildJsonLdGraph agrees with the rendered canonical", () => {
  const homepageSlug = "servicios";

  it("collapses the WebPage url to the bare origin for a homepage resolved by slug, matching the canonical", () => {
    const graph = buildJsonLdGraph(page, site, {}, homepageSlug)!;
    const metadata = buildPageMetadataFrom(page, site, {}, homepageSlug);

    const canonical = (metadata.alternates as { canonical: string }).canonical;
    expect(canonical).toBe(ORIGIN);
    expect(nodeOf(graph, "WebPage")!.url).toBe(canonical);
    expect(nodeOf(graph, "WebPage")!["@id"]).toBe(`${canonical}#webpage`);
  });

  it("honors a valid canonicalUrl override in BOTH the graph and the metadata", () => {
    const overridden = { ...page, canonicalUrl: "https://acme.com/es/servicios" };
    const graph = buildJsonLdGraph(overridden, site, {})!;
    const metadata = buildPageMetadataFrom(overridden, site, {});

    const canonical = (metadata.alternates as { canonical: string }).canonical;
    expect(canonical).toBe("https://acme.com/es/servicios");
    expect(nodeOf(graph, "WebPage")!.url).toBe(canonical);
  });

  it("ignores an invalid canonicalUrl override in BOTH, falling back to the computed canonical", () => {
    const overridden = { ...page, canonicalUrl: "acme.com/about" };
    const graph = buildJsonLdGraph(overridden, site, {})!;
    const metadata = buildPageMetadataFrom(overridden, site, {});

    const canonical = (metadata.alternates as { canonical: string }).canonical;
    expect(canonical).toBe(`${ORIGIN}/servicios`);
    expect(nodeOf(graph, "WebPage")!.url).toBe(canonical);
  });

  it("agrees with the metadata's inLanguage/hreflang locale", () => {
    const graph = buildJsonLdGraph(page, site, {})!;
    const metadata = buildPageMetadataFrom(page, site, {});
    const languages = (
      metadata.alternates as { languages: Record<string, string> }
    ).languages;

    expect(Object.keys(languages)).toContain(
      nodeOf(graph, "WebPage")!.inLanguage as string
    );
  });
});

describe("serializeJsonLd — script-breakout escaping", () => {
  it("escapes < so tenant content cannot close the script element", () => {
    const hostile = "</script><script>alert(1)</script>";
    const serialized = serializeJsonLd(
      buildJsonLdGraph({ ...page, title: hostile }, site, {})!
    );

    expect(serialized).not.toContain("</script");
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c");
  });

  it("round-trips to byte-identical data despite the escaping", () => {
    const hostile = "</script> Tacos & Café <3";
    const graph = buildJsonLdGraph({ ...page, title: hostile }, site, {})!;

    const parsed = JSON.parse(serializeJsonLd(graph)) as Record<string, unknown>;
    const nodes = parsed["@graph"] as Record<string, unknown>[];
    expect(nodes.find((n) => n["@type"] === "WebPage")!.name).toBe(hostile);
  });

  it("escapes > and & as well", () => {
    const serialized = serializeJsonLd(
      buildJsonLdGraph({ ...page, title: "A > B & C" }, site, {})!
    );

    expect(serialized).not.toContain(">");
    expect(serialized).not.toContain("&");
    expect(serialized).toContain("\\u003e");
    expect(serialized).toContain("\\u0026");
  });

  it("escapes the U+2028/U+2029 line terminators a JS parser would choke on", () => {
    const serialized = serializeJsonLd(
      buildJsonLdGraph({ ...page, title: "a\u2028b\u2029c" }, site, {})!
    );

    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
  });

  it("produces parseable JSON for every graph this module builds", () => {
    expect(() =>
      JSON.parse(serializeJsonLd(buildJsonLdGraph(page, site, {})!))
    ).not.toThrow();
  });
});
