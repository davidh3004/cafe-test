/**
 * The single owner of one question: WHICH COPY of React does server-side theme
 * rendering use?
 *
 * Getting this wrong does not produce an error — it produces a silently empty
 * server render, which is why the decision is centralized here with a live
 * health probe instead of being spread across import lines in two modules.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * Inside the App Router's React Server Components layer, Next.js rewrites the
 * bare `react` specifier via a webpack alias
 * (`createRSCAliases` in `next/dist/build/create-compiler-aliases.js`):
 *
 *     react$ -> next/dist/server/route-modules/app-page/vendored/rsc/react
 *
 * That vendored build is the `react-server` build, and it deliberately does NOT
 * export the client hooks — `useState`, `useRef`, `useEffect` are all absent.
 * Server Components have no state, so React removes the surface entirely.
 *
 * Theme section components are ordinary CLIENT components that Phase 12
 * evaluates server-side in a `node:vm` context. They call `React.useState`. So
 * injecting the RSC layer's `react` into that sandbox makes every stateful
 * section throw
 *
 *     TypeError: t.useState is not a function or its return value is not iterable
 *
 * on its first render. Per-section isolation in `lib/server-shell.tsx` then
 * catches each throw, skips the section, and `buildShellHtml` returns `null` —
 * so the page silently falls back to client-only rendering. The build stays
 * green, SSR-01 delivers nothing, and nothing anywhere reports a defect. That
 * failure mode is invisible from Node-environment unit tests, because outside
 * webpack `react` is simply the full React.
 *
 * A second, louder instance of the same root cause: a static
 * `import ... from "react-dom/server"` anywhere in the Server Component graph
 * is rejected outright at compile time by Next's SWC `react-server-components`
 * pass ("You're importing a component that imports react-dom/server"), which is
 * what surfaced this whole class of bug as a hard tenant build failure.
 *
 * ---------------------------------------------------------------------------
 * THE FIX
 * ---------------------------------------------------------------------------
 * Import React, the JSX runtime, ReactDOM, and `renderToStaticMarkup` from
 * Next's own bundled copies under `next/dist/compiled/*`. Those paths are NOT
 * aliased in the non-edge RSC layer, so they resolve to the FULL React build
 * with hooks intact, and they are not on SWC's rejected-specifier list.
 *
 * Critically, all four come from the SAME copy. React's hook dispatcher is
 * read off the React instance that `react-dom/server` was built against, so a
 * mismatched pair (say, `next/dist/compiled/react` rendered by the public
 * `react-dom/server`) reintroduces the exact `useState is not a function`
 * throw this module exists to prevent. Any future edit here must keep the four
 * imports below on a single `next/dist/compiled/` prefix.
 *
 * ---------------------------------------------------------------------------
 * KNOWN CONSTRAINT: NODE RUNTIME ONLY
 * ---------------------------------------------------------------------------
 * When Next builds for the EDGE runtime it adds
 * `'next/dist/compiled/react$' -> next/dist/compiled/react/react.react-server`
 * (the `isEdgeServer` branch of the same `createRSCAliases`), which would put
 * us right back on a hookless React. Theme-site pages are ISR-rendered in the
 * Node runtime, so this holds today — and if that ever changes, the health
 * probe below detects it and the shell degrades loudly instead of silently.
 */

import React from "next/dist/compiled/react";
import * as jsxRuntime from "next/dist/compiled/react/jsx-runtime";
import ReactDOM from "next/dist/compiled/react-dom";
import { renderToStaticMarkup } from "next/dist/compiled/react-dom/server";

export { React, ReactDOM, jsxRuntime, renderToStaticMarkup };

/**
 * Result of the startup probe. A string `reason` is carried on the unhealthy
 * branch so the caller can report WHAT broke, not merely that something did —
 * a bare boolean would make the eventual Sentry event unactionable.
 */
export type SsrReactRuntimeHealth =
  | { healthy: true }
  | { healthy: false; reason: string };

/**
 * Prove — by actually rendering — that the four imports above form a working,
 * hook-capable, correctly-paired runtime.
 *
 * This deliberately does a real `renderToStaticMarkup` of a real stateful
 * component rather than only feature-detecting `typeof React.useState`.
 * Presence checks cannot catch the mismatched-pair failure: in that case
 * `React.useState` IS a function, it just throws when invoked because the
 * renderer never installed a dispatcher on this particular React instance.
 * The probe reproduces the one thing that has to work, so it cannot pass while
 * the real path fails.
 *
 * Cost is one render of a two-node tree at module load, once per server
 * instance. Never throws — a probe that could throw would take down the whole
 * route rather than degrading it.
 */
export function checkSsrReactRuntime(): SsrReactRuntimeHealth {
  for (const [name, value] of [
    ["React.createElement", React?.createElement],
    ["React.useState", React?.useState],
    ["React.useRef", React?.useRef],
    ["React.useEffect", React?.useEffect],
    ["jsxRuntime.jsx", (jsxRuntime as { jsx?: unknown })?.jsx],
    ["renderToStaticMarkup", renderToStaticMarkup],
  ] as const) {
    if (typeof value !== "function") {
      return {
        healthy: false,
        reason: `${name} is not a function (got ${typeof value}) — the RSC layer is supplying a react-server build without client hooks`,
      };
    }
  }

  try {
    const Probe = () => {
      const [value] = React.useState("ok");
      React.useRef(null);
      React.useEffect(() => {}, []);
      return React.createElement("i", null, value);
    };
    const html = renderToStaticMarkup(React.createElement(Probe));
    if (html !== "<i>ok</i>") {
      return {
        healthy: false,
        reason: `probe render produced ${JSON.stringify(html)}, expected "<i>ok</i>"`,
      };
    }
  } catch (err) {
    return {
      healthy: false,
      reason: `probe render threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { healthy: true };
}

/**
 * Evaluated once at module load. Read by `lib/server-shell.tsx` before it
 * builds a shell, so a broken runtime costs one probe render per server
 * instance rather than one failed render per section per request.
 */
export const SSR_REACT_RUNTIME_HEALTH: SsrReactRuntimeHealth = checkSsrReactRuntime();
