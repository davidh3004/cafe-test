import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The React/renderer PAIR under test must be the same pair `buildSandbox`
// injects, which is the whole point of the `ssr-react-runtime` seam. Importing
// the bare `react-dom/server` here instead would render vm-evaluated components
// with a renderer that never installed a hook dispatcher on the React instance
// those components actually closed over, and `FixtureHero`'s `React.useState`
// call would die with "Invalid hook call" — a mismatch in the TEST, not in the
// code under test.
import { React, renderToStaticMarkup } from "../ssr-react-runtime";
import { readFileSync } from "node:fs";
import {
  evaluateThemeServerSide,
  evaluateThemeSource,
  buildSandbox,
  assertHttpsBundleUrl,
  isLoadedThemeModule,
  reportSectionRenderFailure,
  EVAL_TIMEOUT_MS,
  FETCH_TIMEOUT_MS,
  NEGATIVE_CACHE_TTL_MS,
  MAX_BUNDLE_REDIRECTS,
  __resetThemeEvaluatorCachesForTest,
} from "../theme-evaluator";

const fixtureSource = readFileSync(
  new URL("./fixtures/fixture-theme.bundle.js", import.meta.url),
  "utf-8"
);

// vi.hoisted so the mock factory below (itself hoisted above every import by
// Vitest's transform) can close over a stable spy reference declared with
// `const`.
const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: captureExceptionMock,
}));

// So no test in this file inherits another's cached/negative-cached/
// in-flight state, or another test's captureException call count -- applies
// file-wide, ahead of every nested describe's own beforeEach (e.g. the
// fetch-stub setup in "fetch path" below), which is what makes it safe for
// two tests in that pre-existing describe to reuse the same bundle URL
// across different mocked responses.
beforeEach(() => {
  __resetThemeEvaluatorCachesForTest();
  captureExceptionMock.mockClear();
});

// Degenerate bundle sources exercised by the "degrades to null" suite below.
const THROWING_SOURCE = `throw new Error("boom at module scope");`;

const WRONG_NAME_SOURCE = `
  window.__THETA_THEMES__ = window.__THETA_THEMES__ || {};
  window.__THETA_THEMES__["some-other-theme"] = {
    name: "some-other-theme",
    version: "0.0.0",
    sectionsComponents: {},
    sectionSettingsSchemas: {},
  };
`;

const NON_OBJECT_REGISTRATION_SOURCE = `
  window.__THETA_THEMES__ = window.__THETA_THEMES__ || {};
  window.__THETA_THEMES__["fixture-theme"] = 42;
`;

const INFINITE_LOOP_SOURCE = `while (true) {}`;

const EVAL_CALL_SOURCE = `eval("1 + 1");`;

const REASSIGN_GLOBAL_SOURCE = `
  try {
    React = null;
  } catch (e) {
    // sloppy-mode assignment to a non-writable global is a silent no-op;
    // strict-mode assignment throws a TypeError. Either way, swallow it --
    // this source exists only to prove the attempt has no lasting effect.
  }
`;

const SYNTACTICALLY_INVALID_SOURCE = `function ( { this is not valid javascript`;

// Two distinct self-registering sources used to simulate a Site.liveTheme
// switch: same evaluator call shape, different registered theme name, so a
// cache-key test can prove the second call never returns the first's module.
const THEME_A_SOURCE = `
  window.__THETA_THEMES__ = window.__THETA_THEMES__ || {};
  window.__THETA_THEMES__["theme-a"] = {
    name: "theme-a",
    version: "0.0.0-test",
    sectionsComponents: {},
    sectionSettingsSchemas: {},
  };
`;

const THEME_B_SOURCE = `
  window.__THETA_THEMES__ = window.__THETA_THEMES__ || {};
  window.__THETA_THEMES__["theme-b"] = {
    name: "theme-b",
    version: "0.0.0-test",
    sectionsComponents: {},
    sectionSettingsSchemas: {},
  };
`;

describe("buildSandbox — the minimized, frozen global surface (D-04/D-05, SSR-07)", () => {
  const INJECTED_GLOBAL_KEYS = [
    "React",
    "ReactDOM",
    "jsxRuntime",
    "cva",
    "clsx",
    "twMerge",
    "LucideReact",
  ];

  it("exposes exactly the ten expected own enumerable keys", () => {
    const sandbox = buildSandbox();
    const expected = [
      "React",
      "ReactDOM",
      "jsxRuntime",
      "cva",
      "clsx",
      "twMerge",
      "LucideReact",
      "process",
      "__THETA_THEMES__",
      "window",
    ].sort();
    const actual = Object.keys(sandbox).sort();
    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(10);
  });

  it("sets window strictly identical to the sandbox object itself", () => {
    const sandbox = buildSandbox();
    expect(sandbox.window).toBe(sandbox);
  });

  it("exposes cva/clsx/twMerge as module namespaces whose named export is a function (Pitfall 4 guard)", () => {
    const sandbox = buildSandbox() as Record<string, any>;
    expect(typeof sandbox.cva.cva).toBe("function");
    expect(typeof sandbox.clsx.clsx).toBe("function");
    expect(typeof sandbox.twMerge.twMerge).toBe("function");
    // LucideReact.Check is a React.forwardRef component (a tagged object,
    // not a bare function) -- assert it is a defined, renderable component
    // rather than typeof === "function", which would be false for any
    // forwardRef-wrapped icon.
    expect(sandbox.LucideReact.Check).toBeDefined();
    expect(React.isValidElement(React.createElement(sandbox.LucideReact.Check))).toBe(true);
  });

  it("gives the process shim exactly one frozen key, env, with NODE_ENV production", () => {
    const sandbox = buildSandbox() as Record<string, any>;
    expect(Object.keys(sandbox.process)).toEqual(["env"]);
    expect(sandbox.process.env.NODE_ENV).toBe("production");
    expect(Object.isFrozen(sandbox.process)).toBe(true);
    expect(Object.isFrozen(sandbox.process.env)).toBe(true);
  });

  it("defines each of the seven injected globals as non-writable and non-configurable", () => {
    const sandbox = buildSandbox();
    for (const key of INJECTED_GLOBAL_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(sandbox, key);
      expect(descriptor, `descriptor for ${key}`).toBeDefined();
      expect(descriptor!.writable, `${key} writable`).toBe(false);
      expect(descriptor!.configurable, `${key} configurable`).toBe(false);
    }
  });

  it("omits document, localStorage, matchMedia, navigator, fetch and require (D-05)", () => {
    const sandbox = buildSandbox() as Record<string, unknown>;
    for (const key of ["document", "localStorage", "matchMedia", "navigator", "fetch", "require"]) {
      expect(key in sandbox, `${key} should be absent`).toBe(false);
    }
  });
});

describe("evaluateThemeSource — evaluates a bundle in node:vm (SSR-02)", () => {
  it("evaluates the fixture bundle and returns a well-formed module", () => {
    const result = evaluateThemeSource(fixtureSource, "fixture-theme");
    expect(result).not.toBeNull();
    expect(result?.name).toBe("fixture-theme");
    expect(result?.version).toBe("0.0.0-test");
    expect(typeof result?.sectionsComponents.hero).toBe("function");
    expect(typeof result?.sectionsComponents.plain).toBe("function");
  });

  it("returns two distinct module objects across two successive calls (fresh context per evaluation)", () => {
    const first = evaluateThemeSource(fixtureSource, "fixture-theme");
    const second = evaluateThemeSource(fixtureSource, "fixture-theme");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).not.toBe(second);
    expect(first?.sectionsComponents.hero).not.toBe(second?.sectionsComponents.hero);
  });

  it("does not let a global-reassignment attempt persist across evaluations", () => {
    evaluateThemeSource(REASSIGN_GLOBAL_SOURCE, "fixture-theme");
    const result = evaluateThemeSource(fixtureSource, "fixture-theme");
    expect(result).not.toBeNull();
    expect(typeof result?.sectionsComponents.hero).toBe("function");
  });

  it("degrades to null rather than executing a source containing an eval call (code generation disallowed)", () => {
    expect(evaluateThemeSource(EVAL_CALL_SOURCE, "fixture-theme")).toBeNull();
  });
});

describe("evaluateThemeSource — cross-realm React interop (SSR-02, Assumption A1)", () => {
  it("renders a stateful vm-evaluated component through the host's paired ssr-react-runtime renderer", () => {
    const moduleResult = evaluateThemeSource(fixtureSource, "fixture-theme");
    expect(moduleResult).not.toBeNull();
    const Hero = moduleResult!.sectionsComponents.hero;
    const html = renderToStaticMarkup(React.createElement(Hero, { title: "Hello from vm" }));
    expect(html).toContain("Hello from vm");
    expect(html).toContain('data-testid="fixture-hero"');
    expect(html).toContain("<svg");
    expect(html).toContain("count: 0");
  });

  it("renders the minimal vm-evaluated component (sectionsComponents.plain)", () => {
    const moduleResult = evaluateThemeSource(fixtureSource, "fixture-theme");
    expect(moduleResult).not.toBeNull();
    const Plain = moduleResult!.sectionsComponents.plain;
    const html = renderToStaticMarkup(React.createElement(Plain, { title: "Plain works" }));
    expect(html).toContain("Plain works");
    expect(html).toContain('data-testid="fixture-plain"');
  });
});

describe("evaluateThemeSource — degrades to null, never throws (D-07, SSR-07)", () => {
  it("degrades to null for a throwing bundle, wrong-name registration, non-object registration, empty source, whitespace-only source, and syntactically invalid source", () => {
    expect(evaluateThemeSource(THROWING_SOURCE, "fixture-theme")).toBeNull();
    expect(evaluateThemeSource(WRONG_NAME_SOURCE, "fixture-theme")).toBeNull();
    expect(evaluateThemeSource(NON_OBJECT_REGISTRATION_SOURCE, "fixture-theme")).toBeNull();
    expect(evaluateThemeSource("", "fixture-theme")).toBeNull();
    expect(evaluateThemeSource("   \n\t  ", "fixture-theme")).toBeNull();
    expect(evaluateThemeSource(SYNTACTICALLY_INVALID_SOURCE, "fixture-theme")).toBeNull();
  });

  it(
    "degrades to null and enforces the timeout for a synchronous infinite loop",
    () => {
      const start = Date.now();
      const result = evaluateThemeSource(INFINITE_LOOP_SOURCE, "fixture-theme");
      const elapsed = Date.now() - start;
      expect(result).toBeNull();
      expect(elapsed).toBeGreaterThanOrEqual(EVAL_TIMEOUT_MS);
    },
    EVAL_TIMEOUT_MS + 5000
  );
});

describe("assertHttpsBundleUrl — input validation (ASVS V5)", () => {
  it("returns a URL whose protocol is https: for a well-formed https URL", () => {
    const url = assertHttpsBundleUrl("https://cdn.example.com/theme.bundle.js");
    expect(url.protocol).toBe("https:");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace-only string", "   "],
    ["relative path", "/theme.bundle.js"],
    ["http URL", "http://cdn.example.com/theme.bundle.js"],
    ["file URL", "file:///etc/passwd"],
    ["non-URL string", "not-a-url"],
  ])("throws for %s", (_label, input) => {
    expect(() => assertHttpsBundleUrl(input as string | null | undefined)).toThrow();
  });
});

describe("isLoadedThemeModule — registration shape validation (ASVS V5)", () => {
  it("passes for a well-formed module object", () => {
    expect(
      isLoadedThemeModule({
        name: "fixture-theme",
        version: "0.0.0-test",
        sectionsComponents: {},
        sectionSettingsSchemas: {},
      })
    ).toBe(true);
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["an array", []],
    ["missing sectionsComponents", { name: "x", sectionSettingsSchemas: {} }],
    ["sectionsComponents not an object", { name: "x", sectionsComponents: "nope", sectionSettingsSchemas: {} }],
  ])("fails for %s", (_label, value) => {
    expect(isLoadedThemeModule(value)).toBe(false);
  });
});

describe("evaluateThemeServerSide — fetch path (SSR-02, D-07)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a non-null module for a 200 response and calls fetch exactly once with an https URL", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixtureSource,
    });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );

    expect(result).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl] = mockFetch.mock.calls[0];
    expect(String(calledUrl)).toMatch(/^https:/);
  });

  it("degrades to null for a 404 response", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );
    expect(result).toBeNull();
  });

  it("degrades to null for a rejected fetch", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValue(new Error("network error"));

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );
    expect(result).toBeNull();
  });

  it("degrades to null for a 200 response with an empty body", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => "" });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );
    expect(result).toBeNull();
  });

  it("returns null without calling fetch for a null bundle URL and for the relative /theme.bundle.js fallback", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

    const nullResult = await evaluateThemeServerSide(null, "fixture-theme");
    expect(nullResult).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    const relativeResult = await evaluateThemeServerSide("/theme.bundle.js", "fixture-theme");
    expect(relativeResult).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("evaluateThemeServerSide — redirects are re-validated per hop (T-12-05, ASVS V5)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const redirectTo = (location: string, status = 302) => ({
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "location" ? location : null) },
    text: async () => "",
  });

  const ok = () => ({ ok: true, status: 200, text: async () => fixtureSource });

  it("issues the fetch with redirect: \"manual\" so the runtime cannot follow a hop unvalidated", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(ok());

    await evaluateThemeServerSide("https://cdn.example.com/manual.bundle.js", "fixture-theme");

    const [, init] = mockFetch.mock.calls[0];
    expect(init).toMatchObject({ redirect: "manual" });
  });

  it("follows an https -> https redirect and evaluates the final bundle", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(redirectTo("https://cdn2.example.com/final.bundle.js"))
      .mockResolvedValueOnce(ok());

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/hop.bundle.js",
      "fixture-theme"
    );

    expect(result).not.toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(String(mockFetch.mock.calls[1][0])).toBe("https://cdn2.example.com/final.bundle.js");
  });

  it("refuses an https -> http downgrade redirect and never fetches the downgraded hop", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(redirectTo("http://cdn.example.com/downgrade.bundle.js"));

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/downgrade-entry.bundle.js",
      "fixture-theme"
    );

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to an internal non-https host (the SSRF hop) and never fetches it", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(redirectTo("http://169.254.169.254/latest/meta-data/"));

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/ssrf-entry.bundle.js",
      "fixture-theme"
    );

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than spinning on a redirect loop", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(redirectTo("https://cdn.example.com/loop.bundle.js"));

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/loop.bundle.js",
      "fixture-theme"
    );

    expect(result).toBeNull();
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(MAX_BUNDLE_REDIRECTS + 1);
  });

  it("degrades to null for a redirect status with no Location header", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      headers: { get: () => null },
      text: async () => "",
    });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/no-location.bundle.js",
      "fixture-theme"
    );
    expect(result).toBeNull();
  });
});

describe("evaluateThemeServerSide — result cache and cache key (SSR-03, D-10/D-11)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the identical module by reference for a second call on the same cache key (cache key)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => fixtureSource });

    const first = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );
    const second = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("issues two fetches and returns two distinct modules for two different bundle URLs, never returning the first's value for the second key (cache key)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => fixtureSource });

    const first = await evaluateThemeServerSide(
      "https://cdn.example.com/a/theme.bundle.js",
      "fixture-theme"
    );
    const second = await evaluateThemeServerSide(
      "https://cdn.example.com/b/theme.bundle.js",
      "fixture-theme"
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns the module matching the second theme name after a simulated Site.liveTheme switch, with no stale module surviving the swap (cache key)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockImplementation(async (input: unknown) => {
      const requestedUrl = String(input);
      if (requestedUrl.includes("theme-a")) {
        return { ok: true, status: 200, text: async () => THEME_A_SOURCE };
      }
      return { ok: true, status: 200, text: async () => THEME_B_SOURCE };
    });

    const beforeSwitch = await evaluateThemeServerSide(
      "https://cdn.example.com/theme-a.bundle.js",
      "theme-a"
    );
    expect(beforeSwitch?.name).toBe("theme-a");

    const afterSwitch = await evaluateThemeServerSide(
      "https://cdn.example.com/theme-b.bundle.js",
      "theme-b"
    );
    expect(afterSwitch?.name).toBe("theme-b");
    expect(afterSwitch).not.toBe(beforeSwitch);
  });
});

describe("evaluateThemeServerSide — negative cache (D-08)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns null for a 404 URL and does not re-fetch on an immediate second call (negative cache)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });

    const first = await evaluateThemeServerSide(
      "https://cdn.example.com/broken.bundle.js",
      "fixture-theme"
    );
    expect(first).toBeNull();

    const second = await evaluateThemeServerSide(
      "https://cdn.example.com/broken.bundle.js",
      "fixture-theme"
    );
    expect(second).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the negative-cache TTL has elapsed (negative cache)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });

    const first = await evaluateThemeServerSide(
      "https://cdn.example.com/broken.bundle.js",
      "fixture-theme"
    );
    expect(first).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(NEGATIVE_CACHE_TTL_MS + 1);

    const second = await evaluateThemeServerSide(
      "https://cdn.example.com/broken.bundle.js",
      "fixture-theme"
    );
    expect(second).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("never negative-caches a URL that fails validation -- zero fetches across repeated invalid-URL calls (negative cache)", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

    await evaluateThemeServerSide("not-a-url", "fixture-theme");
    await evaluateThemeServerSide("not-a-url", "fixture-theme");
    await evaluateThemeServerSide(null, "fixture-theme");

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("evaluateThemeServerSide — in-flight de-duplication", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues exactly one fetch for N concurrent callers on the same cold URL, all resolving to the same module by reference", async () => {
    let resolveFetch!: () => void;
    const deferred = new Promise<void>((resolve) => {
      resolveFetch = resolve;
    });
    const mockFetch = vi.fn().mockImplementation(async () => {
      await deferred;
      return { ok: true, status: 200, text: async () => fixtureSource };
    });
    vi.stubGlobal("fetch", mockFetch);

    const resultsPromise = Promise.all([
      evaluateThemeServerSide("https://cdn.example.com/concurrent.bundle.js", "fixture-theme"),
      evaluateThemeServerSide("https://cdn.example.com/concurrent.bundle.js", "fixture-theme"),
      evaluateThemeServerSide("https://cdn.example.com/concurrent.bundle.js", "fixture-theme"),
    ]);

    // All three callers have already registered themselves against the
    // in-flight map synchronously above (no await stands between the calls
    // and the deferred fetch); resolving now proves they shared one fetch
    // rather than each starting a fresh one.
    resolveFetch();
    const results = await resultsPromise;

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
  });
});

describe("reportEvaluationFailure — degradation is visible, never silent (D-09)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports a 404 bundle URL to Sentry tagged http-error/theme-evaluator exactly once", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, secondArg] = captureExceptionMock.mock.calls[0];
    expect(secondArg.tags.reason).toBe("http-error");
    expect(secondArg.tags.subsystem).toBe("theme-evaluator");
  });

  it("reports an invalid bundle URL to Sentry tagged invalid-url", async () => {
    const result = await evaluateThemeServerSide("not-a-url", "fixture-theme");

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, secondArg] = captureExceptionMock.mock.calls[0];
    expect(secondArg.tags.reason).toBe("invalid-url");
  });

  it("reports a bundle that throws at module scope to Sentry tagged evaluation-threw", () => {
    const result = evaluateThemeSource(THROWING_SOURCE, "fixture-theme");

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, secondArg] = captureExceptionMock.mock.calls[0];
    expect(secondArg.tags.reason).toBe("evaluation-threw");
  });

  it("reports a wrong-name registration to Sentry tagged not-registered", () => {
    const result = evaluateThemeSource(WRONG_NAME_SOURCE, "fixture-theme");

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, secondArg] = captureExceptionMock.mock.calls[0];
    expect(secondArg.tags.reason).toBe("not-registered");
  });

  it("reports zero times for a successful evaluation", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => fixtureSource });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );

    expect(result).not.toBeNull();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("never includes the fetched bundle's source text in any captureException argument", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => fixtureSource });

    // "theme-not-in-fixture" forces a not-registered degrade on a REAL,
    // fetched fixture bundle -- the strongest form of this guard, since the
    // source text that must NOT leak was genuinely fetched and evaluated in
    // this call, not merely absent from a synthetic degenerate source.
    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "theme-not-in-fixture"
    );

    expect(result).toBeNull();
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, secondArg] = captureExceptionMock.mock.calls[0];
    const serialized = JSON.stringify(secondArg);
    expect(serialized).not.toContain(fixtureSource);
    expect(serialized).not.toContain("fixture-hero");
  });

  it("still resolves to null rather than rejecting when captureException itself throws", async () => {
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error("Sentry is down");
    });
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 404, text: async () => "" });

    const result = await evaluateThemeServerSide(
      "https://cdn.example.com/theme.bundle.js",
      "fixture-theme"
    );

    expect(result).toBeNull();
  });
});

describe("reportSectionRenderFailure — the section-render-threw reason (Phase 13, D-07)", () => {
  it("emits the structured console.error tagged with the section-render-threw reason", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    reportSectionRenderFailure("fixture-theme", "hero", "boom during render");

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[theme-evaluator]",
      "section-render-threw",
      expect.objectContaining({
        themeName: "fixture-theme",
        sectionKey: "hero",
        message: "boom during render",
      })
    );

    consoleErrorSpy.mockRestore();
  });

  it("calls Sentry.captureException tagged subsystem theme-evaluator / reason section-render-threw, with extra carrying exactly the three permitted fields", () => {
    reportSectionRenderFailure("fixture-theme", "hero", "boom during render");

    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const [, secondArg] = captureExceptionMock.mock.calls[0];
    expect(secondArg.tags).toEqual({
      subsystem: "theme-evaluator",
      reason: "section-render-threw",
    });
    expect(Object.keys(secondArg.extra).sort()).toEqual(
      ["message", "sectionKey", "themeName"].sort()
    );
    expect(secondArg.extra).toEqual({
      themeName: "fixture-theme",
      sectionKey: "hero",
      message: "boom during render",
    });
  });

  it("still resolves without throwing when captureException itself throws", () => {
    captureExceptionMock.mockImplementationOnce(() => {
      throw new Error("Sentry is down");
    });

    expect(() =>
      reportSectionRenderFailure("fixture-theme", "hero", "boom during render")
    ).not.toThrow();
  });
});

// FETCH_TIMEOUT_MS is asserted to exist and be imported so a future edit
// that removes the export is caught at import-resolution time even though
// no test here exercises a hung network fetch directly.
void FETCH_TIMEOUT_MS;
