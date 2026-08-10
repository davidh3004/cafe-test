import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateThemeSource } from "../theme-evaluator";
import type { StrapiPage } from "../strapi-client";

// This repo's vitest environment is `node` (no jsdom) -- see app/layout.test.tsx's
// own note on the same constraint. `PageRenderer`'s async theme-load effect
// (`useEffect`) and its heading-normalization `useLayoutEffect` never run under
// `renderToStaticMarkup` (effects are a DOM-commit concept; static markup never
// commits), so every test below controls `themeModule`/`loading` state via the
// `getLoadedTheme` mock below -- which `PageRenderer`'s `useState` initializers
// read SYNCHRONOUSLY, during the render itself -- rather than by waiting for an
// effect that this environment cannot run.
const { getLoadedThemeMock, loadThemeFromUrlMock } = vi.hoisted(() => ({
  getLoadedThemeMock: vi.fn(),
  loadThemeFromUrlMock: vi.fn(() => new Promise(() => {})),
}));

vi.mock("../theme-loader", () => ({
  getLoadedTheme: getLoadedThemeMock,
  loadThemeFromUrl: loadThemeFromUrlMock,
}));

// Imported AFTER the mock is registered (vi.mock is hoisted above imports by
// Vitest's transform regardless of source order, but keeping the import below
// the mock declaration documents the dependency for a human reader).
import { PageRenderer, selectRenderBranch } from "../page-renderer";

const fixtureSource = readFileSync(
  new URL("./fixtures/fixture-theme.bundle.js", import.meta.url),
  "utf-8"
);

/**
 * These tests exercise the CLIENT render path, so the fixture theme module must
 * close over the same React copy this file's `renderToStaticMarkup` is paired
 * with -- the app's own `react` -- which is also what the browser's
 * `theme-loader.ts` genuinely injects at runtime.
 *
 * `evaluateThemeSource` otherwise defaults to `ssr-react-runtime`'s pairing
 * (Next's `next/dist/compiled/react`), which is correct for the SERVER shell but
 * wrong here: `PageRenderer`'s own `useState` resolves its dispatcher through
 * the app's React, so a tree mixing the two copies leaves one of them without a
 * dispatcher and dies with "Invalid hook call". Passing the runtime explicitly
 * keeps this test a single-React tree, matching production's client path.
 */
function getFixtureThemeModule() {
  const module = evaluateThemeSource(fixtureSource, "fixture-theme", {
    React,
    ReactDOM,
    jsxRuntime,
  });
  if (!module) throw new Error("fixture theme module failed to evaluate");
  return module;
}

function pageWithSections(
  sections: Array<{ sectionKey: string; order: number; data?: unknown; blocks?: unknown }>
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

describe("PageRenderer — resolution-time failure isolation (CR-01, 13-06 review fix)", () => {
  beforeEach(() => {
    getLoadedThemeMock.mockReset();
  });

  it("a section whose `blocks` is malformed does not crash the whole client render -- siblings still render, the broken section is silently omitted", () => {
    getLoadedThemeMock.mockReturnValue(getFixtureThemeModule());
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hero title" } } },
      { sectionKey: "resolution-target", order: 1, data: {}, blocks: {} },
      { sectionKey: "plain", order: 2, data: { title: { type: "text", value: "Plain title" } } },
    ]);

    // Before the CR-01 fix, this call throws synchronously (the identical
    // uncaught TypeError the review describes at page-renderer.tsx:272),
    // failing this test with an exception rather than an assertion failure.
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(
        <PageRenderer page={page} themeBundleUrl="https://cdn.example.com/theme.bundle.js" themeName="fixture-theme" />
      );
    }).not.toThrow();

    expect(html).toContain("Hero title");
    expect(html).toContain("Plain title");
    expect(html).not.toContain("fixture-resolution-target");
  });

  it("a section with null `data` renders normally alongside its siblings (matches the server path's behavior)", () => {
    getLoadedThemeMock.mockReturnValue(getFixtureThemeModule());
    const page = pageWithSections([
      { sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hero title" } } },
      { sectionKey: "resolution-target", order: 1, data: null },
      { sectionKey: "plain", order: 2, data: { title: { type: "text", value: "Plain title" } } },
    ]);

    let html = "";
    expect(() => {
      html = renderToStaticMarkup(
        <PageRenderer page={page} themeBundleUrl="https://cdn.example.com/theme.bundle.js" themeName="fixture-theme" />
      );
    }).not.toThrow();

    expect(html).toContain("Hero title");
    expect(html).toContain("Plain title");
    expect(html).toContain("fixture-resolution-target");
  });
});

describe("PageRenderer — shellHtml still wins over the loading placeholder (D-03, reachable synchronously)", () => {
  beforeEach(() => {
    getLoadedThemeMock.mockReset();
  });

  it("renders the shell markup, not the blank placeholder, when the theme has not loaded yet", () => {
    getLoadedThemeMock.mockReturnValue(null); // cache miss -> loading === true on first render
    const page = pageWithSections([{ sectionKey: "hero", order: 0 }]);

    const html = renderToStaticMarkup(
      <PageRenderer
        page={page}
        themeBundleUrl="https://cdn.example.com/theme.bundle.js"
        themeName="fixture-theme"
        shellHtml="<div>server-rendered shell</div>"
      />
    );

    expect(html).toContain("server-rendered shell");
    expect(html).not.toContain('aria-hidden="true"');
  });
});

describe("selectRenderBranch — D-03 branch-priority decision (WR-02, 13-06 review fix)", () => {
  it("shell wins when a server shell exists and the client tree has not taken over (still loading)", () => {
    expect(
      selectRenderBranch({
        shellHtml: "<div>shell</div>",
        themeModuleReady: false,
        loading: true,
        error: null,
        themeModule: null,
      })
    ).toBe("shell");
  });

  it("shell wins over an error, when a server shell exists and the bundle failed to load", () => {
    expect(
      selectRenderBranch({
        shellHtml: "<div>shell</div>",
        themeModuleReady: false,
        loading: false,
        error: "Failed to load theme",
        themeModule: null,
      })
    ).toBe("shell");
  });

  it("falls through to loading when there is no shell and the bundle is still loading", () => {
    expect(
      selectRenderBranch({
        shellHtml: undefined,
        themeModuleReady: false,
        loading: true,
        error: null,
        themeModule: null,
      })
    ).toBe("loading");
  });

  it("falls through to the error screen only when there is no shell AND (error or no theme module) -- today's unchanged behavior", () => {
    expect(
      selectRenderBranch({
        shellHtml: undefined,
        themeModuleReady: false,
        loading: false,
        error: "Failed to load theme",
        themeModule: null,
      })
    ).toBe("error");

    expect(
      selectRenderBranch({
        shellHtml: null,
        themeModuleReady: false,
        loading: false,
        error: null,
        themeModule: null,
      })
    ).toBe("error");
  });

  it("falls through to main once the client tree has genuinely taken over", () => {
    expect(
      selectRenderBranch({
        shellHtml: "<div>shell</div>",
        themeModuleReady: true,
        loading: false,
        error: null,
        themeModule: {},
      })
    ).toBe("main");

    expect(
      selectRenderBranch({
        shellHtml: undefined,
        themeModuleReady: true,
        loading: false,
        error: null,
        themeModule: {},
      })
    ).toBe("main");
  });
});
