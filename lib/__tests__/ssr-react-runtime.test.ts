import { describe, expect, it, vi } from "vitest";
import {
  React,
  ReactDOM,
  jsxRuntime,
  renderToStaticMarkup,
  checkSsrReactRuntime,
  SSR_REACT_RUNTIME_HEALTH,
} from "../ssr-react-runtime";

/**
 * These tests pin the contract that makes server-side theme rendering possible
 * at all: the React this module hands out must have CLIENT HOOKS, and it must
 * be PAIRED with the renderer it hands out.
 *
 * Both halves regressed silently once already. The RSC layer aliases bare
 * `react` to React's hookless `react-server` build, so `import React from
 * "react"` in `theme-evaluator.ts` injected a React whose `useState` did not
 * exist -- every stateful section threw, was caught by per-section isolation,
 * and the page fell back to client-only rendering with a green build and no
 * error anywhere. Nothing in a Node-environment suite catches that by accident,
 * because outside webpack `react` is simply the full React. So these assertions
 * are worth little as "does React work" checks and everything as a tripwire on
 * the import lines in `ssr-react-runtime.ts`.
 */
describe("ssr-react-runtime — the injected React is hook-capable (the RSC react-server trap)", () => {
  it("exports client hooks that the RSC layer's react-server build omits", () => {
    // Named individually rather than looped: these four are exactly the ones
    // absent from the react-server build, so each is a distinct regression.
    expect(typeof React.useState).toBe("function");
    expect(typeof React.useRef).toBe("function");
    expect(typeof React.useEffect).toBe("function");
    expect(typeof React.createElement).toBe("function");
  });

  it("exports a working JSX runtime and ReactDOM namespace for the theme sandbox", () => {
    expect(typeof (jsxRuntime as { jsx?: unknown }).jsx).toBe("function");
    expect(typeof (jsxRuntime as { jsxs?: unknown }).jsxs).toBe("function");
    // `createPortal` stands in for "this is the real react-dom namespace";
    // theme bundles receive this object as their `ReactDOM` global.
    expect(typeof (ReactDOM as { createPortal?: unknown }).createPortal).toBe("function");
  });

  it("pairs React with the renderer, so hooks actually resolve a dispatcher", () => {
    // A presence check on `useState` cannot catch a mismatched pair: the
    // function exists, then throws "Invalid hook call" when invoked because the
    // renderer installed its dispatcher on a DIFFERENT React instance. Only
    // invoking it through this module's own renderer proves the pairing.
    const Stateful = () => {
      const [value] = React.useState("paired");
      React.useRef(null);
      React.useEffect(() => {}, []);
      return React.createElement("span", null, value);
    };
    expect(renderToStaticMarkup(React.createElement(Stateful))).toBe(
      "<span>paired</span>"
    );
  });
});

describe("checkSsrReactRuntime — the startup probe", () => {
  it("reports healthy for the real runtime, and the module-load constant agrees", () => {
    expect(checkSsrReactRuntime()).toEqual({ healthy: true });
    expect(SSR_REACT_RUNTIME_HEALTH).toEqual({ healthy: true });
  });

  it("reports unhealthy with a diagnostic naming the missing API, instead of throwing", async () => {
    // Simulate the exact production failure: a React lacking `useState`, which
    // is what the RSC layer's react-server build looks like.
    vi.resetModules();
    vi.doMock("next/dist/compiled/react", async (importOriginal) => {
      const actual = await importOriginal<Record<string, unknown>>();
      const hookless = { ...(actual.default ?? actual), useState: undefined };
      return { ...hookless, default: hookless };
    });

    const mod = await import("../ssr-react-runtime");
    const health = mod.checkSsrReactRuntime();

    expect(health.healthy).toBe(false);
    // The reason must name WHAT broke — a bare `false` would make the eventual
    // Sentry event unactionable, which is the whole point of carrying a string.
    expect(health.healthy === false && health.reason).toContain("React.useState");

    vi.doUnmock("next/dist/compiled/react");
    vi.resetModules();
  });
});
