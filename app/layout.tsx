import type { Metadata } from "next";
import "./globals.css";
import { fetchSite } from "../lib/strapi-client";
import { resolveLocale, buildSiteMetadataFrom } from "../lib/seo-resolve";
import { reportSeoDegrade } from "../lib/seo-report";

// Phase 14 (Plan 03): the root layout's first data dependency. The shared,
// `cache()`-wrapped Site fetcher imported above is the SAME one `RenderPage`
// / the page-level metadata builder elsewhere in the template already call,
// so this layout's two calls below, plus the page component's own call, all
// collapse into ONE Strapi round trip per request (D-11) — this is the
// entire reason the extra read here is affordable. Both call sites below
// wrap the read in their own error-handling block: this is the first file
// in the template that can fail at all (every prior file had no data
// dependency), and a throw here would take every route down, so the degrade
// must be a real error trap rather than a reliance on the fetcher never
// throwing (T-14-12).

/**
 * The one Site read for this file, with the T-14-12 trap around it.
 *
 * `fetchSite()` traps internally and returns `null`, so this catch is
 * unreachable today — it is kept as defense-in-depth because a throw in the
 * root layout takes every route in the template down, and the cost of the
 * trap is one try block. It REPORTS rather than swallowing silently: if it
 * ever fires, the never-throws contract has been broken, and that has to
 * surface as a log line instead of being inferred later from a mysteriously
 * default `<html lang>` and a missing title.
 *
 * Only the error's constructor name is reported, never its message — a
 * message can carry the Strapi URL or token (T-14-08).
 */
async function readSiteForLayout(surface: "page-metadata" | "root-layout") {
  try {
    return await fetchSite();
  } catch (error) {
    reportSeoDegrade("site-read-threw", surface, {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

// Replaces the static `metadata` export (D-12): the two hardcoded
// placeholder strings this template previously shipped on every tenant are
// gone, not kept as a fallback. On a failed/missing Site read this passes
// `null` into the site-level metadata builder above, which emits no title
// and no description rather than throwing.
export async function generateMetadata(): Promise<Metadata> {
  const site = await readSiteForLayout("page-metadata");
  return buildSiteMetadataFrom(site, process.env);
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const site = await readSiteForLayout("root-layout");
  const locale = resolveLocale(site);

  return (
    <html lang={locale}>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
