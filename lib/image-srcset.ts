/**
 * Pure srcset/sizes builder for Strapi Upload plugin `formats` data (D-01).
 *
 * Strapi's Upload plugin stores resize variants (thumbnail/small/medium/large
 * [/webp]) on the file's OWN `plugin::upload.file` record, keyed by width. This
 * helper turns that `formats` object into the `srcSet`/`sizes` attribute pair an
 * `<img>` tag needs, defensively — mirroring the null-safe, early-return pattern
 * already used by `resolveLiveBundle`/`resolvePageForLiveTheme` in `live-resolve.ts`:
 * never throw, never return `undefined`-valued keys, degrade to `{}` when there's
 * nothing usable.
 *
 * This is the reference contract the theme package (Plan 04, separate repo) copies
 * for its own equivalent — keep it dependency-free and pure.
 */

export interface StrapiImageFormatEntry {
  url: string;
  width?: number;
  height?: number;
}

export type StrapiImageFormats = Record<
  string,
  StrapiImageFormatEntry | undefined | null
>;

export interface BuiltSrcSet {
  srcSet?: string;
  sizes?: string;
}

/**
 * Build a `srcSet`/`sizes` attribute pair from a Strapi `formats` object.
 *
 * - Filters entries down to those with a string `url` AND a numeric `width` (a
 *   width-descriptor srcset entry requires a known width).
 * - Sorts the surviving entries ascending by `width`, regardless of input key order.
 * - Only sets `sizes` when a `srcSet` was actually produced — an empty/malformed
 *   `formats` object yields `{}`, never a `sizes`-only object.
 * - Never throws: null/undefined/malformed input all degrade to `{}`.
 */
export interface IntrinsicSize {
  width: number;
  height: number;
}

/**
 * The intrinsic pixel size to put in an `<img width height>` pair, or `null`.
 *
 * WHY BOTH-OR-NOTHING. A lone `width` (or a lone `height`) does not let the
 * browser reserve a box — it needs the ratio — so a half-known size is
 * returned as `null` rather than as a partial pair. That is why this returns
 * one object instead of two independent numbers: it makes "we know this
 * image's shape" a single decision a caller cannot half-apply.
 *
 * Two tiers, and NO third:
 *   1. the file's own `width`/`height`, merged by `resolveImageFormats`
 *      (`strapi-client.ts`) from the Upload record — the only authoritative
 *      source;
 *   2. the LARGEST `formats` variant, used only when tier 1 is absent. A
 *      variant is a proportional resize of the same original, so its ratio is
 *      the original's ratio, which is the part that governs the reserved box.
 *
 * There is deliberately no fallback beyond those. A guessed size (a
 * hardcoded 16:9, a CSS-derived box, a hardcoded default) produces a
 * reserved box of the WRONG shape, and the browser then shifts the layout on
 * load — strictly worse for CLS than emitting no attributes at all, which is
 * merely neutral. "No size" is a correct answer here, not a failure.
 *
 * Never throws; malformed input degrades to `null`.
 *
 * NOTE FOR THEME AUTHORS: an `<img>` that is absolutely positioned and
 * CSS-sized to fill a parent (`absolute inset-0 h-full w-full object-cover`)
 * takes its box from that parent, so `width`/`height` on it change NOTHING
 * about layout or CLS. Spend the attributes on images whose own intrinsic
 * size drives the layout; `srcSet`, from `buildSrcSet` above, is what pays
 * off on the fill images.
 */
export function resolveIntrinsicSize(
  value:
    | {
        width?: unknown;
        height?: unknown;
        formats?: StrapiImageFormats | null;
      }
    | null
    | undefined
): IntrinsicSize | null {
  const isPositive = (n: unknown): n is number =>
    typeof n === "number" && Number.isFinite(n) && n > 0;

  if (isPositive(value?.width) && isPositive(value?.height)) {
    return { width: value.width, height: value.height };
  }

  const formats = value?.formats;
  if (formats == null || typeof formats !== "object") return null;

  const largest = Object.values(formats)
    .filter(
      (entry): entry is StrapiImageFormatEntry =>
        entry != null &&
        typeof entry === "object" &&
        isPositive(entry.width) &&
        isPositive(entry.height)
    )
    .sort((a, b) => (b.width as number) - (a.width as number))[0];

  if (!largest) return null;
  return { width: largest.width as number, height: largest.height as number };
}

export function buildSrcSet(
  formats: StrapiImageFormats | null | undefined,
  sizesHint = "100vw"
): BuiltSrcSet {
  if (formats == null || typeof formats !== "object") return {};

  const entries = Object.values(formats)
    .filter(
      (entry): entry is StrapiImageFormatEntry =>
        entry != null &&
        typeof entry === "object" &&
        typeof entry.url === "string" &&
        typeof entry.width === "number"
    )
    .sort((a, b) => (a.width as number) - (b.width as number));

  if (entries.length === 0) return {};

  const srcSet = entries.map((entry) => `${entry.url} ${entry.width}w`).join(", ");

  return { srcSet, sizes: sizesHint };
}
