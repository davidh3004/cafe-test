import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gap A (Phase 13 Validation, SSR-06, T-13-09/T-13-10/T-13-11/T-13-12).
 *
 * `templates/theme-site/instrumentation-client.ts` runs its side effects at
 * module evaluation (Next.js client-instrumentation convention, no exported
 * `register()`), so this file must control env vars BEFORE import and use
 * `vi.resetModules()` between cases to force fresh evaluation.
 *
 * `@sentry/nextjs` is mocked so `Sentry.init`'s call arguments can be
 * inspected directly -- this asserts on the actual init config object, not on
 * source text, so it is immune to the prose/comment false positive
 * 13-03-SUMMARY records for a literal grep on "hydrateRoot".
 */

const initMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  init: initMock,
}));

const MODULE_PATH = "../../instrumentation-client";

describe("instrumentation-client — Sentry.init configuration", () => {
  const originalDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    initMock.mockClear();
  });

  afterEach(() => {
    if (originalDsn === undefined) {
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    } else {
      process.env.NEXT_PUBLIC_SENTRY_DSN = originalDsn;
    }
    vi.stubEnv("NODE_ENV", originalNodeEnv ?? "test");
  });

  it("does not call Sentry.init when NEXT_PUBLIC_SENTRY_DSN is unset (opt-in, no-op today on every tenant)", async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    await import(MODULE_PATH);

    expect(initMock).not.toHaveBeenCalled();
  });

  it("calls Sentry.init exactly once, with a locked-down security config, when the DSN is set", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example.ingest.sentry.io/123";

    await import(MODULE_PATH);

    expect(initMock).toHaveBeenCalledTimes(1);
    const config = initMock.mock.calls[0][0];

    expect(config.dsn).toBe("https://example.ingest.sentry.io/123");
    // Don't send PII.
    expect(config.sendDefaultPii).toBe(false);
    // Error reporting, not performance tracing, on tenant sites.
    expect(config.tracesSampleRate).toBe(0);
  });

  it("gates `enabled` on NODE_ENV === production: false outside production, true in production", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example.ingest.sentry.io/123";
    vi.stubEnv("NODE_ENV", "development");

    await import(MODULE_PATH);

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0].enabled).toBe(false);

    vi.resetModules();
    initMock.mockClear();
    vi.stubEnv("NODE_ENV", "production");

    await import(MODULE_PATH);

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0].enabled).toBe(true);
  });

  it("never hand-rolls a window error listener: no addEventListener call reaches the mocked Sentry SDK config and no such global is invoked by the module", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example.ingest.sentry.io/123";
    const addEventListenerSpy = vi.fn();
    vi.stubGlobal("addEventListener", addEventListenerSpy);

    await import(MODULE_PATH);

    expect(addEventListenerSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("never intercepts hydrateRoot: the module never touches a global hydrateRoot hook", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example.ingest.sentry.io/123";
    // If the module ever imported/called a hydrateRoot-shaped API, it would
    // have to come from react-dom/client, not a global -- assert the global
    // slot is never touched as a defense-in-depth signal, and directly assert
    // the init config carries no onRecoverableError/hydration-hook field,
    // which is where an interception would have to be wired through Sentry's
    // own config surface.
    const hydrateRootSpy = vi.fn();
    vi.stubGlobal("hydrateRoot", hydrateRootSpy);

    await import(MODULE_PATH);

    expect(hydrateRootSpy).not.toHaveBeenCalled();
    const config = initMock.mock.calls[0][0];
    expect(config).not.toHaveProperty("onRecoverableError");
    expect(config).not.toHaveProperty("hydrateRoot");

    vi.unstubAllGlobals();
  });

  it("does not export an async register function (this is the client convention, not instrumentation.ts's server register())", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example.ingest.sentry.io/123";

    const mod = await import(MODULE_PATH);

    expect(mod.register).toBeUndefined();
  });

  it("beforeSend only tags hydration-mismatch messages and never adds other context (best-effort triage, not an enricher)", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://example.ingest.sentry.io/123";

    await import(MODULE_PATH);

    const config = initMock.mock.calls[0][0];
    expect(typeof config.beforeSend).toBe("function");

    const hydrationEvent = {
      exception: { values: [{ value: "Hydration failed because the server rendered..." }] },
    };
    const taggedEvent = config.beforeSend(hydrationEvent);
    expect(taggedEvent.tags.hydration_mismatch).toBe(true);

    const unrelatedEvent = { exception: { values: [{ value: "TypeError: boom" }] } };
    const untaggedEvent = config.beforeSend(unrelatedEvent);
    expect(untaggedEvent.tags).toBeUndefined();
  });
});
