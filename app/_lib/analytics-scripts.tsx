import Script from "next/script";
import {
  buildGtagInlineScript,
  buildMetaPixelInlineScript,
  resolveAnalytics,
  type AnalyticsSiteFields,
} from "@/lib/analytics-resolve";

/**
 * Third-party measurement tags (REQ-7/8/9): GA4, Google Ads and the Meta
 * pixel, rendered from site-level ids.
 *
 * NO CONSENT GATING — a deliberate, recorded decision, not an oversight.
 * These tags set cookies on first paint with no prior consent. That was
 * accepted because the tenants are Dominican Republic businesses, outside
 * GDPR/ePrivacy's scope. It stops being true the moment a tenant serves EU
 * visitors, and at that point this component is the correct and only place
 * to add a gate — which is part of why the emission lives in one component
 * rather than being sprinkled through the layout.
 *
 * `afterInteractive` on every tag: measurement is not worth blocking first
 * paint for. The tenant sites spent a whole phase cutting render-blocking
 * weight, and loading these in the head would hand a measurable part of it
 * straight back. The tradeoff accepted here is that a visitor who leaves
 * within the first moment may go uncounted — the right side of that trade
 * for a marketing site.
 *
 * Renders nothing at all when no id is configured, which is the default
 * state for every tenant: no script tags, no empty dataLayer, no cost.
 *
 * INJECTION SAFETY: every interpolated id is re-normalized inside the two
 * `build*InlineScript` functions, which admit only `[A-Z0-9-]`. React does
 * not escape inline script bodies, so that normalization — not escaping —
 * is what makes this safe. Never interpolate a raw Site value here.
 */
export function AnalyticsScripts({
  site,
}: {
  site: AnalyticsSiteFields | null | undefined;
}) {
  const resolved = resolveAnalytics(site);
  const metaPixelScript = resolved.metaPixelId
    ? buildMetaPixelInlineScript(resolved.metaPixelId)
    : null;

  if (!resolved.gtagBootstrapId && !metaPixelScript) return null;

  return (
    <>
      {resolved.gtagBootstrapId && (
        <>
          {/* ONE loader for both Google products — GA4 and Ads are the same
              gtag.js library with different config targets, and loading it
              twice double-executes the loader and can drop events. */}
          <Script
            id="gtag-loader"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${resolved.gtagBootstrapId}`}
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {buildGtagInlineScript(resolved)}
          </Script>
        </>
      )}

      {metaPixelScript && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {metaPixelScript}
        </Script>
      )}
    </>
  );
}
