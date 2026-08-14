import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { buildShellHtml } from "../server-shell";
import { React } from "../ssr-react-runtime";
import { resolvePostRenderPlan, buildBlogRenderPage, type BlogRenderTemplate } from "../blog-render";
import { resolvePostPath } from "../blog-pagination";
import type { LoadedThemeModule } from "../theme-loader";
import type { StrapiPage, StrapiSite } from "../strapi-client";
import {
  ARTICLE_PROP_FIELDS,
  type ArticleSourceRecord,
  type TemplateSupportManifest,
} from "../article-contract";
import type { BlogArticleRecord } from "../blog-client";

/**
 * Phase 22 Plan 02 Task 1 tracer: `resolvePostRenderPlan` -> `buildBlogRenderPage`
 * -> `buildShellHtml` produces server HTML carrying a real published post's
 * prose and title -- the whole read architecture proven as one chain, not
 * five separately-tested units (mirrors Phase 21's `article-render-tracer.test.tsx`
 * exactly: fake theme components built with `React.createElement` sourced
 * from `../ssr-react-runtime`, the SAME React copy `buildShellHtml` renders
 * with, per that module's own header warning).
 */

function Header(props: { article?: { title: string } }) {
  return React.createElement("h1", null, props.article?.title ?? "");
}

function ArticleBodySection(props: { article?: { body: string } }) {
  return React.createElement("div", {
    "data-testid": "article-body",
    dangerouslySetInnerHTML: { __html: props.article?.body ?? "" },
  });
}

function makeTracerThemeModule(): LoadedThemeModule {
  return {
    name: "tracer-theme",
    version: "0.0.0-test",
    sectionsComponents: {
      header: Header,
      "article-body": ArticleBodySection,
    },
    sectionSettingsSchemas: {},
  };
}

const LIVE_THEME_ID = "theme-1";

const SUPPORTING_MANIFEST: TemplateSupportManifest = {
  sections: [{ key: "article-body", name: "Article Body" }],
  templates: [{ key: "article", name: "Article", sections: ["article-body"] }],
  version: "1",
};

const ARTICLE_TEMPLATE: BlogRenderTemplate = {
  documentId: "tmpl-1",
  key: "article",
  theme: { documentId: LIVE_THEME_ID },
  sections: [{ sectionKey: "header", order: 0, data: {} }, { sectionKey: "article-body", order: 1, data: {} }],
};

const PUBLISHED_ARTICLE: ArticleSourceRecord = {
  documentId: "a1",
  title: "My Post Title",
  slug: "my-post",
  body: "<p>Real prose content for the blog tracer test.</p>",
  excerpt: "",
  featuredImage: null,
  category: null,
  tags: [],
  author: null,
  publishedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

describe("blog post render tracer -- resolvePostRenderPlan -> buildBlogRenderPage -> buildShellHtml carries the post's prose and title", () => {
  it("feeding a real published post through the whole chain produces server HTML containing both", () => {
    const plan = resolvePostRenderPlan({
      site: { liveTheme: { documentId: LIVE_THEME_ID, sectionsManifest: SUPPORTING_MANIFEST } },
      pageTemplates: [ARTICLE_TEMPLATE],
      article: PUBLISHED_ARTICLE,
    });

    expect(plan.kind).toBe("render");
    if (plan.kind !== "render") return;

    const page = buildBlogRenderPage(plan.template, PUBLISHED_ARTICLE.title, PUBLISHED_ARTICLE.slug);
    const themeModule = makeTracerThemeModule();

    const html = buildShellHtml({
      page: page as unknown as StrapiPage,
      themeModule,
      themeName: "tracer-theme",
      recordProps: plan.recordProps,
    });

    expect(html).not.toBeNull();
    expect(html).toContain("Real prose content for the blog tracer test.");
    expect(html).toContain("My Post Title");
    expect(html).toContain('data-testid="article-body"');
  });
});

/**
 * Phase 23, Plan 06 tracer: `RenderPost` itself -- not just the pure chain
 * above -- actually reaches a crawler's server HTML with both of this plan's
 * outputs (BLOG-09's Article JSON-LD script, BLOG-10's `relatedPosts` seam).
 *
 * Mocks the same read-layer modules `app/_lib/render-page-metadata.test.ts`
 * mocks for `buildPageMetadata` (`@/lib/strapi-client`), extended to
 * `@/lib/blog-client`'s three `RenderPost` reads, plus the theme-resolution
 * seam (`@/lib/live-resolve`, `@/lib/theme-evaluator`) that would otherwise
 * require a real network bundle fetch and a real `node:vm` evaluation.
 * `lib/jsonld.ts`, `lib/server-shell.tsx`, `lib/section-resolver.tsx` and
 * `lib/page-renderer.tsx` are all REAL, unmocked -- so a passing assertion
 * here proves the whole path from `RenderPost` to rendered markup, not just
 * that a mocked seam was called with the right arguments.
 */
vi.mock("@/lib/strapi-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/strapi-client")>();
  return { ...actual, fetchSite: vi.fn() };
});
vi.mock("@/lib/blog-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/blog-client")>();
  return {
    ...actual,
    fetchBlogPageTemplates: vi.fn(),
    fetchPublishedArticleBySlug: vi.fn(),
    fetchRelatedArticles: vi.fn(),
  };
});
vi.mock("@/lib/live-resolve", () => ({
  resolveLiveBundle: vi.fn(),
}));
vi.mock("@/lib/theme-evaluator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/theme-evaluator")>();
  return { ...actual, evaluateThemeServerSide: vi.fn() };
});

import { RenderPost } from "../../app/_lib/render-blog";
import { fetchSite } from "@/lib/strapi-client";
import {
  fetchBlogPageTemplates,
  fetchPublishedArticleBySlug,
  fetchRelatedArticles,
} from "@/lib/blog-client";
import { resolveLiveBundle } from "@/lib/live-resolve";
import { evaluateThemeServerSide } from "@/lib/theme-evaluator";

const RENDER_POST_LIVE_THEME_ID = "render-post-theme";

const RENDER_POST_MANIFEST: TemplateSupportManifest = {
  sections: [{ key: "article-body", name: "Article Body" }],
  templates: [{ key: "article", name: "Article", sections: ["article-body"] }],
  version: "1",
};

const RENDER_POST_SITE: StrapiSite = {
  name: "Acme",
  siteUrl: "https://acme.com",
  liveTheme: { documentId: RENDER_POST_LIVE_THEME_ID, sectionsManifest: RENDER_POST_MANIFEST },
};

const RENDER_POST_TEMPLATE: BlogRenderTemplate = {
  documentId: "render-post-tmpl",
  key: "article",
  theme: { documentId: RENDER_POST_LIVE_THEME_ID },
  sections: [
    { sectionKey: "header", order: 0, data: {} },
    { sectionKey: "article-body", order: 1, data: {} },
    { sectionKey: "related-posts", order: 2, data: {} },
  ],
};

const RENDER_POST_ARTICLE: BlogArticleRecord = {
  documentId: "post-1",
  title: "My Post Title",
  slug: "my-post",
  body: "<p>Real prose content for the blog tracer test.</p>",
  excerpt: "",
  featuredImage: null,
  category: { name: "Moving Tips", slug: "moving-tips" },
  tags: [],
  author: { name: "Ana García" },
  publishedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function relatedArticle(documentId: string, title: string, slug: string): BlogArticleRecord {
  return {
    documentId,
    title,
    slug,
    body: "",
    excerpt: "",
    featuredImage: null,
    category: { name: "Moving Tips", slug: "moving-tips" },
    tags: [],
    author: null,
    publishedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

/** Set by `RelatedPostsSection` on every render, reset in `beforeEach` below --
 * how the "no `relatedPosts` key when the list is empty" assertions observe
 * the ACTUAL prop bag a section received, not a reimplementation of
 * `buildSectionProps`'s own logic. */
let capturedRelatedPostsProps: Record<string, unknown> | null = null;

/** Same `React.createElement`-from-`ssr-react-runtime` discipline
 * `Header`/`ArticleBodySection` above use -- this component is rendered
 * INSIDE `buildShellHtml`, which pairs its own React copy with its own
 * `renderToStaticMarkup`; JSX syntax here would construct elements with the
 * app's OWN React instead and break that pairing (see this file's header). */
function RelatedPostsSection(props: Record<string, unknown>) {
  capturedRelatedPostsProps = props;
  const items = (props.relatedPosts as Array<{ slug: string; title: string }> | undefined) ?? [];
  return React.createElement(
    "nav",
    { "data-testid": "related-posts" },
    items.map((post) =>
      React.createElement("a", { key: post.slug, href: resolvePostPath(post.slug) }, post.title)
    )
  );
}

function makeRenderPostThemeModule(): LoadedThemeModule {
  return {
    name: "tracer-theme",
    version: "0.0.0-test",
    sectionsComponents: {
      header: Header,
      "article-body": ArticleBodySection,
      "related-posts": RelatedPostsSection,
    },
    sectionSettingsSchemas: {},
  };
}

/** Renders `RenderPost` end to end -- real fetch mocks in, real
 * `serializeJsonLd`/`buildShellHtml`/`PageRenderer` out -- and returns the
 * resulting server HTML string via the app's OWN `renderToStaticMarkup`
 * (`react-dom/server`, imported at this file's top), the same pairing
 * `page-renderer.test.tsx` uses for `PageRenderer`. */
async function renderPostHtml(args: {
  article: BlogArticleRecord | null;
  related?: BlogArticleRecord[];
  site?: StrapiSite | null;
  template?: BlogRenderTemplate;
}): Promise<string> {
  vi.mocked(fetchSite).mockResolvedValue(args.site ?? RENDER_POST_SITE);
  vi.mocked(fetchBlogPageTemplates).mockResolvedValue([args.template ?? RENDER_POST_TEMPLATE]);
  vi.mocked(fetchPublishedArticleBySlug).mockResolvedValue(args.article);
  vi.mocked(fetchRelatedArticles).mockResolvedValue(args.related ?? []);
  vi.mocked(resolveLiveBundle).mockReturnValue({
    themeBundleUrl: "https://cdn.example.com/tracer-theme.bundle.js",
    themeName: "tracer-theme",
    themeCssUrl: undefined,
    themeCssDeferredUrl: undefined,
  });
  vi.mocked(evaluateThemeServerSide).mockResolvedValue(makeRenderPostThemeModule());

  const element = await RenderPost({ slug: args.article?.slug ?? "unknown" });
  return renderToStaticMarkup(element);
}

const RENDER_POST_ENV_KEYS = ["NEXT_PUBLIC_SITE_SUBDOMAIN", "VERCEL_CUSTOM_DOMAIN"] as const;

describe("RenderPost -- Article JSON-LD reaches the rendered server HTML (Phase 23, Plan 06, Task 1, BLOG-09)", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedRelatedPostsProps = null;
    savedEnv = {};
    for (const key of RENDER_POST_ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of RENDER_POST_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of RENDER_POST_ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("a published post's server HTML carries a JSON-LD script whose parsed content carries an Article node", async () => {
    const html = await renderPostHtml({ article: RENDER_POST_ARTICLE });

    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();

    const graph = JSON.parse(match![1]) as { "@graph": Array<{ "@type": string }> };
    expect(graph["@graph"].some((node) => node["@type"] === "Article")).toBe(true);
    // D-9: Article REPLACES WebPage on a post's own route -- the two node
    // types never co-occur in one graph.
    expect(graph["@graph"].some((node) => node["@type"] === "WebPage")).toBe(false);
  });

  it("a post whose graph builder returns null (no resolvable origin) emits no JSON-LD script element at all", async () => {
    const noOriginSite: StrapiSite = { name: "Acme", liveTheme: RENDER_POST_SITE.liveTheme };

    const html = await renderPostHtml({ article: RENDER_POST_ARTICLE, site: noOriginSite });

    expect(html).not.toContain("application/ld+json");
  });

  it("a post title containing a script-closing sequence never lets a raw closing-script sequence reach the rendered markup", async () => {
    const maliciousArticle: BlogArticleRecord = {
      ...RENDER_POST_ARTICLE,
      title: "Deal</script><script>alert(1)</script>",
    };

    const html = await renderPostHtml({ article: maliciousArticle });

    const scriptOpenCount = (html.match(/<script type="application\/ld\+json">/g) ?? []).length;
    expect(scriptOpenCount).toBe(1);

    const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain("</script");

    const graph = JSON.parse(match![1]) as {
      "@graph": Array<{ "@type": string; headline?: string }>;
    };
    const article = graph["@graph"].find((node) => node["@type"] === "Article");
    // JSON.parse decodes the `<` escape back to a literal `<` -- the
    // consumed data is byte-identical to the tenant's real title, proving the
    // escaping is reversible, not merely destructive.
    expect(article?.headline).toBe("Deal</script><script>alert(1)</script>");
  });
});

describe("RenderPost -- relatedPosts reaches every theme section through recordProps (Phase 23, Plan 06, Task 2, BLOG-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedRelatedPostsProps = null;
  });

  it("threads relatedPosts through the recordProps seam, rendering one real internal anchor per related post", async () => {
    const related1 = relatedArticle("post-2", "Related Post One", "related-post-one");
    const related2 = relatedArticle("post-3", "Related Post Two", "related-post-two");

    const html = await renderPostHtml({ article: RENDER_POST_ARTICLE, related: [related1, related2] });

    expect(html).toContain('data-testid="related-posts"');
    expect(html).toContain(`href="${resolvePostPath("related-post-one")}"`);
    expect(html).toContain(`href="${resolvePostPath("related-post-two")}"`);
    expect(html).toContain("Related Post One");
    expect(html).toContain("Related Post Two");
  });

  it("an empty related list attaches no relatedPosts member and renders unchanged from the no-related-posts baseline", async () => {
    const html = await renderPostHtml({ article: RENDER_POST_ARTICLE, related: [] });

    expect(capturedRelatedPostsProps).not.toBeNull();
    expect(
      Object.prototype.hasOwnProperty.call(capturedRelatedPostsProps!, "relatedPosts")
    ).toBe(false);

    expect(html).toContain("My Post Title");
    expect(html).toContain("Real prose content for the blog tracer test.");
    expect(html).not.toContain('href="/blog/related-post-one"');
  });

  it("each related item is a frozen eleven-field prop matching ArticleProp's exact field list", async () => {
    const related1 = relatedArticle("post-2", "Related Post One", "related-post-one");

    await renderPostHtml({ article: RENDER_POST_ARTICLE, related: [related1] });

    const relatedPosts = capturedRelatedPostsProps?.relatedPosts as Array<Record<string, unknown>>;
    expect(relatedPosts).toHaveLength(1);
    expect(Object.keys(relatedPosts[0]).sort()).toEqual([...ARTICLE_PROP_FIELDS].sort());
  });
});
