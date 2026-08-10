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
import { buildSrcSet } from "../image-srcset";

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
