/**
 * The server shell builder (Phase 13, D-01).
 *
 * This module imports `react-dom/server` and is therefore SERVER-ONLY -- it
 * must never be imported from a client-boundary-marked module or become
 * reachable from a client bundle. Its job is to turn a resolved page + a
 * server-evaluated theme module (Phase 12's `evaluateThemeServerSide`) into a
 * single opaque HTML string: the "shell" that a no-JS visitor sees
 * permanently and a JS-enabled visitor sees until the theme bundle finishes
 * loading and the live React tree swaps in (`lib/page-renderer.tsx`).
 *
 * `null` is the ONE signal this module ever returns for "no server shell" --
 * it is never thrown, and an empty string is never returned in its place.
 * The caller (`app/_lib/render-page.tsx`) maps a `null` result onto today's
 * client-only fallback (SSR-04).
 */

// React and the renderer come from `lib/ssr-react-runtime.ts`, NOT from the
// bare "react" / "react-dom/server" specifiers. Two separate reasons, both
// load-bearing:
//
//   1. A static `import ... from "react-dom/server"` anywhere in the Server
//      Component graph is a HARD COMPILE ERROR under Next's SWC
//      `react-server-components` pass ("You're importing a component that
//      imports react-dom/server"). This file is reachable from `app/page.tsx`,
//      so the bare specifier failed every tenant build outright.
//   2. The RSC layer aliases bare `react` to React's hookless `react-server`
//      build, so `React.createElement` here and the React injected into the
//      theme sandbox must BOTH come from the same full copy, paired with the
//      renderer, or stateful sections throw and are silently skipped.
//
// See `ssr-react-runtime.ts`'s header for the whole mechanism.
import {
  React,
  renderToStaticMarkup,
  SSR_REACT_RUNTIME_HEALTH,
} from "./ssr-react-runtime";
import { resolveSectionsForRender } from "./section-resolver";
import type { ResolvedSection } from "./section-resolver";
import { reportSectionRenderFailure, reportSsrRuntimeUnavailable } from "./theme-evaluator";
import type { LoadedThemeModule } from "./theme-loader";
import type { StrapiPage } from "./strapi-client";
import type { SectionRecordProps } from "./article-contract";
// Namespace import (matches this repo's `import * as Sentry from
// "@sentry/nextjs"` convention): a literal reference to the normalization
// function's name below appears exactly once, at its one call site, since
// the import specifier here names only the module.
import * as HeadingNormalizer from "./heading-normalizer";

/**
 * D-04: the env-var kill switch. Server-side only, so no `NEXT_PUBLIC_`
 * prefix -- a tenant flips it in Vercel project settings and redeploys, with
 * no code change and no rollback deploy.
 */
export const SSR_SHELL_DISABLE_ENV = "THETA_DISABLE_SSR_SHELL";

/**
 * Reads `env[SSR_SHELL_DISABLE_ENV]` and returns `true` only when the value
 * is a non-empty string that is not `"0"` and not `"false"`. Deliberately
 * one step stricter than the repo's existing bare `!!process.env.X` truthy
 * check (`render-page.tsx`, `instrumentation.ts`) -- an operator who sets the
 * variable to the literal string `"false"` intending to ENABLE SSR would
 * otherwise silently disable it. A pure function of an injected env object,
 * so it stays unit-testable.
 */
export function isSsrShellDisabled(env: Record<string, string | undefined>): boolean {
  const value = env[SSR_SHELL_DISABLE_ENV];
  if (value == null || value === "" || value === "0" || value === "false") {
    return false;
  }
  return true;
}

/**
 * The sentinel `sectionKey` value `reportSectionRenderFailure` is called with
 * when the FAILURE ITSELF is not attributable to one identifiable section --
 * i.e. the whole-body `catch` in `buildShellHtml` below, which guards against
 * `resolveSectionsForRender` itself throwing (not a per-section render
 * failure, which always carries a real section key). Distinguishes a
 * builder-level failure from a section-level one in Sentry while both still
 * route through the same D-07 seam. `"*"` can never collide with a real
 * section key: Strapi section keys are user-authored strings, and the CMS
 * schema does not permit a bare `*`.
 */
export const SHELL_BUILDER_SECTION_KEY = "*";

/**
 * The one static-markup render call in this file, made PER SECTION, each
 * independently wrapped in its own try/catch (SSR-05). The host's static
 * (non-hydratable) server-render entry point is used deliberately over its
 * hydration-marker-emitting sibling: those markers are never structurally
 * reattached here -- the shell is always opaque -- so they would leak into
 * crawler-visible HTML for no benefit.
 *
 * On success, a section's markup is wrapped in a plain `div` element so the
 * string matches the wrapper element the client tree emits for the SAME
 * section (`lib/page-renderer.tsx`'s `<div key={r.keyForReact}>`), which is
 * what makes D-02's swap invisible.
 *
 * On a throw, reports through `reportSectionRenderFailure` and returns an
 * empty string for that section -- nothing is emitted in its place (D-05,
 * matching the orphan-section precedent already in `section-resolver.tsx`).
 * Per-call try/catch is the only isolation mechanism available here:
 * `componentDidCatch` does not run during synchronous server rendering, so a
 * single whole-page render call either fully succeeds or throws with zero
 * partial output. This is exactly why there is exactly one call site below,
 * invoked once per section inside this `.map` -- never once over the whole
 * composition -- since a whole-composition call cannot satisfy SSR-05 (see
 * the file-level rationale above and 13-RESEARCH.md Pattern 2).
 */
export function renderResolvedSectionsToHtml(
  sections: ResolvedSection[],
  themeName: string
): string[] {
  return sections.map(({ sectionKey, Component, props }) => {
    try {
      const html = renderToStaticMarkup(React.createElement(Component, props));
      return `<div>${html}</div>`;
    } catch (err) {
      // Guard the reporter call itself: a telemetry failure (e.g. the Sentry
      // SDK throwing synchronously) must never be able to turn a graceful
      // per-section degrade into a throw that escapes this function -- the
      // exact same reason `theme-evaluator.ts`'s own `reportEvaluationFailure`
      // wraps its `Sentry.captureException` call in a swallowing try/catch.
      try {
        reportSectionRenderFailure(
          themeName,
          sectionKey,
          err instanceof Error ? err.message : String(err)
        );
      } catch {
        // Swallow: the section is still skipped (empty string returned
        // below) regardless of whether the report itself succeeded.
      }
      return "";
    }
  });
}

/**
 * Build the opaque shell string for one page. Calls
 * `resolveSectionsForRender` (the shared seam, `@/lib/section-resolver`),
 * then `renderResolvedSectionsToHtml`, then joins the non-empty strings.
 *
 * Returns `null` -- **never** `""`, and never a wrapper element with no
 * children -- for every one of these cases:
 *   - `resolveSectionsForRender` yields an empty array (zero sections in the
 *     page's template, or every section's key is absent from the theme
 *     module's `sectionsComponents`);
 *   - every per-section result from `renderResolvedSectionsToHtml` is an
 *     empty string (e.g. every section threw);
 *   - the joined, non-empty results are empty after trimming (defensive:
 *     covers a section that "succeeds" but legitimately renders nothing);
 *   - anything unexpected throws (wrapped in the try/catch below, which
 *     reports through `reportSectionRenderFailure` with the
 *     `SHELL_BUILDER_SECTION_KEY` sentinel, since the failure here is not
 *     attributable to any one section).
 *
 * This is deliberate and load-bearing, not an arbitrary choice: an empty
 * STRING (`""`) would still satisfy `shellHtml != null` in `PageRenderer`,
 * which would pin the visitor on a permanently blank page instead of falling
 * through to the client-only render -- the precise inversion of D-03's
 * shell-wins-over-error priority, which exists to make sure the visitor
 * always sees SOMETHING. `null` is the one and only "no server shell"
 * signal; the caller (`app/_lib/render-page.tsx`) maps it onto today's
 * client-only fallback (SSR-04).
 */
export function buildShellHtml(args: {
  page: StrapiPage;
  themeModule: LoadedThemeModule;
  themeName: string;
  /**
   * Phase 21 (D-06/D-16): the resolved post/listing, threaded through the
   * SAME shared seam (`resolveSectionsForRender`) the client tree
   * (`lib/page-renderer.tsx`) uses, so the server string and the client tree
   * can never carry different `article`/`archive` values. Optional and
   * absent on every non-blog page composition today.
   */
  recordProps?: SectionRecordProps;
}): string | null {
  const { page, themeModule, themeName, recordProps } = args;

  // Gate on the server-side React runtime BEFORE attempting any section, so a
  // platform-level breakage is reported once, under its own reason, with a
  // diagnostic that names what broke.
  //
  // Without this gate the same breakage still "degrades gracefully" -- every
  // section throws `useState is not a function`, each is caught and skipped,
  // and this function returns `null` -- but it does so wearing the disguise of
  // `section-render-threw`, once per section per request, which reads as "this
  // tenant's theme is broken" rather than "the platform's React runtime is".
  // That misattribution is the entire reason this branch exists; the returned
  // value is deliberately identical (`null` -> today's client-only fallback,
  // SSR-04), because a visitor-facing throw here would violate D-03.
  if (!SSR_REACT_RUNTIME_HEALTH.healthy) {
    try {
      reportSsrRuntimeUnavailable(themeName, SSR_REACT_RUNTIME_HEALTH.reason);
    } catch {
      // Swallow, exactly as every other reporter call site in this file does:
      // a telemetry failure must never escalate a graceful degrade into a throw.
    }
    return null;
  }

  try {
    // CR-01 (13-06 review fix): resolution-time failures (a section whose
    // props fail to build) are now caught and isolated INSIDE
    // resolveSectionsForRender itself, one section at a time -- this closure
    // is how that per-section reporting still reaches
    // `reportSectionRenderFailure` with a real `sectionKey`, instead of
    // falling through to this function's own outer `catch` below, which can
    // only ever attribute a failure to the `SHELL_BUILDER_SECTION_KEY`
    // sentinel because it has no per-section granularity.
    const resolved = resolveSectionsForRender(
      page,
      themeModule,
      (sectionKey, message) => reportSectionRenderFailure(themeName, sectionKey, message),
      recordProps
    );
    if (resolved.length === 0) {
      return null;
    }

    const htmls = renderResolvedSectionsToHtml(resolved, themeName);
    const nonEmpty = htmls.filter((html) => html !== "");
    if (nonEmpty.length === 0) {
      return null;
    }

    // META-06/D-09: normalization runs as the LAST step before joining, over
    // the per-section array in the SAME order sections were rendered
    // (ascending by `order`, ties by source-array position -- the order
    // `resolveSectionsForRender` already produced). Running this earlier, or
    // over data that doesn't preserve that order, would silently pick the
    // wrong heading as the survivor -- a wrong result with no error
    // (13-RESEARCH.md Pitfall 3). `page.title` is the fallback used only when
    // the composition has zero authored headings.
    const normalized = HeadingNormalizer.normalizeHeadingsAcrossSections(nonEmpty, page.title);

    const joined = normalized.join("");
    if (joined.trim() === "") {
      return null;
    }

    return joined;
  } catch (err) {
    // Guard this reporter call too, for the same reason
    // `renderResolvedSectionsToHtml` guards its own: a telemetry failure must
    // never be able to turn this already-degraded path into a throw.
    try {
      reportSectionRenderFailure(
        themeName,
        SHELL_BUILDER_SECTION_KEY,
        err instanceof Error ? err.message : String(err)
      );
    } catch {
      // Swallow: `null` is still returned below regardless.
    }
    return null;
  }
}
