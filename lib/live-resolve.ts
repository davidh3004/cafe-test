/**
 * Pure live/preview-divide resolvers for the DEPLOYED per-tenant theme-site.
 *
 * The deployed public site must render STRICTLY through `Site.liveTheme` (D-04,
 * MT-04): only the template BOUND to the current live theme is rendered, and the
 * loaded bundle is the live theme's own bundle. Both resolvers here are PURE
 * (no network, no side effects) so they can be unit-pinned:
 *   - resolvePageForLiveTheme(page, site) → the page narrowed to its liveTheme-bound
 *     template, or null (D-06 missing binding → 404 / D-04 unset liveTheme → nothing).
 *   - resolveLiveBundle(site, env) → { themeBundleUrl, themeName } resolved at
 *     request time from Site.liveTheme.builtAssetUrl/name, env vars as fallback.
 */

/** A theme-binding carried by a template: which theme this template belongs to. */
interface LiveThemeRef {
  documentId: string;
  name?: string | null;
  builtAssetUrl?: string | null;
  /**
   * ISO datetime written by the platform's deploy status callback the moment
   * a rebuild lands (Strapi `Theme.lastDeployedAt`), beside `builtAssetUrl`.
   * This is the D-05/D-06 cache-bust token: `deploymentUrl` (and therefore
   * `builtAssetUrl`) is a STABLE per-tenant alias
   * (`https://${subdomain}.vercel.app/...`), byte-identical across every
   * rebuild, so it cannot bust a browser cache on its own. Only present when
   * a real deploy has recorded one; absent/null degrades to no version query
   * (17-06's header rules deliberately give that un-versioned URL a
   * revalidating cache rather than an `immutable` one).
   */
  lastDeployedAt?: string | null;
}

interface LiveSite {
  documentId?: string;
  liveTheme?: LiveThemeRef | null;
}

/**
 * A bound template as returned by the theme-filtered query. Shape is intentionally
 * loose: Strapi may return `theme` as a single object, and `sections` is repeatable.
 */
interface BoundTemplate {
  documentId?: string;
  theme?: { documentId?: string | null } | null;
  sections?: unknown[];
  [key: string]: unknown;
}

/**
 * A theme-agnostic page (one slug) carries an ARRAY of theme-scoped templates
 * (manyToMany, D-14) — but legacy/snake/camel shapes may surface a single object.
 * We accept either `page_template` (snake, the canonical attribute) or
 * `pageTemplate` (camel), and either an array or a single template, mirroring the
 * dashboard precedent `page.page_template ?? page.pageTemplate`.
 */
interface LivePage {
  documentId?: string;
  slug?: string;
  page_template?: unknown;
  pageTemplate?: unknown;
}

/** Coerce the (snake|camel, array|single) page_template into a flat array. */
function templatesOf(page: LivePage): BoundTemplate[] {
  const raw =
    (page?.page_template as BoundTemplate | BoundTemplate[] | null | undefined) ??
    (page?.pageTemplate as BoundTemplate | BoundTemplate[] | null | undefined) ??
    null;
  if (raw == null) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * D-05: pick the ONE template bound to the current live theme so the SAME slug
 * renders a DIFFERENT template per theme. The JS filter here is AUTHORITATIVE —
 * correctness does NOT depend on Strapi honoring the inline relation filter (A2):
 * even if the query returns templates from other themes, only the liveTheme-bound
 * one is selected.
 *
 * Returns null when:
 *   - site.liveTheme is unset (D-04: nothing renders publicly), or
 *   - no bound template matches the live theme (D-06: missing binding → 404).
 * Otherwise returns the page narrowed so its effective `page_template` is that
 * single bound template (sections preserved).
 */
export function resolvePageForLiveTheme<P extends LivePage>(
  page: P | null | undefined,
  site: LiveSite | null | undefined
): P | null {
  if (!page) return null;
  const liveThemeId = site?.liveTheme?.documentId;
  if (!liveThemeId) return null; // D-04: no live theme → nothing public

  const bound = templatesOf(page).find(
    (tmpl) => tmpl?.theme?.documentId === liveThemeId
  );
  if (!bound) return null; // D-06: missing binding → 404, no cross-theme fallback

  // Narrow the page to the single live-theme-bound template. Normalize to the
  // snake-case attribute the renderer reads, and drop the camel alias so the
  // narrowed shape is unambiguous downstream.
  const { pageTemplate: _drop, ...rest } = page;
  void _drop;
  return {
    ...(rest as P),
    page_template: bound,
  };
}

interface BundleEnv {
  NEXT_PUBLIC_THEME_BUNDLE_URL?: string;
  NEXT_PUBLIC_THEME_NAME?: string;
  /**
   * Operator-supplied absolute override for the CRITICAL stylesheet URL. When
   * set to a non-empty string it wins over the derived `theme.bundle.css`
   * URL and is returned WITHOUT a version token — it is a URL the operator
   * owns and manages the lifecycle of, not an artifact this resolver versions.
   */
  NEXT_PUBLIC_THEME_CSS_URL?: string;
  [key: string]: string | undefined;
}

interface ResolvedBundle {
  themeBundleUrl: string | undefined;
  themeName: string;
  /**
   * URL of the CRITICAL (render-blocking) theme stylesheet, derived from the
   * SAME resolved themeBundleUrl (theme.bundle.js -> theme.bundle.css) under
   * the fixed platform-wide naming convention, with
   * `NEXT_PUBLIC_THEME_CSS_URL` as an operator override. `undefined` when
   * themeBundleUrl is undefined or does not end in `.js` (mirrors
   * themeCssDeferredUrl's own guard below).
   */
  themeCssUrl: string | undefined;
  /**
   * URL of the non-blocking deferred CSS chunk, derived from the SAME resolved
   * themeBundleUrl (theme.bundle.js -> theme.bundle.deferred.css). This is a
   * FIXED, platform-wide naming convention shared with Plan 05 (theme repo,
   * `createCssSplitPlugin`'s `this.emitFile({ fileName: 'theme.bundle.deferred.css' })`) —
   * both sides derive/emit this exact string independently, with no shared
   * runtime config between the two repos. `undefined` when themeBundleUrl is
   * undefined or does not end in `.js` (D-05/D-06/D-07).
   */
  themeCssDeferredUrl: string | undefined;
}

/**
 * Appends the D-05/D-06 cache-bust token to a resolved URL. Returns the URL
 * UNCHANGED when either the URL or the token is absent, so an un-versioned
 * tenant (no `lastDeployedAt` yet) sees byte-identical output to before this
 * helper existed. Joins with `?` when the URL carries no query string yet and
 * with `&` when it already does (an operator-supplied bundle URL may already
 * have one), and percent-encodes the token since an ISO timestamp's colons
 * are not valid bare query-value characters.
 */
function appendVersionToken(
  url: string | undefined,
  token: string | undefined
): string | undefined {
  if (!url || !token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(token)}`;
}

/**
 * Finding 4 / Open Q3 (RESOLVED): resolve the public bundle at REQUEST TIME from
 * Site.liveTheme.builtAssetUrl / name so switching Site.liveTheme to a DIFFERENT
 * theme swaps the rendered bundle with NO redeploy. The env vars remain the
 * fallback for the migration window / single-theme tenant.
 *
 * NOTE: `themeName` MUST be the live theme's registration name — the
 * `__THETA_THEMES__` key (THEME-01 canonical Theme.name), NOT the slug. The
 * loader keys the bundle module on this name.
 *
 * Pure: no network, no side effects.
 */
export function resolveLiveBundle(
  site: LiveSite | null | undefined,
  env: BundleEnv | null | undefined
): ResolvedBundle {
  const liveTheme = site?.liveTheme ?? null;
  const e = env ?? {};

  // ---- Phase one: resolve the RAW bundle URL and theme name, exactly as
  // before this token was introduced. Nothing below this phase is versioned
  // yet. ----
  const rawBundleUrl = liveTheme?.builtAssetUrl ?? e.NEXT_PUBLIC_THEME_BUNDLE_URL;
  const themeName = liveTheme?.name ?? e.NEXT_PUBLIC_THEME_NAME ?? "default";

  // ---- Phase two: derive BOTH stylesheet URLs from the RAW, UNVERSIONED
  // bundle URL. PHASE ORDER IS LOAD-BEARING (D-06's named trap): the
  // derivation below is a `.js` -> `.css`/`.deferred.css` suffix swap with a
  // no-op guard that treats a failed swap as `undefined`. If the version
  // token were applied BEFORE this phase, the bundle URL would no longer end
  // in `.js` (it would end in `...js?v=...`), the swap would silently fail,
  // and the no-op guard would discard the deferred stylesheet — restoring
  // the full render-blocking CSS this milestone worked to split, with the
  // page still working and nobody noticing. ----
  const rawCriticalCssUrl = rawBundleUrl
    ? rawBundleUrl.replace(/\.js$/i, ".css")
    : undefined;
  // Defensive: only a genuine `.js` -> `.css` swap counts. If the resolved
  // URL didn't actually end in `.js` (misconfigured env var already pointing
  // at a `.css`/other asset), the replace above is a no-op and would emit a
  // URL identical to the bundle URL — treat as undefined.
  const safeCriticalCssUrl =
    rawCriticalCssUrl !== rawBundleUrl ? rawCriticalCssUrl : undefined;

  const rawDeferredCssUrl = rawBundleUrl
    ? rawBundleUrl.replace(/\.js$/i, ".deferred.css")
    : undefined;
  // Same defensive no-op guard as above, for the deferred chunk.
  const safeDeferredCssUrl =
    rawDeferredCssUrl !== rawBundleUrl ? rawDeferredCssUrl : undefined;

  // `NEXT_PUBLIC_THEME_CSS_URL` is an operator-supplied absolute override for
  // the critical stylesheet URL — it wins over the derived value and, being
  // an operator-owned URL rather than a platform artifact, is returned
  // WITHOUT a version token (see phase three below).
  const cssOverride = e.NEXT_PUBLIC_THEME_CSS_URL;
  const hasCssOverride = typeof cssOverride === "string" && cssOverride.trim() !== "";

  // ---- Phase three: apply the version token, and ONLY now. Accept
  // `lastDeployedAt` only when it is a non-empty string after trimming — an
  // absent/null/empty/non-string value means no `v` parameter is appended
  // anywhere, and every returned URL is byte-identical to the pre-token
  // output (this degrade path is intentional: 17-06's header rules
  // deliberately give an un-versioned URL a revalidating cache rather than
  // an `immutable` one). ----
  const rawToken = liveTheme?.lastDeployedAt;
  const token =
    typeof rawToken === "string" && rawToken.trim() !== "" ? rawToken : undefined;

  return {
    themeBundleUrl: appendVersionToken(rawBundleUrl, token),
    themeName,
    themeCssUrl: hasCssOverride
      ? cssOverride
      : appendVersionToken(safeCriticalCssUrl, token),
    themeCssDeferredUrl: appendVersionToken(safeDeferredCssUrl, token),
  };
}
