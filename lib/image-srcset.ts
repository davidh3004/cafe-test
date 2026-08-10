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
