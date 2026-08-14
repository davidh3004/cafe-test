import { describe, expect, it } from "vitest";

// Phase 18 (SEO): structured data. Same convention as seo-resolve.test.ts —
// synthetic StrapiPage/StrapiSite shapes, plain-object env, no mocking.
import { buildArticleJsonLdGraph, buildJsonLdGraph, serializeJsonLd } from "../jsonld";
import { buildPageMetadataFrom } from "../seo-resolve";
import { buildPostMetadataFrom } from "../blog-metadata";
import type { StrapiPage, StrapiSite } from "../strapi-client";
import type { BlogArticleRecord } from "../blog-client";

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

const article: BlogArticleRecord = {
  documentId: "article_mudanza",
  title: "Servicios de mudanza",
  slug: "servicios-mudanza",
  publishedAt: "2026-08-01T10:00:00.000Z",
  updatedAt: "2026-08-05T12:30:00.000Z",
};

/** A fully-populated post: author, image and both dates all present. */
const fullArticle: BlogArticleRecord = {
  ...article,
  author: { name: "Ana García" },
  featuredImage: { url: "/uploads/mudanza.png", width: 1200, height: 630 },
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

describe("buildJsonLdGraph — whole-graph pin (Phase 23 Plan 02 Task 1)", () => {
  it("serializes a representative page's full graph byte-identically to this inline expected string, so a future edit to buildSiteWideNodes that silently reorders or drops a member fails loudly", () => {
    const graph = buildJsonLdGraph(page, site, {})!;

    expect(JSON.stringify(graph)).toBe(
      JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": `${ORIGIN}/#organization`,
            name: "Acme",
            url: ORIGIN,
          },
          {
            "@type": "WebSite",
            "@id": `${ORIGIN}/#website`,
            url: ORIGIN,
            inLanguage: "es-MX",
            name: "Acme",
            publisher: { "@id": `${ORIGIN}/#organization` },
          },
          {
            "@type": "WebPage",
            "@id": `${ORIGIN}/servicios#webpage`,
            url: `${ORIGIN}/servicios`,
            name: "Servicios",
            inLanguage: "es-MX",
            isPartOf: { "@id": `${ORIGIN}/#website` },
            datePublished: "2026-08-01T10:00:00.000Z",
            dateModified: "2026-08-05T12:30:00.000Z",
          },
          {
            "@type": "BreadcrumbList",
            "@id": `${ORIGIN}/servicios#breadcrumb`,
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Acme", item: ORIGIN },
              {
                "@type": "ListItem",
                position: 2,
                name: "Servicios",
                item: `${ORIGIN}/servicios`,
              },
            ],
          },
        ],
      })
    );
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

// Phase 23 (Blog SEO), Plan 02, Task 2: buildArticleJsonLdGraph. D-9: Article
// REPLACES the WebPage node on a post route; the rest of the graph stays.
describe("buildArticleJsonLdGraph — emits nothing rather than something invented", () => {
  it("returns null for a missing article", () => {
    expect(buildArticleJsonLdGraph(null, site, {})).toBeNull();
    expect(buildArticleJsonLdGraph(undefined, site, {})).toBeNull();
  });

  it("returns null for an unpublished article — a 404 must not claim to be an Article", () => {
    expect(
      buildArticleJsonLdGraph({ ...article, publishedAt: null }, site, {})
    ).toBeNull();
  });

  it("returns null when no origin resolves — every @id in the graph is absolute", () => {
    expect(buildArticleJsonLdGraph(article, { name: "Acme" }, {})).toBeNull();
    expect(buildArticleJsonLdGraph(article, null, {})).toBeNull();
  });

  it("returns null when the article has no resolvable headline", () => {
    expect(
      buildArticleJsonLdGraph({ ...article, title: "   " }, site, {})
    ).toBeNull();
  });
});

describe("buildArticleJsonLdGraph — a fully-populated post", () => {
  it("emits an Article node carrying headline, datePublished, dateModified, author and image", () => {
    const node = nodeOf(
      buildArticleJsonLdGraph(fullArticle, site, {
        NEXT_PUBLIC_STRAPI_URL: "https://cms.acme.com",
      }),
      "Article"
    )!;

    expect(node.headline).toBe("Servicios de mudanza");
    expect(node.datePublished).toBe("2026-08-01T10:00:00.000Z");
    expect(node.dateModified).toBe("2026-08-05T12:30:00.000Z");
    expect(node.author).toEqual({ "@type": "Person", name: "Ana García" });
    expect(node.image).toEqual({
      "@type": "ImageObject",
      url: `https://cms.acme.com/uploads/mudanza.png`,
      width: 1200,
      height: 630,
    });
  });

  it("resolves image against the CMS host, from the featuredImage tier", () => {
    const node = nodeOf(
      buildArticleJsonLdGraph(fullArticle, site, {
        NEXT_PUBLIC_STRAPI_URL: "https://cms.acme.com",
      }),
      "Article"
    )!;
    expect((node.image as Record<string, unknown>).url).toBe(
      "https://cms.acme.com/uploads/mudanza.png"
    );
  });

  it("emits datePublished byte-identical to the fixture's input timestamp string", () => {
    const node = nodeOf(
      buildArticleJsonLdGraph(fullArticle, site, {}),
      "Article"
    )!;
    expect(node.datePublished).toBe("2026-08-01T10:00:00.000Z");
  });
});

describe("buildArticleJsonLdGraph — every degrade branch emits a valid, never a malformed, node", () => {
  it("omits author entirely when the article has no author — never null, never an empty object", () => {
    const noAuthor = { ...fullArticle, author: undefined };
    const node = nodeOf(buildArticleJsonLdGraph(noAuthor, site, {}), "Article")!;

    expect("author" in node).toBe(false);
    const serialized = JSON.stringify(node);
    expect(serialized).not.toContain('"author":null');
    expect(serialized).not.toContain('"author":{}');
  });

  it("omits image entirely when no tier resolves — never null, never an empty object", () => {
    const noImage = { ...fullArticle, featuredImage: undefined, seo: undefined };
    const node = nodeOf(
      buildArticleJsonLdGraph(noImage, { ...site, seo: undefined }, {}),
      "Article"
    )!;

    expect("image" in node).toBe(false);
    const serialized = JSON.stringify(node);
    expect(serialized).not.toContain('"image":null');
    expect(serialized).not.toContain('"image":{}');
  });

  it("omits datePublished when publishedAt is unparseable but the article is still published (truthy)", () => {
    const unparseable = { ...fullArticle, publishedAt: "last Tuesday" };
    const node = nodeOf(
      buildArticleJsonLdGraph(unparseable, site, {}),
      "Article"
    );

    expect(node).toBeDefined();
    expect("datePublished" in node!).toBe(false);
    expect(JSON.stringify(node)).not.toContain('"datePublished":null');
  });

  it("omits dateModified when updatedAt is unparseable", () => {
    const unparseable = { ...fullArticle, updatedAt: "   " };
    const node = nodeOf(
      buildArticleJsonLdGraph(unparseable, site, {}),
      "Article"
    );

    expect(node).toBeDefined();
    expect("dateModified" in node!).toBe(false);
    expect(JSON.stringify(node)).not.toContain('"dateModified":null');
  });
});

describe("buildArticleJsonLdGraph — the graph's node set", () => {
  it("contains no generic WebPage node: the node type list is Organization, WebSite, Article, BreadcrumbList", () => {
    const graph = buildArticleJsonLdGraph(fullArticle, site, {})!;
    const types = (graph["@graph"] as Record<string, unknown>[]).map(
      (n) => n["@type"]
    );

    expect(types).toEqual([
      "Organization",
      "WebSite",
      "Article",
      "BreadcrumbList",
    ]);
  });

  it("cross-references Organization/WebSite through the SAME shared nodes a page's graph uses", () => {
    const pageGraph = buildJsonLdGraph(page, site, {})!;
    const articleGraph = buildArticleJsonLdGraph(fullArticle, site, {})!;

    const pageOrg = pageGraph["@graph"] as Record<string, unknown>[];
    const articleOrg = articleGraph["@graph"] as Record<string, unknown>[];

    expect(
      pageOrg.find((n) => n["@type"] === "Organization")
    ).toEqual(articleOrg.find((n) => n["@type"] === "Organization"));
    expect(pageOrg.find((n) => n["@type"] === "WebSite")).toEqual(
      articleOrg.find((n) => n["@type"] === "WebSite")
    );
  });

  it("names the BreadcrumbList's second crumb with the article's own headline, never an invented listing label", () => {
    const crumbs = nodeOf(
      buildArticleJsonLdGraph(fullArticle, site, {}),
      "BreadcrumbList"
    )!;
    const items = crumbs.itemListElement as Record<string, unknown>[];

    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({
      position: 2,
      name: "Servicios de mudanza",
    });
    expect(JSON.stringify(crumbs)).not.toContain("Blog");
  });
});

describe("buildArticleJsonLdGraph agrees with the rendered canonical", () => {
  it("derives @id and url from resolvePostCanonical, matching the post's own rendered canonical", () => {
    const graph = buildArticleJsonLdGraph(article, site, {})!;
    const metadata = buildPostMetadataFrom(article, site, {});
    const canonical = (metadata.alternates as { canonical: string }).canonical;

    const node = nodeOf(graph, "Article")!;
    expect(node.url).toBe(canonical);
    expect(node["@id"]).toBe(`${canonical}#article`);
    expect(node.mainEntityOfPage).toBe(canonical);
  });

  it("honors a valid https canonicalUrl override in BOTH the graph and the rendered canonical", () => {
    const overridden = {
      ...article,
      canonicalUrl: "https://acme.com/es/servicios-mudanza",
    };
    const graph = buildArticleJsonLdGraph(overridden, site, {})!;
    const metadata = buildPostMetadataFrom(overridden, site, {});
    const canonical = (metadata.alternates as { canonical: string }).canonical;

    expect(canonical).toBe("https://acme.com/es/servicios-mudanza");
    const node = nodeOf(graph, "Article")!;
    expect(node.url).toBe(canonical);
    expect(node["@id"]).toBe(`${canonical}#article`);
  });
});

describe("buildArticleJsonLdGraph — script-breakout escaping (shared serializeJsonLd)", () => {
  it("is safe once passed through serializeJsonLd: no raw < survives a script-closing title", () => {
    const hostile = "</script><script>alert(1)</script>";
    const serialized = serializeJsonLd(
      buildArticleJsonLdGraph({ ...fullArticle, title: hostile }, site, {})!
    );

    expect(serialized).not.toContain("</script");
    expect(serialized).not.toContain("<");
    expect(serialized).toContain("\\u003c");
  });
});
