import type { MetadataRoute } from "next";
import { fetchPages, fetchSite } from "@/lib/strapi-client";
import { resolveSiteOrigin } from "@/lib/seo-resolve";
import { buildSitemapEntries } from "@/lib/discovery-resolve";
import { reportSeoDegrade } from "@/lib/seo-report";

/**
 * Tenant sitemap (Phase 14, Plan 04, DISC-01). Next's file-convention module —
 * not a route handler and not hand-assembled XML: Next owns the
 * serialization, the escaping and the content type (D-13). Same `revalidate`
 * window as the two render routes (`app/page.tsx`, `app/[slug]/page.tsx`) so
 * this document participates in ISR identically.
 */
export const revalidate = 10;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [pages, site] = await Promise.all([fetchPages(), fetchSite()]);
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

  return buildSitemapEntries(pages, origin);
}
