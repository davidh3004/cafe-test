import { describe, expect, it } from "vitest";
// Phase 23, Plan 01, Task 2. Mirrors seo-resolve.test.ts's convention: one
// describe per exported function, synthetic BlogArticleRecord/StrapiSite
// shapes, plain object env values, no mocking of anything -- buildPostMetadataFrom
// is a PURE module (no network, no I/O), so it is driven directly.
import { buildPostMetadataFrom } from "../blog-metadata";
import { NOT_FOUND_TITLE } from "../seo-resolve";
import type { BlogArticleRecord } from "../blog-client";
import type { StrapiSite } from "../strapi-client";

/** Fixture builder: fills every BlogArticleRecord scalar `buildArticleProp`
 * needs with defaults so each test overrides only the fields it cares about. */
function article(overrides: Partial<BlogArticleRecord> = {}): BlogArticleRecord {
  return {
    documentId: "article-1",
    title: "Hello World",
    slug: "hello-world",
    body: "<p>Some body copy long enough to derive an excerpt from.</p>",
    excerpt: "",
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    canonicalUrl: null,
    featuredImage: null,
    seo: null,
    category: null,
    tags: [],
    author: null,
    ...overrides,
  };
}

describe("buildPostMetadataFrom — not-found gate (D-6 defence in depth)", () => {
  it("returns NOT_FOUND_TITLE for a null article", () => {
    expect(buildPostMetadataFrom(null, null, {})).toEqual({ title: NOT_FOUND_TITLE });
  });

  it("returns NOT_FOUND_TITLE for an undefined article", () => {
    expect(buildPostMetadataFrom(undefined, null, {})).toEqual({ title: NOT_FOUND_TITLE });
  });

  it("returns NOT_FOUND_TITLE for an article with a null publishedAt (draft)", () => {
    expect(
      buildPostMetadataFrom(article({ publishedAt: null }), null, {})
    ).toEqual({ title: NOT_FOUND_TITLE });
  });

  it("returns NOT_FOUND_TITLE for an article with a blank publishedAt", () => {
    expect(
      buildPostMetadataFrom(article({ publishedAt: "" }), null, {})
    ).toEqual({ title: NOT_FOUND_TITLE });
  });
});

describe("buildPostMetadataFrom — title (D-3: post SEO title wins, no site tier)", () => {
  it("emits the plain article title when no seo.title is set", () => {
    const metadata = buildPostMetadataFrom(article(), null, {});
    expect(metadata.title).toBe("Hello World");
  });

  it("the post's own seo.title wins over the article title", () => {
    const metadata = buildPostMetadataFrom(
      article({ seo: { title: "A Hand-Authored SEO Title" } }),
      null,
      {}
    );
    expect(metadata.title).toBe("A Hand-Authored SEO Title");
  });

  it("falls back to the article title when seo.title is whitespace-only", () => {
    const metadata = buildPostMetadataFrom(article({ seo: { title: "   " } }), null, {});
    expect(metadata.title).toBe("Hello World");
  });

  it("emits title.absolute when the site's title template changes the resolved title", () => {
    const site = { titleTemplate: "%s | Acme" } as StrapiSite;
    const metadata = buildPostMetadataFrom(article(), site, {});
    expect(metadata.title).toEqual({ absolute: "Hello World | Acme" });
  });
});

describe("buildPostMetadataFrom — description (D-3 three-tier chain: post override, then excerpt, then site default)", () => {
  it("the post's own seo.description wins over the excerpt", () => {
    const metadata = buildPostMetadataFrom(
      article({
        seo: { description: "An explicit per-post SEO description." },
        excerpt: "A hand-authored excerpt.",
      }),
      null,
      {}
    );
    expect(metadata.description).toBe("An explicit per-post SEO description.");
  });

  it("the excerpt wins over the site default when seo.description is blank", () => {
    const site = { seo: { description: "Site-wide default description." } } as StrapiSite;
    const metadata = buildPostMetadataFrom(
      article({ excerpt: "A hand-authored excerpt." }),
      site,
      {}
    );
    expect(metadata.description).toBe("A hand-authored excerpt.");
  });

  it("derives a description from the body (the excerpt tier) when no excerpt is stored", () => {
    const metadata = buildPostMetadataFrom(
      article({ excerpt: "", body: "<p>Body-derived excerpt content here.</p>" }),
      null,
      {}
    );
    expect(typeof metadata.description).toBe("string");
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });

  it("the site default is used when both seo.description and the excerpt are blank", () => {
    const site = { seo: { description: "Site-wide default description." } } as StrapiSite;
    const metadata = buildPostMetadataFrom(
      article({ excerpt: "", body: "" }),
      site,
      {}
    );
    expect(metadata.description).toBe("Site-wide default description.");
  });

  it("omits the description key entirely when all three tiers are blank", () => {
    const metadata = buildPostMetadataFrom(article({ excerpt: "", body: "" }), null, {});
    expect(metadata).not.toHaveProperty("description");
  });
});

describe("buildPostMetadataFrom — robots directive (T-23-14: same field the sitemap filter reads)", () => {
  it("emits index: false when seo.noindex is strictly true", () => {
    const metadata = buildPostMetadataFrom(article({ seo: { noindex: true } }), null, {});
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("emits index: true when seo.noindex is false", () => {
    const metadata = buildPostMetadataFrom(article({ seo: { noindex: false } }), null, {});
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("emits index: true when seo.noindex is null", () => {
    const metadata = buildPostMetadataFrom(article({ seo: { noindex: null } }), null, {});
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("emits index: true when seo is absent entirely", () => {
    const metadata = buildPostMetadataFrom(article({ seo: null }), null, {});
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });
});

describe("buildPostMetadataFrom — origin-gated metadataBase/alternates (Pitfall 2)", () => {
  it("omits metadataBase and alternates entirely when the origin cannot be resolved", () => {
    const metadata = buildPostMetadataFrom(article(), null, {});
    expect(metadata).not.toHaveProperty("metadataBase");
    expect(metadata).not.toHaveProperty("alternates");
  });

  it("sets metadataBase and alternates.canonical, composed via resolvePostCanonical, when the origin resolves", () => {
    const site = { siteUrl: "https://acme.com" } as StrapiSite;
    const metadata = buildPostMetadataFrom(article(), site, {});
    expect(String(metadata.metadataBase)).toBe("https://acme.com/");
    expect((metadata.alternates as { canonical?: string })?.canonical).toBe(
      "https://acme.com/blog/hello-world"
    );
  });
});

describe("buildPostMetadataFrom — canonicalUrl override (D-1 via resolvePostCanonical)", () => {
  it("a valid absolute https canonicalUrl emits that exact string as alternates.canonical", () => {
    const site = { siteUrl: "https://acme.com" } as StrapiSite;
    const metadata = buildPostMetadataFrom(
      article({ canonicalUrl: "https://elsewhere.example/canonical-post" }),
      site,
      {}
    );
    expect((metadata.alternates as { canonical?: string })?.canonical).toBe(
      "https://elsewhere.example/canonical-post"
    );
  });

  it("a non-https canonicalUrl is ignored in favour of the composed URL", () => {
    const site = { siteUrl: "https://acme.com" } as StrapiSite;
    const metadata = buildPostMetadataFrom(
      article({ canonicalUrl: "http://elsewhere.example/canonical-post" }),
      site,
      {}
    );
    expect((metadata.alternates as { canonical?: string })?.canonical).toBe(
      "https://acme.com/blog/hello-world"
    );
  });
});

describe("buildPostMetadataFrom — language alternates (D-10 self-referential hreflang pair)", () => {
  it("carries exactly two language entries, both valued with the canonical, when the origin resolves", () => {
    const site = { siteUrl: "https://acme.com", siteLocale: "fr" } as StrapiSite;
    const metadata = buildPostMetadataFrom(article(), site, {});
    const languages = (metadata.alternates as { languages?: Record<string, string> })
      ?.languages;
    expect(languages).toEqual({
      fr: "https://acme.com/blog/hello-world",
      "x-default": "https://acme.com/blog/hello-world",
    });
    expect(Object.keys(languages ?? {})).toHaveLength(2);
  });
});

describe("buildPostMetadataFrom — share image (D-3 criterion 3, via resolveShareImage)", () => {
  it("the post's own seo.shareImage wins over the site's", () => {
    const site = {
      seo: { shareImage: { url: "https://cdn.example/site-image.png", width: 800, height: 600 } },
    } as StrapiSite;
    const metadata = buildPostMetadataFrom(
      article({
        seo: {
          shareImage: { url: "https://cdn.example/post-image.png", width: 1200, height: 630 },
        },
      }),
      site,
      {}
    );
    const openGraph = metadata.openGraph as { images?: Array<{ url: string }> };
    const twitter = metadata.twitter as { images?: string[]; card?: string };
    expect(openGraph.images?.[0]?.url).toBe("https://cdn.example/post-image.png");
    expect(twitter.images?.[0]).toBe("https://cdn.example/post-image.png");
    expect(twitter.card).toBe("summary_large_image");
  });

  it("falls back to the site's seo.shareImage when the post has none", () => {
    const site = {
      seo: { shareImage: { url: "https://cdn.example/site-image.png", width: 800, height: 600 } },
    } as StrapiSite;
    const metadata = buildPostMetadataFrom(article({ seo: null }), site, {});
    const openGraph = metadata.openGraph as { images?: Array<{ url: string }> };
    expect(openGraph.images?.[0]?.url).toBe("https://cdn.example/site-image.png");
  });

  it("absolutizes a Strapi-relative media path against the CMS base URL from the env argument, not the site origin", () => {
    const site = { siteUrl: "https://acme.com" } as StrapiSite;
    const metadata = buildPostMetadataFrom(
      article({ seo: { shareImage: { url: "/uploads/card.png", width: 1200, height: 630 } } }),
      site,
      { NEXT_PUBLIC_STRAPI_URL: "https://cms.example" }
    );
    const openGraph = metadata.openGraph as { images?: Array<{ url: string }> };
    expect(openGraph.images?.[0]?.url).toBe("https://cms.example/uploads/card.png");
  });

  it("omits the image key from both openGraph and twitter, and sets a text card, when no share image resolves at any tier", () => {
    const metadata = buildPostMetadataFrom(article({ seo: null }), null, {});
    const openGraph = metadata.openGraph as Record<string, unknown>;
    const twitter = metadata.twitter as Record<string, unknown>;
    expect(openGraph).not.toHaveProperty("images");
    expect(twitter).not.toHaveProperty("images");
    expect(twitter.card).toBe("summary");
  });
});

describe("buildPostMetadataFrom — openGraph/twitter assembly (mirrors buildPageMetadataFrom)", () => {
  it("sets openGraph.type to article and carries title on both blocks", () => {
    const metadata = buildPostMetadataFrom(article(), null, {});
    const openGraph = metadata.openGraph as { title?: string; type?: string };
    const twitter = metadata.twitter as { title?: string };
    expect(openGraph.type).toBe("article");
    expect(openGraph.title).toBe("Hello World");
    expect(twitter.title).toBe("Hello World");
  });

  it("carries openGraph.siteName when the site name resolves", () => {
    const site = { name: "Acme Co." } as StrapiSite;
    const metadata = buildPostMetadataFrom(article(), site, {});
    const openGraph = metadata.openGraph as { siteName?: string };
    expect(openGraph.siteName).toBe("Acme Co.");
  });

  it("carries the description on both blocks only when a description resolved", () => {
    const metadata = buildPostMetadataFrom(article({ excerpt: "", body: "" }), null, {});
    const openGraph = metadata.openGraph as Record<string, unknown>;
    const twitter = metadata.twitter as Record<string, unknown>;
    expect(openGraph).not.toHaveProperty("description");
    expect(twitter).not.toHaveProperty("description");
  });
});
