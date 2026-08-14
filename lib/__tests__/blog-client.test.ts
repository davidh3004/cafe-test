import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Phase 22 (BLOG-07/BLOG-08), Plan 01 Task 2. Covers every bullet in
 * `22-01-PLAN.md` Task 2's `<behavior>` block for the theme-site's new blog
 * read module: `fetchBlogPageTemplates` and `fetchPublishedArticleBySlug`.
 *
 * Same transport-level capture approach as
 * `strapi-client-seo-selection.test.ts`/`strapi-client-blog-templates.test.ts`:
 * `strapiClient.request` is spied on directly and the query string / variables
 * actually sent are asserted against, never source text. `NEXT_PUBLIC_STRAPI_URL`
 * is read at module-load time, so each case sets the env var and re-imports the
 * module fresh via `vi.resetModules()` + dynamic `import()`.
 */

const ENV_VAR = "NEXT_PUBLIC_STRAPI_URL";

describe("blog-client.ts — fetchBlogPageTemplates / fetchPublishedArticleBySlug", () => {
  let savedEnv: string | undefined;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    savedEnv = process.env[ENV_VAR];
    process.env[ENV_VAR] = "https://cms.example.com";
    vi.resetModules();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = savedEnv;
    vi.resetModules();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  // ---- fetchBlogPageTemplates ----

  it("fetchBlogPageTemplates resolves the array of page templates the wire response returns", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const templates = [
      {
        documentId: "tmpl-1",
        key: "article",
        theme: { documentId: "theme-1" },
        sections: [{ sectionKey: "article-body", order: 0, data: {} }],
      },
    ];
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      pageTemplates: templates,
    }));

    const result = await mod.fetchBlogPageTemplates();
    expect(result).toEqual(templates);
  });

  it("fetchBlogPageTemplates resolves [] and warns naming the page-template content type when the request throws", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("boom");
    });

    const result = await mod.fetchBlogPageTemplates();
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    const loggedNamesPageTemplate = warnSpy.mock.calls.some((args) =>
      args.some((arg) => typeof arg === "string" && arg.includes("page-template"))
    );
    expect(loggedNamesPageTemplate).toBe(true);
  });

  // ---- fetchPublishedArticleBySlug ----

  it('fetchPublishedArticleBySlug("published-slug") resolves a record whose publishedAt is a non-empty string', async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles: [
        {
          documentId: "article-1",
          title: "Hello",
          slug: "published-slug",
          body: "<p>hi</p>",
          excerpt: "",
          publishedAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          featuredImage: null,
          category: null,
          tags: [],
          author: null,
        },
      ],
    }));

    const article = await mod.fetchPublishedArticleBySlug("published-slug");
    expect(article).not.toBeNull();
    expect(typeof article?.publishedAt).toBe("string");
    expect(article?.publishedAt).not.toBe("");
  });

  it('fetchPublishedArticleBySlug("draft-slug") resolves null when the only row has a null publishedAt', async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles: [
        {
          documentId: "article-2",
          title: "Draft",
          slug: "draft-slug",
          body: "<p>hi</p>",
          excerpt: "",
          publishedAt: null,
          updatedAt: null,
          featuredImage: null,
          category: null,
          tags: [],
          author: null,
        },
      ],
    }));

    const article = await mod.fetchPublishedArticleBySlug("draft-slug");
    expect(article).toBeNull();
  });

  it('fetchPublishedArticleBySlug("unknown-slug") resolves null on an empty result array', async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles: [],
    }));

    const article = await mod.fetchPublishedArticleBySlug("unknown-slug");
    expect(article).toBeNull();
  });

  it("resolves null rather than propagating when the request throws", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    await expect(mod.fetchPublishedArticleBySlug("any-slug")).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("the slug reaches Strapi as a declared GraphQL variable; the query document never contains the caller's slug text", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async () => ({ articles: [] }));

    const secretSlug = "totally-unique-slug-marker-42";
    await mod.fetchPublishedArticleBySlug(secretSlug);

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [query, variables] = requestSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).not.toContain(secretSlug);
    expect(query).toContain("$slug: String!");
    expect(variables).toEqual({ slug: secretSlug });
  });

  // ---- fetchPublishedArticles (Plan 03 Task 2) ----

  function makeArticle(overrides: Record<string, unknown> = {}) {
    return {
      documentId: "article-1",
      title: "Hello",
      slug: "hello",
      body: "<p>hi</p>",
      excerpt: "",
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      featuredImage: null,
      category: { name: "News", slug: "news", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
      author: null,
      ...overrides,
    };
  }

  it("fetchPublishedArticles({ page: 1, pageSize: 10 }) sends one connection query with an explicit pagination argument and returns { nodes, pageInfo }", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const pageInfo = { page: 1, pageSize: 10, pageCount: 1, total: 1 };
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async () => ({
        articles_connection: { nodes: [makeArticle()], pageInfo },
      }));

    const result = await mod.fetchPublishedArticles({ page: 1, pageSize: 10 });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [query, variables] = requestSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain("pagination: { page: $page, pageSize: $pageSize }");
    expect(variables).toMatchObject({ page: 1, pageSize: 10 });
    expect(result.nodes).toHaveLength(1);
    expect(result.pageInfo).toEqual(pageInfo);
  });

  it('fetchPublishedArticles({ term: { kind: "category", slug: "news" } }) sends the relation-filtered query first', async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const pageInfo = { page: 1, pageSize: 10, pageCount: 1, total: 1 };
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async () => ({
        articles_connection: { nodes: [makeArticle()], pageInfo },
      }));

    const result = await mod.fetchPublishedArticles({
      term: { kind: "category", slug: "news" },
    });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [query, variables] = requestSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain("GetPublishedArticlesByTerm");
    expect(variables).toMatchObject({ filters: { category: { slug: { eq: "news" } } } });
    expect(result.nodes).toHaveLength(1);
  });

  it("falls back to the unfiltered query and JS-filters by category slug when the relation-filtered query throws, recomputing pageInfo from the JS-filtered set", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const matching = makeArticle({
      documentId: "match-1",
      slug: "match-1",
      category: { name: "News", slug: "news", description: null },
    });
    const nonMatching = makeArticle({
      documentId: "no-match-1",
      slug: "no-match-1",
      category: { name: "Other", slug: "other", description: null },
    });
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetPublishedArticlesByTerm")) {
          throw new Error("relation filter not honoured");
        }
        // Unfiltered fallback: a broader, unfiltered set the whole blog's
        // pageInfo would come from if it were passed through unrecomputed.
        return {
          articles_connection: {
            nodes: [matching, nonMatching],
            pageInfo: { page: 1, pageSize: 10, pageCount: 1, total: 2 },
          },
        };
      });

    const result = await mod.fetchPublishedArticles({
      term: { kind: "category", slug: "news" },
    });

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].documentId).toBe("match-1");
    // Recomputed from the JS-narrowed set (1 matching article), NOT the
    // unfiltered query's own total of 2 (T-22-13).
    expect(result.pageInfo).toEqual({ page: 1, pageSize: 10, pageCount: 1, total: 1 });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("the tag variant filters on any tag whose slug matches on the fallback path", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const matching = makeArticle({
      documentId: "tag-match",
      slug: "tag-match",
      category: null,
      tags: [
        { name: "Other", slug: "other", description: null },
        { name: "Release", slug: "release", description: null },
      ],
    });
    const nonMatching = makeArticle({
      documentId: "tag-no-match",
      slug: "tag-no-match",
      category: null,
      tags: [{ name: "Other", slug: "other", description: null }],
    });
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(
      async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetPublishedArticlesByTerm")) {
          throw new Error("relation filter not honoured");
        }
        return {
          articles_connection: {
            nodes: [matching, nonMatching],
            pageInfo: { page: 1, pageSize: 10, pageCount: 1, total: 2 },
          },
        };
      }
    );

    const result = await mod.fetchPublishedArticles({
      term: { kind: "tag", slug: "release" },
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].documentId).toBe("tag-match");
  });

  it("a node whose publishedAt is null never appears in the returned nodes, on the filtered path", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles_connection: {
        nodes: [makeArticle({ publishedAt: null })],
        pageInfo: { page: 1, pageSize: 10, pageCount: 1, total: 1 },
      },
    }));

    const result = await mod.fetchPublishedArticles({ page: 1, pageSize: 10 });
    expect(result.nodes).toHaveLength(0);
  });

  it("a node whose publishedAt is null never appears in the returned nodes, on the A2 fallback path", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(
      async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetPublishedArticlesByTerm")) {
          throw new Error("relation filter not honoured");
        }
        return {
          articles_connection: {
            nodes: [
              makeArticle({ publishedAt: null, category: { name: "News", slug: "news", description: null } }),
            ],
            pageInfo: { page: 1, pageSize: 10, pageCount: 1, total: 1 },
          },
        };
      }
    );

    const result = await mod.fetchPublishedArticles({
      term: { kind: "category", slug: "news" },
    });
    expect(result.nodes).toHaveLength(0);
    expect(result.pageInfo.total).toBe(0);
  });

  it("resolves an empty node list with a zero-count pageInfo, never a throw, when a thrown request occurs on both the filtered and fallback paths", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    const result = await mod.fetchPublishedArticles({
      page: 1,
      pageSize: 10,
      term: { kind: "category", slug: "news" },
    });

    expect(result.nodes).toEqual([]);
    expect(result.pageInfo).toEqual({ page: 1, pageSize: 10, pageCount: 0, total: 0 });
  });

  it("resolves an empty node list with a zero-count pageInfo, never a throw, on the non-term path when the request throws", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    const result = await mod.fetchPublishedArticles({ page: 1, pageSize: 10 });

    expect(result.nodes).toEqual([]);
    expect(result.pageInfo).toEqual({ page: 1, pageSize: 10, pageCount: 0, total: 0 });
  });

  // ---- fetchBlogTerm (Plan 03 Task 2) ----

  it('fetchBlogTerm("category", "news") returns { name, description }', async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      categories: [{ name: "News", slug: "news", description: "News posts" }],
      tags: [],
    }));

    const term = await mod.fetchBlogTerm("category", "news");
    expect(term).toEqual({ name: "News", description: "News posts" });
  });

  it("fetchBlogTerm returns null for an unknown slug", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      categories: [],
      tags: [],
    }));

    const term = await mod.fetchBlogTerm("category", "unknown");
    expect(term).toBeNull();
  });

  it("fetchBlogTerm resolves null rather than propagating when the request throws", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    await expect(mod.fetchBlogTerm("tag", "release")).resolves.toBeNull();
  });

  // ---- fetchPublishedArticleSlugs (Plan 03 Task 2: limit param) ----

  it("fetchPublishedArticleSlugs(limit) returns published slugs only", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async () => ({
        articles: [
          { slug: "published-1", publishedAt: "2026-08-01T00:00:00.000Z" },
          { slug: "draft-1", publishedAt: null },
        ],
      }));

    const slugs = await mod.fetchPublishedArticleSlugs(250);

    expect(slugs).toEqual(["published-1"]);
    const [, variables] = requestSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(variables).toEqual({ limit: 250 });
  });

  // Regression: a published row whose `slug` is null must be dropped, never
  // propagated. Strapi's `slug` is nullable while the generated response type
  // declares it `string`, so nothing upstream catches it. Propagating one
  // yields `[{ slug: null }]` from `generateStaticParams`, and Next fails the
  // WHOLE tenant build with "A required parameter (slug) was not provided as a
  // string received object" (`typeof null === "object"`). Observed on a real
  // tenant deploy 2026-08-13; one incomplete draft must never be able to break
  // a tenant's build.
  it("fetchPublishedArticleSlugs drops published rows with a null or blank slug", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles: [
        { slug: "published-1", publishedAt: "2026-08-01T00:00:00.000Z" },
        { slug: null, publishedAt: "2026-08-01T00:00:00.000Z" },
        { slug: "   ", publishedAt: "2026-08-01T00:00:00.000Z" },
        { slug: "published-2", publishedAt: "2026-08-01T00:00:00.000Z" },
      ],
    }));

    const slugs = await mod.fetchPublishedArticleSlugs();

    expect(slugs).toEqual(["published-1", "published-2"]);
    // Every survivor must be a usable route segment — this is the property
    // generateStaticParams depends on.
    for (const slug of slugs) {
      expect(typeof slug).toBe("string");
      expect(slug.trim()).not.toBe("");
    }
  });

  it("fetchPublishedArticleSlugs(limit) resolves [] on a thrown request", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    await expect(mod.fetchPublishedArticleSlugs(250)).resolves.toEqual([]);
  });

  // ---- fetchSitemapArticles (Phase 23, Plan 01, Task 1) ----

  function makeSitemapArticle(overrides: Record<string, unknown> = {}) {
    return {
      slug: "hello",
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      canonicalUrl: null,
      seo: { noindex: false },
      ...overrides,
    };
  }

  it("sends one GetSitemapArticles connection query with an explicit pagination argument when pageCount is 1", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async () => ({
        articles_connection: {
          nodes: [makeSitemapArticle()],
          pageInfo: { page: 1, pageSize: mod.SITEMAP_ARTICLE_PAGE_SIZE, pageCount: 1, total: 1 },
        },
      }));

    const result = await mod.fetchSitemapArticles();

    expect(requestSpy).toHaveBeenCalledTimes(1);
    const [query, variables] = requestSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(query).toContain("GetSitemapArticles");
    expect(variables).toMatchObject({ page: 1, pageSize: mod.SITEMAP_ARTICLE_PAGE_SIZE });
    expect(result.articles).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(1);
  });

  it("pages through every page up to pageCount, concatenating results in page order, when pageCount is within the cap", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async (_query: unknown, variables: unknown) => {
        const { page } = variables as { page: number };
        return {
          articles_connection: {
            nodes: [makeSitemapArticle({ slug: `post-${page}` })],
            pageInfo: { page, pageSize: mod.SITEMAP_ARTICLE_PAGE_SIZE, pageCount: 3, total: 3 },
          },
        };
      });

    const result = await mod.fetchSitemapArticles();

    expect(requestSpy).toHaveBeenCalledTimes(3);
    expect(result.articles.map((a) => a.slug)).toEqual(["post-1", "post-2", "post-3"]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncated: true and issues no more than SITEMAP_ARTICLE_MAX_PAGES requests when pageCount exceeds the cap", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const bigPageCount = mod.SITEMAP_ARTICLE_MAX_PAGES + 5;
    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async (_query: unknown, variables: unknown) => {
        const { page } = variables as { page: number };
        return {
          articles_connection: {
            nodes: [makeSitemapArticle({ slug: `post-${page}` })],
            pageInfo: {
              page,
              pageSize: mod.SITEMAP_ARTICLE_PAGE_SIZE,
              pageCount: bigPageCount,
              total: bigPageCount * mod.SITEMAP_ARTICLE_PAGE_SIZE,
            },
          },
        };
      });

    const result = await mod.fetchSitemapArticles();

    expect(requestSpy).toHaveBeenCalledTimes(mod.SITEMAP_ARTICLE_MAX_PAGES);
    expect(result.articles).toHaveLength(mod.SITEMAP_ARTICLE_MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  it("drops a node whose publishedAt is blank from the returned article list", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles_connection: {
        nodes: [
          makeSitemapArticle({ slug: "draft", publishedAt: null }),
          makeSitemapArticle({ slug: "published", publishedAt: "2026-08-01T00:00:00.000Z" }),
        ],
        pageInfo: { page: 1, pageSize: mod.SITEMAP_ARTICLE_PAGE_SIZE, pageCount: 1, total: 2 },
      },
    }));

    const result = await mod.fetchSitemapArticles();
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].slug).toBe("published");
  });

  it("carries a node's category slug and tag slugs through to the returned article (Plan 05, Task 1, D-6/D-8)", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => ({
      articles_connection: {
        nodes: [
          makeSitemapArticle({
            slug: "taxonomy-post",
            category: { slug: "news" },
            tags: [{ slug: "release" }, { slug: "announcement" }],
          }),
        ],
        pageInfo: { page: 1, pageSize: mod.SITEMAP_ARTICLE_PAGE_SIZE, pageCount: 1, total: 1 },
      },
    }));

    const result = await mod.fetchSitemapArticles();
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0].category).toEqual({ slug: "news" });
    expect(result.articles[0].tags).toEqual([{ slug: "release" }, { slug: "announcement" }]);
  });

  it("resolves the empty fail-open result rather than propagating when the request throws", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });

    const result = await mod.fetchSitemapArticles();
    expect(result).toEqual({ articles: [], truncated: false, total: 0 });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("resolves the empty fail-open result when the Strapi endpoint is unconfigured", async () => {
    delete process.env[ENV_VAR];
    vi.resetModules();
    const mod = await import("../blog-client");

    const result = await mod.fetchSitemapArticles();
    expect(result).toEqual({ articles: [], truncated: false, total: 0 });
  });

  // ---- fetchRelatedArticles (Phase 23, Plan 04, Task 2, BLOG-10/D-5) ----

  it("a post with a category and tags produces candidates from both terms, deduplicated, ranked, and capped at three", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const categoryOnly = makeArticle({
      documentId: "category-only",
      category: { name: "News", slug: "news", description: null },
      tags: [],
    });
    const tagOnly = makeArticle({
      documentId: "tag-only",
      category: { name: "Other", slug: "other", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const dup = makeArticle({
      documentId: "dup",
      category: { name: "News", slug: "news", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const fourth = makeArticle({
      documentId: "fourth",
      category: { name: "News", slug: "news", description: null },
      tags: [],
      publishedAt: "2026-08-05T00:00:00.000Z",
    });

    const requestSpy = vi
      .spyOn(strapiClientMod.strapiClient, "request")
      .mockImplementation(async (_query: unknown, variables: unknown) => {
        const vars = variables as { filters?: Record<string, unknown> };
        const isCategoryTerm = vars.filters && "category" in vars.filters;
        const nodes = isCategoryTerm
          ? [categoryOnly, dup, fourth]
          : [tagOnly, dup];
        return {
          articles_connection: {
            nodes,
            pageInfo: { page: 1, pageSize: mod.RELATED_CANDIDATE_PAGE_SIZE, pageCount: 1, total: nodes.length },
          },
        };
      });

    const result = await mod.fetchRelatedArticles(source);

    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(3);
    // Deduplicated: "dup" appears exactly once.
    expect(result.filter((a) => a.documentId === "dup")).toHaveLength(1);
  });

  it("a post with no category and no tags resolves an empty array and issues zero requests", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const requestSpy = vi.spyOn(strapiClientMod.strapiClient, "request");
    const source = makeArticle({ documentId: "source", category: null, tags: [] });

    const result = await mod.fetchRelatedArticles(source);

    expect(result).toEqual([]);
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it("reaches the A2 fallback end to end: when the term-filtered request throws, the unfiltered request supplies candidates and a draft among them is still excluded", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
      tags: [],
    });
    const draft = makeArticle({
      documentId: "draft",
      category: { name: "News", slug: "news", description: null },
      publishedAt: null,
    });
    const published = makeArticle({
      documentId: "published-sibling",
      category: { name: "News", slug: "news", description: null },
    });

    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(
      async (query: unknown) => {
        const q = query as string;
        if (q.includes("GetPublishedArticlesByTerm")) {
          throw new Error("relation filter not honoured");
        }
        return {
          articles_connection: {
            nodes: [draft, published],
            pageInfo: { page: 1, pageSize: mod.RELATED_CANDIDATE_PAGE_SIZE, pageCount: 1, total: 2 },
          },
        };
      }
    );

    const result = await mod.fetchRelatedArticles(source);

    expect(result.map((a) => a.documentId)).toEqual(["published-sibling"]);
  });

  it("resolves an empty array rather than propagating when every path throws", async () => {
    const strapiClientMod = await import("../strapi-client");
    const mod = await import("../blog-client");
    vi.spyOn(strapiClientMod.strapiClient, "request").mockImplementation(async () => {
      throw new Error("network error");
    });
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
    });

    await expect(mod.fetchRelatedArticles(source)).resolves.toEqual([]);
  });

  it("resolves an empty array when the Strapi endpoint is unconfigured", async () => {
    delete process.env[ENV_VAR];
    vi.resetModules();
    const mod = await import("../blog-client");
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
    });

    const result = await mod.fetchRelatedArticles(source);
    expect(result).toEqual([]);
  });

  it("RELATED_CANDIDATE_PAGE_SIZE and RELATED_TAG_QUERY_CAP are exported constants", async () => {
    const mod = await import("../blog-client");
    expect(typeof mod.RELATED_CANDIDATE_PAGE_SIZE).toBe("number");
    expect(typeof mod.RELATED_TAG_QUERY_CAP).toBe("number");
  });
});
