import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LOCALE } from "../lib/seo-resolve";

// IN-02 regression. `fetchSite()` traps internally and returns null, so the
// root layout's own try/catch is unreachable today — it is kept as
// defense-in-depth because a throw in the root layout takes every route in the
// template down (T-14-12). It used to swallow with NO logging at all, so if
// that never-throws contract ever changed, the whole template would silently
// degrade to a default `<html lang>` and no title with zero record of why.
//
// This file forces the unreachable branch by mocking the fetcher to throw, and
// pins BOTH halves of the contract: the layout still renders (no 500), and the
// degrade is recorded on the shared seo-report channel rather than swallowed.
//
// Lives in its own file because `layout.test.tsx` deliberately imports the real
// client — a module-level vi.mock there would change what every other case in
// it exercises.
vi.mock("../lib/strapi-client", () => ({
  fetchSite: vi.fn(async () => {
    throw new TypeError("fetchSite contract broken");
  }),
}));

describe("RootLayout — Site read that throws (T-14-12 defensive trap)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("still renders the layout instead of taking every route down", async () => {
    const { default: RootLayout } = await import("./layout");

    const html = renderToStaticMarkup(
      await RootLayout({ children: <div>Arbitrary page content</div> })
    );

    expect(html).toContain("Arbitrary page content");
    expect((html.match(/<main/g) ?? []).length).toBe(1);
    expect(html).toContain(`lang="${DEFAULT_LOCALE}"`);
  });

  it("records the broken contract instead of swallowing it silently", async () => {
    const { default: RootLayout } = await import("./layout");

    renderToStaticMarkup(
      await RootLayout({ children: <div>Arbitrary page content</div> })
    );

    const reported = errorSpy.mock.calls.find(
      (args: unknown[]) =>
        args[0] === "[seo-metadata]" && args[1] === "site-read-threw"
    );
    expect(reported).toBeDefined();
    expect(reported?.[2]).toBe("root-layout");
    // Only the error's constructor name — never its message, which can carry
    // the Strapi URL or token (T-14-08).
    expect(reported?.[3]).toEqual({ errorName: "TypeError" });
    expect(JSON.stringify(reported)).not.toContain("contract broken");
  });

  it("records the same way from generateMetadata, and emits no title", async () => {
    const { generateMetadata } = await import("./layout");

    const metadata = await generateMetadata();

    const reported = errorSpy.mock.calls.find(
      (args: unknown[]) =>
        args[0] === "[seo-metadata]" && args[1] === "site-read-threw"
    );
    expect(reported).toBeDefined();
    expect(reported?.[2]).toBe("page-metadata");

    // D-12: no placeholder is resurrected on the degrade path.
    expect(metadata.title).toBeUndefined();
    expect(metadata.description).toBeUndefined();
  });
});
