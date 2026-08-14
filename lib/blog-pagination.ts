/**
 * D-5 pagination path algebra (Phase 22 Plan 03, BLOG-07). Pure,
 * dependency-free module -- the SOLE producer of every blog listing URL in
 * this codebase. Mirrors `resolveCanonicalPath`/`resolveHomepageSlugFrom`'s
 * "one function, byte-identical by construction" pattern in `seo-resolve.ts`:
 * two URLs for the same page-1 listing is the exact duplicate-content
 * problem D-5 closes, and it can only stay closed if the emitted canonical,
 * the `/blog/page/1` redirect decision, and the rendered route all come from
 * this one function rather than three independent implementations that can
 * drift apart.
 *
 * `resolveBlogPaginationPath` is meant to be the ONLY place in the app that
 * assembles a `/blog...` listing path. Plan 06's routes, canonicals and
 * prev/next links all call through here.
 */

/** Posts per blog listing page (index, category and tag archives alike). */
export const BLOG_PAGE_SIZE = 10;

/** The three blog listing surfaces (D-3): one shared archive template, three kinds of term. */
export type BlogSurfaceKind = "index" | "category" | "tag";

// A fixed digit cap on the raw page-param string, checked BEFORE any numeric
// parsing (T-22-06). A canonical, unpadded page number this large is already
// absurd for a real blog; rejecting on string length alone means a
// pathologically long digit string is never even handed to `Number()`, which
// is where an unbounded-length numeric literal could otherwise be coerced
// into an expensive allocation.
const MAX_PAGE_PARAM_DIGITS = 6;

// A canonical unpadded positive integer: no leading zero (except the single
// digit "0" itself, which this pattern also happens to reject outright since
// page 0 is never valid), no sign, no decimal point, no surrounding
// whitespace.
const CANONICAL_POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/**
 * `/blog` for the index, `/blog/{kind}/{encoded-term}` for a category or tag
 * archive. The term slug is passed through `encodeURIComponent` on the way
 * into the path (T-22-12) so a term containing a slash or a space can never
 * forge a different route in a canonical or a purge path.
 */
export function resolveBlogBasePath(
  kind: BlogSurfaceKind,
  termSlug?: string | null
): string {
  if (kind === "index") return "/blog";
  const encodedTerm = encodeURIComponent(termSlug ?? "");
  return `/blog/${kind}/${encodedTerm}`;
}

/**
 * The full listing path for a given page: the base path when `page` is at or
 * below 1 (page 1 collapses to the bare base path -- D-5's "exactly one URL
 * for page 1" rule, so `/blog/page/1` is never a second URL for identical
 * content), and `{base}/page/{page}` otherwise.
 */
export function resolveBlogPaginationPath(
  kind: BlogSurfaceKind,
  termSlug: string | null | undefined,
  page: number
): string {
  const basePath = resolveBlogBasePath(kind, termSlug);
  if (page <= 1) return basePath;
  return `${basePath}/page/${page}`;
}

/**
 * Strict page-param parser for the `/blog/page/[n]` and
 * `/blog/{kind}/{term}/page/[n]` route segments. Accepts ONLY a canonical
 * unpadded positive integer string; anything else -- a zero, a negative
 * sign, a decimal, a leading zero, trailing/leading whitespace, a non-digit
 * suffix, or a string over the digit cap -- resolves `null`. A `null` is
 * never coerced to `1`; the caller (a route) turns it into a 404. Coercing
 * would resurrect the exact duplicate-content problem D-5 closes, since a
 * malformed segment would then render the same content as the canonical
 * page-1 URL under a second path.
 */
export function parseBlogPageParam(
  raw: string | string[] | undefined
): number | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_PAGE_PARAM_DIGITS) return null;
  if (!CANONICAL_POSITIVE_INTEGER.test(raw)) return null;
  return Number(raw);
}

/**
 * Whether `page` is a servable page number given `pageCount`. Page 1 is
 * ALWAYS in range, even when `pageCount` is 0 -- an empty blog still serves
 * its page 1 with the theme's own empty state rather than a 404. Any other
 * page is in range only up to `pageCount`; a page beyond that is an
 * out-of-range signal the route turns into a 404 rather than an empty list.
 */
export function isBlogPageInRange(page: number, pageCount: number): boolean {
  if (page === 1) return true;
  return page <= pageCount;
}

/**
 * The SOLE producer of a post's own path (Phase 23, Plan 01, Task 2, D-1).
 * `/blog/{encoded-slug}` -- the slug segment is passed through
 * `encodeURIComponent` on the way in, mirroring `resolveBlogBasePath`'s
 * existing treatment of a term segment (T-23-04), so a slug containing a
 * slash or a space can never forge a different route in a canonical or a
 * sitemap entry.
 *
 * `resolvePostCanonical` (`seo-resolve.ts`) and every other consumer of a
 * post's URL compose against THIS function -- a second inline composition of
 * `/blog/{slug}` anywhere in the app is the exact defect D-1 exists to
 * prevent.
 */
export function resolvePostPath(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}
