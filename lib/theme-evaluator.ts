/**
 * Server-side mirror of theme-loader.ts (the browser loader).
 *
 * Exists so a later phase (Phase 13) can render theme sections into HTML on
 * the server. This module is NOT wired into any render path yet -- nothing
 * under templates/theme-site/app/ imports it (SSR-02).
 *
 * Implements D-01 through D-07 and D-13 from
 * .planning/phases/12-server-side-theme-evaluation-infrastructure/12-CONTEXT.md.
 *
 * IMPORTANT: `node:vm` is used here strictly as an ISOLATION mechanism --
 * bounding runaway loops, accidental global leakage, and module-scope side
 * effects -- and is explicitly NOT a security boundary. Theme bundles are
 * first-party code (D-01). See
 * .planning/phases/12-server-side-theme-evaluation-infrastructure/SSR-07-THREAT-MODEL.md
 * for the full trust-model writeup.
 */

import * as vm from "node:vm";
// React / ReactDOM / the JSX runtime come from `lib/ssr-react-runtime.ts`, NOT
// from the bare "react" / "react-dom" / "react/jsx-runtime" specifiers. In the
// App Router's RSC layer those bare specifiers are aliased to React's
// `react-server` build, which exports no client hooks -- injecting it here made
// every stateful theme section throw `useState is not a function`, get skipped
// by server-shell's per-section isolation, and silently produce an empty server
// render. See that module's header for the full mechanism.
import { React, ReactDOM, jsxRuntime } from "./ssr-react-runtime";
import * as classVarianceAuthority from "class-variance-authority";
import * as clsxModule from "clsx";
import * as LucideReact from "lucide-react";
import * as tailwindMerge from "tailwind-merge";
import * as Sentry from "@sentry/nextjs";
import type { LoadedThemeModule } from "./theme-loader";

export type { LoadedThemeModule };

/**
 * D-13: ~1s bound on execution inside the vm context. `microtaskMode:
 * "afterEvaluate"` (set on `vm.createContext`, see buildSandbox usage below)
 * folds promise-scheduled microtasks into this same bound. It does NOT bound
 * macrotask-scheduled work (setTimeout/setInterval) -- see
 * SSR-07-THREAT-MODEL.md "Known limitations, stated plainly". Generous
 * enough that a legitimate theme never fails on a slow cold start, tight
 * enough to catch a genuine runaway loop. This is a guard against
 * pathological bundles, not a latency control -- ISR absorbs the latency.
 */
export const EVAL_TIMEOUT_MS = 1000;

/**
 * A separate bound on the network fetch step, independent of
 * EVAL_TIMEOUT_MS, so a hung or slow bundle host cannot stall a background
 * ISR regeneration indefinitely.
 */
export const FETCH_TIMEOUT_MS = 5000;

/**
 * T-12-05: how many redirect hops the bundle fetch will follow before giving
 * up. The fetch is issued with `redirect: "manual"` and every hop's Location
 * is re-validated through `assertHttpsBundleUrl`, so validating only the
 * initial URL cannot be bypassed by a 302 to `http://` or to an internal
 * host. Without this the WHATWG default (`redirect: "follow"`) would follow
 * such a hop transparently and the https-only control would hold for the
 * first URL only. Bounded so a redirect loop cannot spin inside the
 * FETCH_TIMEOUT_MS window.
 */
export const MAX_BUNDLE_REDIRECTS = 5;

/**
 * D-08: how long a failed evaluation is negative-cached before the next call
 * is allowed to re-fetch and re-evaluate. Mirrors the render routes' existing
 * `revalidate = 10` ISR window rather than introducing an unrelated constant
 * -- since the render path is ISR, a failing bundle is retried at most once
 * per background regeneration, which is already the natural rate, so this is
 * the smallest value that satisfies D-08 without slowing a fixed bundle's
 * self-heal. Successful results are cached with NO TTL: `builtAssetUrl` is
 * composed from the per-deployment Vercel URL
 * (app/api/deploy/[teamId]/[themeId]/status/route.ts), so a rebuild changes
 * the URL and is already a natural cache miss.
 */
export const NEGATIVE_CACHE_TTL_MS = 10_000;

/** The vm sandbox object: exactly the seven injected globals plus process/__THETA_THEMES__/window. */
export type ThemeSandbox = Record<string, unknown>;

/**
 * The React trio injected into a theme sandbox, as an overridable unit.
 *
 * Exists because WHICH COPY of React a theme's components close over is not a
 * detail — it decides whether `renderToStaticMarkup` can find a hook dispatcher
 * for them. React installs its dispatcher on one React instance, so a theme
 * module and the renderer that consumes it must agree, and the only way to
 * express that in a test is to be able to choose.
 *
 * Production never passes this: the default is `ssr-react-runtime`'s pairing,
 * which is matched to the `renderToStaticMarkup` that `lib/server-shell.tsx`
 * uses. It is overridden only by tests that render a vm-evaluated module through
 * a DIFFERENT renderer -- notably `page-renderer.test.tsx`, which exercises the
 * CLIENT render path, where the browser's `theme-loader.ts` injects the app's
 * own React rather than Next's compiled copy.
 */
export type InjectedReactRuntime = {
  React: unknown;
  ReactDOM: unknown;
  jsxRuntime: unknown;
};

/** The production pairing — see `lib/ssr-react-runtime.ts`. */
export const DEFAULT_REACT_RUNTIME: InjectedReactRuntime = { React, ReactDOM, jsxRuntime };

/**
 * Every degrade site in this module classifies itself with one of these
 * reasons and calls reportEvaluationFailure -- the dedicated-channel half of
 * the degrade-and-record pattern (mirrors scripts/measure-baseline.ts).
 * Plan 02 sends these values to Sentry as a tag.
 */
export type EvaluationFailureReason =
  | "invalid-url"
  | "fetch-failed"
  | "http-error"
  | "empty-body"
  | "evaluation-threw"
  | "not-registered"
  | "invalid-shape"
  /**
   * A section threw while being rendered to HTML (Phase 13, `lib/server-shell.tsx`)
   * AFTER its theme bundle was already successfully fetched, evaluated, and
   * shape-validated by this module. Distinct from `evaluation-threw`, which
   * means the bundle itself failed to evaluate at module scope -- this reason
   * means evaluation succeeded and one specific section's component threw
   * later, during its own `renderToStaticMarkup` call.
   */
  | "section-render-threw"
  /**
   * The server-side React runtime itself is unusable, so NO section could have
   * been rendered regardless of the theme (`lib/ssr-react-runtime.ts`'s startup
   * probe failed). Kept distinct from `section-render-threw` because the
   * remedy is the opposite: that reason points at one theme's component code,
   * this one points at the platform -- almost certainly a Next.js upgrade that
   * moved or re-aliased `next/dist/compiled/react`. Without its own reason this
   * failure would be indistinguishable from "every section in this theme
   * happens to be broken", which is the wrong investigation.
   */
  | "ssr-runtime-unavailable";

/**
 * The one and only reporting seam in this module. Always emits the
 * structured `console.error` first -- the always-on record, independent of
 * Sentry availability or DSN configuration -- then reports to Sentry
 * (D-09) tagged with the subsystem and the specific failure reason, and
 * carrying only `context` (bundle URL, theme name, HTTP status where
 * applicable) as extra data. `context` NEVER carries the bundle text itself
 * or anything derived from it at any call site in this module -- a theme
 * bundle can carry an inlined public token, and Sentry payloads are
 * retained (T-12-09).
 *
 * The Sentry call is wrapped in its own try/catch that swallows and does
 * nothing further: a telemetry failure must never be able to turn a
 * graceful degrade into a throw, which would break D-07's never-throws
 * contract.
 */
function reportEvaluationFailure(
  reason: EvaluationFailureReason,
  context: Record<string, unknown>
): void {
  console.error("[theme-evaluator]", reason, context);

  try {
    Sentry.captureException(new Error(`[theme-evaluator] ${reason}`), {
      tags: { subsystem: "theme-evaluator", reason },
      extra: context,
    });
  } catch {
    // Swallow: see the doc comment above. The console.error above already
    // recorded this failure regardless of what happens here.
  }
}

/**
 * The exported, narrow-signature reporting seam for a section that threw
 * while being rendered to HTML server-side (Phase 13, `lib/server-shell.tsx`,
 * D-07). Reuses this module's one `reportEvaluationFailure` function rather
 * than exporting it directly: a fixed three-argument signature keeps a caller
 * in another file from ever attaching the generic `context` bag section props
 * or CMS field values, extending the existing rule that `context` never
 * carries bundle text (T-12-09) to section-render failures (T-13-03).
 */
export function reportSectionRenderFailure(
  themeName: string,
  sectionKey: string,
  message: string
): void {
  reportEvaluationFailure("section-render-threw", { themeName, sectionKey, message });
}

/**
 * Reporting seam for an unusable server-side React runtime
 * (`lib/ssr-react-runtime.ts`'s probe failed). Routed through this module's one
 * `reportEvaluationFailure` for the same reason `reportSectionRenderFailure` is:
 * a fixed, narrow signature means no caller can ever attach section props or
 * CMS field values to the Sentry `extra` bag (T-12-09 / T-13-03).
 *
 * `message` is the probe's own diagnostic string, which is composed only of API
 * names and `typeof` results — it never carries bundle text.
 */
export function reportSsrRuntimeUnavailable(themeName: string, message: string): void {
  reportEvaluationFailure("ssr-runtime-unavailable", { themeName, message });
}

/**
 * Build a fresh sandbox object carrying exactly the seven globals
 * theme-loader.ts injects in the browser, plus a frozen NODE_ENV-only
 * `process` shim, an empty `__THETA_THEMES__` registry, and a
 * self-referential `window`.
 *
 * The `cva` key MUST be the `class-variance-authority` module NAMESPACE, not
 * its bare `cva` export -- the theme bundle expects to call `xn.cva(...)`.
 * Getting this wrong silently degrades every page using a cva-styled
 * component (mirrors the identical note in theme-loader.ts).
 *
 * Each of the seven globals is defined non-writable and non-configurable so
 * evaluated code cannot replace them (verified: a reassignment attempt
 * throws `TypeError: Cannot redefine property` in strict-mode source, and is
 * a silent no-op in sloppy-mode source -- either way the value never
 * changes).
 */
export function buildSandbox(
  runtime: InjectedReactRuntime = DEFAULT_REACT_RUNTIME
): ThemeSandbox {
  const sandbox: ThemeSandbox = {};

  const injectedGlobals: Record<string, unknown> = {
    React: runtime.React,
    ReactDOM: runtime.ReactDOM,
    jsxRuntime: runtime.jsxRuntime,
    cva: classVarianceAuthority,
    clsx: clsxModule,
    twMerge: tailwindMerge,
    LucideReact,
  };

  for (const key of Object.keys(injectedGlobals)) {
    Object.defineProperty(sandbox, key, {
      value: injectedGlobals[key],
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }

  const env = Object.freeze({ NODE_ENV: "production" });
  sandbox.process = Object.freeze({ env });
  sandbox.__THETA_THEMES__ = {};

  // A MINIMAL DOM STUB — deliberately reverses D-05's original "omit document".
  //
  // Why the original decision could not hold. `sandbox.window = sandbox` below
  // gives themes a defined `window`, but D-05 withheld `document`. No real
  // environment is ever in that state, and it breaks the single most common
  // idiom in browser code:
  //
  //     typeof window !== "undefined" && SomeLib.doBrowserThing()
  //
  // The guard passes because `window` exists, then the browser path runs
  // against a missing `document`. theta-theme-fixocargo hit exactly this:
  // DOMPurify without a `document` returns its degraded stub, which has no
  // `addHook`, so the theme's module-scope
  // `typeof window < "u" && DOMPurify.addHook(...)` threw. A module-scope throw
  // fails the WHOLE bundle evaluation, so `evaluateThemeServerSide` returned
  // null, no shell was built, and crawlers received an empty body. Confirmed in
  // production: 0 <h1>/<h2>/<p>/<section> in 38 KB of served HTML. This is not
  // theme-specific — any theme touching a browser-guarded library at module
  // scope fails identically, which is why SSR had never worked for any tenant.
  //
  // Scope discipline. This is enough shape for browser libraries to initialise,
  // NOT a usable DOM. There is no layout, no real tree, no events. Sections are
  // rendered with `renderToStaticMarkup`, which needs none of that — so a theme
  // that genuinely manipulates the DOM at module scope still degrades (per
  // section, via reportSectionRenderFailure) rather than silently "working"
  // against a fake document.
  //
  // SECURITY (Phase 12 threat model). Every value here is an inert local object
  // — no Node built-in, no prototype chain out of the sandbox, no I/O. The
  // deliberate omissions from D-05 that actually carry risk are UNCHANGED and
  // still asserted by tests: no `localStorage`, `matchMedia`, `navigator`,
  // `fetch`, or `require`. Element factories return a FRESH object per call so
  // one section cannot stash state another section reads back.
  const makeElement = (): Record<string, unknown> => ({
    nodeType: 1,
    tagName: "DIV",
    style: {},
    childNodes: [],
    attributes: [],
    setAttribute() {},
    getAttribute() {
      return null;
    },
    removeAttribute() {},
    hasAttribute() {
      return false;
    },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  });

  const domGlobals: Record<string, unknown> = {
    document: {
      nodeType: 9,
      createElement: makeElement,
      createElementNS: makeElement,
      createDocumentFragment: makeElement,
      createTextNode: () => ({ nodeType: 3, textContent: "" }),
      implementation: {
        createHTMLDocument: () => ({
          body: makeElement(),
          head: makeElement(),
          createElement: makeElement,
        }),
      },
      get documentElement() {
        return makeElement();
      },
      get body() {
        return makeElement();
      },
      get head() {
        return makeElement();
      },
      addEventListener() {},
      removeEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
    // Constructors browser libraries feature-detect against (DOMPurify checks
    // several of these before deciding it is usable). Inert placeholders.
    Node: function Node() {},
    Element: function Element() {},
    HTMLTemplateElement: function HTMLTemplateElement() {},
    DocumentFragment: function DocumentFragment() {},
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
  };

  for (const key of Object.keys(domGlobals)) {
    Object.defineProperty(sandbox, key, {
      value: domGlobals[key],
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }

  // vm.createContext(sandbox) makes `sandbox` the context's global object,
  // so `sandbox.window = sandbox` gives `window === globalThis` inside the
  // context -- exactly matching a real browser's invariant. It also makes the
  // stub above reachable as `window.document`, which is how most libraries
  // reach for it.
  sandbox.window = sandbox;

  return sandbox;
}

/**
 * Parse and validate a bundle URL. Throws unless the input is a well-formed
 * URL whose protocol is exactly `https:` (ASVS V5). No code path in this
 * module may fetch a URL that did not pass through this function.
 *
 * The URL originates in tenant-controlled Strapi data
 * (Site.liveTheme.builtAssetUrl) and is fetched server-side -- this is the
 * SSRF-adjacent input-validation control, mirroring the precedent already
 * set by `assertHttpsUrl` in scripts/measure-baseline.ts.
 */
export function assertHttpsBundleUrl(input: string | null | undefined): URL {
  if (input == null || input.trim() === "") {
    throw new Error(`Bundle URL is empty or missing: ${JSON.stringify(input)}`);
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a well-formed bundle URL: "${input}"`);
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `Expected an https: bundle URL, got "${url.protocol}" for input "${input}"`
    );
  }
  return url;
}

/** The redirect statuses the bundle fetch will follow, one validated hop at a time (T-12-05). */
function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Structural check on an extracted registration. Deliberately uses NO
 * `instanceof` anywhere in this predicate: the value was constructed inside
 * the vm context and is cross-realm, so a prototype-identity check would
 * misclassify a perfectly valid module.
 */
export function isLoadedThemeModule(value: unknown): value is LoadedThemeModule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.name !== "string") return false;
  const sections = candidate.sectionsComponents;
  if (sections === null || typeof sections !== "object" || Array.isArray(sections)) {
    return false;
  }
  const schemas = candidate.sectionSettingsSchemas;
  if (schemas === null || typeof schemas !== "object") return false;
  return true;
}

/**
 * The result cache (keyed by the validated, canonical bundle URL string) and
 * the negative cache (same key, holding the epoch-ms timestamp a failure was
 * recorded) and the in-flight promise map (same key again) that
 * `evaluateThemeServerSide` layers over `evaluateUncached` below.
 *
 * Only the extracted module or the failure timestamp is EVER stored here --
 * never a `vm.Context` and never a compiled `vm.Script`. Keeping a context
 * alive across requests would reintroduce exactly the module-scope leakage
 * `node:vm` exists to bound (see the file header and D-01/D-02 above). Plain
 * `Map`s, no LRU, no new dependency: a tenant has one live theme and one
 * Vercel project at a time, so these hold single-digit entries per warm
 * instance (12-RESEARCH.md Don't Hand-Roll).
 */
const resultCache = new Map<string, LoadedThemeModule>();
const negativeCache = new Map<string, number>();
const inFlight = new Map<string, Promise<LoadedThemeModule | null>>();

/**
 * Test-only seam: empties all three caches so one test's state cannot leak
 * into another. Not a production API.
 */
export function __resetThemeEvaluatorCachesForTest(): void {
  resultCache.clear();
  negativeCache.clear();
  inFlight.clear();
}

/**
 * Evaluate already-fetched bundle text in a fresh node:vm context. The
 * fetch-free seam -- synchronous, no caching. Never keeps the context or the
 * compiled script beyond this call. Returns null instead of throwing for
 * every failure mode.
 */
export function evaluateThemeSource(
  bundleText: string,
  themeName: string,
  runtime: InjectedReactRuntime = DEFAULT_REACT_RUNTIME
): LoadedThemeModule | null {
  if (bundleText.trim() === "") {
    return null;
  }

  try {
    const sandbox = buildSandbox(runtime);
    // `microtaskMode` goes on `vm.createContext`, never on `runInContext` --
    // Node accepts the key there too but silently ignores it, which would
    // let promise-scheduled work escape the timeout entirely.
    const context = vm.createContext(sandbox, {
      codeGeneration: { strings: false, wasm: false },
      microtaskMode: "afterEvaluate",
    });
    const script = new vm.Script(bundleText, { filename: "theme.bundle.js" });
    script.runInContext(context, {
      timeout: EVAL_TIMEOUT_MS,
      displayErrors: true,
    });

    const registry = sandbox.__THETA_THEMES__ as Record<string, unknown> | undefined;
    const registered = registry?.[themeName];

    if (registered === undefined) {
      reportEvaluationFailure("not-registered", { themeName });
      return null;
    }

    if (!isLoadedThemeModule(registered)) {
      reportEvaluationFailure("invalid-shape", { themeName });
      return null;
    }

    return registered;
  } catch (err) {
    reportEvaluationFailure("evaluation-threw", {
      themeName,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The uncached evaluation path: validate URL -> fetch -> evaluate ->
 * LoadedThemeModule | null. Never throws for any input. Module-private --
 * `evaluateThemeServerSide` below is the public entry point and layers
 * caching, in-flight de-duplication, and the negative-cache TTL over this
 * function.
 */
async function evaluateUncached(
  themeBundleUrl: string | null | undefined,
  themeName: string
): Promise<LoadedThemeModule | null> {
  let url: URL;
  try {
    url = assertHttpsBundleUrl(themeBundleUrl);
  } catch (err) {
    reportEvaluationFailure("invalid-url", {
      themeBundleUrl,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  // T-12-05: `redirect: "manual"` plus an explicit hop loop. Every hop's
  // Location is put back through assertHttpsBundleUrl before it is fetched,
  // so the https-only control holds for the whole chain and not just for the
  // initial tenant-supplied URL. One signal bounds the entire chain.
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let response: Response;
  let hops = 0;
  for (;;) {
    try {
      response = await fetch(url, {
        cache: "no-store",
        redirect: "manual",
        signal,
      });
    } catch (err) {
      reportEvaluationFailure("fetch-failed", {
        themeBundleUrl: url.toString(),
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    if (!isRedirectStatus(response.status)) break;

    if (hops >= MAX_BUNDLE_REDIRECTS) {
      reportEvaluationFailure("fetch-failed", {
        themeBundleUrl: url.toString(),
        message: `Exceeded ${MAX_BUNDLE_REDIRECTS} redirects fetching the theme bundle`,
      });
      return null;
    }

    const location = response.headers.get("location");
    if (location == null || location.trim() === "") {
      reportEvaluationFailure("fetch-failed", {
        themeBundleUrl: url.toString(),
        message: `Redirect status ${response.status} with no Location header`,
      });
      return null;
    }

    try {
      // Resolve relative Locations against the current hop, then re-apply the
      // same https-only validation the initial URL passed through.
      url = assertHttpsBundleUrl(new URL(location, url).toString());
    } catch (err) {
      reportEvaluationFailure("invalid-url", {
        themeBundleUrl: location,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
    hops += 1;
  }

  if (!response.ok) {
    reportEvaluationFailure("http-error", {
      themeBundleUrl: url.toString(),
      status: response.status,
    });
    return null;
  }

  let bundleText: string;
  try {
    bundleText = await response.text();
  } catch (err) {
    reportEvaluationFailure("fetch-failed", {
      themeBundleUrl: url.toString(),
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (bundleText.trim() === "") {
    reportEvaluationFailure("empty-body", { themeBundleUrl: url.toString() });
    return null;
  }

  return evaluateThemeSource(bundleText, themeName);
}

/**
 * The public entry point. Layers the result cache, the negative-cache TTL,
 * and in-flight de-duplication over `evaluateUncached` above, in this order:
 *
 *   1. Validate the URL. On failure, report and return null immediately --
 *      no cache is touched and no request is issued, so a malformed URL
 *      never occupies a negative-cache slot for a network call it never
 *      made. From here on the cache key is always this URL's canonical
 *      string form (`url.toString()`), never the raw, possibly-relative
 *      input -- this is also what makes a `Site.liveTheme` switch (which
 *      changes `resolveLiveBundle`'s resolved `themeBundleUrl`) a cache miss
 *      by construction (SSR-03, D-10/D-11).
 *   2. Return the result-cache entry when present.
 *   3. Return null without fetching when a live negative-cache entry exists;
 *      delete an expired one and fall through to a fresh attempt (D-08).
 *   4. Return the in-flight promise when one exists for this key, so
 *      concurrent cold callers share one evaluation (12-RESEARCH.md
 *      Pattern 3).
 *   5. Otherwise evaluate, cache the outcome (result cache on success,
 *      negative cache with the current timestamp on null), and
 *      unconditionally delete the in-flight entry on settle -- unconditional
 *      so a rejected promise (which `evaluateUncached` must never produce,
 *      but a future edit could introduce) cannot wedge the key permanently.
 */
export async function evaluateThemeServerSide(
  themeBundleUrl: string | null | undefined,
  themeName: string
): Promise<LoadedThemeModule | null> {
  let url: URL;
  try {
    url = assertHttpsBundleUrl(themeBundleUrl);
  } catch (err) {
    reportEvaluationFailure("invalid-url", {
      themeBundleUrl,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  const key = url.toString();

  const cachedResult = resultCache.get(key);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const negativeEntry = negativeCache.get(key);
  if (negativeEntry !== undefined) {
    const elapsedMs = Date.now() - negativeEntry;
    if (elapsedMs < NEGATIVE_CACHE_TTL_MS) {
      return null;
    }
    negativeCache.delete(key);
  }

  const existingInFlight = inFlight.get(key);
  if (existingInFlight) {
    return existingInFlight;
  }

  const promise = evaluateUncached(key, themeName)
    .then((result) => {
      if (result !== null) {
        resultCache.set(key, result);
      } else {
        negativeCache.set(key, Date.now());
      }
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}
