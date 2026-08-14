import { describe, expect, it, vi } from "vitest";

import {
  resolvePostRenderPlan,
  buildBlogRenderPage,
  resolveBlogNotFoundCopy,
  resolveArchiveRenderPlan,
  resolveArchiveCanonicalPath,
  BLOG_POST_NOT_FOUND_HEADING,
  BLOG_POST_NOT_FOUND_BODY,
  type BlogRenderSite,
  type BlogRenderTemplate,
} from "../blog-render";
import { BLOG_UNSUPPORTED_HEADING, BLOG_UNSUPPORTED_BODY } from "../blog-degrade";
import type { ArticleSourceRecord, TemplateSupportManifest } from "../article-contract";

const SUPPORTING_MANIFEST: TemplateSupportManifest = {
  sections: [{ key: "article-body", name: "Article Body" }],
  templates: [{ key: "article", name: "Article", sections: ["article-body"] }],
  version: "1",
};

const UNSUPPORTING_MANIFEST: TemplateSupportManifest = {
  sections: [],
  templates: [],
  version: "1",
};

const LIVE_THEME_ID = "theme-1";

function site(manifest: TemplateSupportManifest | null | undefined): BlogRenderSite {
  return { liveTheme: { documentId: LIVE_THEME_ID, sectionsManifest: manifest } };
}

const ARTICLE_TEMPLATE: BlogRenderTemplate = {
  documentId: "tmpl-1",
  key: "article",
  theme: { documentId: LIVE_THEME_ID },
  sections: [{ sectionKey: "article-body", order: 0, data: {} }],
};

const ARCHIVE_SUPPORTING_MANIFEST: TemplateSupportManifest = {
  sections: [{ key: "archive-list", name: "Archive List" }],
  templates: [{ key: "archive", name: "Archive", sections: ["archive-list"] }],
  version: "1",
};

const ARCHIVE_TEMPLATE: BlogRenderTemplate = {
  documentId: "tmpl-archive",
  key: "archive",
  theme: { documentId: LIVE_THEME_ID },
  sections: [{ sectionKey: "archive-list", order: 0, data: {} }],
};

const OTHER_THEME_ARTICLE_TEMPLATE: BlogRenderTemplate = {
  documentId: "tmpl-2",
  key: "article",
  theme: { documentId: "some-other-theme" },
  sections: [{ sectionKey: "article-body", order: 0, data: {} }],
};

const PUBLISHED_ARTICLE: ArticleSourceRecord = {
  documentId: "a1",
  title: "My Post",
  slug: "my-post",
  body: "<p>Real prose.</p>",
  excerpt: "",
  featuredImage: null,
  category: null,
  tags: [],
  author: null,
  publishedAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const DRAFT_ARTICLE: ArticleSourceRecord = {
  ...PUBLISHED_ARTICLE,
  publishedAt: null,
};

describe("resolvePostRenderPlan", () => {
  it("resolves not-found when site.liveTheme is null", () => {
    const plan = resolvePostRenderPlan({
      site: { liveTheme: null },
      pageTemplates: [ARTICLE_TEMPLATE],
      article: PUBLISHED_ARTICLE,
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves unsupported (with heading/body/status) when the manifest declares no article template", () => {
    const plan = resolvePostRenderPlan({
      site: site(UNSUPPORTING_MANIFEST),
      pageTemplates: [ARTICLE_TEMPLATE],
      article: PUBLISHED_ARTICLE,
    });
    expect(plan.kind).toBe("unsupported");
    if (plan.kind === "unsupported") {
      expect(plan.heading).toBe(BLOG_UNSUPPORTED_HEADING);
      expect(plan.body).toBe(BLOG_UNSUPPORTED_BODY);
      expect(plan.status).toBe(404);
    }
  });

  it("invokes the supplied reporter exactly once when unsupported", () => {
    const report = vi.fn();
    resolvePostRenderPlan({
      site: site(UNSUPPORTING_MANIFEST),
      pageTemplates: [ARTICLE_TEMPLATE],
      article: PUBLISHED_ARTICLE,
      report,
    });
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("resolves not-found when the manifest supports posts but the article is null", () => {
    const plan = resolvePostRenderPlan({
      site: site(SUPPORTING_MANIFEST),
      pageTemplates: [ARTICLE_TEMPLATE],
      article: null,
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves not-found for an unpublished (draft) article", () => {
    const plan = resolvePostRenderPlan({
      site: site(SUPPORTING_MANIFEST),
      pageTemplates: [ARTICLE_TEMPLATE],
      article: DRAFT_ARTICLE,
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves not-found when a supporting manifest and a real article exist but no article template is bound to the live theme", () => {
    const plan = resolvePostRenderPlan({
      site: site(SUPPORTING_MANIFEST),
      pageTemplates: [OTHER_THEME_ARTICLE_TEMPLATE],
      article: PUBLISHED_ARTICLE,
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves render with an 11-field ArticleProp and no archive when everything is present", () => {
    const plan = resolvePostRenderPlan({
      site: site(SUPPORTING_MANIFEST),
      pageTemplates: [ARTICLE_TEMPLATE],
      article: PUBLISHED_ARTICLE,
    });
    expect(plan.kind).toBe("render");
    if (plan.kind === "render") {
      expect(plan.recordProps.article).not.toBeNull();
      expect(Object.keys(plan.recordProps.article!).length).toBe(11);
      expect(plan.recordProps.article!.title).toBe("My Post");
      expect(plan.recordProps.archive).toBeUndefined();
      expect(plan.template).toBe(ARTICLE_TEMPLATE);
    }
  });

  it("runs the support check BEFORE the article lookup, so an unsupported theme reports the degrade even for a nonexistent slug", () => {
    const report = vi.fn();
    const plan = resolvePostRenderPlan({
      site: site(UNSUPPORTING_MANIFEST),
      pageTemplates: [],
      article: null,
      report,
    });
    expect(plan.kind).toBe("unsupported");
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("buildBlogRenderPage", () => {
  it("returns a value whose page_template.sections are the template's sections and whose title/slug are the post's", () => {
    const page = buildBlogRenderPage(ARTICLE_TEMPLATE, "My Post", "my-post");
    expect(page.title).toBe("My Post");
    expect(page.slug).toBe("my-post");
    expect(page.page_template.sections).toBe(ARTICLE_TEMPLATE.sections);
  });
});

describe("resolveBlogNotFoundCopy", () => {
  it("returns the unsupported heading/body when the article surface is unsupported", () => {
    const copy = resolveBlogNotFoundCopy(UNSUPPORTING_MANIFEST);
    expect(copy.heading).toBe(BLOG_UNSUPPORTED_HEADING);
    expect(copy.body).toBe(BLOG_UNSUPPORTED_BODY);
  });

  it("returns the unsupported heading/body when only the archive surface is unsupported", () => {
    const articleOnly: TemplateSupportManifest = {
      sections: [{ key: "article-body", name: "Article Body" }],
      templates: [{ key: "article", name: "Article", sections: ["article-body"] }],
      version: "1",
    };
    const copy = resolveBlogNotFoundCopy(articleOnly);
    expect(copy.heading).toBe(BLOG_UNSUPPORTED_HEADING);
    expect(copy.body).toBe(BLOG_UNSUPPORTED_BODY);
  });

  it("returns the plain post-not-found copy when both surfaces are supported", () => {
    const bothSupported: TemplateSupportManifest = {
      sections: [
        { key: "article-body", name: "Article Body" },
        { key: "archive-list", name: "Archive List" },
      ],
      templates: [
        { key: "article", name: "Article", sections: ["article-body"] },
        { key: "archive", name: "Archive", sections: ["archive-list"] },
      ],
      version: "1",
    };
    const copy = resolveBlogNotFoundCopy(bothSupported);
    expect(copy.heading).toBe(BLOG_POST_NOT_FOUND_HEADING);
    expect(copy.body).toBe(BLOG_POST_NOT_FOUND_BODY);
  });
});

describe("resolveArchiveRenderPlan", () => {
  const emptyPageInfo = { page: 1, pageSize: 10, pageCount: 0, total: 0 };
  const onePagePageInfo = { page: 1, pageSize: 10, pageCount: 1, total: 1 };

  it("resolves not-found when site.liveTheme is null", () => {
    const plan = resolveArchiveRenderPlan({
      site: { liveTheme: null },
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "index",
      posts: [PUBLISHED_ARTICLE],
      pageInfo: onePagePageInfo,
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves unsupported when the manifest declares no archive template, independently of article support", () => {
    const report = vi.fn();
    // SUPPORTING_MANIFEST declares an `article` template only -- proves the
    // archive check runs independently of article support (D-12).
    const plan = resolveArchiveRenderPlan({
      site: site(SUPPORTING_MANIFEST),
      pageTemplates: [ARTICLE_TEMPLATE],
      kind: "index",
      posts: [],
      pageInfo: emptyPageInfo,
      report,
    });
    expect(plan.kind).toBe("unsupported");
    if (plan.kind === "unsupported") {
      expect(plan.heading).toBe(BLOG_UNSUPPORTED_HEADING);
      expect(plan.body).toBe(BLOG_UNSUPPORTED_BODY);
      expect(plan.status).toBe(404);
    }
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("resolves not-found for a term surface whose term lookup came back null, even when posts were returned", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "category",
      termSlug: "unknown-category",
      term: null,
      posts: [PUBLISHED_ARTICLE],
      pageInfo: onePagePageInfo,
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves not-found when the requested page is above the resolved page count", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "index",
      posts: [],
      pageInfo: { page: 5, pageSize: 10, pageCount: 2, total: 15 },
    });
    expect(plan.kind).toBe("not-found");
  });

  it("resolves render with an empty post array for page 1 of an empty blog", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "index",
      posts: [],
      pageInfo: emptyPageInfo,
    });
    expect(plan.kind).toBe("render");
    if (plan.kind === "render") {
      expect(plan.recordProps.archive?.posts).toEqual([]);
    }
  });

  it("resolves the index surface's term as the 'all' kind with an empty name", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "index",
      posts: [PUBLISHED_ARTICLE],
      pageInfo: onePagePageInfo,
    });
    expect(plan.kind).toBe("render");
    if (plan.kind === "render") {
      expect(plan.recordProps.archive?.term).toEqual({
        kind: "all",
        name: "",
        description: null,
      });
    }
  });

  it("resolves a category surface's term with the term's kind, name and description", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "category",
      termSlug: "news",
      term: { name: "News", description: "News posts" },
      posts: [PUBLISHED_ARTICLE],
      pageInfo: onePagePageInfo,
    });
    expect(plan.kind).toBe("render");
    if (plan.kind === "render") {
      expect(plan.recordProps.archive?.term).toEqual({
        kind: "category",
        name: "News",
        description: "News posts",
      });
    }
  });

  it("carries current page / page size / page count / total on recordProps.archive.page, with no recordProps.article", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [ARCHIVE_TEMPLATE],
      kind: "index",
      posts: [PUBLISHED_ARTICLE],
      pageInfo: { page: 2, pageSize: 10, pageCount: 3, total: 25 },
    });
    expect(plan.kind).toBe("render");
    if (plan.kind === "render") {
      expect(plan.recordProps.archive?.page).toEqual({
        current: 2,
        pageSize: 10,
        pageCount: 3,
        total: 25,
      });
      expect(plan.recordProps.article).toBeUndefined();
    }
  });

  it("resolves not-found when a supporting manifest exists but no archive template is bound to the live theme", () => {
    const plan = resolveArchiveRenderPlan({
      site: site(ARCHIVE_SUPPORTING_MANIFEST),
      pageTemplates: [],
      kind: "index",
      posts: [],
      pageInfo: emptyPageInfo,
    });
    expect(plan.kind).toBe("not-found");
  });
});

describe("resolveArchiveCanonicalPath", () => {
  it("returns the bare path for page 1, across all three kinds", () => {
    expect(resolveArchiveCanonicalPath("index", null, 1)).toBe("/blog");
    expect(resolveArchiveCanonicalPath("category", "news", 1)).toBe(
      "/blog/category/news"
    );
    expect(resolveArchiveCanonicalPath("tag", "featured", 1)).toBe(
      "/blog/tag/featured"
    );
  });

  it("returns the paginated path for page 2 and beyond, across all three kinds", () => {
    expect(resolveArchiveCanonicalPath("index", null, 2)).toBe("/blog/page/2");
    expect(resolveArchiveCanonicalPath("category", "news", 3)).toBe(
      "/blog/category/news/page/3"
    );
    expect(resolveArchiveCanonicalPath("tag", "featured", 2)).toBe(
      "/blog/tag/featured/page/2"
    );
  });
});
