/**
 * Emission-side analytics resolution for the tenant template (REQ-7/8/9).
 *
 * Mirrors `lib/analytics/normalize-analytics-id.ts` in the dashboard repo
 * ("mirror, don't import" — `templates/` is a separate application outside
 * that repo's tsconfig), pinned to it by a cross-tree test.
 *
 * THE NORMALIZERS ARE THE SECURITY BOUNDARY, not a data-quality nicety. Each
 * resolved id is interpolated into an INLINE `<script>` body below. A value
 * containing a quote, an angle bracket, a backslash or a newline would be
 * script injection on every page of the tenant's site — and unlike a meta
 * tag, React does not escape anything inside
 * `dangerouslySetInnerHTML`/inline script children. The patterns admit only
 * `[A-Z0-9-]` and digits, so no value capable of breaking out of a script
 * context can reach emission. Re-normalizing here rather than trusting the
 * stored value is what makes that true even for a value written straight
 * into Strapi's admin UI, bypassing the dashboard form entirely.
 */

const GA4_RE = /\bG-[A-Z0-9]{4,20}\b/;
const GOOGLE_ADS_RE = /\bAW-[0-9]{6,20}\b/;
const META_PIXEL_RE = /\b[0-9]{10,20}\b/;
const FBQ_INIT_RE = /fbq\s*\(\s*['"]init['"]\s*,\s*['"]([0-9]{10,20})['"]/i;

function extract(
  raw: string | null | undefined,
  pattern: RegExp,
  transform: (value: string) => string = (v) => v
): string | null {
  if (raw == null) return null;
  const trimmed = transform(raw.trim());
  if (trimmed === "") return null;
  const match = pattern.exec(trimmed);
  return match ? match[0] : null;
}

export function normalizeGoogleAnalyticsId(
  raw: string | null | undefined
): string | null {
  return extract(raw, GA4_RE, (v) => v.toUpperCase());
}

export function normalizeGoogleAdsId(
  raw: string | null | undefined
): string | null {
  return extract(raw, GOOGLE_ADS_RE, (v) => v.toUpperCase());
}

export function normalizeMetaPixelId(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const init = FBQ_INIT_RE.exec(trimmed);
  if (init) return init[1];
  return /^[0-9]{10,20}$/.test(trimmed) ? trimmed : null;
}

export const ANALYTICS_ID_PATTERNS = {
  ga4: GA4_RE.source,
  googleAds: GOOGLE_ADS_RE.source,
  metaPixel: META_PIXEL_RE.source,
} as const;

/** The Site fields this module reads. Structural, so the template never
 * imports the dashboard's Strapi types. */
export interface AnalyticsSiteFields {
  googleAnalyticsId?: string | null;
  googleAdsId?: string | null;
  metaPixelId?: string | null;
}

/**
 * What the layout should actually render.
 *
 * `gtagBootstrapId` is the load-bearing field. GA4 and Google Ads are the
 * SAME library (gtag.js) with different `config` targets, so loading the
 * script twice would double-execute the loader and can drop events. This
 * resolves ONE bootstrap id — whichever is present, GA4 preferred — and
 * lists every id that should receive its own `config` call after it. With
 * only one product configured the two collapse to the same single id, which
 * is why the shape is a bootstrap plus a list rather than two booleans.
 */
export interface ResolvedAnalytics {
  /** The id used in the `gtag/js?id=` URL, or null when neither Google
   * product is configured and no gtag script should be emitted at all. */
  gtagBootstrapId: string | null;
  /** Every id needing a `gtag('config', id)` call, in emission order. Empty
   * exactly when `gtagBootstrapId` is null. */
  gtagConfigIds: string[];
  /** The Meta pixel id, which shares nothing with gtag and loads on its own. */
  metaPixelId: string | null;
}

/**
 * Pure. Never throws. Returns a fully-resolved, already-normalized plan —
 * the layout does no validation of its own and no conditional logic beyond
 * "is this null".
 */
export function resolveAnalytics(
  site: AnalyticsSiteFields | null | undefined
): ResolvedAnalytics {
  const ga4 = normalizeGoogleAnalyticsId(site?.googleAnalyticsId);
  const ads = normalizeGoogleAdsId(site?.googleAdsId);
  const metaPixelId = normalizeMetaPixelId(site?.metaPixelId);

  // GA4 preferred as the bootstrap when both exist: it is the one whose
  // measurement depends on firing on every page view, whereas an Ads
  // conversion id is typically fired deliberately. If only Ads is set it
  // bootstraps by itself.
  const gtagConfigIds = [ga4, ads].filter((id): id is string => id !== null);
  const gtagBootstrapId = gtagConfigIds[0] ?? null;

  return { gtagBootstrapId, gtagConfigIds, metaPixelId };
}

/**
 * The inline gtag bootstrap body.
 *
 * Built here rather than inline in the layout so the exact emitted text is
 * assertable in a test — including the property that every interpolated id
 * has passed a normalizer. Callers must pass a `ResolvedAnalytics` produced
 * by `resolveAnalytics`; the ids are re-checked here anyway, because a
 * future caller constructing the object by hand is exactly the kind of
 * change that silently reintroduces an injection.
 */
export function buildGtagInlineScript(resolved: ResolvedAnalytics): string {
  const ids = resolved.gtagConfigIds.filter(
    (id) => normalizeGoogleAnalyticsId(id) === id || normalizeGoogleAdsId(id) === id
  );
  const configCalls = ids.map((id) => `gtag('config','${id}');`).join("");
  return `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());${configCalls}`;
}

/**
 * The Meta pixel bootstrap body. `pixelId` is re-normalized for the same
 * reason as above — this function is the last line of defense before the
 * value becomes executable text.
 */
export function buildMetaPixelInlineScript(pixelId: string): string | null {
  const id = normalizeMetaPixelId(pixelId);
  if (!id) return null;
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${id}');fbq('track','PageView');`;
}
