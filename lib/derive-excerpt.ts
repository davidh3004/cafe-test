/**
 * deriveExcerpt — mirrored twin of `lib/blog/derive-excerpt.ts` (platform).
 *
 * WHY A MIRROR, NOT AN IMPORT: this file lives in `templates/theme-site/`, a
 * standalone Next.js app `lib/services/template-copy.service.ts` copies
 * STANDALONE into each tenant repo — it has no import path to the
 * platform's `lib/`. See `templates/theme-site/lib/article-contract.ts`'s
 * header for the full change-one-change-both convention this repo already
 * follows (`lib/seo/site-locales.ts` / `templates/theme-site/lib/seo-resolve.ts`
 * is the established precedent).
 *
 * Phase 21 (D-06/DIS-7) promotes this from a display-only editor placeholder
 * (its origin, `lib/blog/derive-excerpt.ts`) to the ACTUAL derivation a
 * theme's `article.excerpt` falls back to when a post has no stored excerpt
 * — `buildArticleProp` (`./article-contract.ts`) is the one caller.
 * `__tests__/lib/theme-contract/mirror-drift.test.ts` asserts both
 * implementations agree over a fixture table, so a future edit to one that
 * is not mirrored to the other fails a test rather than silently diverging
 * per-tenant excerpt text.
 *
 * Every constraint the origin's header states still applies here:
 * (1) it is NOT a sanitizer — the sanitizers are Phase 20's
 *     `lib/sanitize/*` modules; tag-stripping by pattern must never be
 *     relied on for security.
 * (2) it enumerates grapheme clusters (`Intl.Segmenter`), never UTF-16 code
 *     units, so truncation never splits an emoji or a combining sequence.
 */

export const EXCERPT_DERIVE_LENGTH = 160;

const ENTITY_PATTERN = /&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g;
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (match) => ENTITY_MAP[match] ?? match);
}

/**
 * Every tag becomes a single space rather than the empty string, so
 * adjacent block elements never fuse — "<p>one</p><p>two</p>" must derive
 * "one two", never "onetwo". Only the six entities in `ENTITY_MAP` are
 * decoded; anything else is left verbatim rather than mangled.
 */
function stripTagsToPlainText(html: string): string {
  const withSpaces = html.replace(/<[^>]*>/g, " ");
  const decoded = decodeEntities(withSpaces);
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Enumerates grapheme clusters — never UTF-16 code units, never a bare
 * `.length` comparison. `Intl.Segmenter` is correct against BOTH lone
 * surrogates and combining marks/emoji-modifier sequences; the
 * `Array.from` fallback (code-point iteration) is only correct against lone
 * surrogates, which is why `Intl.Segmenter` is the primary path and
 * `Array.from` is a fallback for a host where it is unavailable.
 */
function segmentGraphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text), (entry) => entry.segment);
  }
  return Array.from(text);
}

/**
 * Joins the first `count` grapheme clusters. Deliberately NOT written with
 * `slice`/`substring` on the source string — both count UTF-16 code units,
 * which is exactly the mechanism that would split an emoji or a
 * combining-mark pair in half. Indexing the CLUSTER ARRAY by position is
 * safe: each array element is already a whole grapheme.
 */
function joinFirstClusters(clusters: string[], count: number): string {
  let result = "";
  for (let i = 0; i < clusters.length && i < count; i++) {
    result += clusters[i];
  }
  return result;
}

export function deriveExcerpt(bodyHtml: string): string {
  const plainText = stripTagsToPlainText(bodyHtml);
  if (plainText === "") return "";

  const clusters = segmentGraphemes(plainText);
  if (clusters.length <= EXCERPT_DERIVE_LENGTH) return plainText;

  return `${joinFirstClusters(clusters, EXCERPT_DERIVE_LENGTH)}…`;
}
