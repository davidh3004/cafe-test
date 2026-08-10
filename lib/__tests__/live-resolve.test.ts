import { describe, expect, it } from "vitest";
// RED (Phase 5, Wave 0): `../live-resolve` is built in a later plan (MT-04,
// D-04/D-06). This suite MUST fail now (module absent) so the deployed site's
// liveTheme-filtered page resolution + 404-on-missing-binding has an automated
// gate. The RED state IS the gate.
//
// This file lives under templates/theme-site, which tsconfig EXCLUDES — the
// Wave-0 vitest config adds `templates/theme-site/**/*.test.ts` to its include
// glob so this suite is discoverable.
//
// Contract under test — resolvePageForLiveTheme(page, site):
//   - returns null when site.liveTheme is null/absent (nothing is public)
//   - returns null when the page has no page_template bound to the liveTheme
//       (D-06 missing binding -> 404, no cross-theme fallback)
//   - returns the page with its bound template when a binding for the liveTheme
//       exists
import { resolvePageForLiveTheme } from "../live-resolve";

const liveThemeId = "theme-live";

const siteLive = { documentId: "site-1", liveTheme: { documentId: liveThemeId } };
const siteNoLive = { documentId: "site-1", liveTheme: null };

const pageBoundToLive = {
  documentId: "page-home",
  slug: "homepage",
  page_template: {
    documentId: "tmpl-home",
    theme: { documentId: liveThemeId },
    sections: [{ sectionKey: "hero", order: 0, data: {} }],
  },
};

const pageBoundToOtherTheme = {
  documentId: "page-home",
  slug: "homepage",
  page_template: {
    documentId: "tmpl-home-other",
    theme: { documentId: "theme-OTHER" },
    sections: [{ sectionKey: "hero", order: 0, data: {} }],
  },
};

describe("resolvePageForLiveTheme — liveTheme-filtered resolution + 404 (MT-04, D-04/D-06)", () => {
  it("returns null when site.liveTheme is absent (nothing public)", () => {
    expect(resolvePageForLiveTheme(pageBoundToLive, siteNoLive)).toBeNull();
  });

  it("returns null when the page has no template bound to the liveTheme (D-06 missing binding -> 404)", () => {
    expect(resolvePageForLiveTheme(pageBoundToOtherTheme, siteLive)).toBeNull();
  });

  it("returns the page with its bound template when a binding for the liveTheme exists", () => {
    const result = resolvePageForLiveTheme(pageBoundToLive, siteLive);
    expect(result).not.toBeNull();
    expect(result?.documentId).toBe("page-home");
    expect(result?.page_template?.theme?.documentId).toBe(liveThemeId);
  });
});
