/**
 * Shared render code for `/blog/{slug}` (Phase 22, Plan 02 -- BLOG-07/BLOG-08).
 *
 * Mirrors `render-page.tsx`'s shape deliberately: this is shared render code,
 * not a route, hence the private `app/_lib` folder (excluded from routing by
 * Next.js). Every DECISION (is this theme supported, is the post published,
 * which template renders it) already lives in the pure `lib/blog-render.ts`
 * resolver (Task 1) -- this module is a thin fetch-and-delegate shell that
 * reaches the theme through the exact same seam every page already uses:
 * `resolveLiveBundle` -> `evaluateThemeServerSide` -> `buildShellHtml` ->
 * `PageRenderer`.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchSite } from "@/lib/strapi-client";
import type { StrapiSite } from "@/lib/strapi-client";
import {
  fetchBlogPageTemplates,
  fetchPublishedArticleBySlug,
  fetchPublishedArticles,
  fetchBlogTerm,
  fetchRelatedArticles,
  type BlogTermFilter,
} from "@/lib/blog-client";
import {
  resolvePostRenderPlan,
  resolveArchiveRenderPlan,
  resolveArchiveCanonicalPath,
  buildBlogRenderPage,
} from "@/lib/blog-render";
import { buildArticleProp, type SectionRecordProps } from "@/lib/article-contract";
import { buildPostMetadataFrom } from "@/lib/blog-metadata";
/**
 * Namespace import (matches this repo's `import * as Sentry from
 * "@sentry/nextjs"`/`import * as HeadingNormalizer from "./heading-normalizer"`
 * convention): the graph serializer's one real call site below is the ONLY
 * place that literal function name appears in this file's code -- never a
 * second, bare stringify call at the call site.
 */
import * as JsonLd from "@/lib/jsonld";
import { BLOG_PAGE_SIZE, type BlogSurfaceKind } from "@/lib/blog-pagination";
import { PageRenderer } from "@/lib/page-renderer";
import { resolveLiveBundle } from "@/lib/live-resolve";
import {
  resolveSiteOrigin,
  resolveSiteTitleTemplate,
  resolveSiteDefaults,
  applyTitleTemplate,
  absoluteUrl,
  NOT_FOUND_TITLE,
} from "@/lib/seo-resolve";
import { reportSeoDegrade } from "@/lib/seo-report";
import { evaluateThemeServerSide } from "@/lib/theme-evaluator";
import { buildShellHtml, isSsrShellDisabled } from "@/lib/server-shell";
import { ConfigurationError } from "./render-page";

/**
 * Metadata for `/blog/{slug}` (BLOG-07/BLOG-08). Thin fetch-and-delegate
 * shell over `buildPostMetadataFrom` (`@/lib/blog-metadata`, Phase 23, Plan
 * 01, Task 2) -- every DECISION (missing/unpublished title, description,
 * title-template application, canonical composition) now lives in that pure
 * module; this function's only job is the two `cache()`-wrapped reads.
 */
export async function buildPostMetadata(slug: string): Promise<Metadata> {
  // Independent reads, fetched concurrently -- both are `cache()`-wrapped
  // (`fetchSite`/`fetchPublishedArticleBySlug`), so the duplicate read from
  // `RenderPost`'s own block below costs no extra Strapi round trip.
  const [site, article] = await Promise.all([fetchSite(), fetchPublishedArticleBySlug(slug)]);
  return buildPostMetadataFrom(article, site, process.env);
}

/**
 * The shared bundle-resolution/shell-building/`PageRenderer` tail, extracted
 * so `RenderPost` and `RenderArchive` (Plan 06 Task 2) call ONE
 * implementation rather than each carrying its own copy -- two copies of
 * this block would drift the moment either render path changes, and this
 * module is already the second consumer of it. Reproduces `RenderPage`'s
 * tail verbatim in structure (`resolveLiveBundle` -> `ConfigurationError`
 * guard -> the SSR-shell kill-switch guard around `evaluateThemeServerSide`
 * + `buildShellHtml` -> `PageRenderer`), with `recordProps` threaded into
 * BOTH `buildShellHtml` and `PageRenderer` -- one seam, both paths, so the
 * server string and the client tree can never carry different article/
 * archive values.
 */
async function renderThemedBlogPage(
  site: StrapiSite | null,
  page: ReturnType<typeof buildBlogRenderPage>,
  recordProps: SectionRecordProps
) {
  const { themeBundleUrl, themeName, themeCssUrl, themeCssDeferredUrl } = resolveLiveBundle(
    site,
    process.env
  );

  if (!themeBundleUrl || themeBundleUrl.trim() === "") {
    return <ConfigurationError themeBundleUrl={themeBundleUrl} themeName={themeName} />;
  }

  let shellHtml: string | undefined;
  if (!isSsrShellDisabled(process.env)) {
    const themeModule = await evaluateThemeServerSide(themeBundleUrl, themeName);
    if (themeModule) {
      shellHtml = buildShellHtml({ page, themeModule, themeName, recordProps }) ?? undefined;
    }
  }

  return (
    <PageRenderer
      page={page}
      themeBundleUrl={themeBundleUrl}
      themeName={themeName}
      themeCssUrl={themeCssUrl}
      themeCssDeferredUrl={themeCssDeferredUrl}
      shellHtml={shellHtml}
      recordProps={recordProps}
    />
  );
}

/**
 * Render one published post at `/blog/{slug}`. `notFound()` for both the
 * unsupported-theme degrade and a missing/unpublished/unbound post -- one
 * boundary, D-4/D-10 -- and the call happens at the SYNCHRONOUS top of this
 * component with no deferred/streaming-boundary component wrapping it above:
 * Next.js commits a 200 status for a streamed response and only returns a
 * real 404 for a non-streamed one, so wrapping this decision in one would
 * render 404 copy under a 200 status and silently poison the
 * sitemap-versus-canonical equality Phase 23 depends on.
 */
export async function RenderPost({ slug }: { slug: string }) {
  // All three reads are independent and each is `cache()`-wrapped
  // (`fetchSite`/`fetchBlogPageTemplates`/`fetchPublishedArticleBySlug`), so
  // the duplicate read from `buildPostMetadata`'s own call costs no extra
  // Strapi round trip -- the same pattern `RenderPage` documents for its own
  // concurrent block.
  const [site, pageTemplates, article] = await Promise.all([
    fetchSite(),
    fetchBlogPageTemplates(),
    fetchPublishedArticleBySlug(slug),
  ]);

  const plan = resolvePostRenderPlan({
    site,
    pageTemplates,
    article,
    report: (_surface, context) =>
      reportSeoDegrade("blog-template-not-declared", "blog-surface", context),
  });

  // `!article` is redundant with `resolvePostRenderPlan`'s own guard (a
  // "render" plan is only ever returned for a truthy, published article) but
  // narrows `article`'s type for the two reads below, and keeps this
  // boundary the SAME single `notFound()` call site D-4/D-10 already commit
  // to -- never a second, later guard.
  if (plan.kind !== "render" || !article) {
    notFound();
  }

  // Phase 23, Plan 02/06 (BLOG-09): the post's structured-data graph,
  // resolved SYNCHRONOUSLY here -- immediately after the not-found branch,
  // above the async related-post read and the async render tail below -- so
  // it stays visibly tied to the same guard that already committed a real
  // 404 for anything not a published, template-bound post.
  const jsonLd = JsonLd.buildArticleJsonLdGraph(article, site, process.env);

  // Phase 23, Plan 04/06 (BLOG-10, T-23-25): the related read depends on the
  // fetched article, so it cannot join the concurrent block above -- it is
  // issued HERE, after the not-found branch, so a draft or unknown slug
  // never triggers a related-post read at all. Every returned record is
  // mapped through `buildArticleProp` (T-23-26) -- the only builder
  // permitted to produce a theme-facing article value -- so no raw fetch
  // record ever reaches a theme.
  const relatedRecords = await fetchRelatedArticles(article);
  // Attach nothing when the list is empty (D-2 of this plan): an absent
  // `relatedPosts` member keeps the section prop bag byte-identical to
  // today's rather than introducing an empty-array regression.
  const recordProps: SectionRecordProps =
    relatedRecords.length > 0
      ? { ...plan.recordProps, relatedPosts: relatedRecords.map((record) => buildArticleProp(record)) }
      : plan.recordProps;

  const page = buildBlogRenderPage(
    plan.template,
    plan.recordProps.article?.title ?? "",
    plan.recordProps.article?.slug ?? slug
  );

  // `recordProps` -- carrying the same `relatedPosts` value, when present --
  // is passed into the ONE `renderThemedBlogPage` seam that threads it into
  // BOTH `buildShellHtml` and `PageRenderer` (T-23-27), so the server string
  // and the client tree can never carry different related-post values.
  const themedPage = await renderThemedBlogPage(site, page, recordProps);

  return (
    <>
      {/*
       * Mirrors `render-page.tsx`'s own JSON-LD emission block exactly: same
       * element type, same serialization call, same conditional so a `null`
       * graph emits nothing at all rather than an empty or partial script.
       * The one serializer call below is what makes `dangerouslySetInnerHTML`
       * here safe -- it escapes the opening-angle-bracket character so
       * tenant-authored Strapi content (a post's title, description, author
       * or image) cannot close this script element and execute in every
       * visitor's browser (T-23-24). Never interpolate a graph here with a
       * bare stringify call.
       */}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JsonLd.serializeJsonLd(jsonLd) }}
        />
      )}
      {themedPage}
    </>
  );
}

/**
 * Resolves the term filter `fetchPublishedArticles`/`fetchBlogTerm` accept
 * from the route's `{ kind, termSlug }` -- `undefined` for the index surface
 * (no term to filter by), `{ kind, slug }` for a category/tag surface.
 */
function resolveArchiveTermFilter(
  kind: BlogSurfaceKind,
  termSlug: string | null | undefined
): BlogTermFilter | undefined {
  if (kind === "index") return undefined;
  return { kind, slug: termSlug ?? "" };
}

/**
 * A stable, non-visitor-facing identifier fed into `buildBlogRenderPage`'s
 * `slug` argument for a listing surface -- distinct per kind/term so two
 * different archives never share a synthesized `documentId`. Never read by
 * `buildShellHtml`/`resolveSectionsForRender`/`PageRenderer` (see
 * `buildBlogRenderPage`'s own doc comment); this exists only so the
 * synthesized page value stays deterministic.
 */
function resolveArchiveSlug(kind: BlogSurfaceKind, termSlug: string | null | undefined): string {
  return termSlug ? `blog-${kind}-${termSlug}` : `blog-${kind}`;
}

/**
 * Render one of the three listing surfaces -- the blog index, a category
 * archive or a tag archive (D-3: one `archive` template, differing only by
 * `ArchiveProp.term`). `notFound()` for the unsupported-theme degrade, an
 * unknown term, and an out-of-range page -- one boundary, same synchronous-
 * top placement as `RenderPost`, for the same reason: a streamed response
 * commits a 200, so this decision must never sit behind a deferred/
 * streaming-boundary component.
 */
export async function RenderArchive({
  kind,
  termSlug,
  page,
}: {
  kind: BlogSurfaceKind;
  termSlug?: string | null;
  page: number;
}) {
  // All four reads are independent and each is `cache()`-wrapped
  // (`fetchSite`/`fetchBlogPageTemplates`/`fetchPublishedArticles`/
  // `fetchBlogTerm`), so the duplicate reads from `buildArchiveMetadata`'s
  // own call cost no extra Strapi round trip. The index surface has no term
  // to look up, so its slot resolves a plain `Promise.resolve(null)` rather
  // than dropping out of the `Promise.all` -- every surface fetches
  // concurrently, never sequentially.
  const [site, pageTemplates, articles, term] = await Promise.all([
    fetchSite(),
    fetchBlogPageTemplates(),
    fetchPublishedArticles({
      page,
      pageSize: BLOG_PAGE_SIZE,
      term: resolveArchiveTermFilter(kind, termSlug),
    }),
    kind === "index" ? Promise.resolve(null) : fetchBlogTerm(kind, termSlug ?? ""),
  ]);

  const plan = resolveArchiveRenderPlan({
    site,
    pageTemplates,
    kind,
    termSlug,
    term,
    posts: articles.nodes,
    pageInfo: articles.pageInfo,
    report: (_surface, context) =>
      reportSeoDegrade("blog-template-not-declared", "blog-surface", context),
  });

  if (plan.kind !== "render") {
    notFound();
  }

  const title = plan.recordProps.archive?.term.name || "Blog";
  const renderedPage = buildBlogRenderPage(plan.template, title, resolveArchiveSlug(kind, termSlug));

  return renderThemedBlogPage(site, renderedPage, plan.recordProps);
}

/**
 * Metadata for the three listing surfaces (BLOG-07). Thin fetch-and-delegate
 * shell mirroring `buildPostMetadata`'s own shape: independently re-derives
 * the render plan (never sharing state with `RenderArchive`'s own call,
 * matching `buildPostMetadata`/`RenderPost`'s existing asymmetry) but pays no
 * extra Strapi round trip since every read is `cache()`-wrapped. Passes no
 * `report` -- this boundary would otherwise double-report the same degrade
 * `RenderArchive` already reports once.
 *
 * The canonical is composed from `resolveArchiveCanonicalPath` (Task 1) --
 * the SAME function that produces the redirect destination and the rendered
 * route (Task 3) -- so the emitted canonical cannot disagree with the served
 * URL. Per this plan's recorded decision, page 1 canonicalises to the bare
 * path and page 2+ canonicalises to ITSELF, never back to page 1. `sitemap.ts`/
 * `robots.ts` are untouched here -- adding these URLs to the sitemap is
 * Phase 23's.
 */
export async function buildArchiveMetadata({
  kind,
  termSlug,
  page,
}: {
  kind: BlogSurfaceKind;
  termSlug?: string | null;
  page: number;
}): Promise<Metadata> {
  const [site, pageTemplates, articles, term] = await Promise.all([
    fetchSite(),
    fetchBlogPageTemplates(),
    fetchPublishedArticles({
      page,
      pageSize: BLOG_PAGE_SIZE,
      term: resolveArchiveTermFilter(kind, termSlug),
    }),
    kind === "index" ? Promise.resolve(null) : fetchBlogTerm(kind, termSlug ?? ""),
  ]);

  const plan = resolveArchiveRenderPlan({
    site,
    pageTemplates,
    kind,
    termSlug,
    term,
    posts: articles.nodes,
    pageInfo: articles.pageInfo,
  });

  if (plan.kind !== "render") {
    return { title: NOT_FOUND_TITLE };
  }

  const siteDefaults = resolveSiteDefaults(site);
  const termName = plan.recordProps.archive?.term.name?.trim();
  const baseTitle = termName || siteDefaults.title || siteDefaults.siteName || "Blog";
  // Page 2+ carries the page number so two paginated pages are
  // distinguishable in a search result -- page 1 (the canonical page) does
  // not, matching the bare-path canonical it emits below.
  const title = page > 1 ? `${baseTitle} - Page ${page}` : baseTitle;

  const origin = resolveSiteOrigin(site, process.env);
  const templated = applyTitleTemplate(resolveSiteTitleTemplate(site), title);

  const metadata: Record<string, unknown> = {
    title: templated !== title ? { absolute: templated } : title,
  };

  if (origin !== null) {
    const canonical = absoluteUrl(origin, resolveArchiveCanonicalPath(kind, termSlug, page));
    metadata.metadataBase = new URL(origin);
    metadata.alternates = { canonical };
  }

  return metadata as Metadata;
}
