/**
 * Redirect click reporting for the tenant's Edge middleware (REQ-2).
 *
 * Owns the bot filter and the fire-and-forget beacon to the platform's
 * `/api/redirect-clicks`. Deliberately does NOT import `./strapi-client`,
 * for the same reason `redirect-resolve.ts` does not — this runs in the Edge
 * bundle on every matched request.
 *
 * The counting model is deliberately narrow: counts only, bucketed by day on
 * the receiving end. This module sends a team id and the matched source path
 * and nothing else — no visitor id, no IP, no referrer, no user-agent
 * string. The UA is read here and immediately discarded.
 *
 * WHAT THESE NUMBERS ARE, precisely, so nobody reads more into them than
 * they carry: a count of requests that reached this middleware and were
 * redirected. They are NOT unique visitors, and they systematically
 * undercount any redirect a browser has cached — which is why a tracked
 * redirect is forced to 302 in `buildRedirectMap`. They will also disagree
 * with the destination site's own analytics, which measure a different
 * event at a different point.
 */

import { reportSeoDegrade } from "./seo-report";

/** Bounds the beacon independently of every other timeout in this template.
 * It rides `waitUntil`, so this caps how long the isolate is kept alive
 * after the response, never how long the visitor waits. */
export const CLICK_BEACON_TIMEOUT_MS = 2000;

/**
 * Known-crawler user-agent filter.
 *
 * Deliberately a coarse substring/keyword match rather than a bot-detection
 * library or a fingerprinting service. A redirect source is a real, often
 * indexed URL, so it gets crawled a lot — and without any filter the counts
 * are visibly, embarrassingly wrong ("400 clicks" on a link nobody shared).
 * This gets them to roughly right, which is the honest ceiling for
 * server-side counting anyway.
 *
 * A missing or empty UA counts as a bot: every real browser sends one, and
 * the things that don't are overwhelmingly scripted.
 *
 * This will not catch a crawler that impersonates a browser UA, and it is
 * not trying to — that is an arms race this feature has no reason to enter.
 */
const BOT_UA_PATTERN =
  /bot|crawler|crawling|spider|scraper|slurp|curl|wget|python-requests|axios|okhttp|headless|lighthouse|pagespeed|preview|monitor|uptime|pingdom|facebookexternalhit|whatsapp|telegram|discord|slackbot|twitterbot|linkedinbot|embedly|quora link preview|bitlybot|applebot|ia_archiver|semrush|ahrefs|mj12|dotbot|petalbot|yandex|baidu|duckduck|bingpreview|google(?!\s*chrome)/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (userAgent == null) return true;
  const trimmed = userAgent.trim();
  if (trimmed === "") return true;
  return BOT_UA_PATTERN.test(trimmed);
}

/**
 * True when this request should be counted. Split out from the beacon so the
 * decision is testable without a fetch, and so middleware reads as one
 * predicate rather than a chain of inline conditions.
 */
export function shouldCountClick(
  trackClicks: boolean,
  userAgent: string | null | undefined
): boolean {
  return trackClicks && !isBotUserAgent(userAgent);
}

/**
 * Fire-and-forget POST to the platform's ingest route. NEVER throws and
 * never returns a rejected promise — a click that goes uncounted is an
 * acceptable loss; a redirect that fails because a counter was down is not.
 *
 * The caller hands this to `event.waitUntil()`, so it runs after the
 * redirect response has already been returned to the visitor. Nothing here
 * is on the critical path.
 *
 * Silently no-ops when unconfigured. An existing tenant deployed before
 * these env vars existed simply does not report, exactly as it did before —
 * this is the same "not a provisioned instance" posture `redirect-resolve`
 * takes for an absent Strapi URL, and it is why no degrade is reported for
 * the unconfigured case specifically.
 */
export async function reportRedirectClick(source: string): Promise<void> {
  const endpoint = process.env.CLICK_TRACKING_URL;
  const secret = process.env.REVALIDATE_SECRET;
  const teamId = process.env.CLICK_TRACKING_TEAM_ID;

  if (!endpoint || !secret || !teamId) return;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": secret,
      },
      body: JSON.stringify({ teamId, source }),
      signal: AbortSignal.timeout(CLICK_BEACON_TIMEOUT_MS),
      // Never let a counter write sit in any cache layer.
      cache: "no-store",
    });

    if (!response.ok) {
      reportSeoDegrade("redirect-click-report-failed", "middleware", {
        status: response.status,
        source,
      });
    }
  } catch (err) {
    reportSeoDegrade("redirect-click-report-failed", "middleware", {
      message: err instanceof Error ? err.message : String(err),
      source,
    });
  }
}
