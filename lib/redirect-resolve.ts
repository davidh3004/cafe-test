/**
 * Pure redirect resolution + module-scope TTL cache for the tenant template's
 * Edge `middleware.ts` (Phase 16 Plan 01).
 *
 * This module owns BOTH the pure resolution logic and the network fetch,
 * mirroring how `theme-evaluator.ts` owns both. It deliberately does NOT
 * import `./strapi-client` — that module is ~900 lines, imports React's
 * `cache` (a no-op in middleware) and `./live-resolve`, and would drag all of
 * it into the Edge bundle for a query that selects three scalars. The base-URL
 * normalisation and query-shape conventions are mirrored here instead
 * ("mirror, don't import" — this codebase's established two-app precedent).
 *
 * Page-size reconciliation (D-07, closing 16-RESEARCH.md Pitfall 1): D-07's
 * literal "~500" is stale. `project-theta-strapi/config/plugins.ts` already
 * sets `graphql.maxLimit: 200`, and `@strapi/utils`'s `withMaxLimit`
 * truncates a larger request SILENTLY — reproducing the exact class of bug
 * D-07 exists to prevent, just moved from row 11 to row 201. This module sets
 * `REDIRECT_PAGE_SIZE = 200` to match the config that is actually enforced,
 * and Plan 02's authoring-time cap is pinned to the same constant. Do NOT
 * "restore" 500 — raising `maxLimit` was considered and rejected because it
 * widens the maximum page size every query against every content type in
 * every tenant may request, for one content type's benefit.
 *
 * D-10 reserved-source deny-list: `RESERVED_SOURCE_PATHS` /
 * `RESERVED_SOURCE_PREFIXES` and the `middleware.ts` `config.matcher`
 * express overlapping intent in two places and can drift. This module is the
 * single source of truth for the SEMANTICS — `isReservedSource` refuses to
 * match reserved sources at request time regardless of what the matcher lets
 * through. The matcher is a Next.js-mandated static literal that cannot read
 * a constant. Plan 02's dashboard-side mirror of these two lists is pinned to
 * this module by an equality assertion in a test.
 */

import { reportSeoDegrade } from "./seo-report";

/** D-05: "short, ~30s". Mirrors the render routes' `revalidate = 10` ISR window as the nearest precedent, widened because this cache serves EVERY request, not a background regeneration. */
export const REDIRECT_MAP_TTL_MS = 30_000;

/** Bounds the redirect-map fetch independently of any other timeout in this template, so a hung Strapi cannot stall the request middleware is enforcing on (T-16-03). */
export const REDIRECT_FETCH_TIMEOUT_MS = 1500;

/** See the page-size reconciliation note in the module header — matches `graphql.maxLimit: 200` in the Strapi repo's `config/plugins.ts`, not D-07's stale "~500". */
export const REDIRECT_PAGE_SIZE = 200;

/** D-10 deny-list: exact-match reserved sources. A redirect can never shadow any of these even if such a row exists in Strapi. */
export const RESERVED_SOURCE_PATHS = ["/", "/sitemap.xml", "/robots.txt"] as const;

/** D-10 deny-list: prefix-match reserved sources (`/_next/*`, `/api/*`). */
export const RESERVED_SOURCE_PREFIXES = ["/_next", "/api"] as const;

/** The raw Strapi shape returned by the `GetRedirects` operation. */
export interface RedirectRow {
  documentId: string;
  source: string;
  destination: string;
  redirectType?: string | null;
  trackClicks?: boolean | null;
}

/** A resolved, emission-ready redirect rule. */
export interface RedirectRule {
  destination: string;
  status: 301 | 302;
  /** REQ-2: whether middleware should beacon a click for this rule. Always a
   * real boolean on a built rule, never undefined, so the middleware never
   * has to decide what an absent value means. */
  trackClicks: boolean;
}

/** The built map, keyed by source. */
export type RedirectMap = Record<string, RedirectRule>;

/**
 * The enum-to-number conversion boundary (D-02). Pure, so the "never NaN,
 * never undefined" contract is directly testable. Returns 301 for the
 * permanent value and for anything unrecognised, including `undefined` and
 * `null` — an absent or malformed value never blocks a redirect from
 * emitting, it just assumes the safer (non-idempotent-cache-friendly)
 * permanent default.
 */
export function httpStatusForRedirectType(
  value: string | null | undefined
): 301 | 302 {
  return value === "temporary" ? 302 : 301;
}

/**
 * REQ-2: the emitted status for a rule, with click tracking taken into
 * account. A tracked redirect is ALWAYS 302, whatever `redirectType` says.
 *
 * This is not a preference, it is what makes the counter mean anything. A
 * 301 is cached by the browser, so the second and every subsequent click by
 * the same visitor never reaches this middleware and is never counted. The
 * undercount is not random noise either — it scales with how loyal the
 * audience is, so the more a link actually works, the more the number
 * understates it. A counter that is wrong in proportion to success is worse
 * than no counter.
 *
 * The dashboard makes the same substitution visible at authoring time by
 * locking the type control while the toggle is on, so the stored
 * `redirectType` and the emitted status can never silently disagree in a way
 * the client cannot see. Turning tracking off restores the stored value —
 * which is why this overrides rather than rewrites `redirectType`.
 */
export function httpStatusForRule(
  redirectType: string | null | undefined,
  trackClicks: boolean
): 301 | 302 {
  return trackClicks ? 302 : httpStatusForRedirectType(redirectType);
}

/**
 * True when `source` is reserved under the D-10 deny-list — either an exact
 * match in `RESERVED_SOURCE_PATHS`, or equal to / nested under a
 * `RESERVED_SOURCE_PREFIXES` entry. `/apiary` and `/_nextgen` are NOT
 * reserved: the prefix match requires the next character to be `/` (or an
 * exact match), not merely a shared string prefix.
 */
export function isReservedSource(source: string): boolean {
  if ((RESERVED_SOURCE_PATHS as readonly string[]).includes(source)) {
    return true;
  }
  return RESERVED_SOURCE_PREFIXES.some(
    (prefix) => source === prefix || source.startsWith(`${prefix}/`)
  );
}

/**
 * The emission-side half of D-11's open-redirect closure (T-16-01). True only
 * when `destination` starts with `/`, is at least two characters, and whose
 * second character is neither `/` nor `\` — rejecting protocol-relative
 * `//evil.com` and the backslash forms browsers normalise into a
 * protocol-relative URL, both of which pass a naive "starts with /" check.
 *
 * CR-01: the prefix inspection runs on a copy with ASCII TAB (U+0009), LF
 * (U+000A) and CR (U+000D) removed, because the WHATWG URL parser strips
 * exactly those three code points from its input BEFORE resolving. Without
 * this, `/<TAB>/evil.com` has a second character of TAB — neither `/` nor
 * `\` — so it reads as internal here, and then `new URL(destination, base)`
 * in middleware.ts collapses it back to `//evil.com` and resolves it to
 * `https://evil.com`. Strip-then-check keeps this guard's verdict aligned
 * with what the URL parser will actually do with the same string.
 */
export function isInternalDestination(destination: string): boolean {
  const stripped = destination.replace(/[\t\n\r]/g, "");
  if (!stripped.startsWith("/") || stripped.length < 2) {
    return false;
  }
  const second = stripped[1];
  return second !== "/" && second !== "\\";
}

/**
 * The emission-side half of the external-destination allowance. Mirrors
 * `lib/redirects/validate.ts`'s `isExternalDestination` exactly (mirror,
 * don't import — see the module header); the two are pinned together by
 * `__tests__/lib/redirect-pagination-cap.test.ts`.
 *
 * True only for an explicitly DECLARED `https://` URL. D-11 is NOT repealed
 * by this function — it is narrowed. The open redirect D-11 closed was a
 * destination that reads as an internal path and only becomes off-origin
 * once the URL parser sees it (`//evil.com`, `/\evil.com`,
 * `/<TAB>/evil.com`); every one of those is still rejected here and in
 * `isInternalDestination`. What is newly permitted is the case where the
 * author typed a full URL, saw it in the field, and meant it.
 *
 * Rejects any value carrying ASCII TAB/LF/CR outright (the internal guard
 * strips-then-checks because a path may legitimately be typed with stray
 * whitespace; an external URL may not, so the stored bytes can never differ
 * from what the URL parser resolves), anything not literally prefixed
 * `https://` — `http://` included, so a redirect off this site is never an
 * insecure hop — anything unparseable or host-less, and anything carrying
 * embedded credentials, whose real authority is the part after the `@`.
 */
export function isExternalDestination(destination: string): boolean {
  if (/[\t\n\r]/.test(destination)) return false;
  if (!/^https:\/\//i.test(destination)) return false;

  let parsed: URL;
  try {
    parsed = new URL(destination);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;
  if (parsed.hostname === "") return false;
  if (parsed.username !== "" || parsed.password !== "") return false;

  return true;
}

/**
 * The union `buildRedirectMap` gates on. Kept as its own named export so the
 * emission-side rule has exactly one name, and so the pin test can compare
 * both trees' full verdicts rather than only their two halves.
 */
export function isAllowedDestination(destination: string): boolean {
  return isInternalDestination(destination) || isExternalDestination(destination);
}

/**
 * Pure. Builds the request-time lookup map from raw Strapi rows. Trims each
 * row's source and destination; skips a row whose source or destination is
 * blank after trimming, whose source is reserved (T-16-02), or whose
 * destination is neither an internal path nor a declared `https://` URL
 * (T-16-01, narrowed — see `isExternalDestination`). Assigns into a plain
 * object keyed by
 * source, so a duplicate source deterministically resolves last-wins in
 * input order — no explicit ordering logic needed, later assignments simply
 * overwrite earlier ones. Never throws for a malformed row.
 */
export function buildRedirectMap(rows: readonly RedirectRow[]): RedirectMap {
  const map: RedirectMap = {};
  for (const row of rows) {
    if (row == null || typeof row !== "object") continue;
    const source = typeof row.source === "string" ? row.source.trim() : "";
    const destination =
      typeof row.destination === "string" ? row.destination.trim() : "";
    if (source === "" || destination === "") continue;
    if (isReservedSource(source)) continue;
    if (!isAllowedDestination(destination)) continue;
    const trackClicks = row.trackClicks === true;
    map[source] = {
      destination,
      status: httpStatusForRule(row.redirectType, trackClicks),
      trackClicks,
    };
  }
  return map;
}

/**
 * Pure, never throws. One equality basis: byte-exact comparison of
 * `pathname` against the stored source string — no decoding, no case
 * folding, no trailing-slash coercion. A second normalisation here would
 * silently disagree with what the authoring form stored.
 */
export function resolveRedirect(
  pathname: string,
  map: RedirectMap | null | undefined
): RedirectRule | null {
  if (map == null) return null;
  return map[pathname] ?? null;
}

const GET_REDIRECTS_QUERY = `
  query GetRedirects {
    redirects(pagination: { pageSize: ${REDIRECT_PAGE_SIZE} }) {
      documentId
      source
      destination
      redirectType
      trackClicks
    }
  }
`;

/**
 * Mirrors `strapi-client.ts`'s `normalizeUrl` behaviour locally rather than
 * importing it, per the module header's "mirror, don't import" rationale.
 */
function normalizeBaseUrl(url: string): string {
  if (!url || url.trim() === "") return "";
  if (/^https?:\/\//.test(url)) return url;
  const isLocal =
    /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|\.local)/.test(
      url
    );
  return `${isLocal ? "http" : "https"}://${url}`;
}

/**
 * The single module-scope cache slot (one tenant, one map — no per-key
 * variance, so a `Map` is unnecessary) plus the single in-flight promise that
 * de-duplicates concurrent cold/expired callers. React's `cache()` must NOT
 * be used here — it is a no-op in the middleware execution context.
 */
let cachedEntry: { map: RedirectMap; fetchedAt: number } | null = null;
let inFlight: Promise<RedirectMap> | null = null;

/** Test-only seam: empties the cache and in-flight state so one test's state cannot leak into another. Not a production API. */
export function __resetRedirectCacheForTest(): void {
  cachedEntry = null;
  inFlight = null;
}

/**
 * Uncached fetch + build. Never caches on failure and never falls back to a
 * previously-cached map: D-03 explicitly rejects last-known-good because a
 * deleted redirect would otherwise outlive its own deletion during a CMS
 * outage. Never throws.
 */
async function fetchRedirectMap(): Promise<RedirectMap> {
  const rawBaseUrl = process.env.NEXT_PUBLIC_STRAPI_URL || "";
  const token = process.env.NEXT_PUBLIC_STRAPI_TOKEN || "";
  const baseUrl = rawBaseUrl ? normalizeBaseUrl(rawBaseUrl) : "";

  if (!baseUrl || !token) {
    // Not a provisioned instance (e.g. local dev without env configured) —
    // no network call and no degrade report; this is expected, not a failure.
    return {};
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/graphql`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: GET_REDIRECTS_QUERY }),
      signal: AbortSignal.timeout(REDIRECT_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    reportSeoDegrade("redirect-map-fetch-failed", "middleware", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {};
  }

  if (!response.ok) {
    reportSeoDegrade("redirect-map-fetch-failed", "middleware", {
      message: `HTTP ${response.status}`,
    });
    return {};
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    reportSeoDegrade("redirect-map-fetch-failed", "middleware", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {};
  }

  const errors = (body as { errors?: unknown } | null)?.errors;
  if (errors != null) {
    reportSeoDegrade("redirect-map-fetch-failed", "middleware", {
      message: "GraphQL response contained errors",
    });
    return {};
  }

  const rows = (body as { data?: { redirects?: unknown } } | null)?.data
    ?.redirects;
  if (!Array.isArray(rows)) {
    reportSeoDegrade("redirect-map-fetch-failed", "middleware", {
      message: "Response body had no data.redirects array",
    });
    return {};
  }

  // Success: this is the ONLY path that populates the cache slot. Every
  // failure branch above returns {} WITHOUT touching `cachedEntry`, so a
  // failed refresh never overwrites a still-fresh entry and never poisons an
  // expired one with a fabricated "successful" empty result — the very next
  // call re-evaluates the (still-expired) TTL and retries (D-03).
  const map = buildRedirectMap(rows as RedirectRow[]);
  cachedEntry = { map, fetchedAt: Date.now() };
  return map;
}

/**
 * The public entry point. Returns the cached map when
 * `Date.now() - fetchedAt < REDIRECT_MAP_TTL_MS`; otherwise awaits an
 * existing in-flight fetch or starts one. `fetchRedirectMap` is the only
 * writer of `cachedEntry`, and only on its success path (see above) — this
 * function never writes the cache itself, so a failed fetch cannot be
 * mistaken for a fresh one.
 */
export async function getRedirectMap(): Promise<RedirectMap> {
  if (cachedEntry && Date.now() - cachedEntry.fetchedAt < REDIRECT_MAP_TTL_MS) {
    return cachedEntry.map;
  }

  if (inFlight) {
    return inFlight;
  }

  const promise = fetchRedirectMap().finally(() => {
    inFlight = null;
  });

  inFlight = promise;
  return promise;
}
