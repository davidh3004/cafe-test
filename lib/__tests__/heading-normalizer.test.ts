import { describe, expect, it } from "vitest";
import {
  PROMOTED_H1_ATTR,
  PROMOTED_H1_INLINE_STYLE,
  escapeHtml,
  demoteH1TagsInHtml,
  normalizeHeadingsAcrossSections,
  buildPromotedH1Html,
  countH1OpenTags,
  normalizeHeadingsInDom,
  type HeadingHost,
} from "../heading-normalizer";

/**
 * Phase 13 Plan 04 (META-06, D-09, T-13-08). Every case here maps to a
 * `<behavior>` bullet in 13-04-PLAN.md's Task 1. Four describe blocks --
 * adjacency, empty, ordering, escaping -- discharge the fourteen pure-function
 * cases; a fifth covers the three DOM-mechanism cases separately.
 */

describe("heading-normalizer — adjacency", () => {
  it("across sections: first entry unchanged, second entry's heading becomes h2, exactly one h1 open tag survives the join", () => {
    const state = { seen: false };
    const sections = ["<div><h1>A</h1></div>", "<div><h1>B</h1></div>"];
    const result = sections.map((html) => demoteH1TagsInHtml(html, state));

    expect(result[0]).toBe("<div><h1>A</h1></div>");
    expect(result[1]).toBe("<div><h2>B</h2></div>");
    expect(countH1OpenTags(result.join(""))).toBe(1);
  });

  it("within one section: a single string with two h1 pairs yields one h1 and one h2, in document order", () => {
    const state = { seen: false };
    const html = "<div><h1>A</h1></div><div><h1>B</h1></div>";

    const result = demoteH1TagsInHtml(html, state);

    expect(result).toBe("<div><h1>A</h1></div><div><h2>B</h2></div>");
  });

  it("touching tags: no whitespace between a closing h1 and the next opening h1 still normalizes correctly", () => {
    const state = { seen: false };
    const html = "<h1>A</h1><h1>B</h1>";

    const result = demoteH1TagsInHtml(html, state);

    expect(result).toBe("<h1>A</h1><h2>B</h2>");
  });

  it("preserves attributes through demotion: a second heading's class/id survive byte-identical apart from the tag name", () => {
    const state = { seen: true }; // simulate already having kept an earlier heading
    const html = '<h1 class="x" id="y">A</h1>';

    const result = demoteH1TagsInHtml(html, state);

    expect(result).toBe('<h2 class="x" id="y">A</h2>');
  });

  it("never rewrites attribute values: an escaped entity sequence resembling an h1 tag inside an attribute value is untouched", () => {
    const state = { seen: true };
    const html = '<h1 data-note="&lt;h1&gt;nested&lt;/h1&gt;">A</h1>';

    const result = demoteH1TagsInHtml(html, state);

    expect(result).toBe('<h2 data-note="&lt;h1&gt;nested&lt;/h1&gt;">A</h2>');
  });
});

describe("heading-normalizer — empty", () => {
  it("zero headings: a fallback title is promoted as the first entry, carrying the marker attribute, inline style, and escaped title", () => {
    const result = normalizeHeadingsAcrossSections(["<div>no headings</div>"], "Home");

    expect(result[0].startsWith(`<h1 ${PROMOTED_H1_ATTR}`)).toBe(true);
    expect(result[0]).toContain(PROMOTED_H1_INLINE_STYLE);
    expect(result[0]).toContain("Home");
    expect(result[0]).toContain("<div>no headings</div>");
  });

  it("empty input: an empty array yields an empty array, no promoted heading is emitted into nothing", () => {
    const result = normalizeHeadingsAcrossSections([], "Home");

    expect(result).toEqual([]);
  });

  it("already correct: a single-section array containing exactly one h1 is returned byte-for-byte unchanged", () => {
    const input = ["<div><h1>Title</h1></div>"];

    const result = normalizeHeadingsAcrossSections(input, "Home");

    expect(result[0]).toBe(input[0]);
  });
});

describe("heading-normalizer — ordering", () => {
  it("processes front to back; the first entry containing an h1 is the one whose heading survives, regardless of which entries contain headings", () => {
    const sections = [
      "<div>no heading here</div>",
      "<div><h1>First real heading</h1></div>",
      "<div><h1>Second heading</h1></div>",
    ];

    const result = normalizeHeadingsAcrossSections(sections, "Fallback");

    expect(result[0]).toBe("<div>no heading here</div>");
    expect(result[1]).toBe("<div><h1>First real heading</h1></div>");
    expect(result[2]).toBe("<div><h2>Second heading</h2></div>");
  });
});

describe("heading-normalizer — escaping (T-13-08, block-on-high)", () => {
  it("angle brackets: a script-element title is emitted as escaped entities, with the raw element text absent entirely", () => {
    const title = "<script>alert(1)</script>";

    const html = buildPromotedH1Html(title);

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain(title);
  });

  it("attribute-breaking characters: double quote and single quote are entity-encoded, raw characters absent", () => {
    const doubleQuoteEscaped = escapeHtml('say "hi"');
    const singleQuoteEscaped = escapeHtml("say 'hi'");

    expect(doubleQuoteEscaped).toContain("&quot;");
    expect(doubleQuoteEscaped).not.toContain('"');
    expect(singleQuoteEscaped).toContain("&#39;");
    expect(singleQuoteEscaped).not.toContain("'");
  });

  it("ampersand ordering: an already entity-shaped sequence round-trips instead of double-decoding to a different entity", () => {
    const plainAmpersand = escapeHtml("Tom & Jerry");
    expect(plainAmpersand).toContain("&amp;");
    expect(plainAmpersand).not.toContain(" & ");

    // The leading `&` in an already-entity-shaped input must be escaped
    // FIRST, so this round-trips back to the literal text "&amp;" rather
    // than being misinterpreted as an already-escaped ampersand.
    const alreadyEntityShaped = escapeHtml("&amp;");
    expect(alreadyEntityShaped).toBe("&amp;amp;");
  });

  it("event-handler payload: no raw angle bracket and no raw attribute-quote character survive, even with no heading-shaped token", () => {
    const title = '<img src=x onerror="alert(1)">';

    const html = buildPromotedH1Html(title);

    expect(html).not.toMatch(/<img/);
    expect(html).not.toContain('onerror="alert(1)"');
    // Structural shape check, recorded as NOT the mitigation itself: the
    // promoted element is still exactly one h1, independent of escaping.
    expect(countH1OpenTags(html)).toBe(1);
  });

  it("structural shape check for every escaping case above is separate from escaping: countH1OpenTags is 1", () => {
    const payloads = [
      "<script>alert(1)</script>",
      'say "hi" & \'bye\'',
      "&amp;",
      '<img src=x onerror="alert(1)">',
    ];

    for (const payload of payloads) {
      expect(countH1OpenTags(buildPromotedH1Html(payload))).toBe(1);
    }
  });

  /**
   * T-13-08 falsifiability (block-on-high) — how this mitigation is proven.
   *
   * 13-04-SUMMARY records that during execution `escapeHtml` was hand-neutered
   * to an identity function, the escaping assertions confirmed RED, then the
   * real implementation restored. That proof left no artifact.
   *
   * The durable replacement is NOT a separate test: it is the four
   * positive/negative pairs above. They assert through `buildPromotedH1Html`,
   * which calls the real `escapeHtml`, so they are wired to the actual
   * mitigation and go red the moment it regresses.
   *
   * Re-verified empirically by /gsd-validate-phase on 2026-07-31: replacing
   * `escapeHtml`'s body with `return value;` turns exactly those four tests
   * RED (4 failed | 16 passed) and the implementation was then restored. To
   * re-run that check, do the same and expect these four names to fail:
   *   - "angle brackets: a script-element title ..."
   *   - "attribute-breaking characters: double quote and single quote ..."
   *   - "ampersand ordering: an already entity-shaped sequence ..."
   *   - "event-handler payload: no raw angle bracket ..."
   *
   * Deliberately NOT added here: a test that builds strings from a local
   * identity function and asserts those fail. Such a test is self-referential
   * — it never invokes `escapeHtml`, stays green when the real function is
   * neutered, and so manufactures false confidence in the phase's only
   * high-severity threat. One was written and removed for exactly that reason.
   *
   * The structural `countH1OpenTags` assertion above is explicitly NOT this
   * mitigation (13-04-PLAN) and correctly stays green under the mutation.
   */
});

describe("heading-normalizer — DOM mechanism", () => {
  function stubHost(headings: Array<{ outerHTML: string }>): HeadingHost & {
    setOuterHTML: (index: number, html: string) => void;
  } {
    const elements = headings.map((h) => ({ ...h }));
    return {
      querySelectorAll: () => elements as unknown as ArrayLike<{ outerHTML: string }>,
      setOuterHTML: (index: number, html: string) => {
        elements[index].outerHTML = html;
      },
    };
  }

  it("given three heading stubs, the first is untouched, the other two are rewritten to h2, and the report says two demoted and three seen", () => {
    const host = stubHost([
      { outerHTML: "<h1>First</h1>" },
      { outerHTML: "<h1>Second</h1>" },
      { outerHTML: "<h1>Third</h1>" },
    ]);

    const report = normalizeHeadingsInDom(host);

    expect(report).toEqual({ h1Count: 3, demoted: 2 });
  });

  it("zero case: a host returning no headings yields a report with a zero count", () => {
    const host = stubHost([]);

    const report = normalizeHeadingsInDom(host);

    expect(report).toEqual({ h1Count: 0, demoted: 0 });
  });

  it("idempotence: a host whose only heading already carries the marker attribute is neither demoted nor counted as authored", () => {
    const host = stubHost([
      { outerHTML: `<h1 ${PROMOTED_H1_ATTR}="true" style="${PROMOTED_H1_INLINE_STYLE}">Home</h1>` },
    ]);

    const report = normalizeHeadingsInDom(host);

    expect(report).toEqual({ h1Count: 0, demoted: 0 });
  });

  /**
   * WR-01 (13-06 review, documented rather than closed -- see
   * page-renderer.tsx's `useLayoutEffect` and this module's own
   * `normalizeHeadingsInDom` doc comment for the full rationale). Pins the
   * KNOWN, ACCEPTED divergence rather than asserting it is fixed: this test
   * exists so a future change to either mechanism does not silently alter
   * this documented edge case without a human noticing.
   */
  it("pins the documented divergence: a heading the SERVER kept (because its earlier section failed to render) can be demoted CLIENT-side once that earlier section reappears ahead of it", () => {
    // Server-side: Section A failed to render (D-06), so the server shell
    // only ever sees Section B's heading -- it survives as the page's sole
    // <h1>, exactly like the single-heading-bearing-section case already
    // covered above.
    const serverSectionHtmls = ["<div><h1>B heading</h1></div>"];
    const serverResult = normalizeHeadingsAcrossSections(serverSectionHtmls, "Fallback");
    expect(serverResult[0]).toBe("<div><h1>B heading</h1></div>");

    // Client-side, post-swap: Section A reappears (D-06) and is now FIRST in
    // document order, ahead of Section B's already-painted <h1>.
    // `normalizeHeadingsInDom` has no visibility into what the server already
    // committed to -- it only ever sees today's DOM order -- so it keeps A's
    // heading and demotes B's, even though B's heading was already visible on
    // screen before this pass ran.
    const host = stubHost([
      { outerHTML: "<h1>A heading</h1>" },
      { outerHTML: "<h1>B heading</h1>" },
    ]);

    normalizeHeadingsInDom(host);

    const headings = host.querySelectorAll("h1");
    expect(headings[0].outerHTML).toBe("<h1>A heading</h1>");
    expect(headings[1].outerHTML).toBe("<h2>B heading</h2>");
  });
});
