"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LoadedThemeModule } from "./theme-loader";
import { loadThemeFromUrl, getLoadedTheme } from "./theme-loader";
import type { StrapiPage } from "./strapi-client";
import {
  convertStrapiDataToProps as sharedConvertStrapiDataToProps,
  resolveSectionsForRender,
} from "@/lib/section-resolver";
// Namespace import (matches this repo's `import * as Sentry from
// "@sentry/nextjs"` convention): a literal reference to the DOM
// normalization function's name below appears exactly once, at its one call
// site, since the import specifier here names only the module. Both this
// file and lib/server-shell.tsx route through the SAME module so heading
// levels can never differ across the swap (D-02).
import * as HeadingNormalizer from "@/lib/heading-normalizer";

interface PageRendererProps {
  page: StrapiPage;
  themeBundleUrl: string;
  themeName: string;
  /**
   * URL for the theme's critical (render-blocking) stylesheet. ALWAYS
   * supplied by `resolveLiveBundle` (17-05, PERF-04) — deriving it locally
   * from `themeBundleUrl` here is incorrect, because the resolved bundle URL
   * may carry a `?v=<lastDeployedAt>` version token, on which a `.js` ->
   * `.css` suffix swap silently fails. Kept optional only because
   * `resolveLiveBundle` itself returns `undefined` when no bundle URL could
   * be resolved at all.
   */
  themeCssUrl?: string;
  /**
   * Optional URL for the non-blocking DEFERRED CSS chunk (theme.bundle.deferred.css,
   * D-05/D-06/D-07). Loaded via a second, isolated `<link precedence="theme-deferred">`
   * AFTER mount so it never competes with the critical `precedence="theme"` stylesheet
   * for render-blocking priority.
   */
  themeCssDeferredUrl?: string;
  /**
   * Optional server-rendered shell HTML (Phase 13, D-01). When present, this
   * is injected via `dangerouslySetInnerHTML` while the theme bundle is
   * still loading (or failed to load) instead of the blank placeholder /
   * error screen below. `undefined` reproduces today's exact behavior
   * byte-for-byte -- simultaneously the SSR-04 fallback (server evaluation
   * returned null) AND the D-04 kill-switch off-state.
   */
  shellHtml?: string;
}

/**
 * WR-02 (13-06 review fix): D-03's branch-priority decision, extracted as a
 * pure function so it is unit-testable directly (`page-renderer.test.tsx`)
 * without needing to reproduce React's async theme-load effect, which only
 * ever runs in a real browser/DOM environment -- this repo's vitest
 * environment is `node` (see `app/layout.test.tsx`'s own note on this). Every
 * condition below is copied verbatim from `PageRenderer`'s own branches
 * further down; change one, change both, and let the shared test suite catch
 * any future drift between them.
 */
export type RenderBranch = "shell" | "loading" | "error" | "main";

export function selectRenderBranch(state: {
  shellHtml: string | null | undefined;
  themeModuleReady: boolean;
  loading: boolean;
  error: string | null;
  themeModule: unknown;
}): RenderBranch {
  const { shellHtml, themeModuleReady, loading, error, themeModule } = state;

  // D-03: the shell branch is checked FIRST and wins over both the loading
  // placeholder and the error screen below.
  if (shellHtml != null && !themeModuleReady) {
    return "shell";
  }

  if (loading) {
    return "loading";
  }

  // D-03: narrowed from the original unconditional `error || !themeModule` so
  // this failure screen is reachable ONLY when there is no server shell to
  // fall back on.
  if (shellHtml == null && (error || !themeModule)) {
    return "error";
  }

  return "main";
}

/**
 * Component that renders a page using theme components.
 *
 * Flash fix: this no longer paints a "Loading theme…" screen — while the bundle
 * downloads it renders a silent, full-height placeholder. The theme stylesheet is
 * rendered declaratively with a `precedence`, so React 19 hoists it into the
 * server-rendered <head> as a render-blocking resource (no flash of unstyled
 * content), and theme state is seeded from the loader cache so client-side
 * navigations paint instantly.
 */
export function PageRenderer({
  page,
  themeBundleUrl,
  themeName,
  themeCssUrl,
  themeCssDeferredUrl,
  shellHtml,
}: PageRendererProps) {
  // Seed from the loader cache synchronously so an already-loaded theme (e.g. a
  // client-side navigation between pages) renders on the first paint with no flash.
  const [themeModule, setThemeModule] = useState<LoadedThemeModule | null>(() =>
    getLoadedTheme(themeName)
  );
  const [loading, setLoading] = useState(() => getLoadedTheme(themeName) === null);
  const [error, setError] = useState<string | null>(null);

  // Theme stylesheet. Rendered declaratively (NOT injected in an effect) so React
  // 19 hoists it into the server-rendered <head> as a render-blocking, deduped
  // resource. This is what kills the flash of unstyled content: the CSS is fetched
  // during initial HTML parse and applied before any theme content paints. The
  // `precedence` prop is what makes React treat it as a hoistable stylesheet; it is
  // emitted in every render branch and deduped by href, so it stays in <head>
  // across the loading → loaded transition.
  const themeStylesheet = themeCssUrl ? (
    <link
      rel="stylesheet"
      href={themeCssUrl}
      precedence="theme"
      data-theme-stylesheet={themeName}
    />
  ) : null;

  // Deferred (non-blocking, `theme-deferred` precedence) theme stylesheet
  // (D-05/D-06/D-07, RESEARCH Pitfall 2 mitigation, T-11-13). This is an ISOLATED
  // useState/useEffect pair — deliberately NOT merged into the themeModule/loading/
  // error state above — so React 19's "wait for a newly-introduced stylesheet to
  // load before committing" behavior is scoped to only this no-op render, never
  // stalling the actual theme load/render sequence.
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    const ric =
      (window as any).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 0));
    const id = ric(() => setDeferredReady(true));
    return () => (window as any).cancelIdleCallback?.(id);
  }, []);
  // `precedence="theme-deferred"` is a DIFFERENT precedence than the critical
  // stylesheet's `precedence="theme"` — React 19 only orders stylesheets within
  // the same precedence group, so this deferred link never gets hoisted ahead of
  // (or blocks) the critical `theme` stylesheet. Emitted, as a sibling of
  // {themeStylesheet}, in EVERY render branch below (loading / error / main) so it
  // starts loading regardless of whether the theme bundle has finished loading —
  // deduped by React (by href) across the loading -> loaded transition, same as
  // {themeStylesheet}.

  useEffect(() => {
    // Check cache first
    const cached = getLoadedTheme(themeName);
    if (cached) {
      setThemeModule(cached);
      setLoading(false);
      return;
    }

    // Load theme bundle (already preloaded via <link rel="preload">, so this
    // resolves from cache almost immediately).
    loadThemeFromUrl(themeBundleUrl, themeName)
      .then((module) => {
        setThemeModule(module);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load theme:", err);
        setError(err instanceof Error ? err.message : "Failed to load theme");
        setLoading(false);
      });
  }, [themeBundleUrl, themeName]);

  // Whether the client tree has actually taken over (bundle loaded, no
  // error) -- the ONLY state in which the shell branch below must NOT win,
  // because reaching it IS the swap.
  const themeModuleReady = !loading && !error && themeModule !== null;

  // META-06/D-09: single-<h1>-per-page normalization for the LIVE tree, an
  // ISOLATED ref/state/effect trio kept deliberately separate from the
  // themeModule/loading/error state above, same isolation discipline as the
  // deferredReady pair. `containerRef` targets the main branch's outer
  // container element below. `needsPromotedH1` gates rendering a promoted
  // heading as a REAL React element (never inserted from the effect as a raw
  // DOM node -- the container's children belong to React, and a foreign first
  // child is exactly what React's reconciliation is entitled to trip over on
  // a later update).
  const containerRef = useRef<HTMLDivElement>(null);
  const [needsPromotedH1, setNeedsPromotedH1] = useState(false);
  // WR-01 (13-06 review, documented rather than closed -- see review for the
  // full rationale): D-06 ("a section skipped on the server may re-appear
  // client-side") is scoped to "a section's CONTENT appearing/disappearing".
  // It does NOT account for a heading-owning section specifically: if section
  // A (order 0, has an <h1>) fails server-side but succeeds in the browser,
  // and section B (order 1, also has an <h1>) is the first heading the SERVER
  // shell ever sees, the server shell keeps B's <h1> as the page's sole
  // heading. Once A reappears client-side and this effect re-runs, A is now
  // first in document order, so THIS pass demotes B's already-visible <h1> to
  // <h2> at swap time -- a heading level (and possibly visible text) changing
  // after the swap, which D-02's "no visible change on the healthy path"
  // guarantee does not anticipate. Cannot happen with today's single
  // heading-bearing section per production theme (13-RESEARCH.md); genuinely
  // possible for a future theme with two or more heading-bearing sections.
  // Accepted, not fixed: closing it would require this effect to know about
  // the SERVER shell's heading choice, reintroducing exactly the
  // cross-tier coordination this module (deliberately framework/tier-neutral,
  // see file header) exists to avoid. See heading-normalizer.test.ts for a
  // pinned regression test of this exact divergence.
  // `useLayoutEffect`, NOT `useEffect`: it runs synchronously before paint,
  // and the state update it schedules is flushed before paint too, so a page
  // with a duplicate or missing heading never shows the un-normalized state
  // for even one frame (13-RESEARCH.md Pitfall 4; D-02 extends "no flash" to
  // this normalization, not just the shell swap). Depends on `themeModule`'s
  // identity so a client-side navigation that swaps theme modules re-runs
  // the pass.
  useLayoutEffect(() => {
    if (!themeModuleReady || !containerRef.current) return;
    try {
      const { h1Count } = HeadingNormalizer.normalizeHeadingsInDom(containerRef.current);
      setNeedsPromotedH1(h1Count === 0);
    } catch {
      // Swallow: this pass must never throw into the render (T-13-14). Worst
      // case, a duplicate/missing heading survives uncorrected on the live
      // tree -- never a broken page.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeModule]);

  // WR-02 (13-06 review fix): the branch-priority DECISION lives in
  // `selectRenderBranch` above (unit-tested directly) so the four `if`s below
  // stay a faithful, unchanged copy of what that pure function already
  // computes -- this call has no behavioral effect of its own, it exists so
  // any future edit to the conditions below has a companion pure function
  // that must be edited too, and a test suite that will fail loudly if they
  // ever drift apart.
  const renderBranch = selectRenderBranch({
    shellHtml,
    themeModuleReady,
    loading,
    error,
    themeModule,
  });

  // D-03: the shell branch is checked FIRST and wins over both the loading
  // placeholder and the error screen below. Whenever a server shell exists
  // and the client tree has not yet taken over -- still loading, OR the
  // bundle load failed (404, network drop, JS disabled never reaches this
  // component at all) -- the visitor keeps the server-rendered content,
  // non-interactive, rather than seeing a blank placeholder or "Error
  // loading theme". Add a comment here naming D-03 so a future edit does not
  // silently restore the old branch priority.
  if (renderBranch === "shell" && shellHtml != null) {
    // The `shellHtml != null` conjunct is redundant with `selectRenderBranch`
    // (it only ever returns "shell" when `shellHtml != null`) -- it exists
    // purely so TypeScript's control-flow narrowing knows `shellHtml` is a
    // real string below, for `dangerouslySetInnerHTML`. `renderBranch` alone
    // remains the actual decision; this can never evaluate to false when
    // `renderBranch === "shell"`.
    return (
      <>
        {themeStylesheet}
        {deferredReady && themeCssDeferredUrl && (
          <link
            rel="stylesheet"
            href={themeCssDeferredUrl}
            precedence="theme-deferred"
            data-theme-stylesheet-deferred={themeName}
          />
        )}
        <link rel="preload" as="script" href={themeBundleUrl} crossOrigin="anonymous" />
        {/*
          Safety comes from `dangerouslySetInnerHTML` making React skip
          child reconciliation for this subtree entirely during hydration --
          it adopts whatever is already in the DOM regardless of what the
          client's own render would have produced for these children. The
          hydration-warning suppressor below is defensive only (it reaches
          one level deep); the client's FIRST render emits this exact
          element with this exact `shellHtml` string, since it is a plain
          prop that arrives identically on server and client.
        */}
        <div
          className="min-h-screen"
          dangerouslySetInnerHTML={{ __html: shellHtml }}
          suppressHydrationWarning
        />
      </>
    );
  }

  if (renderBranch === "loading") {
    // Silent placeholder — no "Loading…" text. Also eagerly preload the bundle so
    // the download starts immediately even when page.tsx didn't emit a preload.
    return (
      <>
        {themeStylesheet}
        {deferredReady && themeCssDeferredUrl && (
          <link
            rel="stylesheet"
            href={themeCssDeferredUrl}
            precedence="theme-deferred"
            data-theme-stylesheet-deferred={themeName}
          />
        )}
        <link rel="preload" as="script" href={themeBundleUrl} crossOrigin="anonymous" />
        <div className="min-h-screen" aria-hidden="true" />
      </>
    );
  }

  // D-03: narrowed from the original unconditional `error || !themeModule`
  // so this failure screen is reachable ONLY when there is no server shell
  // to fall back on. Server-rendered content that already rendered
  // successfully must never be replaced by this screen.
  if (renderBranch === "error") {
    return (
      <>
        {themeStylesheet}
        {deferredReady && themeCssDeferredUrl && (
          <link
            rel="stylesheet"
            href={themeCssDeferredUrl}
            precedence="theme-deferred"
            data-theme-stylesheet-deferred={themeName}
          />
        )}
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <p className="text-lg font-semibold text-destructive">Error loading theme</p>
            <p className="text-sm text-muted-foreground">{error || "Theme module not found"}</p>
          </div>
        </div>
      </>
    );
  }

  if (!themeModule) {
    // Unreachable in practice: every branch above returns unless
    // `!loading && !error && themeModule` (i.e. `themeModuleReady`), so
    // `themeModule` is always non-null by this point. TypeScript's
    // control-flow analysis cannot follow that compound boolean logic across
    // the `shellHtml`-gated branches above, so this guard exists purely to
    // keep this function type-safe.
    return null;
  }

  // Resolve sections through the shared seam (@/lib/section-resolver) so the
  // client tree and the server shell (lib/server-shell.tsx, added in a later
  // task) can never drift: section-key resolution, prop conversion, and the
  // orphan-section skip all live in exactly one place now.
  const resolvedSections = resolveSectionsForRender(page, themeModule);

  return (
    <>
      {themeStylesheet}
      {deferredReady && themeCssDeferredUrl && (
        <link
          rel="stylesheet"
          href={themeCssDeferredUrl}
          precedence="theme-deferred"
          data-theme-stylesheet-deferred={themeName}
        />
      )}
      <div className="min-h-screen" ref={containerRef}>
        {/*
          META-06/D-09: rendered as a REAL React element -- gated on
          `needsPromotedH1`, set by the useLayoutEffect above -- rather than
          inserted into the DOM from the effect, so React's own reconciliation
          owns this node like every other child. Must be the FIRST child so a
          zero-heading composition still yields exactly one h1 as the
          document's first heading, matching the server shell's placement.
          Tag, marker attribute, and inline style all come from
          `HeadingNormalizer`'s shared constants -- never restated here -- so
          the server and the client can never disagree on any of the three.
          The style is applied via a ref callback (not the `style` prop,
          which requires a JS object) so the exact same CSS-text constant
          `buildPromotedH1Html` uses server-side is reused byte-for-byte,
          rather than hand-translated into a parallel object literal.
        */}
        {needsPromotedH1 && (
          <h1
            {...{ [HeadingNormalizer.PROMOTED_H1_ATTR]: "true" }}
            ref={(el) => {
              el?.setAttribute("style", HeadingNormalizer.PROMOTED_H1_INLINE_STYLE);
            }}
          >
            {page.title}
          </h1>
        )}
        {resolvedSections.map((r) => (
          <div key={r.keyForReact}>
            <r.Component {...r.props} />
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Convert page metafields (Record<string, unknown>) to flat component props.
 * Reuses convertStrapiDataToProps so all field type normalization applies.
 */
export function convertPageMetafields(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  return sharedConvertStrapiDataToProps(raw);
}
