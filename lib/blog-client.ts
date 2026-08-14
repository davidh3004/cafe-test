import { cache } from "react";
import { gql } from "graphql-request";
import { strapiClient, graphqlEndpoint } from "./strapi-client";
import type { StrapiSection, StrapiSeo } from "./strapi-client";
import type { ArticleSourceRecord } from "./article-contract";
import { BLOG_PAGE_SIZE } from "./blog-pagination";
import { rankRelatedPosts } from "./blog-related";

/**
 * The theme-site's blog READ data layer (Phase 22, Plan 01 Task 2 --
 * BLOG-07/BLOG-08). No second GraphQL client and no env var of its own:
 * every fetcher below reuses the SAME `strapiClient` instance
 * `strapi-client.ts` exports and constructs, so there is exactly one token
 * resolution in this app.
 *
 * D-6 (22-CONTEXT.md): published-only reachability is enforced STRUCTURALLY,
 * not incidentally -- no query in this file declares a publication-status
 * variable or argument. The tenant's public read-only `NEXT_PUBLIC_STRAPI_TOKEN`
 * already returns published documents only; `fetchPublishedArticleBySlug`
 * additionally re-checks `publishedAt` in JS as defence in depth, mirroring
 * `RenderPage`'s existing `!page.publishedAt` check.
 */

/**
 * Shared article field selection -- ONE definition, interpolated into every
 * article query in this file, matching `PAGE_SCALAR_AND_SEO_FIELDS`'s role
 * in `strapi-client.ts`. `featuredImage`/`author.avatar` select `url` (and
 * dimensions) only -- no `id`, no `documentId` -- because neither identifier
 * is consumed downstream (`ArticleSourceRecord`'s media shapes carry none)
 * and Strapi 5's `UploadFile` does not expose `id` at all: one bad field
 * name fails the WHOLE document (2026-08-04 incident, see
 * `graphql/queries/articles.ts`'s header).
 *
 * Phase 23 (Plan 01, Task 1, BLOG-09): widened with `canonicalUrl` (the
 * top-level override scalar `resolvePostCanonical` -- Plan 01 Task 2 --
 * composes against) and `seo { title description noindex shareImage {...} }`
 * -- the SAME `shared.seo` component shape `Page` already carries, copied
 * verbatim from `strapi-client.ts`'s `SEO_FIELDS`'s `shareImage` media
 * sub-selection (`url`, `width`, `height` -- no `id`, for the identical
 * Strapi-5-`UploadFile` reason stated above).
 */
const BLOG_ARTICLE_FIELDS = `
  documentId
  title
  slug
  body
  excerpt
  publishedAt
  updatedAt
  canonicalUrl
  featuredImage {
    url
    width
    height
  }
  seo {
    title
    description
    noindex
    shareImage {
      url
      width
      height
    }
  }
  category {
    name
    slug
    description
  }
  tags {
    name
    slug
    description
  }
  author {
    name
    avatar {
      url
    }
  }
`;

/**
 * GetBlogPageTemplates -- the theme-site's own read of `pageTemplates`,
 * mirroring `graphql/queries/pages.ts`'s `getPageTemplatesQuery` minus the
 * admin-only `name`/`description`/`isDefault`/`previewImage` members this
 * app never needs. No inline relation filter on `theme` -- `resolveTemplateByKey`
 * (Phase 21, `./article-contract`) is the JS-authoritative narrower and this
 * codebase never trusts an inline relation filter as authoritative (A2).
 */
export const getBlogPageTemplatesQuery = gql`
  query GetBlogPageTemplates {
    pageTemplates {
      documentId
      key
      theme {
        documentId
      }
      sections {
        id
        sectionKey
        order
        data
        blocks {
          id
          blockType
          order
          data
        }
      }
    }
  }
`;

/**
 * GetBlogArticleBySlug -- `slug` is a declared `String!` GraphQL variable,
 * never interpolated into the query document (T-22-02). Declares no
 * publication-status variable and passes no such argument (D-6/T-22-01):
 * the tenant's public read-only token already returns published documents
 * only, and accepting a caller-influenced publication argument is the exact
 * information-disclosure surface D-6 closes by filtering in the query
 * rather than in JS afterwards.
 */
export const getArticleBySlugQuery = gql`
  query GetBlogArticleBySlug($slug: String!) {
    articles(filters: { slug: { eq: $slug } }) {
      ${BLOG_ARTICLE_FIELDS}
    }
  }
`;

/**
 * Newest-first, deterministic article sort (D-21 precedent from
 * `graphql/queries/articles.ts`): `publishedAt` descending, then
 * `createdAt` descending, so two posts published in the same instant still
 * come back in the same order on every load, instead of whatever order the
 * database happens to return.
 */
const DEFAULT_ARTICLE_SORT = ["publishedAt:desc", "createdAt:desc"];

/**
 * GetPublishedArticles -- the theme-site's own `articles_connection` read
 * (BLOG-07, Plan 03 Task 2), and the A2 FALLBACK sibling for a term-scoped
 * listing: it carries no inline relation filter, so it is safe to re-send
 * unfiltered and narrow the result in JS when the term-filtered sibling
 * below throws. `project-theta-strapi/config/plugins.ts` sets a tenant-wide
 * GraphQL `defaultLimit` of 100 -- an `articles_connection` selection that
 * omits an explicit `pagination` argument truncates at 100 rows silently,
 * with no error (the same failure class this repo's redirect
 * pagination-cap test already exists to catch) -- so
 * `pagination: { page: $page, pageSize: $pageSize }` is never optional
 * here. Declares no publication-status variable or argument (D-6/T-22-01):
 * the tenant's public read-only token already returns published documents
 * only, and `fetchPublishedArticles` re-checks `publishedAt` in JS as
 * defence in depth on every path, including the fallback -- exactly where a
 * draft would otherwise slip through, since the unfiltered query here is
 * deliberately broader than its term-filtered sibling (T-22-01).
 */
export const getPublishedArticlesQuery = gql`
  query GetPublishedArticles($page: Int!, $pageSize: Int!, $sort: [String]) {
    articles_connection(
      pagination: { page: $page, pageSize: $pageSize }
      sort: $sort
    ) {
      nodes {
        ${BLOG_ARTICLE_FIELDS}
      }
      pageInfo {
        page
        pageSize
        pageCount
        total
      }
    }
  }
`;

/**
 * GetPublishedArticlesByTerm -- the relation-filtered sibling of
 * `getPublishedArticlesQuery` above. `$filters` is built in JS by
 * `fetchPublishedArticles` from the caller's `{ kind, slug }` term (never
 * interpolated into this query document -- T-22-02) so ONE query document
 * serves both the category and the tag case. This is exactly the shape this
 * codebase has been burned by twice before trusting as authoritative on its
 * own (A2): if Strapi does not honour the inline relation filter, or the
 * filter throws outright, `fetchPublishedArticles` falls back to
 * `getPublishedArticlesQuery` above and narrows in JS -- correctness never
 * depends on this filter being honoured.
 */
export const getPublishedArticlesByTermQuery = gql`
  query GetPublishedArticlesByTerm(
    $page: Int!
    $pageSize: Int!
    $sort: [String]
    $filters: ArticleFiltersInput
  ) {
    articles_connection(
      pagination: { page: $page, pageSize: $pageSize }
      sort: $sort
      filters: $filters
    ) {
      nodes {
        ${BLOG_ARTICLE_FIELDS}
      }
      pageInfo {
        page
        pageSize
        pageCount
        total
      }
    }
  }
`;

/**
 * GetBlogTerm -- a category/tag name+description lookup by slug. Both root
 * fields (`categories` and `tags`) are selected in the SAME document so
 * `fetchBlogTerm` never needs a second query const or a second round-trip
 * to distinguish "category" from "tag"; the caller-supplied `kind` picks
 * which array to read in JS. `slug` is a declared `String!` variable, never
 * interpolated into the document (T-22-02).
 */
export const getBlogTermQuery = gql`
  query GetBlogTerm($slug: String!) {
    categories(filters: { slug: { eq: $slug } }) {
      name
      slug
      description
    }
    tags(filters: { slug: { eq: $slug } }) {
      name
      slug
      description
    }
  }
`;

/**
 * GetPublishedArticleSlugs -- Phase 22 Plan 02 (D-6): `generateStaticParams`
 * for `/blog/{slug}` must enumerate PUBLISHED posts only. Declares no
 * publication-status variable, same structural posture as
 * `getArticleBySlugQuery` above: the tenant's public read-only token already
 * returns published documents only, and `fetchPublishedArticleSlugs` re-checks
 * `publishedAt` in JS as defence in depth (D-6/T-22-01).
 *
 * `$limit` (Plan 03 Task 2): an explicit `pagination: { limit: $limit }`
 * argument, for the same reason `getPublishedArticlesQuery` above declares
 * one -- an omitted pagination argument silently truncates at the tenant's
 * GraphQL `defaultLimit` of 100 with no error, which would silently cap
 * static-param generation on any tenant with more than 100 published posts.
 */
export const getPublishedArticleSlugsQuery = gql`
  query GetPublishedArticleSlugs($limit: Int) {
    articles(pagination: { limit: $limit }) {
      slug
      publishedAt
    }
  }
`;

/**
 * The sitemap enumeration cap (Phase 23, Plan 01, Task 1, D-6/BLOG-09).
 * `SITEMAP_ARTICLE_PAGE_SIZE` is the tenant Strapi's GraphQL `maxLimit`
 * (`project-theta-strapi/config/plugins.ts`) -- the largest row count a
 * single `pagination: { pageSize }` argument can ever actually return, no
 * matter what value the caller passes, because the server clamps anything
 * larger. `SITEMAP_ARTICLE_MAX_PAGES` bounds the total number of GraphQL
 * requests one sitemap build ever issues, so enumeration cost stays
 * constant-bounded regardless of tenant post count (T-23-05).
 */
export const SITEMAP_ARTICLE_PAGE_SIZE = 200;
export const SITEMAP_ARTICLE_MAX_PAGES = 25;

/**
 * GetSitemapArticles -- the dedicated sitemap enumeration read (Phase 23,
 * Plan 01, Task 1, D-6/BLOG-09; widened Plan 05, Task 1, D-6/D-8/BLOG-09).
 * Selects only what a sitemap entry and its eligibility check need:
 * `slug`/`canonicalUrl` (to compose the URL via `resolvePostCanonical`),
 * `publishedAt` (the D-6 defence-in-depth gate), `updatedAt`
 * (`lastModified`), `seo { noindex }` (the SAME field `isPostSitemapEligible`
 * reads, never a second flag), and now `category { slug }` / `tags { slug }`
 * -- the slug member ONLY, none of the human-readable `name`/`description`
 * members `BLOG_ARTICLE_FIELDS`'s own `category`/`tags` selections carry,
 * because a sitemap archive entry needs a term to NAME a URL and nothing
 * else. Declares no publication-status variable or argument -- the same
 * structural posture every other query in this file follows (D-6/T-22-01):
 * the tenant's public read-only token already returns published documents
 * only, and `fetchSitemapArticles` re-checks `publishedAt` in JS as defence
 * in depth.
 *
 * Plan 05, D-6/D-8: the archive term set (`buildBlogArchiveSitemapEntries`,
 * `discovery-resolve.ts`) is DERIVED from this SAME post enumeration rather
 * than read via a second, independently-capped `categories`/`tags` query.
 * A dedicated taxonomy read would need its own pagination guard and its own
 * published-post reachability check, and would be free to disagree with the
 * post enumeration's own published-only gate and cap under load -- exactly
 * the two-gates-that-can-drift problem D-6 exists to prevent. Deriving terms
 * from the posts this query already returns means one published-only gate,
 * one cap, one truncation signal: a term's presence in the sitemap and its
 * posts' presence in the sitemap can never disagree by construction.
 *
 * An `articles_connection` page loop replaces the single `pagination: {
 * limit }` form `fetchPublishedArticleSlugs` uses above, because the
 * tenant's `maxLimit` of 200 clamps ANY larger `limit` server-side -- a
 * single-request read can never enumerate more than 200 posts no matter what
 * number the caller passes, which is the exact silent-truncation class D-6
 * exists to close, one layer deeper than the `defaultLimit` bug Phase 22
 * found (that bug was an OMITTED pagination argument; this is the ceiling on
 * an argument that IS present). `fetchPublishedArticleSlugs`'s own default
 * limit of 1000 is subject to that identical clamp and is NOT fixed here --
 * its one caller is `generateStaticParams`, where the consequence of the
 * clamp is on-demand rendering for the posts past row 200 rather than a
 * missing sitemap URL, and widening it is outside this plan's BLOG-09 scope.
 */
export const getSitemapArticlesQuery = gql`
  query GetSitemapArticles($page: Int!, $pageSize: Int!, $sort: [String]) {
    articles_connection(
      pagination: { page: $page, pageSize: $pageSize }
      sort: $sort
    ) {
      nodes {
        slug
        publishedAt
        updatedAt
        canonicalUrl
        seo {
          noindex
        }
        category {
          slug
        }
        tags {
          slug
        }
      }
      pageInfo {
        page
        pageSize
        pageCount
        total
      }
    }
  }
`;

/** The read shape `GetSitemapArticles` returns per node. `category`/`tags`
 * (Plan 05, Task 1) carry the slug member only -- the term set
 * `buildBlogArchiveSitemapEntries` derives is a set of slugs, never a
 * human-readable name or description. */
export interface SitemapArticleRecord {
  slug: string;
  publishedAt?: string | null;
  updatedAt?: string | null;
  canonicalUrl?: string | null;
  seo?: { noindex?: boolean | null } | null;
  category?: { slug: string } | null;
  tags?: Array<{ slug: string }> | null;
}

/** `fetchSitemapArticles`'s resolved shape: the enumerated, published-only
 * article rows, whether the cap was hit, and the tenant's real total. */
export interface FetchSitemapArticlesResult {
  articles: SitemapArticleRecord[];
  truncated: boolean;
  total: number;
}

interface GetSitemapArticlesConnectionResponse {
  articles_connection: {
    nodes: SitemapArticleRecord[];
    pageInfo: BlogPageInfo;
  };
}

/** A theme-scoped page template bound to the live theme (D-2, D-3). */
export interface BlogPageTemplate {
  documentId: string;
  key: string;
  theme: { documentId: string };
  sections: StrapiSection[];
}

/**
 * The read shape `GetBlogArticleBySlug` returns. Structurally assignable to
 * `ArticleSourceRecord` (`./article-contract`) -- asserted below with a
 * type-only satisfaction check so a future field rename breaks
 * `yarn typecheck` rather than production.
 *
 * Phase 23 (Plan 01, Task 1): widened with `canonicalUrl` and `seo` --
 * additive-only, so the satisfaction check below (which only requires
 * assignability TO the narrower `ArticleSourceRecord`) still holds. `seo`
 * reuses `StrapiSeo` (`./strapi-client`) rather than a second local shape --
 * the same object `resolveShareImage` already consumes for pages now flows
 * through a post identically.
 */
export interface BlogArticleRecord {
  documentId: string;
  title: string;
  slug: string;
  body?: string | null;
  excerpt?: string | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
  canonicalUrl?: string | null;
  featuredImage?: { url: string; width?: number | null; height?: number | null } | null;
  seo?: StrapiSeo | null;
  category?: { name: string; slug: string; description?: string | null } | null;
  tags?: Array<{ name: string; slug: string; description?: string | null }> | null;
  author?: { name: string; avatar?: { url: string } | null } | null;
}

// Type-only satisfaction check (compile-time only, no runtime cost): a
// future rename/removal on `BlogArticleRecord` that breaks `ArticleSourceRecord`
// assignability fails `yarn typecheck` here rather than surfacing as a
// production `buildArticleProp` crash.
type _AssertBlogArticleRecordSatisfiesArticleSourceRecord =
  BlogArticleRecord extends ArticleSourceRecord ? true : never;
const _blogArticleRecordSatisfiesArticleSourceRecord: _AssertBlogArticleRecordSatisfiesArticleSourceRecord = true;
void _blogArticleRecordSatisfiesArticleSourceRecord;

interface GetBlogPageTemplatesResponse {
  pageTemplates: BlogPageTemplate[];
}

interface GetBlogArticleBySlugResponse {
  articles: BlogArticleRecord[];
}

interface GetPublishedArticleSlugsResponse {
  articles: Array<{ slug: string; publishedAt?: string | null }>;
}

/** The Relay-style `pageInfo` a listing read resolves alongside its `nodes`. */
export interface BlogPageInfo {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
}

interface GetPublishedArticlesConnectionResponse {
  articles_connection: {
    nodes: BlogArticleRecord[];
    pageInfo: BlogPageInfo;
  };
}

/** A category or tag term to scope a listing read to (D-3). */
export interface BlogTermFilter {
  kind: "category" | "tag";
  slug: string;
}

interface BlogTermRecord {
  name: string;
  slug: string;
  description?: string | null;
}

interface GetBlogTermResponse {
  categories: BlogTermRecord[];
  tags: BlogTermRecord[];
}

export interface FetchPublishedArticlesParams {
  page?: number;
  pageSize?: number;
  term?: BlogTermFilter;
}

export interface FetchPublishedArticlesResult {
  nodes: BlogArticleRecord[];
  pageInfo: BlogPageInfo;
}

/**
 * Read every `pageTemplate` bound to any theme with the tenant's public
 * read-only token. `resolveTemplateByKey` (Phase 21) narrows the result to
 * the live theme's `article`/`archive` template. Fails open to `[]` on a
 * thrown request -- never propagates -- matching every other fetcher in
 * `strapi-client.ts`.
 *
 * Wrapped in React `cache()` for the same reason `fetchSite`/`fetchPageBySlug`
 * are: `generateMetadata` and the page component both need this per request.
 */
export const fetchBlogPageTemplates = cache(async (): Promise<BlogPageTemplate[]> => {
  if (!graphqlEndpoint) {
    console.warn("Strapi GraphQL endpoint not configured. Returning empty page-template array.");
    return [];
  }

  try {
    const response = await strapiClient.request<GetBlogPageTemplatesResponse>(
      getBlogPageTemplatesQuery
    );
    return response.pageTemplates ?? [];
  } catch (error) {
    console.warn(
      "Failed to fetch page-template content type from Strapi:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
});

/**
 * Read one published post by slug. Returns `null` for a draft (a row whose
 * `publishedAt` is not a non-empty string) or an unknown slug (empty result
 * array) -- an unpublished or unknown slug can never be serialized into a
 * page payload (D-6). Fails open to `null` on a thrown request.
 *
 * Wrapped in React `cache()` for the same per-request-memoization reason as
 * every other fetcher in this app.
 */
export const fetchPublishedArticleBySlug = cache(
  async (slug: string): Promise<BlogArticleRecord | null> => {
    if (!graphqlEndpoint) {
      console.warn("Strapi GraphQL endpoint not configured. Cannot fetch article.");
      return null;
    }

    try {
      const response = await strapiClient.request<GetBlogArticleBySlugResponse>(
        getArticleBySlugQuery,
        { slug }
      );
      const article = response.articles?.[0] ?? null;
      if (!article) return null;
      // D-6 defence-in-depth gate, applied in JS after the fetch (mirrors
      // RenderPage's `!page.publishedAt` check): a row whose `publishedAt`
      // is not a non-empty string is never returned, even if the Strapi-side
      // filter's default behaviour ever changed.
      if (typeof article.publishedAt !== "string" || article.publishedAt.trim() === "") {
        return null;
      }
      return article;
    } catch (error) {
      console.error(`Failed to fetch article with slug "${slug}" from Strapi:`, error);
      return null;
    }
  }
);

// D-6 defence-in-depth gate, shared by every listing read below: a row whose
// `publishedAt` is not a non-empty string is never returned, mirroring
// `fetchPublishedArticleBySlug`'s single-post check above.
function isPublishedArticle(article: BlogArticleRecord): boolean {
  return typeof article.publishedAt === "string" && article.publishedAt.trim() !== "";
}

// Builds the `$filters` variable `getPublishedArticlesByTermQuery` receives
// -- never interpolated into the query document (T-22-02).
function buildTermFilters(term: BlogTermFilter): Record<string, unknown> {
  if (term.kind === "category") {
    return { category: { slug: { eq: term.slug } } };
  }
  return { tags: { slug: { eq: term.slug } } };
}

// The JS-authoritative term match applied on the A2 fallback path, where
// correctness cannot depend on the inline relation filter.
function articleMatchesTerm(article: BlogArticleRecord, term: BlogTermFilter): boolean {
  if (term.kind === "category") {
    return article.category?.slug === term.slug;
  }
  return (article.tags ?? []).some((tag) => tag.slug === term.slug);
}

function zeroPageInfo(page: number, pageSize: number): BlogPageInfo {
  return { page, pageSize, pageCount: 0, total: 0 };
}

/**
 * The term-aware published-post listing read (BLOG-07, D-3, D-6, A2).
 *
 * With no `term`, sends `getPublishedArticlesQuery` once. With a `term`,
 * sends the relation-filtered `getPublishedArticlesByTermQuery` FIRST; on
 * ANY thrown error, re-fetches `getPublishedArticlesQuery` unfiltered and
 * narrows the result in JS -- the JS narrowing is the authoritative one,
 * because this exact inline relation-filter shape has never been exercised
 * against a live tenant in this codebase. On that fallback path,
 * `pageInfo.total`/`pageInfo.pageCount` are RECOMPUTED from the JS-narrowed
 * set, never passed through from the unfiltered query's own counts, or a
 * category archive would advertise the whole blog's page count (T-22-13).
 *
 * The D-6 `publishedAt` gate is applied on every path, including the
 * fallback, before any node leaves this function -- the fallback is exactly
 * where a draft would otherwise slip through, since the unfiltered query is
 * deliberately broader than its term-filtered sibling (T-22-01).
 *
 * Never throws: a thrown request on both the filtered and the fallback path
 * resolves to an empty node list with a zero-count `pageInfo`, matching
 * every other fetcher's fail-open posture in this file.
 *
 * Wrapped in React `cache()` for the same per-request-memoization reason as
 * every other fetcher in this file.
 */
export const fetchPublishedArticles = cache(
  async (
    params: FetchPublishedArticlesParams = {}
  ): Promise<FetchPublishedArticlesResult> => {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? BLOG_PAGE_SIZE;
    const term = params.term;

    if (!graphqlEndpoint) {
      console.warn("Strapi GraphQL endpoint not configured. Returning empty article listing.");
      return { nodes: [], pageInfo: zeroPageInfo(page, pageSize) };
    }

    if (!term) {
      try {
        const response = await strapiClient.request<GetPublishedArticlesConnectionResponse>(
          getPublishedArticlesQuery,
          { page, pageSize, sort: DEFAULT_ARTICLE_SORT }
        );
        const nodes = (response.articles_connection?.nodes ?? []).filter(isPublishedArticle);
        const pageInfo = response.articles_connection?.pageInfo ?? zeroPageInfo(page, pageSize);
        return { nodes, pageInfo };
      } catch (error) {
        console.error("Failed to fetch published articles from Strapi:", error);
        return { nodes: [], pageInfo: zeroPageInfo(page, pageSize) };
      }
    }

    try {
      const response = await strapiClient.request<GetPublishedArticlesConnectionResponse>(
        getPublishedArticlesByTermQuery,
        { page, pageSize, sort: DEFAULT_ARTICLE_SORT, filters: buildTermFilters(term) }
      );
      const nodes = (response.articles_connection?.nodes ?? []).filter(isPublishedArticle);
      const pageInfo = response.articles_connection?.pageInfo ?? zeroPageInfo(page, pageSize);
      return { nodes, pageInfo };
    } catch (termError) {
      // A2 fallback: the inline relation-filter shape may not be honored by
      // this Strapi version, or may throw outright. Re-fetch unfiltered and
      // let JS pick the term-matching nodes -- falling back to unfiltered
      // query narrowing, correctness independent of the GraphQL filter.
      console.warn(
        "Term-filtered article query failed; falling back to unfiltered query.",
        termError instanceof Error ? termError.message : String(termError)
      );
      try {
        const response = await strapiClient.request<GetPublishedArticlesConnectionResponse>(
          getPublishedArticlesQuery,
          { page, pageSize, sort: DEFAULT_ARTICLE_SORT }
        );
        const allNodes = (response.articles_connection?.nodes ?? []).filter(isPublishedArticle);
        const matched = allNodes.filter((article) => articleMatchesTerm(article, term));
        const pageCount = matched.length === 0 ? 0 : Math.ceil(matched.length / pageSize);
        return {
          nodes: matched,
          pageInfo: { page, pageSize, pageCount, total: matched.length },
        };
      } catch (fallbackError) {
        console.error(
          "Unfiltered article fallback query also failed:",
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        );
        return { nodes: [], pageInfo: zeroPageInfo(page, pageSize) };
      }
    }
  }
);

/**
 * Read one category or tag's `name`/`description` by slug. Returns `null`
 * for an unknown slug (empty result on the relevant array). Fails open to
 * `null` on a thrown request, matching every other fetcher in this file.
 *
 * Wrapped in React `cache()` for the same per-request-memoization reason as
 * every other fetcher in this file.
 */
export const fetchBlogTerm = cache(
  async (
    kind: "category" | "tag",
    slug: string
  ): Promise<{ name: string; description?: string | null } | null> => {
    if (!graphqlEndpoint) {
      console.warn("Strapi GraphQL endpoint not configured. Cannot fetch blog term.");
      return null;
    }

    try {
      const response = await strapiClient.request<GetBlogTermResponse>(getBlogTermQuery, {
        slug,
      });
      const list = kind === "category" ? response.categories : response.tags;
      const term = list?.[0] ?? null;
      if (!term) return null;
      return { name: term.name, description: term.description ?? null };
    } catch (error) {
      console.warn(
        `Failed to fetch blog ${kind} "${slug}" from Strapi:`,
        error instanceof Error ? error.message : String(error)
      );
      return null;
    }
  }
);

/**
 * Read the slugs of every PUBLISHED post -- `generateStaticParams` for
 * `/blog/{slug}` (D-6) is the one caller. Filters on `publishedAt` in JS
 * after the fetch, the same defence-in-depth posture
 * `fetchPublishedArticleBySlug` applies above. Fails open to `[]` on a
 * thrown request so a Strapi outage never fails the tenant build, matching
 * `fetchPages`'s existing try/catch-returning-empty-array shape.
 *
 * `limit` (Plan 03 Task 2, default 1000) is threaded through as an explicit
 * `pagination: { limit: $limit }` argument -- the same explicit-pagination
 * rule `getPublishedArticlesQuery` follows, so this read can never silently
 * truncate at the tenant's GraphQL `defaultLimit` of 100.
 *
 * Wrapped in React `cache()` for the same per-request-memoization reason as
 * every other fetcher in this file.
 */
export const fetchPublishedArticleSlugs = cache(async (limit = 1000): Promise<string[]> => {
  if (!graphqlEndpoint) {
    console.warn("Strapi GraphQL endpoint not configured. Returning empty article-slug array.");
    return [];
  }

  try {
    const response = await strapiClient.request<GetPublishedArticleSlugsResponse>(
      getPublishedArticleSlugsQuery,
      { limit }
    );
    return (response.articles ?? [])
      .filter(
        (article) =>
          typeof article.publishedAt === "string" && article.publishedAt.trim() !== ""
      )
      .map((article) => article.slug)
      // A published row is NOT guaranteed to carry a slug -- Strapi's `slug` is
      // nullable and the generated response type says `string`, so nothing above
      // catches it. Without this guard a single slugless post yields
      // `[{ slug: null }]` from `generateStaticParams`, and Next fails the WHOLE
      // tenant build with "A required parameter (slug) was not provided as a
      // string received object" (`typeof null === "object"`). One incomplete
      // draft must never be able to break a tenant's deploy, so a slugless row
      // is dropped here rather than propagated: it has no reachable URL anyway
      // (`postHref` returns null for a blank slug, and the sitemap skips it),
      // so dropping it loses nothing that was ever addressable.
      .filter(
        (slug): slug is string => typeof slug === "string" && slug.trim() !== ""
      );
  } catch (error) {
    console.warn(
      "Failed to fetch published article slugs from Strapi:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
});

/**
 * Read every PUBLISHED post for the sitemap enumeration (Phase 23, Plan 01,
 * Task 1, D-6/BLOG-09) -- `app/sitemap.ts` is the one caller. Requests page 1
 * with `DEFAULT_ARTICLE_SORT` at `SITEMAP_ARTICLE_PAGE_SIZE`, reads
 * `pageInfo.pageCount`, then requests pages 2 through
 * `Math.min(pageCount, SITEMAP_ARTICLE_MAX_PAGES)` CONCURRENTLY and
 * concatenates the results in page order -- never sequentially, so the
 * enumeration's wall-clock cost does not scale with page count. `truncated`
 * is `true` exactly when `pageCount` exceeds `SITEMAP_ARTICLE_MAX_PAGES` --
 * the explicit, reported degrade D-6 requires instead of a silently partial
 * sitemap.
 *
 * The D-6 `publishedAt` gate is re-applied in JS on every returned node, the
 * same defence-in-depth posture every other listing read in this file
 * follows. Fails open to `{ articles: [], truncated: false, total: 0 }` on a
 * thrown request and on an unconfigured endpoint, matching every other
 * fetcher's posture in this file -- an enumeration failure degrades to an
 * empty (but syntactically valid) sitemap rather than failing the tenant
 * build.
 *
 * Wrapped in React `cache()` for the same per-request-memoization reason as
 * every other fetcher in this file.
 */
export const fetchSitemapArticles = cache(async (): Promise<FetchSitemapArticlesResult> => {
  if (!graphqlEndpoint) {
    console.warn("Strapi GraphQL endpoint not configured. Returning empty sitemap article list.");
    return { articles: [], truncated: false, total: 0 };
  }

  try {
    const first = await strapiClient.request<GetSitemapArticlesConnectionResponse>(
      getSitemapArticlesQuery,
      { page: 1, pageSize: SITEMAP_ARTICLE_PAGE_SIZE, sort: DEFAULT_ARTICLE_SORT }
    );
    const firstPageInfo = first.articles_connection?.pageInfo ?? {
      page: 1,
      pageSize: SITEMAP_ARTICLE_PAGE_SIZE,
      pageCount: 0,
      total: 0,
    };
    const pageCount = firstPageInfo.pageCount ?? 0;
    const lastPage = Math.min(pageCount, SITEMAP_ARTICLE_MAX_PAGES);

    let allNodes = [...(first.articles_connection?.nodes ?? [])];

    if (lastPage > 1) {
      const remainingPages = Array.from({ length: lastPage - 1 }, (_, index) => index + 2);
      const responses = await Promise.all(
        remainingPages.map((page) =>
          strapiClient.request<GetSitemapArticlesConnectionResponse>(getSitemapArticlesQuery, {
            page,
            pageSize: SITEMAP_ARTICLE_PAGE_SIZE,
            sort: DEFAULT_ARTICLE_SORT,
          })
        )
      );
      // `Promise.all` preserves array order regardless of resolution order,
      // so concatenating in `responses`' order is concatenating in page order.
      for (const response of responses) {
        allNodes = allNodes.concat(response.articles_connection?.nodes ?? []);
      }
    }

    const articles = allNodes.filter(
      (article) => typeof article.publishedAt === "string" && article.publishedAt.trim() !== ""
    );

    return {
      articles,
      truncated: pageCount > SITEMAP_ARTICLE_MAX_PAGES,
      total: firstPageInfo.total ?? articles.length,
    };
  } catch (error) {
    console.error("Failed to fetch sitemap articles from Strapi:", error);
    return { articles: [], truncated: false, total: 0 };
  }
});

/**
 * The per-term candidate page size and tag fan-out cap for
 * `fetchRelatedArticles` below (Phase 23, Plan 04, Task 2, BLOG-10). Both
 * are explicit `pagination`/fan-out bounds, the same D-6 discipline every
 * other listing read in this file follows: the tenant Strapi's GraphQL
 * `maxLimit` (`project-theta-strapi/config/plugins.ts`) clamps any larger
 * `pageSize` server-side regardless of what this caller passes, so a small,
 * explicit page size per term read is not a missed optimization -- it is
 * the value the server would clamp to anyway, kept explicit so the request
 * count and per-request cost both stay constant-bounded (T-23-18) rather
 * than scaling with a source post's tag count.
 */
export const RELATED_CANDIDATE_PAGE_SIZE = 12;
export const RELATED_TAG_QUERY_CAP = 3;

/**
 * Read a post's related-post candidates and rank them (Phase 23, Plan 04,
 * Task 2, BLOG-10/D-5). Writes no new GraphQL query document and no new
 * relation-filter fallback: candidates are read by calling the
 * already-proven `fetchPublishedArticles` once per term `article` carries --
 * its category (when present) plus up to `RELATED_TAG_QUERY_CAP` of its
 * tags -- each at page one and the explicit `RELATED_CANDIDATE_PAGE_SIZE`,
 * issued CONCURRENTLY via `Promise.all`. Reusing that function rather than
 * re-implementing any part of it is what makes this correct by
 * construction: it already gates published-only at the query layer and
 * re-checks in JS on every path (including its A2 fallback), and it already
 * carries the explicit pagination argument D-6 requires. Re-implementing
 * any of those three here would be a second, slightly-different copy of a
 * rule this codebase has been burned by twice (T-23-16).
 *
 * The concatenated candidate pool is handed to `rankRelatedPosts`
 * (`blog-related.ts`) alongside `article`, which applies the D-5 selection
 * rules and its own defence-in-depth `publishedAt` gate -- a third
 * application of the same published-only rule, on top of the two
 * `fetchPublishedArticles` already applies.
 *
 * Returns `[]` immediately, issuing no request at all, when `article`
 * carries neither a category nor any tags, and when the GraphQL endpoint is
 * unconfigured. Never throws: every underlying `fetchPublishedArticles` call
 * already fails open to an empty node list.
 *
 * Wrapped in React `cache()` for the same per-request-memoization reason as
 * every other fetcher in this file.
 */
export const fetchRelatedArticles = cache(
  async (article: BlogArticleRecord): Promise<BlogArticleRecord[]> => {
    const categorySlug = article.category?.slug;
    const tagSlugs = (article.tags ?? [])
      .map((tag) => tag.slug)
      .slice(0, RELATED_TAG_QUERY_CAP);

    if (categorySlug == null && tagSlugs.length === 0) {
      return [];
    }

    if (!graphqlEndpoint) {
      console.warn(
        "Strapi GraphQL endpoint not configured. Returning empty related-article list."
      );
      return [];
    }

    const terms: BlogTermFilter[] = [];
    if (categorySlug != null) {
      terms.push({ kind: "category", slug: categorySlug });
    }
    for (const tagSlug of tagSlugs) {
      terms.push({ kind: "tag", slug: tagSlug });
    }

    const results = await Promise.all(
      terms.map((term) =>
        fetchPublishedArticles({ page: 1, pageSize: RELATED_CANDIDATE_PAGE_SIZE, term })
      )
    );

    const candidates = results.flatMap((result) => result.nodes);
    return rankRelatedPosts(article, candidates);
  }
);
