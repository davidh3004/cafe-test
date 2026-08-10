import { describe, expect, it } from "vitest";
// Phase 15, Plan 03: closes RESEARCH assumption A2 / Pitfall 4. Proves the
// root layout's `title.template` composes with a leaf page's plain-string
// title in THIS template's real two-segment route tree, by driving Next's
// OWN `resolveTitle` through `resolveComposedTitle` — never a hand-written
// model of Next's `%s` substitution rule. See next-head-surface.ts's header
// comment for why this proof exists (Phase 14 shipped G-14-4/G-14-5 by
// trusting a source read of Next's composition layer instead).
import { resolveComposedTitle } from "./helpers/next-head-surface";

describe("resolveComposedTitle — A2/Pitfall 4: title.template composes across the real 2-segment tree", () => {
  it("composes a root {template, default} with a leaf plain-string title", () => {
    expect(
      resolveComposedTitle(
        { template: "%s | Brand", default: "Brand" },
        "About Us"
      )
    ).toBe("About Us | Brand");
  });

  // D-08/Open-Question-2, resolved: the homepage gets the template exactly
  // like every other page — no special case. Named explicitly so this
  // decision is a visible, failing-on-change assertion (RESEARCH Open
  // Question 2 called this out as the stated footgun).
  it("the homepage receives the template exactly like every other page — no special case", () => {
    expect(
      resolveComposedTitle(
        { template: "%s | Brand", default: "Brand" },
        "Home"
      )
    ).toBe("Home | Brand");
  });

  it("composes verbatim with NO de-duplication when the leaf title already ends with the suffix", () => {
    expect(
      resolveComposedTitle(
        { template: "%s | Brand", default: "Brand" },
        "About Us | Brand"
      )
    ).toBe("About Us | Brand | Brand");
  });

  it("a leaf { absolute } title bypasses the template entirely", () => {
    expect(
      resolveComposedTitle(
        { template: "%s | Brand", default: "Brand" },
        { absolute: "Exact Title" }
      )
    ).toBe("Exact Title");
  });

  it("a root plain-string title with no template leaves a leaf title untouched", () => {
    expect(resolveComposedTitle("Brand", "About Us")).toBe("About Us");
  });

  it("an empty-string default alongside a template does not throw and does not affect a leaf that supplies its own title", () => {
    expect(() =>
      resolveComposedTitle({ template: "%s | Brand", default: "" }, "About Us")
    ).not.toThrow();
    expect(
      resolveComposedTitle({ template: "%s | Brand", default: "" }, "About Us")
    ).toBe("About Us | Brand");
  });
});
