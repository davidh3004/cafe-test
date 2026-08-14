/**
 * The pure post-detail render-plan resolver (Phase 22, Plan 02 Task 1 --
 * BLOG-07/BLOG-08).
 *
 * PURE MODULE, DELIBERATELY: no React import, no network call, and no
 * import of the framework's route-boundary navigation helper. Every blog
 * render decision for `/blog/{slug}` lives here so it is unit-testable
 * without a request, a route or a theme bundle -- which is exactly what
 * makes `app/blog/[slug]/page.tsx` (Task 3) legitimately as thin and
 * untested as `app/[slug]/page.tsx` already is in this codebase.
 *
 * Delegates 100% of "does this theme support posts" to `blog-degrade.ts`'s
 * `resolveBlogSurfaceSupport` (Phase 21) -- never re-derives that manifest
 * declaration rule itself. Template resolution reuses `resolveTemplateByKey`
 * (Phase 21, D-2) verbatim: the reserved key off the live theme, no new
 * resolution mechanism, no per-post template relation. The prop contract
 * stays frozen at eleven fields (D-12) -- `buildArticleProp` is the only
 * builder called, never a hand-rolled field addition.
 */

import {
  ARTICLE_TEMPLATE_KEY,
  ARCHIVE_TEMPLATE_KEY,
  resolveTemplateByKey,
  buildArticleProp,
  buildArchiveProp,
  type ArticleSourceRecord,
  type SectionRecordProps,
  type TemplateSupportManifest,
} from "./article-contract";
import { resolveBlogSurfaceSupport, type BlogDegradeReporter } from "./blog-degrade";
import {
  resolveBlogPaginationPath,
  isBlogPageInRange,
  type BlogSurfaceKind,
} from "./blog-pagination";

/**
 * Narrow site shape this resolver needs -- mirrors `blog-degrade.ts`'s own
 * narrow-local-interface convention (its `TemplateSupportManifest` param)
 * rather than importing the wider `StrapiSite` from `./strapi-client`, which
 * would pull this module into that file's dependency graph for no reason:
 * every field this resolver reads is already represented here.
 */
export interface BlogRenderSite {
  liveTheme?: {
    documentId: string;
    sectionsManifest?: TemplateSupportManifest | null;
  } | null;
}

/**
 * The narrow shape of a resolved page-template this module needs -- mirrors
 * `BlogPageTemplate`'s own shape (`./blog-client`) without importing that
 * module, the same narrow-local-interface convention `BlogRenderSite` above
 * follows. Structurally compatible with `resolveTemplateByKey`'s generic
 * constraint (`{ key?, theme? }`).
 */
export interface BlogRenderTemplate {
  documentId: string;
  key?: string | null;
  theme?: { documentId?: string | null } | null;
  sections: Array<{
    id?: number | string;
    sectionKey: string;
    order?: number | null;
    data: Record<string, unknown>;
    blocks?: Array<{
      id?: number | string;
      blockType: string;
      order?: number | null;
      data: Record<string, unknown>;
    }>;
  }>;
}

/**
 * The whole post-detail render decision, as a discriminated union.
 *
 * `unsupported`'s `heading`/`body`/`status` are copied straight off
 * `resolveBlogSurfaceSupport`'s unsupported result -- the SAME
 * `BLOG_UNSUPPORTED_HEADING`/`BLOG_UNSUPPORTED_BODY` constants
 * `blog-degrade.ts` exports -- never retyped here, so the copy has exactly
 * one source of truth.
 */
export type BlogRenderPlan =
  | { kind: "unsupported"; heading: string; body: string; status: 404 }
  | { kind: "not-found" }
  | { kind: "render"; template: BlogRenderTemplate; recordProps: SectionRecordProps };

/**
 * Resolves the whole post-detail decision for `/blog/{slug}` -- one call
 * this module's only export a route needs to reach a render/not-found/
 * unsupported answer.
 *
 * Guard order is LOAD-BEARING (matches the plan's behavior contract exactly):
 *   1. `site.liveTheme` presence -- absent means nothing renders publicly
 *      (mirrors `resolvePageForLiveTheme`'s D-04 rule).
 *   2. `resolveBlogSurfaceSupport(liveTheme.sectionsManifest, ARTICLE_TEMPLATE_KEY, report)`
 *      -- runs BEFORE the article lookup, so an unsupported theme reports the
 *      degrade even for a slug that does not exist (T-22-*, matches D-4).
 *   3. The article's presence AND a non-empty `publishedAt` (T-22-01: the
 *      double gate `RenderPage` already uses for pages, on top of Plan 01's
 *      query-level published-only gate).
 *   4. `resolveTemplateByKey(pageTemplates, site.liveTheme.documentId, ARTICLE_TEMPLATE_KEY)`
 *      -- no template bound to the live theme is a not-found, not a crash.
 *
 * Only when every guard passes does this return `{ kind: "render" }`, whose
 * `recordProps.article` is built via `buildArticleProp` (the frozen
 * eleven-field contract, D-12) and whose `recordProps.archive` is absent --
 * a post-detail composition never carries a listing prop.
 */
export function resolvePostRenderPlan(args: {
  site: BlogRenderSite | null | undefined;
  pageTemplates: BlogRenderTemplate[] | null | undefined;
  article: ArticleSourceRecord | null | undefined;
  report?: BlogDegradeReporter;
}): BlogRenderPlan {
  const { site, pageTemplates, article, report } = args;

  const liveTheme = site?.liveTheme;
  if (!liveTheme) {
    return { kind: "not-found" };
  }

  const support = resolveBlogSurfaceSupport(
    liveTheme.sectionsManifest,
    ARTICLE_TEMPLATE_KEY,
    report
  );
  if (!support.supported) {
    return {
      kind: "unsupported",
      heading: support.heading,
      body: support.body,
      status: support.status,
    };
  }

  if (
    !article ||
    typeof article.publishedAt !== "string" ||
    article.publishedAt.trim() === ""
  ) {
    return { kind: "not-found" };
  }

  const template = resolveTemplateByKey(pageTemplates, liveTheme.documentId, ARTICLE_TEMPLATE_KEY);
  if (!template) {
    return { kind: "not-found" };
  }

  return {
    kind: "render",
    template,
    recordProps: { article: buildArticleProp(article) },
  };
}

/**
 * Synthesises the `StrapiPage`-shaped value the existing render seam
 * (`buildShellHtml` / `PageRenderer`) consumes, so a post reuses the page
 * render path with no parallel renderer. `title`/`slug` are the post's, and
 * `page_template` is `{ documentId, sections }` taken off the resolved
 * template. `documentId` on the returned value is synthesized from `slug`
 * (a real post's `documentId` is never threaded through this 3-argument
 * signature) and `publishedAt` is not carried -- neither field is read by
 * `buildShellHtml`, `resolveSectionsForRender` or `PageRenderer`, which only
 * ever consume `page.title` and `page.page_template`.
 */
export function buildBlogRenderPage(
  template: BlogRenderTemplate,
  title: string,
  slug: string
): {
  documentId: string;
  title: string;
  slug: string;
  publishedAt: string | null;
  page_template: { documentId: string; sections: BlogRenderTemplate["sections"] };
} {
  return {
    documentId: slug,
    title,
    slug,
    publishedAt: null,
    page_template: {
      documentId: template.documentId,
      sections: template.sections,
    },
  };
}

/** The plain "post not found" copy this file owns -- read by both
 * `app/blog/not-found.tsx` (Task 3) and this file's own tests, so the two
 * never restate the strings independently. */
export const BLOG_POST_NOT_FOUND_HEADING = "Post not found";
export const BLOG_POST_NOT_FOUND_BODY =
  "The post you're looking for doesn't exist or is no longer available.";

/**
 * D-10's reason branch for the blog-scoped 404 boundary: when
 * `resolveBlogSurfaceSupport` reports EITHER reserved surface (`article` or
 * `archive`) unsupported for the live theme's manifest, returns the Phase 21
 * degrade copy; otherwise returns this file's own plain post-not-found copy.
 * Called with no `report` argument -- this boundary renders after a
 * `notFound()` has already been resolved and (when applicable) already
 * reported by `resolvePostRenderPlan`, so calling it again here would double
 * -report the same degrade.
 */
export function resolveBlogNotFoundCopy(
  manifest: TemplateSupportManifest | null | undefined
): { heading: string; body: string } {
  const articleSupport = resolveBlogSurfaceSupport(manifest, ARTICLE_TEMPLATE_KEY);
  if (!articleSupport.supported) {
    return { heading: articleSupport.heading, body: articleSupport.body };
  }

  const archiveSupport = resolveBlogSurfaceSupport(manifest, ARCHIVE_TEMPLATE_KEY);
  if (!archiveSupport.supported) {
    return { heading: archiveSupport.heading, body: archiveSupport.body };
  }

  return { heading: BLOG_POST_NOT_FOUND_HEADING, body: BLOG_POST_NOT_FOUND_BODY };
}

// ---- Archive render-plan resolver (Phase 22, Plan 06 Task 1 -- BLOG-07) ----
//
// The listing-surface counterpart to `resolvePostRenderPlan` above, serving
// `/blog`, `/blog/category/{term}` and `/blog/tag/{term}` alike (D-3: one
// `archive` template, three kinds of term). Returns the SAME `BlogRenderPlan`
// union `resolvePostRenderPlan` returns, so the post-detail and listing route
// families map a plan onto a response with identical code.

/** The resolved category/tag lookup a term surface supplies -- the shape
 * `fetchBlogTerm` (`./blog-client`) resolves, duplicated narrowly here per
 * this module's own no-cross-app-import convention (see `BlogRenderSite`'s
 * doc comment above). `null`/`undefined` means the term slug does not exist. */
export interface BlogRenderTerm {
  name: string;
  description?: string | null;
}

/** The Relay-style page state a listing read resolves alongside its nodes --
 * mirrors `BlogPageInfo`'s shape (`./blog-client`) without importing that
 * module. */
export interface ArchivePageInfo {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

/**
 * Resolves the whole listing decision for the blog index, a category archive
 * and a tag archive alike -- one call a route needs to reach a
 * render/not-found/unsupported answer, exactly like `resolvePostRenderPlan`.
 *
 * Guard order is LOAD-BEARING (matches the plan's behavior contract exactly):
 *   1. `site.liveTheme` presence.
 *   2. `resolveBlogSurfaceSupport` against `ARCHIVE_TEMPLATE_KEY` -- resolved
 *      COMPLETELY INDEPENDENTLY of the article surface (D-12): an
 *      archive-only manifest supports this surface and not the post surface,
 *      and the reverse; neither falls back to the other.
 *   3. For a `category`/`tag` surface, the resolved `term` must be present --
 *      an unknown term slug is not-found even when `posts` came back (a
 *      stale inline relation filter could otherwise surface rows for a term
 *      that no longer exists).
 *   4. `isBlogPageInRange(pageInfo.page, pageInfo.pageCount)` -- an
 *      out-of-range page is not-found, NEVER an empty list. Page 1 of an
 *      empty blog is always in range, so the theme's own empty state shows.
 *   5. `resolveTemplateByKey` against `ARCHIVE_TEMPLATE_KEY`.
 *
 * The record props are built via `buildArchiveProp` -- never hand-built --
 * mapping the index surface onto the `"all"` term kind with an empty name
 * and a null description, and a term surface onto that term's resolved kind,
 * name and description.
 */
export function resolveArchiveRenderPlan(args: {
  site: BlogRenderSite | null | undefined;
  pageTemplates: BlogRenderTemplate[] | null | undefined;
  kind: BlogSurfaceKind;
  termSlug?: string | null;
  term?: BlogRenderTerm | null;
  posts: ArticleSourceRecord[] | null | undefined;
  pageInfo: ArchivePageInfo;
  report?: BlogDegradeReporter;
}): BlogRenderPlan {
  const { site, pageTemplates, kind, term, posts, pageInfo, report } = args;

  const liveTheme = site?.liveTheme;
  if (!liveTheme) {
    return { kind: "not-found" };
  }

  const support = resolveBlogSurfaceSupport(
    liveTheme.sectionsManifest,
    ARCHIVE_TEMPLATE_KEY,
    report
  );
  if (!support.supported) {
    return {
      kind: "unsupported",
      heading: support.heading,
      body: support.body,
      status: support.status,
    };
  }

  if (kind !== "index" && !term) {
    return { kind: "not-found" };
  }

  if (!isBlogPageInRange(pageInfo.page, pageInfo.pageCount)) {
    return { kind: "not-found" };
  }

  const template = resolveTemplateByKey(
    pageTemplates,
    liveTheme.documentId,
    ARCHIVE_TEMPLATE_KEY
  );
  if (!template) {
    return { kind: "not-found" };
  }

  const resolvedTerm =
    kind === "index"
      ? { kind: "all" as const, name: "", description: null }
      : { kind, name: term?.name ?? "", description: term?.description ?? null };

  return {
    kind: "render",
    template,
    recordProps: {
      archive: buildArchiveProp({
        posts: posts ?? [],
        term: resolvedTerm,
        page: {
          current: pageInfo.page,
          pageSize: pageInfo.pageSize,
          pageCount: pageInfo.pageCount,
          total: pageInfo.total,
        },
      }),
    },
  };
}

/**
 * Thin named wrapper over `resolveBlogPaginationPath` (Plan 03) -- adds NO
 * logic of its own. It exists so the canonical's producer is named at the
 * call site: a future reader looking for "where does the blog canonical come
 * from" finds one answer. Never reimplement the path algebra here -- a
 * second implementation is precisely the drift that would break criterion 2.
 */
export function resolveArchiveCanonicalPath(
  kind: BlogSurfaceKind,
  termSlug: string | null | undefined,
  page: number
): string {
  return resolveBlogPaginationPath(kind, termSlug, page);
}
