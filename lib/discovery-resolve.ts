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
} from "./seo-resolve";
import type { StrapiPage } from "./strapi-client";

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
