/**
 * The single `<h1>`-per-page rule (Phase 13 Plan 04, META-06, D-09).
 *
 * Exactly one rule -- "keep the first `<h1>` in document order, demote every
 * later one to `<h2>`; when a composition has zero, promote a visually-hidden
 * `<h1>` carrying the page title" -- implemented via TWO mechanisms, because
 * the server and the client hold different representations of the same
 * content at the point normalization must run: a plain string
 * (`normalizeHeadingsAcrossSections`, called from `lib/server-shell.tsx`) and
 * a live DOM tree (`normalizeHeadingsInDom`, called from
 * `lib/page-renderer.tsx`). Both mechanisms route through the SAME
 * `demoteH1TagsInHtml` rewrite rule and the SAME promoted-heading constants,
 * so the server shell and the live client tree can never disagree on heading
 * levels -- a disagreement would make D-02's invisible swap visible.
 *
 * This module is pure and framework-free by design: no React import, no DOM
 * globals, no client-boundary directive. Everything it needs is passed in,
 * which is what makes both mechanisms testable in this repository's `node`
 * vitest environment without a browser test harness.
 */

/**
 * Marks an `<h1>` the platform injected (a promoted heading), as opposed to
 * one a theme author wrote. Both `normalizeHeadingsInDom` (to stay
 * idempotent -- it must never count or re-demote its own promoted element)
 * and a future verification harness use this to tell the two apart.
 */
export const PROMOTED_H1_ATTR = "data-theta-promoted-h1";

/**
 * Visually-hidden inline style for a promoted `<h1>`. An INLINE declaration,
 * not a utility class name: the theme's stylesheet is built in a sibling
 * repository from that repository's own Tailwind content scan, so the
 * platform cannot assume any particular class (e.g. `sr-only`) exists there.
 * The classic visually-hidden-but-accessible recipe: absolutely positioned,
 * a one-pixel box, zero padding, a negative one-pixel margin (offsets the
 * one-pixel box so it contributes no layout), hidden overflow, a zero-size
 * clip rectangle, no white-space wrapping, and no border.
 */
export const PROMOTED_H1_INLINE_STYLE =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;";

/**
 * Escape a string for safe concatenation into an HTML string as text
 * content. Ampersand is escaped FIRST -- escaping any other character first
 * and only then escaping `&` would double-escape the entities that step just
 * introduced (e.g. the `&` inside `&lt;` would itself get re-escaped to
 * `&amp;lt;`). This is the ONLY place in the shell string that concatenates a
 * CMS-authored value (the page title) as raw text rather than through
 * React's own escaping (`renderToStaticMarkup`) -- see T-13-08.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Matches only the tag-name token of an `h1` element: an open tag whose name
 * is immediately followed by whitespace or the closing angle bracket (so
 * `<h1>` and `<h1 class="x">` match, but a hypothetical custom element like
 * `<h1foo>` does not), or the literal close tag `</h1>`. It never inspects or
 * rewrites attribute VALUES -- the classic "you can't parse HTML with a
 * regex" objection is about extracting/understanding arbitrary nested
 * structure, which does not apply to this one narrow substitution. This is
 * safe against the HTML this module is ever handed (`renderToStaticMarkup`
 * output, or a browser's own `outerHTML` serialization): any angle bracket a
 * theme author put inside an attribute VALUE already comes out
 * entity-escaped (`&lt;`/`&gt;`) by React's own escaping, so it can never
 * collide with this literal `<h1`/`</h1>` match.
 */
const H1_TAG_TOKEN = /<h1(\s[^>]*)?>|<\/h1>/gi;

/**
 * Rewrite every `h1` tag-name token in `html` to `h2`, except the very first
 * heading's own open-and-close pair, which is left untouched. `state.seen` is
 * a caller-owned flag: it starts `false`, flips to `true` the moment the
 * FIRST heading's own CLOSE tag has been passed (not its open tag -- flipping
 * on the open tag would incorrectly demote that same heading's own closing
 * tag a moment later), and stays `true` for every subsequent call across an
 * array, so the first heading in document order survives whether the later
 * heading is in the same string or a later one in the array.
 *
 * `normalizeHeadingsInDom` calls this with `state.seen` PRE-SET to `true` --
 * by the time it calls this, it has already decided the heading being
 * processed is not the one being kept, so every tag-name token in that single
 * heading's own complete `outerHTML` (open AND close) must demote.
 */
export function demoteH1TagsInHtml(html: string, state: { seen: boolean }): string {
  return html.replace(H1_TAG_TOKEN, (match) => {
    const isClosingTag = match[1] === "/"; // "<h1..." -> match[1] is 'h'; "</h1>" -> match[1] is '/'
    if (!state.seen) {
      if (isClosingTag) {
        state.seen = true;
      }
      return match;
    }
    return isClosingTag ? "</h2>" : match.replace(/^<h1/i, "<h2");
  });
}

/** Count `h1` open tags in `html`. Used by tests and by Task 3's harness. */
export function countH1OpenTags(html: string): number {
  const matches = html.match(/<h1(\s[^>]*)?>/gi);
  return matches ? matches.length : 0;
}

/**
 * Build the promoted heading element string: an `h1` carrying
 * `PROMOTED_H1_ATTR`, `PROMOTED_H1_INLINE_STYLE`, and the escaped title as
 * its only child. T-13-08's mitigation lives entirely in the `escapeHtml`
 * call below -- every other byte of the shell comes from
 * `renderToStaticMarkup`, which escapes text content by default; this is the
 * one path that bypasses it.
 */
export function buildPromotedH1Html(title: string): string {
  return `<h1 ${PROMOTED_H1_ATTR}="true" style="${PROMOTED_H1_INLINE_STYLE}">${escapeHtml(title)}</h1>`;
}

/**
 * The server mechanism (called from `lib/server-shell.tsx`'s `buildShellHtml`,
 * as the LAST step before the per-section strings are joined -- running it
 * earlier, or over data that doesn't preserve render order, silently picks
 * the wrong heading). Maps `sectionHtmls` front to back through
 * `demoteH1TagsInHtml` with ONE shared `state` object, so document order is
 * the array order. If no heading was seen anywhere and the array is
 * non-empty, prepends a promoted heading to the FIRST entry. If the array is
 * empty, returns it unchanged -- a page with no renderable sections has no
 * shell at all (`buildShellHtml` returns `null` in that case), and a
 * promoted heading must never be emitted into nothing. Returns a NEW array;
 * never mutates the input.
 */
export function normalizeHeadingsAcrossSections(
  sectionHtmls: string[],
  fallbackTitle: string
): string[] {
  if (sectionHtmls.length === 0) {
    return sectionHtmls;
  }

  const state = { seen: false };
  const result = sectionHtmls.map((html) => demoteH1TagsInHtml(html, state));

  if (!state.seen) {
    result[0] = buildPromotedH1Html(fallbackTitle) + result[0];
  }

  return result;
}

/**
 * The narrow structural interface `normalizeHeadingsInDom` needs: a real
 * `HTMLElement` satisfies it (its `querySelectorAll` returns a live
 * `NodeListOf<Element>`, and `outerHTML` is a real read/write DOM property),
 * and a two-line test double satisfies it too -- this repository's vitest
 * environment is `node`, so tests exercise this function against a stub, not
 * a real DOM.
 */
export interface HeadingHost {
  querySelectorAll(selector: string): ArrayLike<{ outerHTML: string }>;
}

/**
 * The client mechanism (called from `lib/page-renderer.tsx`'s
 * `useLayoutEffect`, wrapped in a `try`/`catch` by the caller so this can
 * never throw into the render -- see that file for why `outerHTML`
 * reassignment on a React-owned node is a bounded, accepted hazard, T-13-14).
 *
 * Queries `"h1"` on `host`. Any element whose `outerHTML` already carries
 * `PROMOTED_H1_ATTR` is skipped entirely -- neither demoted nor counted as
 * authored -- so the pass is idempotent against the promoted element the
 * caller itself renders (re-running it cannot oscillate: a page that needed
 * a promoted heading last time still reports zero authored headings this
 * time, since the promoted element it rendered is excluded from the count).
 * Of the remaining, authored headings: the first is left untouched; every
 * later one has a demoted string assigned back to its `outerHTML`, via
 * `demoteH1TagsInHtml` with `state.seen` PRE-SET to `true` (this function has
 * already decided this heading is not the one being kept).
 *
 * Returns `{ h1Count, demoted }`: `h1Count` counts AUTHORED headings only
 * (never the promoted one), which is the zero-vs-nonzero signal the caller
 * uses to decide whether to render a promoted heading at all.
 *
 * WR-01 (13-06 review, documented rather than closed): this function decides
 * "first in document order wins" using only the DOM it is handed at call
 * time. It has no visibility into what `normalizeHeadingsAcrossSections`
 * decided server-side. If a heading-owning section that failed server-side
 * (D-06) reappears client-side ahead of the section whose heading the server
 * shell kept, this pass demotes that already-visible heading -- see the
 * detailed writeup next to this function's one caller
 * (`lib/page-renderer.tsx`'s `useLayoutEffect`) and the pinned regression
 * test in `__tests__/heading-normalizer.test.ts`. Not reachable by today's
 * single-heading-section production themes.
 */
export function normalizeHeadingsInDom(host: HeadingHost): { h1Count: number; demoted: number } {
  const headings = Array.from(host.querySelectorAll("h1"));
  let h1Count = 0;
  let demoted = 0;
  let firstAuthoredSeen = false;

  for (const el of headings) {
    if (el.outerHTML.includes(PROMOTED_H1_ATTR)) {
      continue;
    }

    h1Count++;

    if (!firstAuthoredSeen) {
      firstAuthoredSeen = true;
      continue;
    }

    const state = { seen: true };
    el.outerHTML = demoteH1TagsInHtml(el.outerHTML, state);
    demoted++;
  }

  return { h1Count, demoted };
}
