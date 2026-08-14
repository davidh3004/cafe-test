/**
 * Pure sitemap/robots resolvers for the DEPLOYED per-tenant theme-site (Phase 14,
 * Plan 04).
 *
 * Mirrors `lib/live-resolve.ts` and `lib/seo-resolve.ts`: every export here is
 * PURE (no network, no read of the global runtime environment, no side
 * effects, never throws) so each can be unit-pinned against synthetic Strapi
 * objects. `app/sitemap.ts` and `app/robots.ts` are thin fetch-and-delegate
 * shells over these two builders.
 *
 *   - isSitemapEligible(page) → the D-17 two-signal filter: `publishedAt`
 *     must be truthy (DISC-02 — the raw page fetch returns unpublished pages
 *     today and nothing filtered them before this plan) and `page.seo.noindex`
 *     must not be strictly `true` (META-05 — the SAME field that emits the
 *     robots noindex tag in `buildPageMetadataFrom`, never a second field).
 *     No other indexability input exists.
 *   - buildSitemapEntries(pages, origin) → filters through `isSitemapEligible`,
 *     maps every survivor through the shared canonical-path resolver (Plan
 *     02) and then `absoluteUrl`, and dedupes by resolved URL. This is what
 *     makes a sitemap URL byte-identical to that page's own canonical BY
 *     CONSTRUCTION rather than by review (D-15) — the homepage is listed at
 *     the site root only, and its slug path is never also present, because
 *     both this function and `buildPageMetadataFrom` resolve the same path
 *     through that one shared call. Since Phase 14 Plan 07 (G-14-5), that
 *     byte-identity holds against Next's RENDERED canonical `href` — not
 *     merely against the pre-render resolver output — because `absoluteUrl`
 *     now emits the exact root form (`{origin}`, no trailing slash) Next's
 *     own metadata normalizer collapses the canonical to. The cross-layer
 *     proof (Next's real serialized `<loc>` compared against Next's real
 *     rendered canonical `href`) lives in the "cross-layer byte identity"
 *     describe block in `discovery-resolve.test.ts`. No sort is introduced;
 *     input order is preserved. `lastModified` is set only when the page's
 *     `updatedAt` is a real, non-blank Strapi timestamp — never defaulted to
 *     "now" (D-14). No crawl-priority or change-frequency field is ever
 *     emitted: Google has stated it ignores both, so any value this platform
 *     invented would be fabricated structure, not derived data.
 *   - buildRobots(origin) → a single wildcard user-agent group with a
 *     site-wide allow, plus a `sitemap` reference built from the SAME
 *     `absoluteUrl` join every other consumer uses — when and only when
 *     `origin` resolves. Never emits a crawl-blocking directive for any path
 *     and never an unresolvable-origin fail-closed block (D-16): a blocked
 *     crawler never re-fetches a page to read its own noindex tag, so
 *     blocking would defeat the exact mechanism META-05 relies on, and one
 *     blank `Site.siteUrl` must never silently de-index a whole live tenant.
 *     Never emits a canonical-host directive either — that is not part of
 *     D-16's three lines and would be a fourth invented one.
 *
 * Sitemap-scale note (RESEARCH.md Pitfall 4, discretion call 6): Google's
 * documented ceiling is 50,000 URLs per sitemap document. No tenant is
 * remotely near it, and nothing here is implemented against that limit —
 * Next's own `generateSitemaps()` is the in-framework escape hatch if a
 * tenant ever approaches it, and `fetchPages` is additionally bounded by the
 * tenant Strapi's GraphQL `maxLimit` of 200 (`config/plugins.ts`). Recorded
 * here so a future contributor finds the answer without re-researching it.
 */

import type { MetadataRoute } from "next";
// Aliased on import: the shared canonical-path resolver from Plan 02 is
// referenced from exactly one call site below (grep-enforced — see this
// module's acceptance criteria), so it is imported once here under a local
// name and never re-spelled by its exported identifier elsewhere in this file.
import {
  resolveCanonicalPath as canonicalPathOf,
  resolveHomepageSlugFrom,
  absoluteUrl,
  resolveCanonicalOverride,
  resolvePostCanonical,
} from "./seo-resolve";
import { resolveArchiveCanonicalPath } from "./blog-render";
import type { StrapiPage } from "./strapi-client";
import type { SitemapArticleRecord } from "./blog-client";

/**
 * D-17 two-signal indexability filter. Both signals gate independently;
 * neither substitutes for the other and no third field is ever consulted.
 * Reuses `StrapiPage`'s own `seo` shape (strapi-client.ts) rather than
 * re-declaring a local field for the noindex flag — a second declaration of
 * the same field is exactly the drift risk a "one signal" requirement exists
 * to prevent.
 */
export function isSitemapEligible(page: StrapiPage): boolean {
  // DISC-02: the raw `fetchPages` result includes unpublished (draft) pages
  // today — nothing filtered them out before this plan existed. A falsy
  // `publishedAt` (null, undefined, or an absent key) excludes the page.
  if (!page?.publishedAt) return false;

  // META-05 / D-17: the SAME `seo.noindex` flag `buildPageMetadataFrom` reads
  // to emit the robots `noindex` meta tag — never a second, independently
  // maintained field. Only a strict `true` excludes; `false`, `null`, and
  // absence all leave an otherwise-published page eligible.
  if (page?.seo?.noindex === true) return false;

  return true;
}

/**
 * Builds one sitemap entry per distinct resolved URL, in input order, with no
 * sort and no invented fields. Nullish `pages` yields an empty array rather
 * than throwing.
 *
 * The mapping goes through the shared canonical-path resolver — the SAME
 * function `buildPageMetadataFrom` (Plan 02) uses to emit
 * `alternates.canonical` — rather than a local homepage-detection ladder,
 * because that shared call is
 * exactly what makes a sitemap `url` byte-identical to that page's own
 * canonical by construction (D-15): a page flagged as the homepage resolves
 * to the site root only, and its slug path is never also produced as a
 * second entry. Two pages that both claim the homepage flag therefore both
 * resolve to the SAME root URL, and the dedup-by-URL step below (keeping the
 * first occurrence) collapses them to a single entry rather than emitting
 * the root twice.
 */
export function buildSitemapEntries(
  pages: StrapiPage[] | null | undefined,
  origin: string
): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];

  // Which page the site root actually serves, resolved from the SAME
  // three-tier ladder that routes `/` (flag → conventional slug → first
  // page). Resolved over the full, unfiltered page list — the page serving
  // `/` is determined by routing, not by sitemap eligibility, so filtering
  // first could shift the homepage onto a different page than the one the
  // root really renders. Computed here rather than taken as a parameter so a
  // caller cannot forget to pass it (D-15).
  const homepageSlug = resolveHomepageSlugFrom(pages);

  for (const page of pages ?? []) {
    if (!isSitemapEligible(page)) continue;

    const path = canonicalPathOf(page, homepageSlug);
    const url = absoluteUrl(origin, path);
    if (seen.has(url)) continue;
    seen.add(url);

    const updatedAt = page?.updatedAt;
    const entry: MetadataRoute.Sitemap[number] =
      typeof updatedAt === "string" && updatedAt.trim() !== ""
        ? { url, lastModified: updatedAt }
        : { url };

    entries.push(entry);
  }

  return entries;
}

/**
 * D-6/T-23-06 THREE-signal post-indexability filter (Phase 23, Plan 01, Task
 * 3) — a widening of `isSitemapEligible`'s two-signal filter above, for the
 * same posture: every signal gates independently, none substitutes for
 * another, no fourth field is ever consulted.
 *
 *   1. `publishedAt` must be truthy — the SAME D-6 defence-in-depth gate
 *      every other blog read in this app re-applies after the fetch.
 *   2. `seo.noindex` must not be strictly `true` — the SAME field a post's
 *      own robots directive would be emitted from, never a second,
 *      independently-maintained flag (mirrors `isSitemapEligible`'s own
 *      noindex signal).
 *   3. A post carrying a VALID `canonicalUrl` override (one that survives
 *      `resolveCanonicalOverride`) is EXCLUDED. This is new and specific to
 *      posts, and is a stated design choice, not an oversight: that post's
 *      RENDERED canonical names a URL this document has no authority to
 *      advertise, so listing this document's own `/blog/{slug}` URL for it
 *      would directly contradict the canonical the post itself emits —
 *      exactly the split-link-authority problem criterion 1's byte-identity
 *      claim exists to close (T-23-03).
 *   4. `slug` must be a non-empty string. Strapi's `slug` is NULLABLE and the
 *      generated response type declares it `string`, so nothing upstream
 *      catches a published-but-slugless row. Without this gate
 *      `resolvePostCanonical` coerces the missing slug to `""` and emits
 *      `{origin}/blog/` — a bogus entry that duplicates the blog index's own
 *      URL under a post's authority. A slugless post has no reachable URL at
 *      all, so it is not merely un-indexable, it is un-addressable; excluding
 *      it loses nothing that could ever have been crawled.
 */
export function isPostSitemapEligible(
  post:
    | Pick<SitemapArticleRecord, "publishedAt" | "seo" | "canonicalUrl" | "slug">
    | null
    | undefined
): boolean {
  if (!post?.publishedAt) return false;
  if (post?.seo?.noindex === true) return false;
  if (resolveCanonicalOverride(post?.canonicalUrl) !== null) return false;
  if (typeof post?.slug !== "string" || post.slug.trim() === "") return false;
  return true;
}

/**
 * Builds one sitemap entry per distinct resolved URL, in input order, with no
 * sort and no invented fields — structurally mirroring `buildSitemapEntries`
 * above (Phase 23, Plan 01, Task 3, D-1/D-6/BLOG-09).
 *
 * Filters through `isPostSitemapEligible`, then maps every survivor's URL
 * through `resolvePostCanonical` (`seo-resolve.ts`) — NEVER a local path
 * composition — which is exactly what makes a post's sitemap `<loc>`
 * byte-identical to that post's own rendered canonical BY CONSTRUCTION
 * rather than by review (the D-1 single-producer guarantee this phase's
 * tracer establishes; proven cross-layer in this file's test suite). Dedupes
 * by resolved URL, keeping the first occurrence. `lastModified` is set only
 * when the post's `updatedAt` is a real, non-blank string — never defaulted
 * to "now" (matches `buildSitemapEntries`'s own D-14 posture). No
 * crawl-priority or change-frequency field is ever emitted, for the same
 * reason `buildSitemapEntries` states above.
 */
export function buildBlogPostSitemapEntries(
  posts: SitemapArticleRecord[] | null | undefined,
  origin: string
): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];

  for (const post of posts ?? []) {
    if (!isPostSitemapEligible(post)) continue;

    const url = resolvePostCanonical(post, origin);
    if (seen.has(url)) continue;
    seen.add(url);

    const updatedAt = post?.updatedAt;
    const entry: MetadataRoute.Sitemap[number] =
      typeof updatedAt === "string" && updatedAt.trim() !== ""
        ? { url, lastModified: updatedAt }
        : { url };

    entries.push(entry);
  }

  return entries;
}

/**
 * Builds the blog index and every content-bearing category/tag archive's
 * page-1 sitemap entry (Phase 23, Plan 05, Task 2, D-8/BLOG-09).
 *
 * Filters `posts` through `isPostSitemapEligible` FIRST, so a draft, a
 * `noindex` post or a post carrying a valid canonical override contributes
 * NOTHING to term eligibility — a term reachable only through an ineligible
 * post is structurally absent, never a second published-only check that
 * could drift from the one `isPostSitemapEligible` already applies (T-23-20).
 * When no post survives, returns `[]` — no blog index entry either. D-8: an
 * empty archive is a thin page, and a blog with no indexable content at all
 * gets no listing entry, matching D-8's rule for an empty term archive.
 *
 * Otherwise emits, in this fixed order: the blog index at page one, then one
 * entry per DISTINCT category slug in first-appearance order across the
 * eligible post list, then one entry per DISTINCT tag slug in the same
 * first-appearance order. Every URL is composed by `resolveArchiveCanonicalPath`
 * (`blog-render.ts`) — always at page 1 — piped through the SAME `absoluteUrl`
 * join every other sitemap builder in this file uses, NEVER a local path
 * composition. `resolveArchiveCanonicalPath` is the exact function
 * `buildArchiveMetadata` (`app/_lib/render-blog.tsx`) composes its own
 * `alternates.canonical` from (D-1), so an archive's sitemap `<loc>` and its
 * own rendered canonical can never disagree by construction. Deduplicates by
 * resolved URL, keeping the first occurrence (T-23-21: a category slug
 * carrying a `/` is percent-encoded by `resolveArchiveCanonicalPath`'s own
 * path algebra, so it can never forge a second route into this entry list).
 *
 * D-8 EXCLUDES every paginated archive URL (`/blog/page/2`, a term's
 * `page/2`, etc.) BY DESIGN, not by truncation — a paginated page remains
 * self-canonical (D-5) but adds crawl surface with no indexable content of
 * its own the page-1 canonical does not already carry, so this function
 * NEVER composes a path for any page other than 1. Pinned by a dedicated
 * test using a fixture with more posts than one listing page, asserting
 * across every emitted entry rather than trusting the code path alone.
 *
 * Emits no `lastModified` on an archive entry: a listing carries no authored
 * timestamp of its own, and synthesizing one from its members would be a
 * value this platform would then have to keep honest across every post
 * change and every page of pagination. Emits no `priority` or
 * `changeFrequency`, for the same reason `buildSitemapEntries` states above
 * (Google has stated it ignores both).
 */
export function buildBlogArchiveSitemapEntries(
  posts: SitemapArticleRecord[] | null | undefined,
  origin: string
): MetadataRoute.Sitemap {
  const eligible = (posts ?? []).filter(isPostSitemapEligible);
  if (eligible.length === 0) return [];

  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];

  const addArchiveEntry = (kind: "index" | "category" | "tag", termSlug?: string | null) => {
    const url = absoluteUrl(origin, resolveArchiveCanonicalPath(kind, termSlug, 1));
    if (seen.has(url)) return;
    seen.add(url);
    entries.push({ url });
  };

  addArchiveEntry("index");

  for (const post of eligible) {
    const categorySlug = post.category?.slug;
    if (categorySlug) addArchiveEntry("category", categorySlug);
  }

  for (const post of eligible) {
    for (const tag of post.tags ?? []) {
      if (tag.slug) addArchiveEntry("tag", tag.slug);
    }
  }

  return entries;
}

/**
 * Counts how many of `group`'s own ENTRY OBJECTS `merged` still carries, by
 * REFERENCE — never by URL string equality (Phase 23, Plan 05, Task 2,
 * T-23-23). This distinction is load-bearing: `mergeSitemapEntries`'s
 * first-wins dedup means a URL colliding across two groups still ends up
 * exactly once in `merged` either way, so a URL-string-membership check
 * would report every group as "fully surviving" even when an earlier group's
 * entry silently won. `mergeSitemapEntries` never copies or reconstructs an
 * entry -- it pushes the input group's own object verbatim (`entries.push(entry)`)
 * -- so a `merged` entry is `===` one of `group`'s entries if and only if
 * THAT group supplied it; when this count is LOWER than `group.length`, an
 * earlier group in the `mergeSitemapEntries` call claimed at least one of
 * `group`'s own URLs first with its own entry object instead.
 *
 * `app/sitemap.ts` uses this to detect the blog-listing-URL collision
 * recorded in STATE.md (a published CMS page already occupying the blog
 * listing's URL): for the archive group specifically, a surviving-count
 * shortfall can only be the blog index entry, because a category/tag archive
 * URL is never also a bare page slug. Pure and generic: takes no dependency
 * on which group is being checked.
 */
export function countSurvivingEntries(
  group: MetadataRoute.Sitemap,
  merged: MetadataRoute.Sitemap
): number {
  const mergedEntries = new Set<MetadataRoute.Sitemap[number]>(merged);
  return group.filter((entry) => mergedEntries.has(entry)).length;
}

/**
 * A pure first-wins dedup across any number of sitemap entry groups (Phase
 * 23, Plan 01, Task 3) — so `app/sitemap.ts` stays a thin fetch-and-delegate
 * shell and a cross-group URL collision (a CMS page at slug `blog` colliding
 * with the blog listing, for instance) is handled in ONE tested place rather
 * than inline in the route file. Earlier groups win: a URL already seen in
 * an earlier group is skipped when it recurs in a later one. Preserves each
 * surviving entry's own shape and input order within/across groups. A
 * nullish group is treated as empty rather than throwing.
 */
export function mergeSitemapEntries(
  ...groups: Array<MetadataRoute.Sitemap | null | undefined>
): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];

  for (const group of groups) {
    for (const entry of group ?? []) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * A single wildcard allow group, plus a sitemap reference built from the
 * same `absoluteUrl` join every other consumer uses — present only when
 * `origin` resolves.
 *
 * Two rejections a well-intentioned future edit will be tempted to make,
 * recorded here deliberately:
 *
 *   1. No path is ever blocked from crawling, including the framework-asset
 *      directory. A blocked crawler never fetches the page and therefore
 *      never reads that page's own `noindex` tag — blocking would defeat the
 *      exact mechanism META-05 relies on, and blocking the asset directory
 *      specifically would additionally stop the crawler rendering the page
 *      at all.
 *   2. An unresolvable origin never produces a site-wide crawl block. That
 *      would let one blank `Site.siteUrl` silently de-index a live tenant's
 *      entire site — the opposite of the milestone's fail-open posture
 *      (D-07/D-16). The correct degradation is this same allow group with
 *      the `sitemap` key simply omitted.
 *
 * No canonical-host key is ever emitted — that declaration is not part of
 * D-16's three lines and would be a fourth invented directive.
 */
export function buildRobots(origin: string | null): MetadataRoute.Robots {
  const rules: MetadataRoute.Robots["rules"] = {
    userAgent: "*",
    allow: "/",
  };

  if (origin === null) {
    return { rules };
  }

  return {
    rules,
    sitemap: absoluteUrl(origin, "/sitemap.xml"),
  };
}
