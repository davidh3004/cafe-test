import type { MetadataRoute } from "next";
import { fetchPages, fetchSite } from "@/lib/strapi-client";
import { fetchSitemapArticles } from "@/lib/blog-client";
import { resolveSiteOrigin } from "@/lib/seo-resolve";
import {
  buildSitemapEntries,
  buildBlogPostSitemapEntries,
  buildBlogArchiveSitemapEntries,
  countSurvivingEntries,
  mergeSitemapEntries,
} from "@/lib/discovery-resolve";
import { reportSeoDegrade } from "@/lib/seo-report";

/**
 * Tenant sitemap (Phase 14, Plan 04, DISC-01; posts added Phase 23, Plan 01,
 * BLOG-09; archive surfaces added Phase 23, Plan 05, D-8/BLOG-09). Next's
 * file-convention module — not a route handler and not hand-assembled XML:
 * Next owns the serialization, the escaping and the content type (D-13).
 * Same `revalidate` window as the two render routes (`app/page.tsx`,
 * `app/[slug]/page.tsx`) so this document participates in ISR identically.
 *
 * Stays a thin fetch-and-delegate shell: every DECISION (which page/post/
 * archive is eligible, how each URL is composed, how the page group, the
 * post group and the archive group are merged, and how a blog-listing-URL
 * collision is detected) lives in `lib/discovery-resolve.ts`'s pure builders.
 */
export const revalidate = 10;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, site, sitemapArticles] = await Promise.all([
    fetchPages(),
    fetchSite(),
    fetchSitemapArticles(),
  ]);
  const origin = resolveSiteOrigin(site, process.env);

  if (origin === null) {
    // D-07 posture extended to discovery: return a syntactically valid empty
    // sitemap rather than emitting entries against a guessed host.
    reportSeoDegrade("origin-unresolvable", "sitemap", {
      hasSite: site !== null,
      pageCount: pages.length,
    });
    return [];
  }

  // D-6/T-23-06: the enumeration cap was hit -- report the explicit,
  // primitives-only degrade rather than silently emitting a partial sitemap.
  if (sitemapArticles.truncated) {
    reportSeoDegrade("sitemap-post-cap-exceeded", "sitemap", {
      total: sitemapArticles.total,
      returned: sitemapArticles.articles.length,
    });
  }

  const pageEntries = buildSitemapEntries(pages, origin);
  const postEntries = buildBlogPostSitemapEntries(sitemapArticles.articles, origin);
  const archiveEntries = buildBlogArchiveSitemapEntries(sitemapArticles.articles, origin);

  const merged = mergeSitemapEntries(pageEntries, postEntries, archiveEntries);

  // T-23-23/D-8: the archive group's own entry count vs. the count that
  // survived the merge tells us whether an earlier group (the page group,
  // when a CMS page already occupies the blog listing's URL) claimed one of
  // the archive group's URLs first. Reports the observation only -- the
  // merge already keeps that URL exactly once via mergeSitemapEntries's
  // first-wins rule.
  const survivingArchiveCount = countSurvivingEntries(archiveEntries, merged);
  if (survivingArchiveCount < archiveEntries.length) {
    reportSeoDegrade("blog-index-url-collision", "sitemap", {
      archiveCount: archiveEntries.length,
      survivingArchiveCount,
    });
  }

  return merged;
}
