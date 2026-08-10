import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Pins the cache policy in vercel.json.
 *
 * WHY THIS TEST EXISTS. The platform appends `?v=<lastDeployedAt>` to every
 * theme asset URL it renders. A versioned URL is safe to cache forever, because
 * a rebuild produces a NEW url rather than a stale one under the same key.
 *
 * But three cases reach the bundle with NO version token:
 *   1. a tenant whose theme has never been deployed (no timestamp to append)
 *   2. an operator-set CSS URL override
 *   3. anyone hitting the bare path — a script, a bookmark, a proxy
 *
 * If any of those ever received `immutable`, a visitor's browser would pin a
 * stale bundle **with no way for the server to recall it**. There is no purge
 * path for a browser cache once `immutable` has been accepted. That is why the
 * rules are query-gated, and why widening them is not a small change.
 */

const config = JSON.parse(
  readFileSync(resolve(__dirname, "../vercel.json"), "utf-8"),
) as {
  headers: Array<{
    source: string;
    has?: Array<{ type: string; key: string }>;
    missing?: Array<{ type: string; key: string }>;
    headers: Array<{ key: string; value: string }>;
  }>;
};

const BUNDLE_PATHS = [
  "/theme.bundle.js",
  "/theme.bundle.css",
  "/theme.bundle.deferred.css",
];

type HeaderRule = (typeof config.headers)[number];

function cacheControl(rule: HeaderRule): string {
  return rule.headers.find((h) => h.key === "Cache-Control")?.value ?? "";
}

// The one rule that must never be violated: a bundle path may only be cached
// forever when the request carries a version token.
function unsafeImmutableRules(rules: HeaderRule[]): HeaderRule[] {
  return rules.filter(
    (r) =>
      BUNDLE_PATHS.includes(r.source) &&
      cacheControl(r).includes("immutable") &&
      !r.has?.some((c) => c.type === "query" && c.key === "v"),
  );
}

describe("vercel.json cache policy", () => {
  it.each(BUNDLE_PATHS)("%s has exactly one versioned and one bare rule", (path) => {
    const rules = config.headers.filter((r) => r.source === path);
    expect(rules).toHaveLength(2);

    const versioned = rules.filter((r) =>
      r.has?.some((c) => c.type === "query" && c.key === "v"),
    );
    const bare = rules.filter((r) =>
      r.missing?.some((c) => c.type === "query" && c.key === "v"),
    );

    expect(versioned).toHaveLength(1);
    expect(bare).toHaveLength(1);
  });

  it.each(BUNDLE_PATHS)("%s caches forever ONLY when ?v is present", (path) => {
    const rule = config.headers.find(
      (r) => r.source === path && r.has?.some((c) => c.key === "v"),
    )!;
    expect(cacheControl(rule)).toBe("public, max-age=31536000, immutable");
  });

  it.each(BUNDLE_PATHS)("%s revalidates when ?v is absent", (path) => {
    const rule = config.headers.find(
      (r) => r.source === path && r.missing?.some((c) => c.key === "v"),
    )!;
    expect(cacheControl(rule)).toBe("public, max-age=0, must-revalidate");
  });

  // The load-bearing assertion. Everything above could pass while an extra,
  // unconditional rule quietly re-introduced the bug.
  it("never grants immutable to a bundle path without requiring ?v", () => {
    const offenders = unsafeImmutableRules(config.headers);
    expect(
      offenders,
      `these rules would pin a stale bundle in visitors' browsers: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });

  // Proves the assertion above is not vacuous. A check nobody has watched fail
  // is not a check — these are the two ways the rule gets broken in practice.
  it("detects an unconditional immutable rule", () => {
    const bad: HeaderRule[] = [
      {
        source: "/theme.bundle.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
    expect(unsafeImmutableRules(bad)).toHaveLength(1);
  });

  it("detects immutable gated on the wrong query key", () => {
    const bad: HeaderRule[] = [
      {
        source: "/theme.bundle.css",
        has: [{ type: "query", key: "version" }], // not "v"
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
    expect(unsafeImmutableRules(bad)).toHaveLength(1);
  });

  it("serves fonts with a permissive CORS header", () => {
    // Font URLs in the CSS resolve against the THEME's origin, not the tenant
    // site's, so the font responses must be cross-origin readable.
    const rule = config.headers.find((r) => r.source === "/fonts/(.*)");
    expect(rule).toBeDefined();
    expect(
      rule!.headers.find((h) => h.key === "Access-Control-Allow-Origin")?.value,
    ).toBe("*");
  });
});
