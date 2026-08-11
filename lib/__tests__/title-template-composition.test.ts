import { describe, expect, it } from "vitest";
// Phase 15, Plan 03: closes RESEARCH assumption A2 / Pitfall 4. Proves the
// root layout's `title.template` composes with a leaf page's plain-string
// title in THIS template's real two-segment route tree, by driving Next's
// OWN `resolveTitle` through `resolveComposedTitle` — never a hand-written
// model of Next's `%s` substitution rule. See next-head-surface.ts's header
// comment for why this proof exists (Phase 14 shipped G-14-4/G-14-5 by
// trusting a source read of Next's composition layer instead).
import { resolveComposedTitle } from "./helpers/next-head-surface";
import { applyTitleTemplate, buildPageMetadataFrom } from "../seo-resolve";
import type { StrapiSite } from "../strapi-client";

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

// LIVE DEFECT 2026-08-10, surfaced by a Semrush "not enough text within the
// title tags" finding on the homepage. Next applies a layout's title.template
// to CHILD segments only, and app/page.tsx shares the root segment with the
// layout that declares it — so every tenant's homepage silently shipped a bare
// title ("Homepage") while every other route got "Nosotros | Fixocargo".
describe("homepage title template composition (applyTitleTemplate)", () => {
  const site: StrapiSite = {
    name: "Fixocargo",
    siteUrl: "https://acme.com",
    titleTemplate: "%s | Fixocargo",
  };

  it("returns the title unchanged with no template", () => {
    expect(applyTitleTemplate(undefined, "Homepage")).toBe("Homepage");
  });

  it("substitutes %s", () => {
    expect(applyTitleTemplate("%s | Fixocargo", "Homepage")).toBe("Homepage | Fixocargo");
  });

  it("ignores a template with no %s rather than discarding the page title", () => {
    expect(applyTitleTemplate("Fixocargo", "Homepage")).toBe("Homepage");
  });

  it("emits title.absolute for a flagged homepage so Next cannot double-apply", () => {
    const metadata = buildPageMetadataFrom(
      { documentId: "p1", title: "Homepage", slug: "home", publishedAt: "2026-01-01", isHomepage: true },
      site,
      {}
    );

    expect(metadata.title).toEqual({ absolute: "Homepage | Fixocargo" });
  });

  it("also composes for a homepage resolved by slug rather than by flag (D-08)", () => {
    const metadata = buildPageMetadataFrom(
      { documentId: "p1", title: "Homepage", slug: "home", publishedAt: "2026-01-01" },
      site,
      {},
      "home"
    );

    expect(metadata.title).toEqual({ absolute: "Homepage | Fixocargo" });
  });

  it("leaves a NON-homepage title a plain string — Next applies the template there", () => {
    const metadata = buildPageMetadataFrom(
      { documentId: "p2", title: "Nosotros", slug: "nosotros", publishedAt: "2026-01-01" },
      site,
      {},
      "home"
    );

    expect(metadata.title).toBe("Nosotros");
  });

  it("leaves the homepage title a plain string when the site has no template", () => {
    const metadata = buildPageMetadataFrom(
      { documentId: "p1", title: "Homepage", slug: "home", publishedAt: "2026-01-01", isHomepage: true },
      { ...site, titleTemplate: null },
      {}
    );

    expect(metadata.title).toBe("Homepage");
  });
});

// Driven through Next's OWN resolveTitle (this file's stated discipline: never
// a hand-written model of the %s rule), because the whole fix depends on
// `absolute` defeating an inherited template. If it did not, the homepage would
// render "Homepage | Fixocargo | Fixocargo".
describe("title.absolute vs an inherited template — proven with Next's resolver", () => {
  it("does not re-apply the layout template to a composed absolute title", () => {
    expect(
      resolveComposedTitle(
        { template: "%s | Fixocargo", default: "Fixocargo" },
        { absolute: "Homepage | Fixocargo" }
      )
    ).toBe("Homepage | Fixocargo");
  });

  it("confirms the contrast: a plain-string leaf title DOES get templated", () => {
    expect(
      resolveComposedTitle(
        { template: "%s | Fixocargo", default: "Fixocargo" },
        "Nosotros"
      )
    ).toBe("Nosotros | Fixocargo");
  });
});
