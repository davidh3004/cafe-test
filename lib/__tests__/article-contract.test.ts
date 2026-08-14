import { describe, expect, it } from "vitest";

import {
  ARTICLE_TEMPLATE_KEY,
  ARCHIVE_TEMPLATE_KEY,
  ARTICLE_BODY_SECTION_KEY,
  ARCHIVE_LIST_SECTION_KEY,
  THEME_ARTICLE_CONTRACT_VERSION,
  ARTICLE_PROP_FIELDS,
  buildArticleProp,
  buildArchiveProp,
  type ArticleSourceRecord,
} from "../article-contract";
import { deriveExcerpt } from "../derive-excerpt";

function baseFixture(overrides: Partial<ArticleSourceRecord> = {}): ArticleSourceRecord {
  return {
    documentId: "a1",
    title: "Hello World",
    slug: "hello-world",
    body: "<p>Some prose.</p>",
    excerpt: "A stored excerpt.",
    featuredImage: { url: "https://e/img.jpg", width: 800, height: 600 },
    category: { name: "News", slug: "news", description: "News posts" },
    tags: [{ name: "Tag A", slug: "tag-a", description: null }],
    author: { name: "Jane Doe", avatar: { url: "https://e/avatar.jpg" } },
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("article-contract mirror — reserved keys (DIS-1)", () => {
  it("exports the exact confirmed literals", () => {
    expect(ARTICLE_TEMPLATE_KEY).toBe("article");
    expect(ARCHIVE_TEMPLATE_KEY).toBe("archive");
    expect(ARTICLE_BODY_SECTION_KEY).toBe("article-body");
    expect(ARCHIVE_LIST_SECTION_KEY).toBe("archive-list");
  });

  it("THEME_ARTICLE_CONTRACT_VERSION is 1", () => {
    expect(THEME_ARTICLE_CONTRACT_VERSION).toBe(1);
  });
});

describe("buildArticleProp — key set (DIS-3)", () => {
  it("returns an object whose keys equal ARTICLE_PROP_FIELDS exactly", () => {
    const prop = buildArticleProp(baseFixture());
    expect(Object.keys(prop).sort()).toEqual([...ARTICLE_PROP_FIELDS].sort());
  });

  it("uses the stored excerpt when non-empty", () => {
    const prop = buildArticleProp(baseFixture({ excerpt: "A stored excerpt." }));
    expect(prop.excerpt).toBe("A stored excerpt.");
  });

  it("trims the stored excerpt", () => {
    const prop = buildArticleProp(baseFixture({ excerpt: "  padded  " }));
    expect(prop.excerpt).toBe("padded");
  });
});

describe("buildArticleProp — excerpt derivation fallback (DIS-7, Task 3)", () => {
  it("with a non-blank stored excerpt, returns the stored one (never derives)", () => {
    const prop = buildArticleProp(
      baseFixture({ excerpt: "A stored excerpt.", body: "<p>Body prose that would derive differently.</p>" })
    );
    expect(prop.excerpt).toBe("A stored excerpt.");
  });

  it("with a blank stored excerpt and a non-empty body, returns deriveExcerpt(body)", () => {
    const body = "<p>Body prose used for excerpt derivation.</p>";
    const prop = buildArticleProp(baseFixture({ excerpt: "", body }));
    expect(prop.excerpt).toBe(deriveExcerpt(body));
    expect(prop.excerpt).toBe("Body prose used for excerpt derivation.");
  });

  it("with a whitespace-only stored excerpt and a non-empty body, derives (blank-after-trim counts as blank)", () => {
    const body = "<p>Derived from whitespace-only stored excerpt.</p>";
    const prop = buildArticleProp(baseFixture({ excerpt: "   ", body }));
    expect(prop.excerpt).toBe(deriveExcerpt(body));
  });

  it("with both a blank stored excerpt and an empty body, returns the empty string", () => {
    const prop = buildArticleProp(baseFixture({ excerpt: "", body: "" }));
    expect(prop.excerpt).toBe("");
  });

  it("with both a blank stored excerpt and a null body, returns the empty string", () => {
    const prop = buildArticleProp(baseFixture({ excerpt: null as unknown as string, body: null }));
    expect(prop.excerpt).toBe("");
  });
});

describe("buildArticleProp — null/absent coercion, never undefined (DIS-3)", () => {
  it("coerces null/absent featuredImage, category and author to null, and absent tags to []", () => {
    const prop = buildArticleProp(
      baseFixture({ featuredImage: null, category: null, author: null, tags: undefined })
    );
    expect(prop.featuredImage).toBeNull();
    expect(prop.category).toBeNull();
    expect(prop.author).toBeNull();
    expect(prop.tags).toEqual([]);
  });

  it("coerces a null body to the empty string", () => {
    const prop = buildArticleProp(baseFixture({ body: null }));
    expect(prop.body).toBe("");
  });

  it("coerces null publishedAt/updatedAt to null (never undefined)", () => {
    const prop = buildArticleProp(baseFixture({ publishedAt: null, updatedAt: null }));
    expect(prop.publishedAt).toBeNull();
    expect(prop.updatedAt).toBeNull();
  });

  it("never produces an undefined value anywhere in the returned object graph", () => {
    const prop = buildArticleProp(
      baseFixture({
        body: null,
        excerpt: null,
        featuredImage: null,
        category: null,
        author: null,
        tags: undefined,
        publishedAt: null,
        updatedAt: null,
      })
    );
    for (const [key, value] of Object.entries(prop)) {
      expect(value, `field "${key}" must never be undefined`).not.toBeUndefined();
    }
  });

  it("resolves author.avatarUrl to null when the author has no avatar", () => {
    const prop = buildArticleProp(baseFixture({ author: { name: "No Avatar", avatar: null } }));
    expect(prop.author).toEqual({ name: "No Avatar", avatarUrl: null });
  });
});

describe("buildArchiveProp — DIS-6 shape", () => {
  it("reuses buildArticleProp per post and carries term/page through unchanged", () => {
    const archive = buildArchiveProp({
      posts: [baseFixture()],
      term: { kind: "all", name: "", description: null },
      page: { current: 1, pageSize: 10, pageCount: 1, total: 1 },
    });

    expect(archive.posts).toHaveLength(1);
    expect(archive.posts[0].documentId).toBe("a1");
    expect(archive.term).toEqual({ kind: "all", name: "", description: null });
    expect(archive.page).toEqual({ current: 1, pageSize: 10, pageCount: 1, total: 1 });
  });
});

/**
 * Regression coverage for the blank-featured-image bug: Strapi's DEFAULT
 * local-disk upload provider stores media urls relative to the CMS
 * (`/uploads/cover.jpg`). Handed to a theme unchanged, `<img src>` resolves
 * that against the TENANT's origin and 404s, so every card painted an empty
 * box. `buildArticleProp` is the only builder permitted to produce a
 * theme-facing article value, so absolutization is asserted HERE.
 */
describe("buildArticleProp — CMS media absolutization", () => {
  const BASE = "https://cms.example.com";

  it("absolutizes a CMS-relative featuredImage url against the CMS origin", () => {
    const prop = buildArticleProp(
      baseFixture({ featuredImage: { url: "/uploads/cover.jpg", width: 4, height: 2 } }),
      BASE
    );
    expect(prop.featuredImage).toEqual({
      url: "https://cms.example.com/uploads/cover.jpg",
      width: 4,
      height: 2,
    });
  });

  it("absolutizes a relative author avatar url through the same seam", () => {
    const prop = buildArticleProp(
      baseFixture({ author: { name: "Jane", avatar: { url: "/uploads/jane.png" } } }),
      BASE
    );
    expect(prop.author).toEqual({
      name: "Jane",
      avatarUrl: "https://cms.example.com/uploads/jane.png",
    });
  });

  it("leaves an already-absolute url byte-identical (cloud upload providers)", () => {
    const prop = buildArticleProp(
      baseFixture({ featuredImage: { url: "https://cdn.example.net/x.jpg" } }),
      BASE
    );
    expect(prop.featuredImage?.url).toBe("https://cdn.example.net/x.jpg");
  });

  it("tolerates a base url with a trailing slash without doubling the separator", () => {
    const prop = buildArticleProp(
      baseFixture({ featuredImage: { url: "/uploads/cover.jpg" } }),
      "https://cms.example.com/"
    );
    expect(prop.featuredImage?.url).toBe("https://cms.example.com/uploads/cover.jpg");
  });

  it("joins a base and a url that carries no leading slash", () => {
    const prop = buildArticleProp(
      baseFixture({ featuredImage: { url: "uploads/cover.jpg" } }),
      BASE
    );
    expect(prop.featuredImage?.url).toBe("https://cms.example.com/uploads/cover.jpg");
  });

  it("degrades to the unchanged url when no CMS base is configured", () => {
    const prop = buildArticleProp(
      baseFixture({ featuredImage: { url: "/uploads/cover.jpg" } }),
      ""
    );
    expect(prop.featuredImage?.url).toBe("/uploads/cover.jpg");
  });

  it("threads the base through buildArchiveProp to every post", () => {
    const archive = buildArchiveProp(
      {
        posts: [baseFixture({ featuredImage: { url: "/uploads/a.jpg" } })],
        term: { kind: "all", name: "", description: null },
        page: { current: 1, pageSize: 10, pageCount: 1, total: 1 },
      },
      BASE
    );
    expect(archive.posts[0].featuredImage?.url).toBe("https://cms.example.com/uploads/a.jpg");
  });
});
