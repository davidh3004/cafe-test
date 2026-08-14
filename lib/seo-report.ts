/**
 * Structured degrade channel for the SEO/metadata subsystem (Phase 14).
 *
 * Deliberately a SEPARATE module from `theme-evaluator.ts`'s reporting seam:
 * `app/robots.ts` and `app/sitemap.ts` (Plan 04) would otherwise have to
 * import the theme evaluator, which pulls in `node:vm`, the SSR React
 * runtime and `lucide-react` into a route that emits four lines of text.
 *
 * Reproduces `theme-evaluator.ts`'s `reportEvaluationFailure` structure
 * exactly: the `console.error` record is unconditional and always-on,
 * independent of Sentry availability or DSN configuration; the Sentry call
 * is wrapped in its own swallowing try/catch so a telemetry failure can
 * never turn a graceful degrade into a throw (extends the theme-evaluator's
 * D-09/D-07 pattern to this subsystem).
 *
 * `context` NEVER carries CMS field values, the resolved Strapi token, the
 * bundle text, or any request header — only booleans and short identifiers
 * describing which inputs were present (extends T-12-09 to this subsystem,
 * T-14-08).
 */

import * as Sentry from "@sentry/nextjs";

/**
 * The degrade reasons this phase produces.
 *
 * - `origin-unresolvable` — no tenant origin could be resolved, so every
 *   absolute URL is omitted rather than guessed (D-07).
 * - `site-read-threw` — `fetchSite()` threw despite its documented
 *   never-throws contract (it traps internally and returns `null`). The root
 *   layout keeps a defensive trap because a throw there takes every route in
 *   the template down (T-14-12); if that trap ever fires, the contract has
 *   been broken and it must be visible rather than inferred from a silently
 *   defaulted `<html lang>`.
 * - `redirect-map-fetch-failed` (Phase 16) — `getRedirectMap()`'s fetch
 *   rejected, resolved non-ok, returned a GraphQL `errors` array, or returned
 *   a body with no `data.redirects` array. The middleware degrades to
 *   no-redirects and serves the request normally (D-03/REDIR-03) — this
 *   report is the only record of the degrade. Sentry is a no-op on the Edge
 *   runtime in this template (`instrumentation.ts` returns early for any
 *   non-nodejs runtime and there is no edge Sentry config here), so the
 *   unconditional `console.error` below is the real record for this surface
 *   — accepted, matching the status quo for every other degrade site in this
 *   template, and not expanded in this phase.
 * - `redirect-click-report-failed` (REQ-2) — the fire-and-forget click
 *   beacon to the platform's ingest route rejected or resolved non-ok. The
 *   visitor is unaffected: the beacon rides `waitUntil`, so the redirect
 *   response was already returned before this could fire. The only
 *   consequence is one uncounted click, which is why this is a degrade
 *   report and not an error path.
 * - `blog-template-not-declared` (Phase 21, D-09/D-11/D-12) — the live
 *   theme's manifest declares no `article` (or no `archive`) template, or
 *   declares one without its required section slot. `blog-degrade.ts`'s
 *   `resolveBlogSurfaceSupport` responds 404 inside the theme's own chrome
 *   with fixed, stated copy rather than a blank page or a crash. The
 *   context is boolean-only (T-21-11): which inputs were present, never a
 *   manifest's content or any CMS field value.
 * - `sitemap-post-cap-exceeded` (Phase 23, D-6/BLOG-09/T-23-06) — the
 *   sitemap's post enumeration (`fetchSitemapArticles`,
 *   `lib/blog-client.ts`) hit its `SITEMAP_ARTICLE_MAX_PAGES` cap: the
 *   sitemap emitted the newest `SITEMAP_ARTICLE_PAGE_SIZE *
 *   SITEMAP_ARTICLE_MAX_PAGES` published posts in the query's deterministic
 *   sort order (newest `publishedAt` first), and the remainder are absent by
 *   an EXPLICIT, reported cap rather than by silent truncation. The context
 *   carries primitive counts only (T-23-06) — never a slug, a title, or any
 *   other CMS field value.
 * - `blog-index-url-collision` (Phase 23, Plan 05, Task 2, D-8/T-23-23) — a
 *   published CMS page already occupies the blog listing's URL (the
 *   Fixocargo-tenant hazard recorded in STATE.md: a page at slug `blog`
 *   Phase 22's static `/blog` segment will shadow on its next re-template).
 *   `mergeSitemapEntries`'s first-wins rule means the sitemap still emits
 *   that URL exactly once — never twice — but the collision itself would
 *   otherwise be silently absorbed rather than observable. This report is
 *   that observation, not a fix: the recorded resolution is renaming the
 *   affected tenant page's slug, tracked outside this phase. The context
 *   carries primitive counts only, matching every other reason above — never
 *   the colliding page's own slug or title.
 */
export type SeoDegradeReason =
  | "origin-unresolvable"
  | "site-read-threw"
  | "redirect-map-fetch-failed"
  | "redirect-click-report-failed"
  | "blog-template-not-declared"
  | "sitemap-post-cap-exceeded"
  | "blog-index-url-collision";

/** The consumers of this channel (Plans 02-04, Phase 16 Plan 01, Phase 21
 * Plan 04 / Phase 22's post & archive routes). */
export type SeoSurface =
  | "page-metadata"
  | "root-layout"
  | "sitemap"
  | "robots"
  | "middleware"
  | "blog-surface";

/**
 * The one and only reporting seam in this module. `context` is constrained
 * to primitive values so a caller cannot hand it an object graph that might
 * carry a CMS field value, a token, or a request header.
 */
export function reportSeoDegrade(
  reason: SeoDegradeReason,
  surface: SeoSurface,
  context?: Record<string, string | number | boolean>
): void {
  console.error("[seo-metadata]", reason, surface, context ?? {});

  try {
    Sentry.captureException(new Error(`[seo-metadata] ${reason}`), {
      tags: { subsystem: "seo-metadata", reason, surface },
      extra: context,
    });
  } catch {
    // Swallow: see the module doc comment above. The console.error above
    // already recorded this failure regardless of what happens here.
  }
}
