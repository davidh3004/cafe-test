/**
 * Hand-authored stand-in for a published theme bundle.
 *
 * Its wrapper signature deliberately mirrors the real emitted theme bundle's
 * IIFE (see 12-01-PLAN.md "Facts established by pre-planning probes" item 1):
 * a top-level `var` binding assigned from a function expression that takes
 * three parameters -- an exports object, the jsx runtime, and React -- and
 * is immediately invoked with an empty object literal and the bare
 * identifiers `jsxRuntime` and `React`, in that order.
 *
 * This file is NEVER transpiled -- it is read as raw text and evaluated
 * inside a node:vm context exactly as-is, so it MUST stay plain
 * ES5-compatible JavaScript: no JSX syntax, no import/export syntax.
 */
var FixtureTheme = (function (exports, jsxRuntime, React) {
  "use strict";

  function FixtureHero(props) {
    var state = React.useState(0);
    var count = state[0];
    var variantClass = cva.cva("p-4")();
    var mergedClass = clsx.clsx("base-class", { "active-class": true });
    var spacingClass = twMerge.twMerge("p-2", "p-4");
    var className = variantClass + " " + mergedClass + " " + spacingClass;
    return jsxRuntime.jsxs("div", {
      "data-testid": "fixture-hero",
      className: className,
      children: [
        jsxRuntime.jsx("h1", { children: props.title || "Fixture Hero" }),
        jsxRuntime.jsx("p", { children: "count: " + count }),
        jsxRuntime.jsx(LucideReact.Check, { size: 16 }),
      ],
    });
  }

  function FixturePlain(props) {
    return jsxRuntime.jsx("div", {
      "data-testid": "fixture-plain",
      children: props.title || "Fixture Plain",
    });
  }

  // Phase 13 Plan 02 (SSR-05): throws on every render, unconditionally, with a
  // fixed and greppable message -- the fixture's only section that can
  // actually fail the server-render path, proving per-section isolation.
  function FixtureThrows() {
    // Deliberately ignores its props argument -- it throws unconditionally
    // on every render regardless of what it is called with.
    throw new Error("FixtureThrows: deliberate render-time failure");
  }

  // Phase 13 Plan 02 (META-06): a SECOND h1-bearing section. Before this, only
  // FixtureHero emitted an h1 -- a composition could never legitimately reach
  // MORE than one h1 for Plan 04's duplicate-heading normalization path to
  // exercise. `props.heading` with a literal default, per the plan's action.
  function FixtureBanner(props) {
    return jsxRuntime.jsxs("div", {
      "data-testid": "fixture-banner",
      children: [
        jsxRuntime.jsx("h1", { children: props.heading || "Fixture Banner" }),
        jsxRuntime.jsx("p", { children: "banner body" }),
      ],
    });
  }

  // Phase 13 Plan 02 (META-06): a heading-free section -- no h1, no heading
  // element at all -- so a composition can legitimately reach ZERO h1s for
  // Plan 04's promote-a-heading-when-absent path to exercise.
  function FixtureCard(props) {
    return jsxRuntime.jsxs("div", {
      "data-testid": "fixture-card",
      children: [
        jsxRuntime.jsx("h2", { children: props.heading || "Fixture Card" }),
        jsxRuntime.jsx("p", { children: "card body" }),
      ],
    });
  }

  // Phase 13-06 (CR-01): registered under its own key, distinct from
  // "plain"/"hero", so resolution-time-failure tests (malformed
  // `data`/`blocks`, which throw in section-resolver.tsx BEFORE this
  // component is ever invoked) can point at a semantically-named section
  // instead of overloading an existing one. The component itself is
  // unremarkable -- FixturePlain in a party hat -- because the isolation
  // being proven happens entirely in shared resolution code, never in this
  // component's own body (that render-body case is what "throws" above
  // already covers).
  function FixtureResolutionTarget(props) {
    return jsxRuntime.jsx("div", {
      "data-testid": "fixture-resolution-target",
      children: props.title || "Fixture Resolution Target",
    });
  }

  window.__THETA_THEMES__ = window.__THETA_THEMES__ || {};
  window.__THETA_THEMES__["fixture-theme"] = {
    name: "fixture-theme",
    version: "0.0.0-test",
    sectionsComponents: {
      hero: FixtureHero,
      plain: FixturePlain,
      throws: FixtureThrows,
      banner: FixtureBanner,
      card: FixtureCard,
      "resolution-target": FixtureResolutionTarget,
    },
    sectionSettingsSchemas: {
      hero: [],
      plain: [],
      throws: [],
      banner: [],
      card: [],
      "resolution-target": [],
    },
  };

  exports.FixtureHero = FixtureHero;
  exports.FixturePlain = FixturePlain;
  exports.FixtureThrows = FixtureThrows;
  exports.FixtureBanner = FixtureBanner;
  exports.FixtureCard = FixtureCard;
  exports.FixtureResolutionTarget = FixtureResolutionTarget;

  return exports;
})({}, jsxRuntime, React);
