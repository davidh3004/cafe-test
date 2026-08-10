import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateThemeSource } from "../theme-evaluator";
import {
  buildShellHtml,
  isSsrShellDisabled,
  SSR_SHELL_DISABLE_ENV,
  SHELL_BUILDER_SECTION_KEY,
} from "../server-shell";
import type { StrapiPage } from "../strapi-client";
import { countH1OpenTags, PROMOTED_H1_ATTR } from "../heading-normalizer";

// vi.hoisted so the mock factory (hoisted above every import by Vitest's
// transform) can close over a stable spy reference declared with `const`.
const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

// Spy on the section-failure reporter AT THE MODULE BOUNDARY (`../theme-evaluator`,
// the same module `server-shell.tsx` imports it from as `./theme-evaluator` --
// both specifiers resolve to the same file, so mocking here intercepts the
// call site inside `renderResolvedSectionsToHtml` too) rather than asserting
// on `console.error` text, per Task 1's action: this pins the D-07 seam
// itself, not a log format. `importOriginal` keeps every other export (in
// particular `evaluateThemeSource`, used below to obtain a real vm-evaluated
// fixture module) genuinely real.
const { reportSectionRenderFailureMock } = vi.hoisted(() => ({
  reportSectionRenderFailureMock: vi.fn(),
}));

vi.mock("../theme-evaluator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../theme-evaluator")>();
  return {
    ...actual,
    reportSectionRenderFailure: reportSectionRenderFailureMock,
  };
});

const fixtureSource = readFileSync(
  new URL("./fixtures/fixture-theme.bundle.js", import.meta.url),
  "utf-8"
);

// Obtained the same way theme-evaluator.test.ts obtains a real, vm-evaluated
// module -- proves buildShellHtml works against a genuine LoadedThemeModule,
// not a hand-rolled stub.
function getFixtureThemeModule() {
  const module = evaluateThemeSource(fixtureSource, "fixture-theme");
  if (!module) throw new Error("fixture theme module failed to evaluate");
  return module;
}

function pageWithSections(
  sections: Array<{ sectionKey: string; order: number; data?: Record<string, unknown> }>
): StrapiPage {
  return {
    documentId: "p1",
    title: "Home",
    slug: "home",
    page_template: {
      sections: sections.map((s) => ({ ...s, data: s.data ?? {} })),
    },
  } as unknown as StrapiPage;
}

describe("buildShellHtml — server-rendered shell string (SSR-01, D-01/D-02)", () => {
  it("returns a non-empty string containing both sections' rendered text content", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hero title" } } },
      { sectionKey: "plain", order: 1, data: { title: { type: "text", value: "Plain title" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html).toContain("Hero title");
    expect(html).toContain("Plain title");
    expect(html).toContain('data-testid="fixture-hero"');
    expect(html).toContain('data-testid="fixture-plain"');
  });

  it("wraps each section's markup in its own div, matching the client tree's per-section wrapper", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0 },
      { sectionKey: "plain", order: 1 },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    // Each section is wrapped in a plain <div>, so the fixture-hero testid
    // and the fixture-plain testid should each appear inside their own div
    // that itself sits directly alongside the other (no shared wrapper).
    const divOpenTagMatches = html!.match(/<div/g) ?? [];
    // At least one wrapper div per section, plus whatever the fixture
    // components themselves emit.
    expect(divOpenTagMatches.length).toBeGreaterThanOrEqual(2);
    expect(html!.indexOf("fixture-hero")).toBeLessThan(html!.indexOf("fixture-plain"));
  });

  it("returns null for a page whose template has zero sections", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([]);

    expect(buildShellHtml({ page, themeModule, themeName: "fixture-theme" })).toBeNull();
  });

  it("returns null when every section key is absent from the theme module", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "does-not-exist", order: 0 },
      { sectionKey: "also-missing", order: 1 },
    ]);

    expect(buildShellHtml({ page, themeModule, themeName: "fixture-theme" })).toBeNull();
  });

  it("renders sections in order ascending, concatenating the shell string in that same order", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "plain", order: 1, data: { title: { type: "text", value: "Second" } } },
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "First" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html!.indexOf("First")).toBeLessThan(html!.indexOf("Second"));
  });
});

describe("buildShellHtml — per-section failure isolation (SSR-05, D-05/D-06/D-07)", () => {
  beforeEach(() => {
    reportSectionRenderFailureMock.mockClear();
  });

  it("skips a throwing middle section silently: siblings still render, no wrapper or thrown-message text survives for it", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hero title" } } },
      { sectionKey: "throws", order: 1 },
      { sectionKey: "plain", order: 2, data: { title: { type: "text", value: "Plain title" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html).toContain("Hero title");
    expect(html).toContain("Plain title");
    expect(html).not.toContain("deliberate render-time failure");
    // Exactly two section wrappers (hero + plain) survive -- the throwing
    // section contributes no wrapper element at all, not merely an empty one.
    const wrapperMatches = html!.match(/<div>/g) ?? [];
    expect(wrapperMatches).toHaveLength(2);
  });

  it("calls the section-failure reporter exactly once, with the theme name, the section key, and the thrown message -- no fourth argument", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0 },
      { sectionKey: "throws", order: 1 },
      { sectionKey: "plain", order: 2 },
    ]);

    buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(reportSectionRenderFailureMock).toHaveBeenCalledTimes(1);
    const call = reportSectionRenderFailureMock.mock.calls[0];
    expect(call).toHaveLength(3);
    expect(call[0]).toBe("fixture-theme");
    expect(call[1]).toBe("throws");
    expect(call[2]).toContain("deliberate render-time failure");
  });

  it("never carries a synthetic CMS value from the failing section's data in any reported argument (T-13-03)", () => {
    const themeModule = getFixtureThemeModule();
    const SECRET_CMS_VALUE = "synthetic-cms-value-should-never-leak-9f3a";
    const page = pageWithSections([
      {
        sectionKey: "throws",
        order: 0,
        data: { title: { type: "text", value: SECRET_CMS_VALUE } },
      },
    ]);

    buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(reportSectionRenderFailureMock).toHaveBeenCalledTimes(1);
    const call = reportSectionRenderFailureMock.mock.calls[0];
    for (const arg of call) {
      expect(String(arg)).not.toContain(SECRET_CMS_VALUE);
    }
  });

  it("returns null for a composition whose only section throws", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([{ sectionKey: "throws", order: 0 }]);

    expect(buildShellHtml({ page, themeModule, themeName: "fixture-theme" })).toBeNull();
  });

  it("still renders a section AFTER a failing one -- the failure at index 1 does not block index 2", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "First" } } },
      { sectionKey: "throws", order: 1 },
      { sectionKey: "plain", order: 2, data: { title: { type: "text", value: "Third" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html!.indexOf("First")).toBeGreaterThanOrEqual(0);
    expect(html!.indexOf("Third")).toBeGreaterThan(html!.indexOf("First"));
  });

  it("returns null (strictly, an identity check, not a truthiness check) when EVERY section in the composition throws", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "throws", order: 0 },
      { sectionKey: "throws", order: 1 },
    ]);

    const result = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(result === null).toBe(true);
    expect(reportSectionRenderFailureMock).toHaveBeenCalledTimes(2);
  });

  it("still returns the surviving sections' markup when the reporter itself throws", () => {
    const themeModule = getFixtureThemeModule();
    reportSectionRenderFailureMock.mockImplementationOnce(() => {
      throw new Error("Sentry/telemetry is down");
    });
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Survives" } } },
      { sectionKey: "throws", order: 1 },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html).toContain("Survives");
  });

  it("returns null (strictly) when the page's template has zero sections -- resolveSectionsForRender's empty-array case", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([]);

    const result = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(result === null).toBe(true);
  });
});

describe("buildShellHtml — resolution-time failure isolation (CR-01, 13-06 review fix)", () => {
  beforeEach(() => {
    reportSectionRenderFailureMock.mockClear();
  });

  it("a section with null `data` no longer aborts the whole page -- it renders alongside its siblings", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hero title" } } },
      // Legitimate Strapi runtime shape (section added, never configured).
      { sectionKey: "resolution-target", order: 1, data: null as unknown as Record<string, unknown> },
      { sectionKey: "plain", order: 2, data: { title: { type: "text", value: "Plain title" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html).toContain("Hero title");
    expect(html).toContain("Plain title");
    expect(html).toContain("fixture-resolution-target");
  });

  it("a section whose `blocks` is malformed (non-iterable) throws during prop-building -- skipped, siblings on both sides still render, reported with the real section key (not the '*' sentinel)", () => {
    const themeModule = getFixtureThemeModule();
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "First" } } },
          { sectionKey: "resolution-target", order: 1, data: {}, blocks: {} },
          { sectionKey: "plain", order: 2, data: { title: { type: "text", value: "Third" } } },
        ],
      },
    } as unknown as StrapiPage;

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html).toContain("First");
    expect(html).toContain("Third");
    expect(html).not.toContain("fixture-resolution-target");

    expect(reportSectionRenderFailureMock).toHaveBeenCalledTimes(1);
    const call = reportSectionRenderFailureMock.mock.calls[0];
    expect(call[0]).toBe("fixture-theme");
    expect(call[1]).toBe("resolution-target");
    expect(call[1]).not.toBe(SHELL_BUILDER_SECTION_KEY);
  });
});

describe("isSsrShellDisabled — the D-04 kill switch predicate", () => {
  it("is false for an empty env", () => {
    expect(isSsrShellDisabled({})).toBe(false);
  });

  it("is true when set to a non-empty, non-'0'/'false' value", () => {
    expect(isSsrShellDisabled({ [SSR_SHELL_DISABLE_ENV]: "1" })).toBe(true);
  });

  it("is false for the literal string '0'", () => {
    expect(isSsrShellDisabled({ [SSR_SHELL_DISABLE_ENV]: "0" })).toBe(false);
  });

  it("is false for the literal string 'false'", () => {
    expect(isSsrShellDisabled({ [SSR_SHELL_DISABLE_ENV]: "false" })).toBe(false);
  });

  it("is false for an empty string value", () => {
    expect(isSsrShellDisabled({ [SSR_SHELL_DISABLE_ENV]: "" })).toBe(false);
  });
});

describe("buildShellHtml — heading normalization (META-06, D-09)", () => {
  it("a composition with two heading-bearing sections (hero + banner) yields a shell string with exactly one h1 open tag", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hero heading" } } },
      { sectionKey: "banner", order: 1, data: { heading: { type: "text", value: "Banner heading" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(countH1OpenTags(html!)).toBe(1);
    // The first (hero) heading survives untouched; the second (banner) is demoted.
    expect(html).toContain("<h1>Hero heading</h1>");
    expect(html).toContain("<h2>Banner heading</h2>");
  });

  it("a composition of only heading-free sections (card + plain) yields a shell whose first element carries the promoted marker and whose h1 count is 1", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "card", order: 0 },
      { sectionKey: "plain", order: 1 },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(countH1OpenTags(html!)).toBe(1);
    expect(html).toContain(PROMOTED_H1_ATTR);
    expect(html).toContain(page.title);
  });

  it("a composition with exactly one heading-bearing section yields a shell whose heading is byte-identical to the section's own rendered heading -- no marker, no rewrite", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Solo Hero" } } },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html).toContain("<h1>Solo Hero</h1>");
    expect(html).not.toContain(PROMOTED_H1_ATTR);
    expect(countH1OpenTags(html!)).toBe(1);
  });

  it("the promoted heading appears at the very start of the shell string, ahead of the first section's wrapper", () => {
    const themeModule = getFixtureThemeModule();
    const page = pageWithSections([
      { sectionKey: "card", order: 0 },
      { sectionKey: "plain", order: 1 },
    ]);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(html!.startsWith(`<h1 ${PROMOTED_H1_ATTR}`)).toBe(true);
  });
});

/**
 * Theme-agnostic worst-case-composition harness for ROADMAP criterion 5
 * ("every registered theme", META-06).
 *
 * WHAT THIS PROVES: the single-`<h1>` rule holds for a synthetic page built
 * from EVERY section key `themeModule.sectionsComponents` actually exposes
 * -- derived via `Object.keys` at runtime, not a hard-coded fixture-name
 * array -- in the worst composition an author could assemble, once each,
 * key order. Because the fixture theme registers a genuinely-throwing
 * section under `throws`, the worst-case composition below also exercises
 * the interaction between per-section skipping (SSR-05) and heading
 * normalization in one pass: the surviving sections must still yield exactly
 * one heading even though one section drops out mid-composition. Pointing
 * this harness at a second theme's bundle later is a fixture swap and
 * nothing else -- the harness itself contains no per-theme branch.
 *
 * WHAT THIS DOES NOT PROVE: that any live tenant's REAL page composition
 * (the actual subset and order of sections a client picked in the editor)
 * holds this property. No automated check here observes a live tenant's
 * actual section selection -- that residual is named explicitly here rather
 * than left implicit, and is re-checked by hand in Plan 05's end-of-phase
 * UAT.
 */
describe("buildShellHtml — theme-agnostic worst-case-composition harness (criterion 5, META-06)", () => {
  function buildPageFromSectionKeys(keys: string[]): StrapiPage {
    return {
      documentId: "worst-case",
      title: "Worst Case Page",
      slug: "worst-case",
      page_template: {
        sections: keys.map((sectionKey, order) => ({ sectionKey, order, data: {} })),
      },
    } as unknown as StrapiPage;
  }

  it("a page built from every section key the theme module exposes (Object.keys, no hard-coded name list) yields exactly one h1 open tag", () => {
    const themeModule = getFixtureThemeModule();
    const allSectionKeys = Object.keys(themeModule.sectionsComponents);
    const page = buildPageFromSectionKeys(allSectionKeys);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(countH1OpenTags(html!)).toBe(1);
  });

  it("filtering that same key list down to only the heading-bearing sections (the duplicate case) still normalizes to one h1, carrying no promoted marker", () => {
    const themeModule = getFixtureThemeModule();
    const allSectionKeys = Object.keys(themeModule.sectionsComponents);
    const headingBearingKeys = allSectionKeys.filter(
      (key) => key === "hero" || key === "banner"
    );
    const page = buildPageFromSectionKeys(headingBearingKeys);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(countH1OpenTags(html!)).toBe(1);
    expect(html).not.toContain(PROMOTED_H1_ATTR);
  });

  it("filtering that same key list down to only heading-free sections (the zero case) produces one h1 carrying the promoted marker", () => {
    const themeModule = getFixtureThemeModule();
    const allSectionKeys = Object.keys(themeModule.sectionsComponents);
    const headingFreeKeys = allSectionKeys.filter((key) => key === "plain" || key === "card");
    const page = buildPageFromSectionKeys(headingFreeKeys);

    const html = buildShellHtml({ page, themeModule, themeName: "fixture-theme" });

    expect(html).not.toBeNull();
    expect(countH1OpenTags(html!)).toBe(1);
    expect(html).toContain(PROMOTED_H1_ATTR);
  });
});
