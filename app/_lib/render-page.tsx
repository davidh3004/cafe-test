/**
 * Shared page rendering for the two routes that render CMS pages:
 * `/` (the homepage) and `/[slug]` (everything else).
 *
 * Both routes used to be separate, and `/` only issued a 307 to `/{slug}` —
 * which cost a full extra round trip (measured ~1.5s) and canonicalized the
 * homepage to `/home` instead of `/`. Rendering the homepage in place means the
 * two routes must produce identical output, so the rendering lives here rather
 * than being duplicated.
 *
 * Underscore-prefixed folder: `app/_lib` is a private folder, excluded from
 * routing by Next.js.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPages, fetchPageBySlug, fetchSite } from "@/lib/strapi-client";
import type { StrapiPage } from "@/lib/strapi-client";
import { PageRenderer } from "@/lib/page-renderer";
import { resolveLiveBundle } from "@/lib/live-resolve";
import {
  resolveSiteOrigin,
  buildPageMetadataFrom,
  resolveHomepageSlugFrom,
  NOT_FOUND_TITLE,
} from "@/lib/seo-resolve";
import { buildJsonLdGraph, serializeJsonLd } from "@/lib/jsonld";
import { reportSeoDegrade } from "@/lib/seo-report";
import { extractFirstHeroImageUrl } from "@/lib/hero-preload";
import { evaluateThemeServerSide } from "@/lib/theme-evaluator";
import { buildShellHtml, isSsrShellDisabled } from "@/lib/server-shell";

/**
 * Resolve which page is the homepage: the `isHomepage` flag, then the
 * conventional slugs, then the first page. Mirrors the resolution the old
 * `app/page.tsx` redirect performed.
 *
 * The ladder itself lives in `resolveHomepageSlugFrom` (pure, in
 * `lib/seo-resolve.ts`) so this routing decision and the canonical/sitemap
 * decisions are the same code, not two copies that can drift. They did drift
 * once: the canonical and sitemap honored only tier one, so a tenant with no
 * explicitly-flagged homepage served `/` while declaring a canonical pointing
 * at `/{slug}` and omitting `/` from the sitemap.
 */
export async function resolveHomepageSlug(): Promise<string | null> {
  return resolveHomepageSlugFrom(await fetchPages());
}

/**
 * Metadata shared by both routes (Phase 14). Thin fetch-and-delegate shell —
 * all emission logic lives in the pure `buildPageMetadataFrom` (discretion
 * call 5): a test of this shell would have to mock `@/lib/strapi-client` and
 * would then assert the mock rather than the behavior, so this function has
 * no dedicated test file; every metadata assertion lives in
 * `lib/__tests__/seo-resolve.test.ts` against synthetic Strapi objects.
 */
export async function buildPageMetadata(slug: string | null): Promise<Metadata> {
  if (!slug) return { title: NOT_FOUND_TITLE };

  // The page and the site are independent reads — fetching them concurrently
  // mirrors RenderPage's own block below. Both `fetchPageBySlug`/`fetchSite`
  // are `cache()`-deduped, so the duplicate read from RenderPage's own call
  // costs no extra round trip.
  // `fetchPages` is read here too so the canonical can collapse to `/` for a
  // homepage resolved by convention or first-page fallback, not just by an
  // explicit flag (D-08). All three reads are `cache()`-deduped, and
  // `fetchPages` is already fetched by the `/` route's own
  // `resolveHomepageSlug()`, so this costs no extra Strapi round trip.
  const [page, site, pages] = await Promise.all([
    fetchPageBySlug(slug),
    fetchSite(),
    fetchPages(),
  ]);

  const origin = resolveSiteOrigin(site, process.env);
  if (origin === null && page) {
    // D-07: report the degrade, never guess an origin. Only booleans
    // describing which inputs were present — never the values themselves
    // (T-14-08).
    reportSeoDegrade("origin-unresolvable", "page-metadata", {
      hasSite: site != null,
      hasSiteUrl: !!site?.siteUrl?.trim(),
      hasSubdomainEnv: !!process.env.NEXT_PUBLIC_SITE_SUBDOMAIN?.trim(),
    });
  }

  return buildPageMetadataFrom(
    page,
    site,
    process.env,
    resolveHomepageSlugFrom(pages)
  );
}

function ConfigurationError({
  themeBundleUrl,
  themeName,
}: {
  themeBundleUrl: string | null | undefined;
  themeName: string | undefined;
}) {
  console.error("Theme bundle URL configuration error:", {
    themeBundleUrl: themeBundleUrl || "(empty)",
    themeName,
    hasStrapiUrl: !!process.env.NEXT_PUBLIC_STRAPI_URL,
    hasStrapiToken: !!process.env.NEXT_PUBLIC_STRAPI_TOKEN,
    nodeEnv: process.env.NODE_ENV,
    allNextPublicVars: Object.keys(process.env).filter((k) =>
      k.startsWith("NEXT_PUBLIC_")
    ),
  });

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4 p-8 max-w-2xl">
        <p className="text-lg font-semibold text-destructive">
          Configuration Error
        </p>
        <p className="text-sm text-muted-foreground">
          Theme bundle URL is not configured
        </p>
        <div className="text-xs text-muted-foreground mt-4 space-y-2 text-left bg-muted p-4 rounded">
          <p className="font-semibold">Debug Information:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Theme Bundle URL: {themeBundleUrl || "(empty)"}</li>
            <li>Theme Name: {themeName}</li>
            <li>
              Strapi URL configured:{" "}
              {process.env.NEXT_PUBLIC_STRAPI_URL ? "Yes" : "No"}
            </li>
            <li>Environment: {process.env.NODE_ENV || "unknown"}</li>
          </ul>
          <p className="font-semibold mt-4">Possible causes:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>The theme bundle was not built before deployment</li>
            <li>The THEME_BUNDLE_URL secret is not set in GitHub</li>
            <li>The bundle file was not found in the build branch</li>
            <li>
              The environment variable was not set during the GitHub Actions
              build
            </li>
          </ul>
          <p className="mt-2">
            Please check your GitHub Actions workflow logs for the &quot;Determine
            theme bundle URL&quot; step to see what URL was determined.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Render a CMS page by slug. `notFound()` when the page is missing or unpublished.
 */
export async function RenderPage({ slug }: { slug: string | null }) {
  if (!slug) notFound();

  // The page and the site are independent reads — fetching them concurrently
  // removes one Strapi round trip from the critical path. Previously these were
  // sequential (`await` page, then `await` site) which serialized two Railway
  // round trips. Both are wrapped in React `cache()`, so the duplicate call from
  // generateMetadata still costs nothing.
  // `fetchPages` joins this block for the JSON-LD graph's canonical `@id`,
  // which needs the site's resolved homepage slug for the same D-08 reason
  // buildPageMetadata reads it: without it the graph would name the homepage
  // `{origin}/{slug}` while `<link rel="canonical">` names it `{origin}`, and
  // Google discards a node whose URL contradicts the page's own head. It is
  // `cache()`-deduped and already read by `buildPageMetadata` (and by the `/`
  // route's own `resolveHomepageSlug()`), so this costs no extra round trip.
  const [page, site, pages]: [
    StrapiPage | null,
    Awaited<ReturnType<typeof fetchSite>>,
    StrapiPage[],
  ] = await Promise.all([fetchPageBySlug(slug), fetchSite(), fetchPages()]);

  if (!page || !page.publishedAt) {
    notFound();
  }

  // Phase 18 (SEO): structured data, previously absent from every served
  // page. `null` whenever there is nothing honest to say (no origin, no
  // name — see buildJsonLdGraph), in which case no script is emitted at all
  // rather than an empty or partial graph.
  const jsonLd = buildJsonLdGraph(
    page,
    site,
    process.env,
    resolveHomepageSlugFrom(pages)
  );

  // Resolve the hero section's background image URL (D-04) so we can emit a
  // server-rendered high-priority preload hint BEFORE the theme bundle is even
  // requested — the LCP candidate is never in this page's HTML otherwise, since
  // PageRenderer is a client component that paints a blank placeholder until the
  // bundle downloads/executes (lcp-discovery-insight). `null` when the page has
  // no hero image; renders unchanged in that case.
  const heroImageUrl = extractFirstHeroImageUrl(page);

  // Resolve the bundle from Site.liveTheme (Finding 4 / Q3) so switching
  // Site.liveTheme to a DIFFERENT theme swaps the loaded bundle with NO
  // redeploy. The env vars remain the fallback (migration window / single-theme
  // tenant). `themeName` is the live theme's registration name (the
  // __THETA_THEMES__ key), not the slug.
  //
  // NOTE: this route is now ISR-cached rather than force-dynamic, so a
  // liveTheme switch takes effect on the next revalidation — the platform
  // should call /api/revalidate after changing it (see app/api/revalidate).
  // themeCssUrl (the critical stylesheet URL) is resolved HERE, inside
  // resolveLiveBundle, and nowhere else (17-05, PERF-04). It must not be
  // re-derived from themeBundleUrl downstream: once themeBundleUrl carries a
  // `?v=` version token, a `.js` -> `.css` suffix swap on it silently fails
  // and would point the critical `<link rel="stylesheet">` at the JS bundle.
  // The `NEXT_PUBLIC_THEME_CSS_URL` operator override is also handled inside
  // the resolver (it already receives `process.env` as its second argument).
  const { themeBundleUrl, themeName, themeCssUrl, themeCssDeferredUrl } =
    resolveLiveBundle(site, process.env);

  if (!themeBundleUrl || themeBundleUrl.trim() === "") {
    return (
      <ConfigurationError themeBundleUrl={themeBundleUrl} themeName={themeName} />
    );
  }

  // Phase 13 (SSR-01/SSR-04, D-01/D-04): server-render the page's real
  // section markup into an opaque shell string, so a crawler that executes
  // no JavaScript reads real content instead of PageRenderer's blank
  // placeholder. `shellHtml` stays `undefined` -- never an empty string --
  // whenever there is no server shell to hand off, which reproduces today's
  // exact client-only behavior byte-for-byte. That single `undefined` state
  // covers three cases at once: the kill switch is set (this section), the
  // evaluator returned null (SSR-04, Phase 12's degrade-and-record contract),
  // or every section failed to resolve/render (buildShellHtml's own null).
  let shellHtml: string | undefined;
  if (!isSsrShellDisabled(process.env)) {
    // The kill switch gates the evaluator CALL itself, not merely its
    // result -- a tenant with THETA_DISABLE_SSR_SHELL set pays nothing for
    // server evaluation (D-04).
    const themeModule = await evaluateThemeServerSide(themeBundleUrl, themeName);
    if (themeModule) {
      shellHtml = buildShellHtml({ page, themeModule, themeName }) ?? undefined;
    }
    // A null themeModule means evaluateThemeServerSide already degraded and
    // reported through its own reportEvaluationFailure seam (Phase 12,
    // D-07) -- no new failure plumbing needed here for that case.
  }

  return (
    <>
      {/*
        The hero preload link stays unconditional even though the hero is
        now (usually) also in shellHtml's server HTML. This link is emitted
        in <head>, ahead of the shell body, so it still reaches the browser's
        preload scanner earlier than the body markup does. Considered
        conditioning it on `shellHtml == null`, but removing it would be an
        unmeasured LCP risk for zero benefit -- performance tuning is
        Phase 17's scope -- so it is kept exactly as it was.
      */}
      {heroImageUrl && (
        <link
          rel="preload"
          as="image"
          href={heroImageUrl}
          fetchPriority="high"
        />
      )}
      {/*
        JSON-LD must go through dangerouslySetInnerHTML — React escapes a text
        child, and an escaped `&quot;` inside a ld+json script is invalid JSON
        that every consumer silently drops. `serializeJsonLd` is what makes
        that safe: it escapes `<` so tenant-authored Strapi content cannot
        close this script element and execute (see its doc comment). Never
        interpolate a graph here with a bare JSON.stringify.
      */}
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      <PageRenderer
        page={page}
        themeBundleUrl={themeBundleUrl}
        themeName={themeName}
        themeCssUrl={themeCssUrl}
        themeCssDeferredUrl={themeCssDeferredUrl}
        shellHtml={shellHtml}
      />
    </>
  );
}
