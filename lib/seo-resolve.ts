/**
 * Pure page-metadata resolvers for the DEPLOYED per-tenant theme-site (Phase 14).
 *
 * Mirrors `lib/live-resolve.ts`: every export here is PURE (no network, no
 * side effects, never throws) so each can be unit-pinned against synthetic
 * Strapi objects. This module is the SINGLE seam every consumer derives an
 * origin, a locale, a canonical path, or an alternates map from — the root
 * layout (Plan 03), `sitemap.ts` and `robots.ts` (Plan 04) all call
 * `resolveSiteOrigin` rather than re-deriving it (RESEARCH.md's anti-pattern
 * list names re-deriving it per consumer explicitly).
 *
 *   - resolveSiteOrigin(site, env) → the tenant's own origin, D-05 precedence
 *     (Site.siteUrl first, then the deploy-time env fallback, else null).
 *     Takes `env` as a PARAMETER — never reads the global runtime environment
 *     itself — so no request-controlled value (the Host header) can ever
 *     reach it (D-07).
 *   - resolveLocale(site) → the tenant's resolved BCP-47 locale, or the
 *     documented `en` default. Never throws, never returns blank (D-11).
 *   - resolveCanonicalPath(page) → `"/"` for the homepage, `"/{slug}"`
 *     otherwise, branching ONLY on `page.isHomepage` (D-08) — never on which
 *     route invoked the metadata builder, since `/` and `/{homepage-slug}`
 *     can pass the identical slug string.
 *   - absoluteUrl(origin, path) → the AMENDED D-15/discretion-3 policy
 *     (supersedes the original "{origin}/" wording, Phase 14 Plan 07,
 *     G-14-5): the site root resolves to the bare `{origin}`, with NO
 *     trailing slash — identical in form to every other path's
 *     `{origin}/{slug}`. Forced by Next itself:
 *     `resolveAbsoluteUrlWithPathname` in
 *     `node_modules/next/dist/lib/metadata/resolvers/resolve-url.js`
 *     collapses any root-pathname URL to the bare origin under the default
 *     `trailingSlash: false`, and only re-appends a slash when that config
 *     flag is enabled. The sitemap serializer (Next's `resolveSitemap`)
 *     interpolates each entry's `url` into `<loc>` completely verbatim, with
 *     no normalization of its own — so the sitemap and the rendered
 *     canonical only agree when this resolver emits the exact bytes Next
 *     will render. Restoring the trailing slash on the root re-opens Phase
 *     14 UAT gap G-14-5 (the sitemap `<loc>` disagreeing with the rendered
 *     canonical). No re-encoding, no decoding, no case folding.
 *   - buildLanguageAlternates(locale, canonical) → the D-10 self-referential
 *     hreflang pair: the resolved locale plus `x-default`, both the
 *     canonical URL.
 *   - resolveShareImage(shareImage, strapiBaseUrl) → absolutizes a Strapi
 *     media URL against the CMS host (never the site origin — Strapi's
 *     upload `url` is relative to the CMS, not the tenant's own domain), or
 *     null when unresolvable. Real dimensions only, never guessed (D-03).
 *   - buildPageMetadataFrom(page, site, env) → the full Next `Metadata`
 *     object. Description resolves through a two-tier chain — trimmed
 *     `page.seo.description`, then the site default resolved via
 *     `resolveSiteDefaults(site).description` — omitting the key entirely
 *     when both are blank (SEOED-06, D-10). Title has NO site-level tier: it
 *     hard-falls-back to `page.title` only, unchanged from Phase 14 — D-10's
 *     asymmetry is deliberate, not an oversight.
 */

import type { Metadata } from "next";
import { normalizeUrl } from "./strapi-client";
import type { StrapiPage, StrapiSite, StrapiSeoImage } from "./strapi-client";

/** The documented locale default (D-11: never blank, never a throw). */
export const DEFAULT_LOCALE = "en";

/** Title emitted for a null slug, a missing page, or an unpublished page. */
export const NOT_FOUND_TITLE = "Page Not Found";

/** Env shape `resolveSiteOrigin`/`buildPageMetadataFrom` read from — passed
 * in explicitly by the caller, never read from the global runtime
 * environment in this file. */
export interface SeoEnv {
  NEXT_PUBLIC_SITE_SUBDOMAIN?: string;
  VERCEL_CUSTOM_DOMAIN?: string;
  NEXT_PUBLIC_STRAPI_URL?: string;
  [key: string]: string | undefined;
}

/** The narrow site shape `resolveSiteOrigin` needs. */
interface OriginSite {
  siteUrl?: string | null;
}

/** The narrow site shape `resolveLocale` needs. */
interface LocaleSite {
  siteLocale?: string | null;
}

/** The narrow site shape `resolveSiteTitleTemplate` needs. */
interface TitleTemplateSite {
  titleTemplate?: string | null;
}

/** The narrow site shape `resolveVerification` needs. */
interface VerificationSite {
  verificationGoogle?: string | null;
  verificationBing?: string | null;
  verificationYandex?: string | null;
}

/** The narrow site shape `resolveSiteDefaults`/`buildSiteMetadataFrom` need. */
interface DefaultsSite extends OriginSite {
  name?: string | null;
  seo?: { title?: string | null; description?: string | null } | null;
}

/**
 * Site-level default title/description/site-name, present only when a
 * non-blank value exists (D-12). No key is ever emitted holding a blank or
 * whitespace-only string — an absent tag is better for a crawler than an
 * empty one. There is deliberately NO hard-coded final fallback for `title`:
 * every real page supplies its own title through `buildPageMetadataFrom`'s
 * page-title fallback, so a layout with neither a site name nor a
 * site-level SEO title simply emits no title at all. Re-adding any literal
 * default here is precisely the defect D-12 removes.
 */
export interface SiteDefaults {
  siteName?: string;
  title?: string;
  description?: string;
}

/** The narrow page shape `resolveCanonicalPath` needs. */
interface CanonicalPage {
  isHomepage?: boolean | null;
  slug?: string | null;
}

/** Slugs treated as the homepage when no page carries `isHomepage: true`. */
export const CONVENTIONAL_HOMEPAGE_SLUGS = ["home", "homepage", "index"];

export interface ResolvedShareImage {
  url: string;
  width?: number;
  height?: number;
}

/** A conservative BCP-47 shape: a 2-3 letter primary subtag optionally
 * followed by hyphen-separated 2-8 alphanumeric subtags. A value that fails
 * this check falls back to `DEFAULT_LOCALE` rather than being emitted —
 * an invalid `hreflang` is worse for a crawler than the documented default. */
const BCP47_SHAPE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

/**
 * Normalize a URL candidate and parse it, or return `null`. The single
 * validation path every URL-ish input in this module goes through — a value
 * that fails to parse, or whose protocol is neither http nor https, returns
 * `null` rather than propagating a value that would throw later inside a
 * `new URL()` call built directly into a `Metadata` object (D-07 / the
 * never-throw contract).
 */
function parseHttpUrl(candidate: string): URL | null {
  // Detect an explicit non-http(s) scheme BEFORE `normalizeUrl` gets a
  // chance to prepend "https://" onto it — `normalizeUrl`'s own protocol
  // check only recognizes `^https?:\/\//`, so an already-schemed value like
  // "ftp://acme.com" would otherwise be re-prefixed into a syntactically
  // valid but nonsensical nested-scheme URL ("https://ftp://acme.com",
  // which parses to the origin "https://ftp"). Reject it here instead.
  const explicitScheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(candidate);
  if (explicitScheme && !/^https?$/i.test(explicitScheme[1])) {
    return null;
  }

  const normalized = normalizeUrl(candidate);
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Validate and format a candidate down to a bare origin (no path, no
 * trailing slash) — what a canonical, `og:url`, hreflang or sitemap entry is
 * composed against.
 */
function validateAndFormatOrigin(candidate: string): string | null {
  return parseHttpUrl(candidate)?.origin ?? null;
}

/**
 * Validate a host COMPOSED from two separately-sourced parts (the deploy-time
 * `NEXT_PUBLIC_SITE_SUBDOMAIN` and its domain), rather than one authored value.
 *
 * SECURITY (security audit, sibling of code-review CR-02). `validateAndFormatOrigin`
 * reduces its input to `.origin`, which is correct for a whole authored URL but
 * catastrophic for a value INTERPOLATED into a larger host string: the interpolated
 * part can terminate the host early and hand the rest to a path, query, fragment or
 * userinfo. `NEXT_PUBLIC_SITE_SUBDOMAIN` carries `theme.subdomain`, a plain Strapi
 * string writable by any team member through the `UpdateTheme` mutation on the
 * `/api/graphql` allow-list. Observed collapses before this guard:
 *
 *   "evil.com/"  -> "https://evil.com/.vercel.app"  -> origin "https://evil.com"
 *   "evil.com#"  -> "https://evil.com#.vercel.app"  -> origin "https://evil.com"
 *   "evil.com?"  -> "https://evil.com?.vercel.app"  -> origin "https://evil.com"
 *   "evil.com\\" -> "https://evil.com\\.vercel.app" -> origin "https://evil.com"
 *
 * Each parses cleanly, so the D-07 promise that this resolver "returns null rather
 * than a guess on an unparseable value" did not cover them — they are not unparseable,
 * they are parseable into an attacker-chosen origin, which then becomes this tenant's
 * `metadataBase`, canonical, hreflang alternates, `og:url`, every sitemap `<loc>` and
 * the `robots.txt` `Sitemap:` line.
 *
 * The platform now also sanitizes the value before writing the env var
 * (`lib/deploy/naming.ts`), but this guard must stay: every tenant deployed before
 * that fix already has a raw value baked into its environment, and the template is
 * the only layer that can defend them without a redeploy. Defense in depth, not
 * duplication.
 *
 * Round trip: `https://${subdomain}.${domain}` must be byte-identical to its own
 * `.origin`. Anything that escaped the host position changes it.
 */
function validateAndFormatComposedOrigin(
  subdomain: string,
  domain: string
): string | null {
  const candidate = `https://${subdomain}.${domain}`;
  const url = parseHttpUrl(candidate);
  if (!url) return null;
  if (url.origin !== candidate) return null;
  return url.origin;
}

/**
 * Validate and format a candidate as a base URL, PRESERVING any path and
 * dropping any query/fragment, with trailing slashes stripped.
 *
 * Distinct from `validateAndFormatOrigin` on purpose: a Strapi instance can
 * legitimately be hosted on a subpath (`https://example.com/cms`), and
 * collapsing that to `.origin` would silently drop the `/cms` segment and
 * produce upload URLs that 404. The site origin has no such case — it is
 * always a bare origin — so the two must not share one function.
 */
function validateAndFormatBaseUrl(candidate: string): string | null {
  const url = parseHttpUrl(candidate);
  if (!url) return null;
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

/**
 * D-05 precedence: trimmed `site.siteUrl` first, then the env fallback built
 * from `NEXT_PUBLIC_SITE_SUBDOMAIN` plus `VERCEL_CUSTOM_DOMAIN` (defaulting
 * the domain to `vercel.app` when that env var is unset, matching what the
 * deploy route computes), then `null`. Takes `env` as a PARAMETER precisely
 * so no request-derived value can ever reach it — never the Host header
 * (D-07). A missing or unresolvable origin is never substituted with a
 * guessed, hardcoded, or another tenant's origin.
 */
export function resolveSiteOrigin(
  site: OriginSite | null | undefined,
  env: SeoEnv | null | undefined
): string | null {
  // D-05 step 1: the tenant's own stored origin wins when it validates.
  const storedUrl = site?.siteUrl?.trim();
  if (storedUrl) {
    const resolved = validateAndFormatOrigin(storedUrl);
    if (resolved) return resolved;
  }

  // D-05 step 2: the deploy-time subdomain env fallback.
  const e = env ?? {};
  const subdomain = e.NEXT_PUBLIC_SITE_SUBDOMAIN?.trim();
  if (subdomain) {
    const domain = e.VERCEL_CUSTOM_DOMAIN?.trim() || "vercel.app";
    const resolved = validateAndFormatComposedOrigin(subdomain, domain);
    if (resolved) return resolved;
  }

  // D-07: no origin resolves — the caller degrades gracefully, never guesses.
  return null;
}

/**
 * Trimmed `siteLocale`, validated against a conservative BCP-47 shape, else
 * `DEFAULT_LOCALE`. D-11's hard constraint: never throws, never returns
 * blank.
 */
export function resolveLocale(site: LocaleSite | null | undefined): string {
  const raw = site?.siteLocale?.trim();
  if (raw && BCP47_SHAPE.test(raw)) return raw;
  return DEFAULT_LOCALE;
}

/**
 * Reduces a stored verification value to a bare token (SITE-04, RESEARCH.md
 * Pitfall 6). This is the DEFENSIVE, emission-side twin of
 * `lib/seo/normalize-verification-token.ts` (Plan 15-02) — deliberate
 * duplication, not drift. `lib/seo/` (the dashboard) and
 * `templates/theme-site/lib/` (this file) are separate Next.js apps with no
 * shared runtime import path, and a value written through Strapi's own
 * admin UI, or by an older client, bypasses the dashboard's save-time
 * normalization entirely — D-02 already establishes exactly this "reject on
 * save AND ignore at emission" defense-in-depth posture for canonical URLs,
 * and the same posture applies here. Any edit to one implementation's rule
 * must be mirrored in the other; `seo-resolve.test.ts` pins both
 * implementations to the same behavior so a drift surfaces as a test
 * failure, not a silent divergence.
 *
 * Never throws: trim, `null` on blank, extract a `content` attribute value
 * from tag-shaped input (anything containing `<` or `>`), `null` when
 * tag-shaped input yields nothing extractable, otherwise the trimmed token.
 */
const CONTENT_ATTR_RE = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

export function normalizeVerificationToken(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes("<") || trimmed.includes(">")) {
    const match = CONTENT_ATTR_RE.exec(trimmed);
    const extracted = (match?.[1] ?? match?.[2] ?? "").trim();
    return extracted ? extracted : null;
  }

  return trimmed;
}

/**
 * SITE-01 read side: the trimmed `Site.titleTemplate`, or `undefined` for a
 * blank, whitespace-only, `null`, or absent value — matching
 * `resolveSiteOrigin`/`resolveLocale`'s "narrow per-function site
 * interface, safe default, never throws" convention.
 */
export function resolveSiteTitleTemplate(
  site: TitleTemplateSite | null | undefined
): string | undefined {
  const trimmed = site?.titleTemplate?.trim();
  return trimmed || undefined;
}

/**
 * SITE-04: builds Next's `verification` metadata block from the three raw
 * `Site.verification*` fields, each run through `normalizeVerificationToken`
 * first (Pitfall 6). `google` and `yandex` are Next's own first-class
 * `Verification` keys. Bing has NO first-class key — Next's `Verification`
 * type (confirmed by direct source read of
 * `next/dist/lib/metadata/types/metadata-types.d.ts`) only has `google`,
 * `yahoo`, `yandex`, `me` and a free-form `other` record, and
 * `VerificationMeta`'s tag generator silently ignores any key it does not
 * recognize — a `bing` property would simply never render, with no error
 * (RESEARCH.md Pitfall 5). Bing's token is therefore routed through
 * `other["msvalidate.01"]`, the tag name Bing Webmaster Tools actually
 * expects. Returns `undefined` when nothing survives — never an empty
 * object (matching this module's "absent key beats an empty one"
 * convention throughout).
 */
export function resolveVerification(
  site: VerificationSite | null | undefined
): Metadata["verification"] | undefined {
  const google = normalizeVerificationToken(site?.verificationGoogle);
  const bing = normalizeVerificationToken(site?.verificationBing);
  const yandex = normalizeVerificationToken(site?.verificationYandex);

  const result: Record<string, unknown> = {};
  if (google) result.google = google;
  if (yandex) result.yandex = yandex;
  if (bing) result.other = { "msvalidate.01": bing };

  return Object.keys(result).length > 0
    ? (result as Metadata["verification"])
    : undefined;
}

/**
 * D-12: the site-level default title, description and site name — a second
 * pure function in this module rather than logic inlined in `layout.tsx`
 * (Discretion 1), because a Server Component layout has no test harness in
 * this repo. `siteName` is the trimmed `site.name`. `title` is the trimmed
 * site-level `seo.title`, falling back to the trimmed `site.name` — the
 * site-level SEO title wins over the bare name. `description` is the
 * trimmed site-level `seo.description`, with no fallback. A key is present
 * ONLY when its resolved value is non-blank; a whitespace-only value is
 * treated exactly as unset, never emitted as a blank tag.
 *
 * There is deliberately no hard-coded final fallback for `title` (Discretion
 * 4): every real page already supplies its own title through
 * `buildPageMetadataFrom`'s page-title fallback, so a tenant with neither a
 * site name nor a site-level SEO title simply gets no layout-level title —
 * Next's own metadata merging lets the page's title win. Inventing a display
 * name (e.g. from the hostname) would be exactly the kind of invented data
 * this phase rejects elsewhere, and re-adding any literal string here is
 * precisely the defect D-12 removes.
 */
export function resolveSiteDefaults(
  site: DefaultsSite | null | undefined
): SiteDefaults {
  const result: SiteDefaults = {};

  const siteName = site?.name?.trim();
  if (siteName) result.siteName = siteName;

  const seoTitle = site?.seo?.title?.trim();
  const title = seoTitle || siteName;
  if (title) result.title = title;

  const description = site?.seo?.description?.trim();
  if (description) result.description = description;

  return result;
}

/**
 * The pure form of `resolveHomepageSlug()` — which page the site root `/`
 * actually serves, resolved from a page list with no I/O.
 *
 * Three tiers, in order: the `isHomepage` flag, then a conventionally-named
 * slug, then the first page. This MUST stay byte-identical in behavior to
 * `resolveHomepageSlug()` in `app/_lib/render-page.tsx`, which is what really
 * routes `/`. CONTEXT.md is explicit that D-08's canonical rule and D-15's
 * sitemap rule both need exactly this resolution, not just tier one: a tenant
 * with no page flagged `isHomepage` still serves content at `/`, and if the
 * canonical/sitemap only honored the flag, that root URL would declare a
 * canonical pointing elsewhere and would be missing from the sitemap — the
 * exact split link authority D-08 and D-15 exist to close.
 *
 * Returns `null` for an empty/absent page list.
 */
export function resolveHomepageSlugFrom(
  pages: CanonicalPage[] | null | undefined
): string | null {
  const list = pages ?? [];
  const homepage =
    list.find((p) => p?.isHomepage === true) ||
    list.find(
      (p) =>
        typeof p?.slug === "string" &&
        CONVENTIONAL_HOMEPAGE_SLUGS.includes(p.slug)
    );
  return homepage?.slug ?? list[0]?.slug ?? null;
}

/**
 * `"/"` when this page is the one the site root serves, else `"/" + page.slug`.
 *
 * Never branches on caller identity (D-08) — `buildPageMetadata` is invoked
 * from two call sites (`/` and `/{homepage-slug}`) that can pass the identical
 * slug string, so the decision reads only data: the page's own `isHomepage`
 * flag, or its slug matching the site's resolved homepage slug.
 *
 * `homepageSlug` is the value from `resolveHomepageSlugFrom(pages)`. Omitting
 * it falls back to flag-only behavior, which is correct only for a tenant that
 * flags its homepage explicitly — every in-repo caller passes it.
 */
export function resolveCanonicalPath(
  page: CanonicalPage,
  homepageSlug?: string | null
): string {
  if (page?.isHomepage === true) return "/";
  const slug = page?.slug;
  if (
    typeof slug === "string" &&
    typeof homepageSlug === "string" &&
    slug === homepageSlug
  ) {
    return "/";
  }
  return `/${slug ?? ""}`;
}

/**
 * AMENDED trailing-slash policy (Phase 14 Plan 07, G-14-5 — supersedes the
 * original discretion-3 wording that emitted `{origin}/` for the root): the
 * site root now resolves to the bare origin, with NO trailing slash,
 * identical in form to every other path. This is a deliberate, recorded
 * policy change, not an incidental edit.
 *
 * Why: Next does not offer a middle setting. Under the template's default
 * `trailingSlash: false`, `resolveAbsoluteUrlWithPathname`
 * (`node_modules/next/dist/lib/metadata/resolvers/resolve-url.js`) reduces
 * any URL whose pathname is the root to the bare `result.origin` before
 * rendering `alternates.canonical`, `og:url` and both hreflang alternates —
 * and re-appends a slash only when `trailingSlash` is enabled. Meanwhile
 * Next's sitemap serializer (`resolveSitemap`) interpolates each entry's
 * `url` into `<loc>` verbatim, applying no normalization whatsoever. So the
 * sitemap and the rendered canonical only agree when this function emits
 * the same bare-origin bytes Next will actually render — matching what Next
 * renders is the minimal fix, touching exactly one expression and only the
 * root URL.
 *
 * Flipping `templates/theme-site/next.config.ts`'s `trailingSlash` instead
 * was considered and REJECTED: it would append a slash to every NON-root
 * canonical too, and — the disqualifying part — it changes ROUTING,
 * permanently redirecting every slash-less URL to its slash form. Since
 * `templates/theme-site/` is copied per tenant at deploy time, that would
 * reshape the URL space of every already-deployed tenant site, invalidating
 * indexed URLs and inbound links — a strictly larger blast radius for a
 * cosmetic difference.
 *
 * Restoring the trailing slash on the root re-opens Phase 14 UAT gap G-14-5
 * (the sitemap `<loc>` disagreeing with the rendered canonical) — see the
 * cross-layer byte-identity test in `discovery-resolve.test.ts`. No
 * re-encoding, no decoding, no case folding of the path — a slug containing
 * a percent-escape or a non-ASCII character comes through byte-for-byte.
 */
export function absoluteUrl(origin: string, path: string): string {
  return path === "/" ? origin : `${origin}${path}`;
}

/**
 * SEOED-05 emission-side guard (Phase 16, D-16 absolute-https-only; Phase 15
 * D-02's two-guard posture — reject on save AND independently ignore at
 * emission). Returns the canonical string a page's `canonicalUrl` override
 * should emit, or `null` to mean "no override, use the computed canonical."
 *
 * This is NOT redundant with Plan 05's save-time validation: a value written
 * through Strapi's own admin UI never traverses the dashboard's validator,
 * so save-time validation alone is structurally insufficient for this field.
 * `resolveCanonicalOverride` is the second, independent guard that makes the
 * field safe regardless of how the stored value got there. (Contrast with
 * the slug-collision case, D-09, which deliberately gets a single guard —
 * the two are not the same posture and must not be conflated.)
 *
 * Built on top of `parseHttpUrl`, with one deliberate addition: the ORIGINAL
 * trimmed candidate must itself begin with `https://`. That clause is the
 * one that matters and is easy to miss — `parseHttpUrl` calls `normalizeUrl`,
 * which prepends a scheme onto a bare host, so `"acme.com/about"` and
 * `"/about"` would otherwise both parse successfully into an https URL the
 * client never authored. Guarding on the raw input's prefix (not only the
 * parsed protocol) is what stops a typo or a relative path from silently
 * becoming a live canonical pointing at a domain the client does not
 * control.
 *
 * Never re-serializes through `URL.href` — re-serializing can add a trailing
 * slash or re-encode characters, and the emitted canonical must be
 * byte-identical to what the client authored (the same no-re-encoding
 * discipline this module's header states for the sitemap/canonical
 * agreement). Never throws for any input.
 */
export function resolveCanonicalOverride(
  candidate: string | null | undefined
): string | null {
  if (candidate == null) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  // Guard on the RAW prefix before parsing — see doc comment above.
  if (!trimmed.startsWith("https://")) return null;
  const url = parseHttpUrl(trimmed);
  if (!url || url.protocol !== "https:") return null;
  return trimmed;
}

/**
 * The D-10 self-referential hreflang pair: exactly two entries, the resolved
 * locale and `x-default`, both valued with the canonical URL. `x-default` is
 * a plain string key in Next's typed `Languages<string>` map — no dedicated
 * field exists in this Next version.
 */
export function buildLanguageAlternates(
  locale: string,
  canonical: string
): Record<string, string> {
  return { [locale]: canonical, "x-default": canonical };
}

/**
 * Absolutizes a Strapi media URL against the CMS host — NEVER the site
 * origin. Strapi's Upload plugin stores `url` relative to the CMS, so
 * composing it against `metadataBase` would emit an `og:image` on the
 * tenant's OWN domain, which 404s (T-14-10). Takes the Strapi base URL as a
 * parameter (never reads the global runtime environment) so the module
 * stays pure and the base is testable.
 *
 * Returns `null` for a nullish input or a blank `url`. When the url already
 * carries an http/https protocol, it is used as-is — a cloud upload
 * provider stores absolute URLs and re-prefixing them would corrupt them.
 * When the url is Strapi-relative, it is joined to `strapiBaseUrl` after
 * that base passes the same validation the site origin does: a missing,
 * unparseable, or non-http(s) base returns `null` (D-04: no bundled
 * placeholder is substituted, and no half-formed absolute URL is emitted in
 * place of one). A protocol-less base is normalized rather than rejected,
 * matching how `strapi-client.ts` already reads this same env var. Any path
 * on the base is preserved, so a subpath-hosted Strapi still resolves.
 * `width`/`height` are carried through only when they are real positive
 * numbers, never a guessed or zero size.
 */
export function resolveShareImage(
  shareImage: StrapiSeoImage | null | undefined,
  strapiBaseUrl: string | undefined
): ResolvedShareImage | null {
  const url = shareImage?.url?.trim();
  if (!url) return null;

  let absoluteImageUrl: string;
  if (/^https?:\/\//.test(url)) {
    // Provider-hosted absolute URL — never re-prefixed against the CMS host.
    absoluteImageUrl = url;
  } else {
    // The CMS base goes through the SAME validation path as the site origin
    // (WR-01). Previously this only trimmed and stripped a trailing slash, so
    // a protocol-less or unparseable NEXT_PUBLIC_STRAPI_URL produced a
    // non-null result whose `url` was not a valid absolute URL
    // ("cms.example.com/uploads/card.png") — embedded verbatim into
    // og:image/twitter:image as if it had resolved, contradicting D-04's
    // documented degrade-to-no-image behavior.
    //
    // A protocol-less value normalizes rather than degrades, matching how
    // strapi-client.ts already derives its own GraphQL endpoint from this
    // exact env var: if the CMS is reachable, its images should be too.
    // Only a genuinely unusable base (non-http(s) scheme, unparseable)
    // degrades to null.
    const trimmed = strapiBaseUrl?.trim();
    const base = trimmed ? validateAndFormatBaseUrl(trimmed) : null;
    if (!base) return null;
    absoluteImageUrl = `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  const result: ResolvedShareImage = { url: absoluteImageUrl };
  if (typeof shareImage?.width === "number" && shareImage.width > 0) {
    result.width = shareImage.width;
  }
  if (typeof shareImage?.height === "number" && shareImage.height > 0) {
    result.height = shareImage.height;
  }
  return result;
}

/**
 * Assembles the full Next `Metadata` object for a page. Resolves the site
 * defaults through `resolveSiteDefaults(site)` and consumes BOTH `siteName`
 * (unconditionally, as before) AND `description` — the SEOED-06 site-
 * description inheritance tier (Phase 15, D-10): a blank/whitespace-only
 * `page.seo.description` falls back to the trimmed site default, and when
 * both are blank the `description` key (and `openGraph.description`/
 * `twitter.description`) is omitted entirely rather than emitted as an
 * empty string. `resolveSiteDefaults` is reused rather than reading
 * `site.seo.description` inline — it already trims and already omits
 * blanks, so there is exactly one seam for "the site's resolved
 * description," not two independent reads that could drift.
 *
 * Title deliberately has NO equivalent site-level tier: it stays
 * `page.seo.title` then `page.title`, exactly as in Phase 14 — D-10's
 * asymmetry between title (hard page-only fallback) and description (page
 * then site) is a deliberate design decision, not an inconsistency to "fix."
 *
 * `openGraph.siteName` is emitted here — not left to the root layout —
 * because Next REPLACES the whole `openGraph` object with whatever a page
 * sets rather than deep-merging it against the layout's. Any page that
 * defines its own page-level OpenGraph block (every page) therefore
 * discarded the layout's `siteName` outright; that was the observed
 * consequence, `og:site_name` absent from every served page (Phase 14 UAT
 * gap G-14-4). `resolveSiteDefaults` is used rather than reading `site.name`
 * inline because it is already the single seam `buildSiteMetadataFrom` uses
 * for the identical concept — two independent reads of a tenant's display
 * name is exactly the drift this module's header exists to prevent.
 *
 * `metadataBase`, `alternates` and `openGraph.url` are all gated behind the
 * SAME single `origin !== null` check — one conditional, not three
 * (RESEARCH Pitfall 2). Every URL emitted is absolute; no relative URL can
 * ever reach the returned object.
 *
 * `homepageSlug` is the site's resolved homepage slug from
 * `resolveHomepageSlugFrom(pages)`. It is what lets the canonical collapse to
 * `/` for a tenant whose homepage is resolved by convention or by first-page
 * fallback rather than by an explicit `isHomepage` flag (D-08).
 *
 * Share image resolves through a two-tier chain (Phase 15, SITE-02/SEOED-03/
 * SEOED-06): `resolveShareImage(page.seo.shareImage) ?? resolveShareImage(
 * site.seo.shareImage)`, both against the SAME Strapi base — the CMS host,
 * never the site origin (see `resolveShareImage`'s own doc comment). The
 * nullish-coalescing form means an unresolvable page tier (blank url, or an
 * unusable Strapi base) falls through to the site tier rather than
 * short-circuiting straight to no image. Neither tier resolving omits
 * `openGraph.images` entirely and sets `twitter.card` to `summary` — Phase
 * 14's D-04 named this exact degradation as correct, and the site tier
 * IS its stated upgrade path; no placeholder, bundled default, or
 * hostname-derived image is ever substituted here.
 *
 * This completes D-10's stated asymmetry: title hard-falls-back to
 * `page.title` only (no site tier, unchanged); description and share image
 * both fall back to the site tier, then to omission.
 */
export function buildPageMetadataFrom(
  page: StrapiPage | null | undefined,
  site: StrapiSite | null | undefined,
  env: SeoEnv | null | undefined,
  homepageSlug?: string | null
): Metadata {
  if (!page || !page.publishedAt) {
    return { title: NOT_FOUND_TITLE };
  }

  const origin = resolveSiteOrigin(site, env);
  const locale = resolveLocale(site);
  const canonicalPath = resolveCanonicalPath(page, homepageSlug);
  const { siteName, description: siteDefaultDescription } =
    resolveSiteDefaults(site);

  const title = page.seo?.title?.trim() || page.title;
  // SEOED-06 / D-10: page tier wins, then the site default, then omit the
  // key entirely — never an empty string. Title intentionally has NO
  // equivalent site tier (see this function's header comment).
  const description = page.seo?.description?.trim() || siteDefaultDescription;
  const noindex = page.seo?.noindex === true;

  const openGraph: Record<string, unknown> = { title, type: "website" };
  if (siteName) openGraph.siteName = siteName;
  const twitter: Record<string, unknown> = { title };
  if (description) {
    openGraph.description = description;
    twitter.description = description;
  }

  const metadata: Record<string, unknown> = {
    title,
    robots: { index: !noindex, follow: true },
  };
  if (description) metadata.description = description;

  // Origin-gated block (Pitfall 2): metadataBase, alternates and
  // openGraph.url are all decided by this ONE conditional, never three
  // independent ones — the no-origin branch omits all three outright rather
  // than leave metadataBase undefined while still setting a relative path.
  //
  // SEOED-05 (Phase 16): a valid absolute-https `page.canonicalUrl` override
  // takes precedence over the computed canonical here — even for the
  // homepage collapse, an explicit override outranks it. `resolveCanonicalOverride`
  // independently re-validates the stored value and falls back to the
  // computed canonical for anything that doesn't qualify, so hreflang and
  // og:url always agree with whichever canonical actually won.
  if (origin !== null) {
    const computedCanonical = absoluteUrl(origin, canonicalPath);
    const canonical =
      resolveCanonicalOverride(page.canonicalUrl) ?? computedCanonical;
    metadata.metadataBase = new URL(origin);
    metadata.alternates = {
      canonical,
      languages: buildLanguageAlternates(locale, canonical),
    };
    openGraph.url = canonical;
  }

  // Share-image half (Phase 14 Task 2, D-03/D-04; Phase 15 Plan 03 adds the
  // site tier, SITE-02/SEOED-03). Resolved against the STRAPI host, never
  // the site origin — see resolveShareImage's doc comment. The page tier is
  // tried first; an unresolvable page tier (blank url, unusable base) falls
  // through to the site tier via nullish coalescing rather than
  // short-circuiting to no image.
  const resolvedImage =
    resolveShareImage(page.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL) ??
    resolveShareImage(site?.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL);
  if (resolvedImage) {
    openGraph.images = [
      {
        url: resolvedImage.url,
        ...(resolvedImage.width !== undefined ? { width: resolvedImage.width } : {}),
        ...(resolvedImage.height !== undefined ? { height: resolvedImage.height } : {}),
      },
    ];
    twitter.card = "summary_large_image";
    twitter.images = [resolvedImage.url];
  } else {
    // D-04: no bundled placeholder is substituted — the text card is the
    // correct degradation. Set explicitly rather than relying on any
    // platform's silent downgrade of the large-image card.
    twitter.card = "summary";
  }

  metadata.openGraph = openGraph;
  metadata.twitter = twitter;

  return metadata as Metadata;
}

/**
 * Assembles the root layout's site-level default `Metadata` object
 * (Discretion 1). Resolves `resolveSiteDefaults(site)` for the title/
 * description/site name, then resolves the origin with the existing
 * `resolveSiteOrigin(site, env)` — the same function `buildPageMetadataFrom`
 * uses, never re-derived. `title` and `description` are emitted only when
 * present. `metadataBase` is emitted as a `URL` built from the resolved
 * origin only when the origin is non-null (Discretion 2) — the same single
 * gate `buildPageMetadataFrom` uses, for the same Pitfall-2 reason: a page
 * later adding a URL-valued field at layout level composes correctly
 * instead of failing the build. `openGraph.siteName` is emitted from the
 * resolved site name (Discretion 3) — the page-level builder owns
 * `og:title`, `og:description`, `og:url`, `og:type` and `og:image`, and
 * nothing here duplicates any of them.
 *
 * Emits SITE-01's title template and SITE-04's verification block
 * (14-03-D2's containment, lifted in Phase 15 Plan 03): when
 * `resolveSiteTitleTemplate(site)` returns a value, `title` is set to
 * `{ template, default: resolveSiteDefaults(site).title ?? "" }` — the
 * `default` branch is only reachable by a route that supplies no title of
 * its own, and no route in this template does, so an empty default is
 * honest rather than an invented brand string. With no template, `title`
 * stays the pre-existing plain-string behavior, byte-identical to before
 * this plan. When `resolveVerification(site)` returns a value, it is
 * assigned to `metadata.verification`; a `bing` value never appears as a
 * top-level key (Pitfall 5 — see `resolveVerification`'s own doc comment).
 *
 * Still does NOT emit, for any input: `alternates` (page-level, D-10),
 * `robots` (page-level, META-05), or `og:locale`.
 *
 * Does not read any page field and does not accept a page parameter — the
 * root layout has no page context and must not acquire one.
 */
export function buildSiteMetadataFrom(
  site:
    | (DefaultsSite & LocaleSite & TitleTemplateSite & VerificationSite)
    | null
    | undefined,
  env: SeoEnv | null | undefined
): Metadata {
  const defaults = resolveSiteDefaults(site);
  const origin = resolveSiteOrigin(site, env);

  const metadata: Record<string, unknown> = {};

  const titleTemplate = resolveSiteTitleTemplate(site);
  if (titleTemplate) {
    metadata.title = { template: titleTemplate, default: defaults.title ?? "" };
  } else if (defaults.title) {
    metadata.title = defaults.title;
  }

  if (defaults.description) metadata.description = defaults.description;

  if (origin !== null) {
    metadata.metadataBase = new URL(origin);
  }

  if (defaults.siteName) {
    metadata.openGraph = { siteName: defaults.siteName };
  }

  const verification = resolveVerification(site);
  if (verification) metadata.verification = verification;

  return metadata as Metadata;
}
