import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.hoisted so the mock factory below (itself hoisted above every import by
// Vitest's transform) can close over a stable spy reference declared with
// `const`. Mirrors theme-evaluator.test.ts's captureExceptionMock pattern.
const { reportSeoDegradeMock } = vi.hoisted(() => ({
  reportSeoDegradeMock: vi.fn(),
}));

vi.mock("../seo-report", () => ({
  reportSeoDegrade: reportSeoDegradeMock,
}));

import {
  httpStatusForRedirectType,
  isInternalDestination,
  isReservedSource,
  buildRedirectMap,
  resolveRedirect,
  getRedirectMap,
  __resetRedirectCacheForTest,
  REDIRECT_MAP_TTL_MS,
  REDIRECT_PAGE_SIZE,
  RESERVED_SOURCE_PATHS,
  RESERVED_SOURCE_PREFIXES,
  type RedirectRow,
  type RedirectMap,
} from "../redirect-resolve";

// So no test in this file inherits another's cached/in-flight state, or
// another test's reportSeoDegrade call count.
beforeEach(() => {
  __resetRedirectCacheForTest();
  reportSeoDegradeMock.mockClear();
});

describe("httpStatusForRedirectType (D-02: never NaN, never undefined)", () => {
  it("maps 'permanent' to 301 and 'temporary' to 302", () => {
    expect(httpStatusForRedirectType("permanent")).toBe(301);
    expect(httpStatusForRedirectType("temporary")).toBe(302);
  });

  it("returns 301 for undefined, null, empty string, and any unrecognised value", () => {
    expect(httpStatusForRedirectType(undefined)).toBe(301);
    expect(httpStatusForRedirectType(null)).toBe(301);
    expect(httpStatusForRedirectType("")).toBe(301);
    expect(httpStatusForRedirectType("bogus")).toBe(301);
  });
});

describe("isInternalDestination (T-16-01: emission-side open-redirect closure)", () => {
  it("accepts single-segment and multi-segment internal paths", () => {
    expect(isInternalDestination("/about")).toBe(true);
    expect(isInternalDestination("/a/b/c")).toBe(true);
  });

  it("rejects empty string, a path with no leading slash, and every off-origin form", () => {
    expect(isInternalDestination("")).toBe(false);
    expect(isInternalDestination("about")).toBe(false);
    expect(isInternalDestination("//evil.com")).toBe(false);
    expect(isInternalDestination("/\\evil.com")).toBe(false);
    expect(isInternalDestination("/\\/\\evil.com")).toBe(false);
    expect(isInternalDestination("https://evil.com")).toBe(false);
    expect(isInternalDestination("http://evil.com")).toBe(false);
    expect(isInternalDestination("//")).toBe(false);
  });

  it("rejects a value whose second character is a backslash", () => {
    expect(isInternalDestination("/\\x")).toBe(false);
  });

  // CR-01 regression. The WHATWG URL parser strips ASCII TAB/LF/CR from its
  // input before resolving, so each of these collapses to a protocol-relative
  // "//evil.com" and resolves off-origin — verified directly against Node's
  // URL: new URL("/\t/evil.com", "https://tenant.example.com") is
  // "https://evil.com/". A guard that inspects the raw second character sees
  // TAB (neither "/" nor "\") and wrongly accepts.
  it.each([
    ["tab", "/\t/evil.com"],
    ["newline", "/\n/evil.com"],
    ["carriage return", "/\r/evil.com"],
    ["tab then backslash", "/\t\\evil.com"],
    ["tab between backslashes", "/\t\\/evil.com"],
    ["leading tab before the slashes", "\t//evil.com"],
  ])(
    "rejects an off-origin destination smuggled past the prefix check with a %s (CR-01)",
    (_label, destination) => {
      expect(isInternalDestination(destination)).toBe(false);
    }
  );

  it("pins CR-01 to the URL parser's actual behaviour, not just the guard's", () => {
    const base = "https://tenant.example.com/some/page";
    for (const destination of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com"]) {
      // The vector really does resolve off-origin...
      expect(new URL(destination, base).origin).toBe("https://evil.com");
      // ...so the guard must reject it.
      expect(isInternalDestination(destination)).toBe(false);
    }
  });

  it("still accepts an internal path that merely contains stripped whitespace", () => {
    // "/ab\tc" strips to "/abc" — internal, second char "a". Not an escape.
    expect(isInternalDestination("/ab\tc")).toBe(true);
  });
});

describe("isReservedSource (D-10 deny-list, T-16-02)", () => {
  it("returns true for every exact reserved path", () => {
    for (const path of RESERVED_SOURCE_PATHS) {
      expect(isReservedSource(path)).toBe(true);
    }
  });

  it("returns true for exact prefix matches and nested paths under a prefix", () => {
    for (const prefix of RESERVED_SOURCE_PREFIXES) {
      expect(isReservedSource(prefix)).toBe(true);
    }
    expect(isReservedSource("/_next/static/x.js")).toBe(true);
    expect(isReservedSource("/api/foo")).toBe(true);
  });

  it("returns false for paths that merely share a string prefix, and for ordinary paths", () => {
    expect(isReservedSource("/about")).toBe(false);
    expect(isReservedSource("/apiary")).toBe(false);
    expect(isReservedSource("/_nextgen")).toBe(false);
  });
});

describe("buildRedirectMap (pure, never throws)", () => {
  function row(overrides: Partial<RedirectRow>): RedirectRow {
    return {
      documentId: "doc-1",
      source: "/old",
      destination: "/new",
      redirectType: "permanent",
      ...overrides,
    };
  }

  it("keys the map by source and resolves a duplicate source last-wins in input order", () => {
    const map = buildRedirectMap([
      row({ source: "/dup", destination: "/first" }),
      row({ source: "/dup", destination: "/second" }),
    ]);
    expect(map["/dup"]).toEqual({ destination: "/second", status: 301 });
  });

  it("omits a row whose source is reserved", () => {
    const map = buildRedirectMap([row({ source: "/api/foo" })]);
    expect(map["/api/foo"]).toBeUndefined();
  });

  it("omits a row whose destination is not internal", () => {
    const map = buildRedirectMap([row({ destination: "https://evil.com" })]);
    expect(map["/old"]).toBeUndefined();
  });

  it("omits a row with a blank source or blank destination", () => {
    const map = buildRedirectMap([
      row({ source: "  " }),
      row({ source: "/blank-dest", destination: "  " }),
    ]);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it("never throws for a malformed row", () => {
    expect(() =>
      buildRedirectMap([null as unknown as RedirectRow, {} as RedirectRow])
    ).not.toThrow();
  });

  it("converts redirectType to the correct numeric status", () => {
    const map = buildRedirectMap([
      row({ source: "/temp", redirectType: "temporary" }),
    ]);
    expect(map["/temp"].status).toBe(302);
  });
});

describe("resolveRedirect (pure, never throws, one equality basis)", () => {
  const map: RedirectMap = {
    "/old": { destination: "/new", status: 301 },
    "/café": { destination: "/cafe", status: 301 },
  };

  it("returns the matching rule, or null when there is no match", () => {
    expect(resolveRedirect("/old", map)).toEqual({
      destination: "/new",
      status: 301,
    });
    expect(resolveRedirect("/nothing", map)).toBeNull();
  });

  it("returns null for an empty map, and for a null/undefined map without throwing", () => {
    expect(resolveRedirect("/x", {})).toBeNull();
    expect(() => resolveRedirect("/x", null as never)).not.toThrow();
    expect(resolveRedirect("/x", null as never)).toBeNull();
    expect(resolveRedirect("/x", undefined as never)).toBeNull();
  });

  it("matches a raw unicode key but not its percent-encoded form -- no decoding, no normalisation", () => {
    expect(resolveRedirect("/café", map)).toEqual({
      destination: "/cafe",
      status: 301,
    });
    expect(resolveRedirect("/caf%C3%A9", map)).toBeNull();
  });

  it("is case-sensitive -- no case folding", () => {
    expect(resolveRedirect("/About", map)).toBeNull();
  });
});

describe("getRedirectMap (module-scope TTL cache, fetch, fail-open)", () => {
  const ORIGINAL_URL = process.env.NEXT_PUBLIC_STRAPI_URL;
  const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_STRAPI_TOKEN;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_STRAPI_URL = "https://cms.example.com";
    process.env.NEXT_PUBLIC_STRAPI_TOKEN = "test-token";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_STRAPI_URL;
    else process.env.NEXT_PUBLIC_STRAPI_URL = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env.NEXT_PUBLIC_STRAPI_TOKEN;
    else process.env.NEXT_PUBLIC_STRAPI_TOKEN = ORIGINAL_TOKEN;
  });

  function okResponse(rows: unknown[]) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { redirects: rows } }),
    };
  }

  it("fetches once on a cold cache, and again zero times inside the TTL", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(okResponse([]));

    await getRedirectMap();
    await getRedirectMap();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refetches exactly once more at exactly REDIRECT_MAP_TTL_MS elapsed", async () => {
    vi.useFakeTimers();
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(okResponse([]));

    await getRedirectMap();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(REDIRECT_MAP_TTL_MS - 1);
    await getRedirectMap();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await getRedirectMap();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("de-duplicates concurrent cold-cache callers to exactly one fetch, resolving to the same map object", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(
      okResponse([
        { documentId: "d1", source: "/a", destination: "/b", redirectType: "permanent" },
      ])
    );

    const [first, second] = await Promise.all([getRedirectMap(), getRedirectMap()]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(first["/a"]).toEqual({ destination: "/b", status: 301 });
  });

  it("fails open to an empty map and reports once when fetch rejects", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValue(new Error("network down"));

    const map = await getRedirectMap();

    expect(map).toEqual({});
    expect(reportSeoDegradeMock).toHaveBeenCalledTimes(1);
    expect(reportSeoDegradeMock).toHaveBeenCalledWith(
      "redirect-map-fetch-failed",
      "middleware",
      expect.any(Object)
    );
  });

  it("fails open to an empty map and reports once when the response is non-ok", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const map = await getRedirectMap();

    expect(map).toEqual({});
    expect(reportSeoDegradeMock).toHaveBeenCalledTimes(1);
  });

  it("fails open to an empty map and reports once when the body has no data.redirects array", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) });

    const map = await getRedirectMap();

    expect(map).toEqual({});
    expect(reportSeoDegradeMock).toHaveBeenCalledTimes(1);
  });

  it("never throws on any failure mode", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockRejectedValue(new Error("boom"));

    await expect(getRedirectMap()).resolves.toEqual({});
  });

  it("does NOT serve a last-known-good map after a failed refresh (D-03)", async () => {
    vi.useFakeTimers();
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

    // Warm the cache with a populated, successful map.
    mockFetch.mockResolvedValueOnce(
      okResponse([
        { documentId: "d1", source: "/old", destination: "/new", redirectType: "permanent" },
      ])
    );
    const warm = await getRedirectMap();
    expect(warm["/old"]).toBeDefined();

    // Expire it, then fail the refresh.
    vi.advanceTimersByTime(REDIRECT_MAP_TTL_MS + 1);
    mockFetch.mockRejectedValueOnce(new Error("outage"));

    const afterFailure = await getRedirectMap();
    expect(afterFailure).toEqual({});
  });

  it("issues the outbound request with an AbortSignal and a query interpolating REDIRECT_PAGE_SIZE", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue(okResponse([]));

    await getRedirectMap();

    const [, init] = mockFetch.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body);
    expect(body.query).toContain(String(REDIRECT_PAGE_SIZE));
    expect(body.query).toContain("redirects");
  });

  it("returns an empty map with no fetch and no degrade report when env is not configured", async () => {
    delete process.env.NEXT_PUBLIC_STRAPI_URL;
    delete process.env.NEXT_PUBLIC_STRAPI_TOKEN;
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;

    const map = await getRedirectMap();

    expect(map).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
    expect(reportSeoDegradeMock).not.toHaveBeenCalled();
  });
});
