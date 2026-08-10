import type { MetadataRoute } from "next";
import { fetchSite } from "@/lib/strapi-client";
import { resolveSiteOrigin } from "@/lib/seo-resolve";
import { buildRobots } from "@/lib/discovery-resolve";
import { reportSeoDegrade } from "@/lib/seo-report";

/**
 * Tenant robots.txt (Phase 14, Plan 04, DISC-03). Next's file-convention
 * module — not a route handler and not a hand-assembled text response: Next
 * owns the formatting and the content type (D-13). Same `revalidate` window
 * as `app/sitemap.ts` and the two render routes, so this document
 * participates in ISR identically.
 */
export const revalidate = 10;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const site = await fetchSite();
  const origin = resolveSiteOrigin(site, process.env);

  if (origin === null) {
    // Unlike the sitemap's degrade, robots.txt still returns real content —
    // the wildcard allow group — so this reports a degraded reference, not a
    // degraded document (D-07/D-16 fail-open posture).
    reportSeoDegrade("origin-unresolvable", "robots", {
      hasSite: site !== null,
    });
  }

  return buildRobots(origin);
}
