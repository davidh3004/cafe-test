import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE } from "../lib/seo-resolve";

// Render-smoke test for the root layout's <main> landmark (D-09,
// landmark-one-main). The vitest environment is `node` (no jsdom), so we render
// DOM-free with renderToStaticMarkup and assert on the returned HTML string —
// matches the theta-theme-fixocargo/test/sections-*.test.tsx convention.
//
// This single wrapper in the root layout covers EVERY render branch of the app
// (normal render, app/[slug]/page.tsx's Configuration Error branch, and
// app/not-found.tsx) by construction, since all routes render through this
// layout — so testing it here is sufficient, no per-branch duplication needed.
//
// Phase 14 (Plan 03): `RootLayout` is now async and reads the Site through
// the shared Strapi fetcher, so its returned element must be awaited before
// handing it to `renderToStaticMarkup`. This `node` vitest environment has
// no Strapi endpoint configured, so the fetcher returns null and only the
// D-11 degrade path is reachable here — the assertions below pin the
// documented default language attribute and the absence of both retired
// placeholder strings on that path. The non-default locale path (a real
// Strapi-authored `siteLocale` driving a non-"en" `<html lang>`) is covered
// instead by `resolveLocale`'s own pure unit cases (Plan 02) and by Task 3's
// live check in this plan.
import RootLayout from "./layout";

describe("RootLayout — single <main> landmark (D-09)", () => {
  it("renders exactly one <main> element wrapping arbitrary children", async () => {
    const html = renderToStaticMarkup(
      await RootLayout({
        children: <div>Arbitrary page content</div>,
      })
    );

    const mainOpenTagMatches = html.match(/<main/g) ?? [];
    expect(mainOpenTagMatches).toHaveLength(1);
    expect(html).toContain("Arbitrary page content");
  });

  it("degrades to the documented default language attribute when the Site read fails or is unconfigured (D-11)", async () => {
    const html = renderToStaticMarkup(
      await RootLayout({
        children: <div>Arbitrary page content</div>,
      })
    );

    expect(html).toContain(`lang="${DEFAULT_LOCALE}"`);
  });

  it("never renders either retired placeholder string (D-12)", async () => {
    const html = renderToStaticMarkup(
      await RootLayout({
        children: <div>Arbitrary page content</div>,
      })
    );

    expect(html).not.toContain("Theme Site");
    expect(html).not.toContain("Generated theme site");
  });
});
