import { describe, expect, it } from "vitest";
// RED (Phase 11, Plan 02, Task 1): `../image-srcset` is built in this same task
// (D-01 frontend half). This suite MUST fail now (module absent) so the pure
// srcset/sizes builder has an automated gate before strapi-client.ts wires real
// Strapi `formats` data through it.
//
// Contract under test — buildSrcSet(formats, sizesHint?):
//   - orders entries ascending by width regardless of input key order
//   - never throws on null/undefined/malformed/empty input
//   - only returns srcSet/sizes keys when a srcSet was actually produced
import { buildSrcSet, resolveIntrinsicSize } from "../image-srcset";

describe("buildSrcSet — pure srcset/sizes builder (D-01)", () => {
  it("Test 1: builds an ascending-by-width srcSet + default 100vw sizes, regardless of input key order", () => {
    const formats = {
      large: { url: "/l.jpg", width: 1000 },
      thumbnail: { url: "/t.jpg", width: 245 },
      medium: { url: "/m.jpg", width: 750 },
      small: { url: "/s.jpg", width: 500 },
    };
    expect(buildSrcSet(formats)).toEqual({
      srcSet: "/t.jpg 245w, /s.jpg 500w, /m.jpg 750w, /l.jpg 1000w",
      sizes: "100vw",
    });
  });

  it("Test 2: returns {} for null/undefined formats — never throws, never undefined-valued keys", () => {
    expect(buildSrcSet(null)).toEqual({});
    expect(buildSrcSet(undefined)).toEqual({});
    expect(Object.keys(buildSrcSet(null))).toHaveLength(0);
    expect(Object.keys(buildSrcSet(undefined))).toHaveLength(0);
  });

  it("Test 3: skips a format entry missing width, keeps other valid entries", () => {
    const formats = {
      webp: { url: "/w.webp" },
      small: { url: "/s.jpg", width: 500 },
    };
    expect(buildSrcSet(formats)).toEqual({
      srcSet: "/s.jpg 500w",
      sizes: "100vw",
    });
  });

  it("Test 4: skips a format entry with a non-string url", () => {
    // Deliberately malformed for the defensive test (e.g. bad upstream data) —
    // cast bypasses the compile-time type since buildSrcSet must survive this at
    // runtime regardless of what TypeScript would otherwise forbid.
    const formats = {
      broken: { url: 12345, width: 300 },
      small: { url: "/s.jpg", width: 500 },
    } as unknown as Parameters<typeof buildSrcSet>[0];
    expect(buildSrcSet(formats)).toEqual({
      srcSet: "/s.jpg 500w",
      sizes: "100vw",
    });
  });

  it("Test 5: honors a sizesHint override instead of the 100vw default", () => {
    const formats = { small: { url: "/s.jpg", width: 500 } };
    expect(buildSrcSet(formats, "200px")).toEqual({
      srcSet: "/s.jpg 500w",
      sizes: "200px",
    });
  });

  it("Test 6: returns {} for an empty formats object — nothing to offer", () => {
    expect(buildSrcSet({})).toEqual({});
    expect(Object.keys(buildSrcSet({}))).toHaveLength(0);
  });
});

// Phase 18 (item 12): the intrinsic-size half of the same theme-facing image
// contract buildSrcSet belongs to.
describe("resolveIntrinsicSize", () => {
  it("prefers the file's own width/height — the only authoritative source", () => {
    expect(
      resolveIntrinsicSize({
        width: 1600,
        height: 900,
        formats: { large: { url: "/l.jpg", width: 1000, height: 562 } },
      })
    ).toEqual({ width: 1600, height: 900 });
  });

  it("falls back to the LARGEST format variant when the file has no dimensions", () => {
    expect(
      resolveIntrinsicSize({
        formats: {
          thumbnail: { url: "/t.jpg", width: 245, height: 138 },
          large: { url: "/l.jpg", width: 1000, height: 562 },
          medium: { url: "/m.jpg", width: 750, height: 422 },
        },
      })
    ).toEqual({ width: 1000, height: 562 });
  });

  it("returns null rather than a half pair when only one dimension is known", () => {
    expect(resolveIntrinsicSize({ width: 1600 })).toBeNull();
    expect(resolveIntrinsicSize({ height: 900 })).toBeNull();
  });

  it("returns null when a format variant has a width but no height", () => {
    expect(
      resolveIntrinsicSize({ formats: { large: { url: "/l.jpg", width: 1000 } } })
    ).toBeNull();
  });

  it("rejects zero, negative and non-finite dimensions", () => {
    expect(resolveIntrinsicSize({ width: 0, height: 100 })).toBeNull();
    expect(resolveIntrinsicSize({ width: -10, height: 100 })).toBeNull();
    expect(resolveIntrinsicSize({ width: Number.NaN, height: 100 })).toBeNull();
    expect(resolveIntrinsicSize({ width: Infinity, height: 100 })).toBeNull();
  });

  it("never throws and returns null for nullish/malformed input", () => {
    expect(resolveIntrinsicSize(null)).toBeNull();
    expect(resolveIntrinsicSize(undefined)).toBeNull();
    expect(resolveIntrinsicSize({})).toBeNull();
    expect(resolveIntrinsicSize({ formats: null })).toBeNull();
    expect(
      resolveIntrinsicSize({ formats: "nope" as unknown as null })
    ).toBeNull();
  });
});
