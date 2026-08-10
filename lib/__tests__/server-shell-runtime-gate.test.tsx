import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { StrapiPage } from "../strapi-client";

/**
 * Pins the behavior of `buildShellHtml` when the server-side React runtime
 * itself is unusable (`ssr-react-runtime`'s probe failed).
 *
 * Lives in its own file rather than inside `server-shell.test.tsx` because it
 * needs `../ssr-react-runtime` mocked at the MODULE level for every test in the
 * file, while that suite needs the genuine runtime in order to render real
 * fixture sections. Two conflicting module graphs, two files.
 *
 * The behavior under test is deliberately NOT "throws" and NOT "renders an
 * error": a visitor must still get a page (D-03), so the shell degrades to the
 * same `null` that the kill switch produces. What this test actually protects is
 * the ATTRIBUTION — that the failure is reported once under
 * `ssr-runtime-unavailable` rather than masquerading as N per-section
 * `section-render-threw` events, which would send an investigation at the
 * tenant's theme instead of at the platform's React runtime.
 */

const { reportSsrRuntimeUnavailableMock, reportSectionRenderFailureMock } = vi.hoisted(
  () => ({
    reportSsrRuntimeUnavailableMock: vi.fn(),
    reportSectionRenderFailureMock: vi.fn(),
  })
);

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

vi.mock("../theme-evaluator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../theme-evaluator")>();
  return {
    ...actual,
    reportSsrRuntimeUnavailable: reportSsrRuntimeUnavailableMock,
    reportSectionRenderFailure: reportSectionRenderFailureMock,
  };
});

// Keep the real React and renderer (so the module still loads and every other
// export behaves normally); override ONLY the health verdict.
vi.mock("../ssr-react-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ssr-react-runtime")>();
  return {
    ...actual,
    SSR_REACT_RUNTIME_HEALTH: {
      healthy: false,
      reason: "React.useState is not a function (got undefined) — simulated",
    },
  };
});

const fixtureSource = readFileSync(
  new URL("./fixtures/fixture-theme.bundle.js", import.meta.url),
  "utf-8"
);

function pageWithHero(): StrapiPage {
  return {
    id: 1,
    documentId: "doc-1",
    title: "Runtime gate page",
    slug: "runtime-gate",
    publishedAt: "2026-07-30T00:00:00.000Z",
    sections: [{ sectionKey: "hero", order: 0, data: { title: "Hero title" } }],
  } as unknown as StrapiPage;
}

describe("buildShellHtml — unusable server React runtime (platform-level degrade)", () => {
  beforeEach(() => {
    reportSsrRuntimeUnavailableMock.mockClear();
    reportSectionRenderFailureMock.mockClear();
  });

  it("returns null — the same client-only fallback the kill switch produces, never a throw", async () => {
    const { buildShellHtml } = await import("../server-shell");
    const { evaluateThemeSource } = await import("../theme-evaluator");
    const themeModule = evaluateThemeSource(fixtureSource, "fixture-theme");
    expect(themeModule).not.toBeNull();

    expect(
      buildShellHtml({ page: pageWithHero(), themeModule: themeModule!, themeName: "fixture-theme" })
    ).toBeNull();
  });

  it("reports exactly once under its own reason, carrying the probe's diagnostic", async () => {
    const { buildShellHtml } = await import("../server-shell");
    const { evaluateThemeSource } = await import("../theme-evaluator");
    const themeModule = evaluateThemeSource(fixtureSource, "fixture-theme");

    buildShellHtml({
      page: pageWithHero(),
      themeModule: themeModule!,
      themeName: "fixture-theme",
    });

    expect(reportSsrRuntimeUnavailableMock).toHaveBeenCalledTimes(1);
    expect(reportSsrRuntimeUnavailableMock).toHaveBeenCalledWith(
      "fixture-theme",
      expect.stringContaining("React.useState")
    );
    // The misattribution this gate exists to prevent: no per-section blame.
    expect(reportSectionRenderFailureMock).not.toHaveBeenCalled();
  });

  it("short-circuits before touching sections, so no section is rendered at all", async () => {
    const { buildShellHtml } = await import("../server-shell");
    const { evaluateThemeSource } = await import("../theme-evaluator");
    const themeModule = evaluateThemeSource(fixtureSource, "fixture-theme");

    const spied = {
      ...themeModule!,
      sectionsComponents: { ...themeModule!.sectionsComponents },
    };
    const heroSpy = vi.fn(themeModule!.sectionsComponents.hero);
    spied.sectionsComponents.hero = heroSpy as never;

    expect(
      buildShellHtml({ page: pageWithHero(), themeModule: spied, themeName: "fixture-theme" })
    ).toBeNull();
    expect(heroSpy).not.toHaveBeenCalled();
  });
});
