import { describe, expect, it } from "vitest";
// Phase 14, Plan 04: pure sitemap/robots builders. Mirrors the
// live-resolve/seo-resolve test convention — one describe per exported
// function, synthetic StrapiPage shapes, no mocking of anything.
import {
  isSitemapEligible,
  buildSitemapEntries,
  buildRobots,
  isPostSitemapEligible,
  buildBlogPostSitemapEntries,
  buildBlogArchiveSitemapEntries,
  countSurvivingEntries,
  mergeSitemapEntries,
} from "../discovery-resolve";
import {
  buildPageMetadataFrom,
  resolveSiteOrigin,
  resolveHomepageSlugFrom,
  absoluteUrl,
} from "../seo-resolve";
import { buildPostMetadataFrom } from "../blog-metadata";
import { resolveArchiveCanonicalPath } from "../blog-render";
import type { StrapiPage } from "../strapi-client";
import type { SitemapArticleRecord, BlogArticleRecord } from "../blog-client";
import type { Metadata } from "next";
// Phase 14, Plan 07 (G-14-5): the rendered-head-tag + sitemap-XML harness.
// Drives Next's OWN resolvers/generators/serializers so this describe block
// asserts on what a crawler actually receives, not on two pure builders'
// return values compared to each other.
import { renderHeadTags, renderSitemapXml } from "./helpers/next-head-surface";

const ORIGIN = "https://acme.com";

/** Fixture builder for the sitemap-enumeration read shape (Phase 23, Plan
 * 01, Task 3) — fills the required scalars with defaults so each test
 * overrides only the fields it cares about. */
function sitemapPost(overrides: Partial<SitemapArticleRecord> = {}): SitemapArticleRecord {
  return {
    slug: "hello-world",
    publishedAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    canonicalUrl: null,
    seo: null,
    ...overrides,
  };
}

/** Fixture builder: fills the required StrapiPage scalars with defaults so
 * each test overrides only the fields it cares about, matching the plan's
 * minimal example objects without violating strict typing. */
function page(overrides: Partial<StrapiPage> = {}): StrapiPage {
  return {
    documentId: "doc-1",
    title: "Untitled",
    slug: "untitled",
    ...overrides,
  } as StrapiPage;
}

describe("isSitemapEligible — D-17 two-signal filter", () => {
  it("is true for a published page with no seo block", () => {
    expect(isSitemapEligible(page({ publishedAt: "2026-01-01T00:00:00Z" }))).toBe(true);
  });

  it("is false when publishedAt is null", () => {
    expect(isSitemapEligible(page({ publishedAt: null }))).toBe(false);
  });

  it("is false when publishedAt is undefined", () => {
    expect(isSitemapEligible(page({ publishedAt: undefined }))).toBe(false);
  });

  it("is false when publishedAt is absent entirely", () => {
    expect(isSitemapEligible(page())).toBe(false);
  });

  it("is false for a published page flagged noindex: true", () => {
    expect(
      isSitemapEligible(
        page({ publishedAt: "2026-01-01T00:00:00Z", seo: { noindex: true } })
      )
    ).toBe(false);
  });

  it("is true for a published page with noindex: false", () => {
    expect(
      isSitemapEligible(
        page({ publishedAt: "2026-01-01T00:00:00Z", seo: { noindex: false } })
      )
    ).toBe(true);
  });

  it("is true for a published page with noindex: null", () => {
    expect(
      isSitemapEligible(
        page({ publishedAt: "2026-01-01T00:00:00Z", seo: { noindex: null } })
      )
    ).toBe(true);
  });

  it("is true for a published page with no noindex key on seo at all", () => {
    expect(
      isSitemapEligible(page({ publishedAt: "2026-01-01T00:00:00Z", seo: {} }))
    ).toBe(true);
  });
});

describe("buildSitemapEntries — D-14/D-15 entry construction", () => {
  it("returns an empty array for an empty pages array", () => {
    expect(buildSitemapEntries([], ORIGIN)).toEqual([]);
  });

  it("returns an empty array for a nullish pages input rather than throwing", () => {
    expect(buildSitemapEntries(null, ORIGIN)).toEqual([]);
    expect(buildSitemapEntries(undefined, ORIGIN)).toEqual([]);
  });

  it("lists the homepage at the site root only, never at its slug path", () => {
    const homepage = page({
      slug: "home",
      isHomepage: true,
      publishedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    });
    const about = page({
      slug: "about",
      publishedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z",
    });

    const entries = buildSitemapEntries([homepage, about], ORIGIN);
    const urls = entries.map((e) => e.url);

    // AMENDED (Phase 14 Plan 07, G-14-5): the root entry is the bare origin.
    expect(urls).toEqual(["https://acme.com", "https://acme.com/about"]);
    expect(urls).not.toContain("https://acme.com/home");
  });

  it("excludes an unpublished page and a published-but-noindex page without shifting remaining order", () => {
    const draft = page({ slug: "draft", publishedAt: null });
    const noindexed = page({
      slug: "hidden",
      publishedAt: "2026-01-01T00:00:00Z",
      seo: { noindex: true },
    });
    const published = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });

    const entries = buildSitemapEntries([draft, noindexed, published], ORIGIN);

    expect(entries.map((e) => e.url)).toEqual(["https://acme.com/about"]);
  });

  it("sets lastModified from updatedAt, and omits the key entirely for a blank/null/undefined value", () => {
    const withTimestamp = page({
      slug: "about",
      publishedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-05T00:00:00Z",
    });
    const [entry] = buildSitemapEntries([withTimestamp], ORIGIN);
    expect(entry.lastModified).toBe("2026-01-05T00:00:00Z");

    for (const updatedAt of [null, undefined, ""] as const) {
      const noTimestamp = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z", updatedAt });
      const [entryWithout] = buildSitemapEntries([noTimestamp], ORIGIN);
      expect(entryWithout).not.toHaveProperty("lastModified");
    }
  });

  it("never carries a crawl-priority or change-frequency key", () => {
    const published = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const [entry] = buildSitemapEntries([published], ORIGIN);
    expect(entry).not.toHaveProperty("priority");
    expect(entry).not.toHaveProperty("changeFrequency");
  });

  it("dedupes two pages that both claim the homepage flag into a single root entry", () => {
    const homepageA = page({ slug: "home", isHomepage: true, publishedAt: "2026-01-01T00:00:00Z" });
    const homepageB = page({ slug: "landing", isHomepage: true, publishedAt: "2026-01-01T00:00:00Z" });

    const entries = buildSitemapEntries([homepageA, homepageB], ORIGIN);

    // AMENDED (Phase 14 Plan 07, G-14-5): the root entry is the bare origin.
    expect(entries.map((e) => e.url)).toEqual(["https://acme.com"]);
  });

  // CR-01 regression. The sitemap used to honor only the isHomepage flag
  // while routing resolved `/` through the full three-tier ladder, so a
  // tenant with no flagged page got a sitemap that listed `/{slug}` and never
  // listed the site root at all — D-15's contradictory-signal problem.
  it("lists the root, not the slug, for a homepage resolved by convention", () => {
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const home = page({ slug: "home", publishedAt: "2026-01-01T00:00:00Z" });

    const urls = buildSitemapEntries([about, home], ORIGIN).map((e) => e.url);

    // AMENDED (Phase 14 Plan 07, G-14-5): the root entry is the bare origin.
    expect(urls).toContain("https://acme.com");
    expect(urls).not.toContain("https://acme.com/home");
    expect(urls).toContain("https://acme.com/about");
  });

  it("lists the root, not the slug, for a homepage resolved by first-page fallback", () => {
    const landing = page({ slug: "landing", publishedAt: "2026-01-01T00:00:00Z" });
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });

    const urls = buildSitemapEntries([landing, about], ORIGIN).map((e) => e.url);

    // AMENDED (Phase 14 Plan 07, G-14-5): the root entry is the bare origin.
    expect(urls).toContain("https://acme.com");
    expect(urls).not.toContain("https://acme.com/landing");
    expect(urls).toContain("https://acme.com/about");
  });

  it("resolves the homepage over the unfiltered list, so an ineligible first page does not shift it", () => {
    // `landing` is what `/` really renders (tier 3 over the full list) even
    // though it is a draft and so excluded from the sitemap. The remaining
    // pages must NOT be promoted to the root in its place.
    const draftLanding = page({ slug: "landing", publishedAt: null });
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });

    const urls = buildSitemapEntries([draftLanding, about], ORIGIN).map((e) => e.url);

    // AMENDED (Phase 14 Plan 07, G-14-5): negative assertion flipped to the
    // bare-origin root form — meaning preserved, the root must still be
    // absent from this filtered list.
    expect(urls).toEqual(["https://acme.com/about"]);
    expect(urls).not.toContain("https://acme.com");
  });

  it("agrees with the page's own canonical for a conventionally-resolved homepage", () => {
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const home = page({ slug: "home", publishedAt: "2026-01-01T00:00:00Z" });
    const site = { siteUrl: ORIGIN } as never;

    const sitemapUrls = buildSitemapEntries([about, home], ORIGIN).map((e) => e.url);
    const metadata = buildPageMetadataFrom(home, site, {}, "home");

    // D-15: a sitemap entry's url is byte-identical to that page's canonical.
    // AMENDED (Phase 14 Plan 07, G-14-5): bare origin, no trailing slash.
    expect(String(metadata.alternates?.canonical)).toBe("https://acme.com");
    expect(sitemapUrls).toContain(String(metadata.alternates?.canonical));
  });

  it("preserves input order and introduces no sort", () => {
    // Homepage flagged explicitly so this assertion isolates ordering and does
    // not also depend on which page the homepage ladder resolves to.
    const home = page({
      slug: "home",
      isHomepage: true,
      publishedAt: "2026-01-01T00:00:00Z",
    });
    const b = page({ slug: "b-page", publishedAt: "2026-01-01T00:00:00Z" });
    const a = page({ slug: "a-page", publishedAt: "2026-01-01T00:00:00Z" });

    const entries = buildSitemapEntries([home, b, a], ORIGIN);

    // AMENDED (Phase 14 Plan 07, G-14-5): the root entry is the bare origin.
    expect(entries.map((e) => e.url)).toEqual([
      "https://acme.com",
      "https://acme.com/b-page",
      "https://acme.com/a-page",
    ]);
  });

  it("emits a sitemap URL byte-identical to buildPageMetadataFrom's canonical for the same page and origin", () => {
    // Both sides resolve the homepage from the SAME page list — that shared
    // resolution is what makes the two agree by construction (D-15).
    const home = page({
      slug: "home",
      isHomepage: true,
      publishedAt: "2026-01-01T00:00:00Z",
    });
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const pages = [home, about];
    const site = { siteUrl: ORIGIN };
    const env = {};

    const entries = buildSitemapEntries(pages, ORIGIN);
    const aboutEntry = entries.find((e) => e.url.endsWith("/about"));
    const metadata = buildPageMetadataFrom(
      about,
      site,
      env,
      resolveHomepageSlugFrom(pages)
    );

    expect(aboutEntry?.url).toBe(
      (metadata.alternates as { canonical?: string })?.canonical
    );
  });
});

describe("isPostSitemapEligible — D-6/T-23-06 three-signal filter", () => {
  it("is false when publishedAt is blank", () => {
    expect(isPostSitemapEligible(sitemapPost({ publishedAt: null }))).toBe(false);
    expect(isPostSitemapEligible(sitemapPost({ publishedAt: "" }))).toBe(false);
    expect(isPostSitemapEligible(sitemapPost({ publishedAt: undefined }))).toBe(false);
  });

  // Regression: `slug` is nullable in Strapi while the generated type declares
  // it `string`. Without a gate here, `resolvePostCanonical` coerces the
  // missing slug to "" and the sitemap emits `{origin}/blog/` — a bogus entry
  // duplicating the blog index's own URL under a post's authority. A slugless
  // post has no reachable URL at all, so it can never legitimately be listed.
  it("is false when the slug is null, undefined or blank", () => {
    expect(isPostSitemapEligible(sitemapPost({ slug: null }))).toBe(false);
    expect(isPostSitemapEligible(sitemapPost({ slug: undefined }))).toBe(false);
    expect(isPostSitemapEligible(sitemapPost({ slug: "" }))).toBe(false);
    expect(isPostSitemapEligible(sitemapPost({ slug: "   " }))).toBe(false);
  });

  it("never emits a bare /blog/ entry for a slugless published post", () => {
    const entries = buildBlogPostSitemapEntries(
      [sitemapPost({ slug: null }), sitemapPost({ slug: "real-post" })],
      "https://tenant.example"
    );
    expect(entries.map((e) => e.url)).toEqual([
      "https://tenant.example/blog/real-post",
    ]);
    expect(entries.some((e) => e.url.endsWith("/blog/"))).toBe(false);
  });

  it("is false when seo.noindex is strictly true", () => {
    expect(isPostSitemapEligible(sitemapPost({ seo: { noindex: true } }))).toBe(false);
  });

  it("is true when seo.noindex is false, null, or the seo block is absent", () => {
    expect(isPostSitemapEligible(sitemapPost({ seo: { noindex: false } }))).toBe(true);
    expect(isPostSitemapEligible(sitemapPost({ seo: { noindex: null } }))).toBe(true);
    expect(isPostSitemapEligible(sitemapPost({ seo: null }))).toBe(true);
  });

  it("is false for a post carrying a valid absolute https canonicalUrl override", () => {
    expect(
      isPostSitemapEligible(
        sitemapPost({ canonicalUrl: "https://elsewhere.example/canonical-post" })
      )
    ).toBe(false);
  });

  it("is true for a post whose canonicalUrl fails validation (never a live override)", () => {
    expect(
      isPostSitemapEligible(sitemapPost({ canonicalUrl: "http://elsewhere.example/x" }))
    ).toBe(true);
    expect(isPostSitemapEligible(sitemapPost({ canonicalUrl: "not a url" }))).toBe(true);
  });

  it("is true for a published post with none of the three exclusion signals", () => {
    expect(isPostSitemapEligible(sitemapPost())).toBe(true);
  });
});

describe("buildBlogPostSitemapEntries — D-1 URL derivation, D-6 eligibility, dedup", () => {
  it("returns an empty array for an empty or nullish posts input", () => {
    expect(buildBlogPostSitemapEntries([], ORIGIN)).toEqual([]);
    expect(buildBlogPostSitemapEntries(null, ORIGIN)).toEqual([]);
    expect(buildBlogPostSitemapEntries(undefined, ORIGIN)).toEqual([]);
  });

  it("emits one entry per eligible post, composed via resolvePostCanonical", () => {
    const entries = buildBlogPostSitemapEntries([sitemapPost({ slug: "hello-world" })], ORIGIN);
    expect(entries).toEqual([{ url: "https://acme.com/blog/hello-world" }]);
  });

  it("excludes a draft, a noindex post, and a post with a valid canonical override", () => {
    const draft = sitemapPost({ slug: "draft", publishedAt: null });
    const noindexed = sitemapPost({ slug: "hidden", seo: { noindex: true } });
    const overridden = sitemapPost({
      slug: "overridden",
      canonicalUrl: "https://elsewhere.example/canonical",
    });
    const eligible = sitemapPost({ slug: "visible" });

    const entries = buildBlogPostSitemapEntries(
      [draft, noindexed, overridden, eligible],
      ORIGIN
    );

    expect(entries).toEqual([{ url: "https://acme.com/blog/visible" }]);
  });

  it("sets lastModified from updatedAt, and omits the key entirely for a blank/null/undefined value", () => {
    const withTimestamp = sitemapPost({ slug: "a", updatedAt: "2026-01-05T00:00:00Z" });
    const [entry] = buildBlogPostSitemapEntries([withTimestamp], ORIGIN);
    expect(entry.lastModified).toBe("2026-01-05T00:00:00Z");

    for (const updatedAt of [null, undefined, ""] as const) {
      const noTimestamp = sitemapPost({ slug: "b", updatedAt });
      const [entryWithout] = buildBlogPostSitemapEntries([noTimestamp], ORIGIN);
      expect(entryWithout).not.toHaveProperty("lastModified");
    }
  });

  it("never carries a crawl-priority or change-frequency key", () => {
    const [entry] = buildBlogPostSitemapEntries([sitemapPost()], ORIGIN);
    expect(entry).not.toHaveProperty("priority");
    expect(entry).not.toHaveProperty("changeFrequency");
  });

  it("dedupes two posts that resolve the same URL, keeping the first occurrence", () => {
    const first = sitemapPost({ slug: "dup", updatedAt: "2026-01-01T00:00:00Z" });
    const second = sitemapPost({ slug: "dup", updatedAt: "2026-02-01T00:00:00Z" });

    const entries = buildBlogPostSitemapEntries([first, second], ORIGIN);

    expect(entries).toHaveLength(1);
    expect(entries[0].lastModified).toBe("2026-01-01T00:00:00Z");
  });

  it("preserves input order and introduces no sort", () => {
    const b = sitemapPost({ slug: "b-post" });
    const a = sitemapPost({ slug: "a-post" });

    const entries = buildBlogPostSitemapEntries([b, a], ORIGIN);

    expect(entries.map((e) => e.url)).toEqual([
      "https://acme.com/blog/b-post",
      "https://acme.com/blog/a-post",
    ]);
  });
});

describe("mergeSitemapEntries — pure first-wins dedup across groups", () => {
  it("returns an empty array when called with no groups", () => {
    expect(mergeSitemapEntries()).toEqual([]);
  });

  it("treats a nullish group as empty rather than throwing", () => {
    expect(mergeSitemapEntries(null, undefined, [{ url: "https://acme.com/about" }])).toEqual([
      { url: "https://acme.com/about" },
    ]);
  });

  it("concatenates distinct URLs across groups, preserving each group's own order", () => {
    const pageGroup = [{ url: "https://acme.com/about" }];
    const postGroup = [{ url: "https://acme.com/blog/hello" }];

    expect(mergeSitemapEntries(pageGroup, postGroup)).toEqual([
      { url: "https://acme.com/about" },
      { url: "https://acme.com/blog/hello" },
    ]);
  });

  it("keeps exactly one entry when a page group and a blog group both resolve the same URL, and it is the FIRST group's", () => {
    // The exact CMS-page-slug-'blog'-collides-with-the-blog-listing scenario
    // this function exists to resolve deterministically (plan header).
    const pageGroup = [{ url: "https://acme.com/blog", lastModified: "2026-01-01T00:00:00Z" }];
    const postGroup = [{ url: "https://acme.com/blog" }];

    const merged = mergeSitemapEntries(pageGroup, postGroup);

    expect(merged).toEqual([{ url: "https://acme.com/blog", lastModified: "2026-01-01T00:00:00Z" }]);
  });
});

describe("buildBlogArchiveSitemapEntries — D-8 archive page-1 entries, D-6 term derivation", () => {
  it("returns an empty array for an empty or nullish posts input", () => {
    expect(buildBlogArchiveSitemapEntries([], ORIGIN)).toEqual([]);
    expect(buildBlogArchiveSitemapEntries(null, ORIGIN)).toEqual([]);
    expect(buildBlogArchiveSitemapEntries(undefined, ORIGIN)).toEqual([]);
  });

  it("returns an empty array, including no blog index entry, when zero posts are eligible", () => {
    const draft = sitemapPost({
      slug: "draft",
      publishedAt: null,
      category: { slug: "news" },
    });
    const noindexed = sitemapPost({
      slug: "hidden",
      seo: { noindex: true },
      category: { slug: "news" },
    });

    expect(buildBlogArchiveSitemapEntries([draft, noindexed], ORIGIN)).toEqual([]);
  });

  it("emits the blog index, one category archive and one tag archive at page one for a fixture whose posts carry that taxonomy", () => {
    const post = sitemapPost({
      slug: "hello",
      category: { slug: "news" },
      tags: [{ slug: "release" }],
    });

    const entries = buildBlogArchiveSitemapEntries([post], ORIGIN);

    expect(entries.map((e) => e.url)).toEqual([
      "https://acme.com/blog",
      "https://acme.com/blog/category/news",
      "https://acme.com/blog/tag/release",
    ]);
  });

  it("excludes a category that appears only on a draft, only on a noindex post, or only on a post carrying a valid canonical override", () => {
    const draftWithCategory = sitemapPost({
      slug: "draft",
      publishedAt: null,
      category: { slug: "draft-only" },
    });
    const noindexWithCategory = sitemapPost({
      slug: "hidden",
      seo: { noindex: true },
      category: { slug: "noindex-only" },
    });
    const overriddenWithCategory = sitemapPost({
      slug: "overridden",
      canonicalUrl: "https://elsewhere.example/canonical",
      category: { slug: "override-only" },
    });
    const eligible = sitemapPost({ slug: "visible", category: { slug: "visible-category" } });

    const entries = buildBlogArchiveSitemapEntries(
      [draftWithCategory, noindexWithCategory, overriddenWithCategory, eligible],
      ORIGIN
    );

    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://acme.com/blog/category/visible-category");
    expect(urls).not.toContain("https://acme.com/blog/category/draft-only");
    expect(urls).not.toContain("https://acme.com/blog/category/noindex-only");
    expect(urls).not.toContain("https://acme.com/blog/category/override-only");
  });

  it("emits no paginated archive URL for a fixture with more posts than one listing page", () => {
    // BLOG_PAGE_SIZE (blog-pagination.ts) is 10 -- a naive per-term,
    // per-page enumeration would have produced /blog/page/2, /blog/category/
    // news/page/2, etc. for this 25-post fixture.
    const posts = Array.from({ length: 25 }, (_, index) =>
      sitemapPost({
        slug: `post-${index}`,
        category: { slug: "news" },
        tags: [{ slug: "release" }],
      })
    );

    const entries = buildBlogArchiveSitemapEntries(posts, ORIGIN);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.url).not.toMatch(/\/page\//);
    }
  });

  it("never carries a lastModified key on any archive entry", () => {
    const post = sitemapPost({
      slug: "hello",
      updatedAt: "2026-01-05T00:00:00Z",
      category: { slug: "news" },
      tags: [{ slug: "release" }],
    });

    const entries = buildBlogArchiveSitemapEntries([post], ORIGIN);

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).not.toHaveProperty("lastModified");
    }
  });

  it("never carries a priority or changeFrequency key", () => {
    const post = sitemapPost({ slug: "hello", category: { slug: "news" } });
    const [entry] = buildBlogArchiveSitemapEntries([post], ORIGIN);
    expect(entry).not.toHaveProperty("priority");
    expect(entry).not.toHaveProperty("changeFrequency");
  });

  it("dedupes repeated category and tag slugs across posts, preserving first-appearance order, index-then-categories-then-tags", () => {
    const first = sitemapPost({
      slug: "a",
      category: { slug: "news" },
      tags: [{ slug: "release" }],
    });
    const second = sitemapPost({
      slug: "b",
      category: { slug: "news" },
      tags: [{ slug: "release" }],
    });
    const third = sitemapPost({
      slug: "c",
      category: { slug: "updates" },
      tags: [{ slug: "announcement" }],
    });

    const entries = buildBlogArchiveSitemapEntries([first, second, third], ORIGIN);

    expect(entries.map((e) => e.url)).toEqual([
      "https://acme.com/blog",
      "https://acme.com/blog/category/news",
      "https://acme.com/blog/category/updates",
      "https://acme.com/blog/tag/release",
      "https://acme.com/blog/tag/announcement",
    ]);
  });
});

describe("countSurvivingEntries — T-23-23 blog-listing URL collision detection", () => {
  it("returns the group's own length when no collision occurred", () => {
    const group = [{ url: "https://acme.com/blog/category/news" }];
    const merged = mergeSitemapEntries([{ url: "https://acme.com/about" }], group);
    expect(countSurvivingEntries(group, merged)).toBe(group.length);
  });

  it("returns a count lower than the group's length when an earlier group already claimed the blog index URL, and the merged result still carries that URL exactly once, as the earlier group's own entry", () => {
    const post = sitemapPost({ slug: "hello", category: { slug: "news" } });
    const archiveEntries = buildBlogArchiveSitemapEntries([post], ORIGIN);
    const pageGroup = [{ url: "https://acme.com/blog", lastModified: "2026-01-01T00:00:00Z" }];

    const merged = mergeSitemapEntries(pageGroup, archiveEntries);

    expect(countSurvivingEntries(archiveEntries, merged)).toBe(archiveEntries.length - 1);

    const blogIndexEntries = merged.filter((e) => e.url === "https://acme.com/blog");
    expect(blogIndexEntries).toHaveLength(1);
    expect(blogIndexEntries[0]).toEqual({
      url: "https://acme.com/blog",
      lastModified: "2026-01-01T00:00:00Z",
    });
  });
});

describe("cross-layer byte identity — Next's real sitemap vs. Next's real rendered canonical (G-14-5)", () => {
  // The two "byte-identical" tests in the block above compare the PURE
  // buildSitemapEntries resolver against the PURE buildPageMetadataFrom
  // resolver — a real property worth pinning, but one that stayed green
  // while G-14-5 shipped, because Next's OWN rendering layer (URL
  // normalization against trailingSlash) sits downstream of both pure
  // resolvers and neither test reaches it. This block drives Next's real
  // `resolveSitemap` serializer (renderSitemapXml) and Next's real canonical
  // /og:url/hreflang tag generators (renderHeadTags) and compares their
  // EXTRACTED output directly. Not a replacement for the pure-resolver
  // block above — a future reader should not delete one as a duplicate of
  // the other.
  const site = { siteUrl: ORIGIN, siteLocale: "es-MX" };
  const env = {};

  /** Extracts the first `<loc>` text from a serialized sitemap XML string,
   * asserting the extraction actually matched before returning — an
   * extraction that silently returns undefined on both sides would make a
   * byte-identity comparison pass while proving nothing. */
  function extractLoc(xml: string): string {
    const match = /<loc>([^<]*)<\/loc>/.exec(xml);
    expect(match).not.toBeNull();
    const loc = match ? match[1] : "";
    expect(loc).not.toBe("");
    return loc;
  }

  /** Extracts the rendered canonical `href` from head markup, asserting the
   * extraction actually matched. */
  function extractCanonicalHref(html: string): string {
    const match = /<link rel="canonical" href="([^"]*)"/.exec(html);
    expect(match).not.toBeNull();
    const href = match ? match[1] : "";
    expect(href).not.toBe("");
    return href;
  }

  /** Extracts the rendered `og:url` content, asserting the extraction
   * actually matched. */
  function extractOgUrl(html: string): string {
    const match = /<meta property="og:url" content="([^"]*)"/.exec(html);
    expect(match).not.toBeNull();
    const url = match ? match[1] : "";
    expect(url).not.toBe("");
    return url;
  }

  /** Extracts every rendered hreflang alternate `href` (keyed off `href`
   * only — `renderToStaticMarkup` emits React's camelCase `hrefLang`
   * spelling, per the Plan 06 harness note), asserting at least one matched
   * and none is blank. */
  function extractHreflangHrefs(html: string): string[] {
    const hrefs = [
      ...html.matchAll(/<link rel="alternate" hrefLang="[^"]*" href="([^"]*)"/g),
    ].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).not.toBe("");
    return hrefs;
  }

  it("flagged homepage: the serialized <loc> equals the rendered canonical href, and og:url + both hreflang alternates agree too", () => {
    const homepage = page({
      slug: "home",
      isHomepage: true,
      publishedAt: "2026-01-01T00:00:00Z",
    });
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const pages = [homepage, about];

    const sitemapEntries = buildSitemapEntries(pages, ORIGIN);
    const homeEntry = sitemapEntries.find((e) => !e.url.endsWith("/about"));
    expect(homeEntry).toBeDefined();
    const xml = renderSitemapXml([homeEntry!]);
    const loc = extractLoc(xml);

    const metadata = buildPageMetadataFrom(
      homepage,
      site,
      env,
      resolveHomepageSlugFrom(pages)
    );
    const html = renderHeadTags(metadata, { pathname: "/" });
    const canonical = extractCanonicalHref(html);

    expect(loc).toBe(canonical);

    // Every root-referring surface must agree, not just these two.
    expect(extractOgUrl(html)).toBe(canonical);
    const hreflangHrefs = extractHreflangHrefs(html);
    expect(hreflangHrefs).toEqual([canonical, canonical]);
  });

  it("ordinary non-homepage page: the serialized <loc> equals the rendered canonical href", () => {
    const homepage = page({
      slug: "home",
      isHomepage: true,
      publishedAt: "2026-01-01T00:00:00Z",
    });
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const pages = [homepage, about];

    const sitemapEntries = buildSitemapEntries(pages, ORIGIN);
    const aboutEntry = sitemapEntries.find((e) => e.url.endsWith("/about"));
    expect(aboutEntry).toBeDefined();
    const xml = renderSitemapXml([aboutEntry!]);
    const loc = extractLoc(xml);

    const metadata = buildPageMetadataFrom(
      about,
      site,
      env,
      resolveHomepageSlugFrom(pages)
    );
    const html = renderHeadTags(metadata, { pathname: "/about" });
    const canonical = extractCanonicalHref(html);

    expect(loc).toBe(canonical);
  });

  // CR-01 scenario: the homepage resolved by convention, not by the
  // isHomepage flag — the case this defect class keeps recurring in.
  it("conventionally-resolved homepage (no isHomepage flag): the serialized <loc> equals the rendered canonical href", () => {
    const home = page({ slug: "home", publishedAt: "2026-01-01T00:00:00Z" });
    const about = page({ slug: "about", publishedAt: "2026-01-01T00:00:00Z" });
    const pages = [about, home];
    const homepageSlug = resolveHomepageSlugFrom(pages);
    expect(homepageSlug).toBe("home");

    const sitemapEntries = buildSitemapEntries(pages, ORIGIN);
    const homeEntry = sitemapEntries.find((e) => !e.url.endsWith("/about"));
    expect(homeEntry).toBeDefined();
    const xml = renderSitemapXml([homeEntry!]);
    const loc = extractLoc(xml);

    const metadata = buildPageMetadataFrom(home, site, env, homepageSlug);
    // "/" is the route that really serves this page's content for this
    // tenant (the CR-01 property) — the pathname the harness is given
    // matches the real serving route, not the page's own slug.
    const html = renderHeadTags(metadata, { pathname: "/" });
    const canonical = extractCanonicalHref(html);

    expect(loc).toBe(canonical);
  });

  // Phase 23, Plan 01, Task 3 -- this phase's TRACER claim: a published
  // post's sitemap <loc> is byte-identical to that SAME post's rendered
  // canonical, driven through Next's OWN real serializer (renderSitemapXml)
  // on one side and Next's OWN real head-tag generator (renderHeadTags) on
  // the other -- never two pure resolvers compared to each other. Both sides
  // trace back to the SAME resolvePostCanonical call (buildBlogPostSitemapEntries
  // and buildPostMetadataFrom each call it independently), which is what
  // makes agreement a construction guarantee (D-1) rather than a coincidence
  // this one test happens to catch.
  it("a published post: the serialized <loc> equals the rendered canonical href for that post's own route", () => {
    const post: SitemapArticleRecord = {
      slug: "hello-world",
      publishedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      canonicalUrl: null,
      seo: { noindex: false },
    };

    const postEntries = buildBlogPostSitemapEntries([post], ORIGIN);
    expect(postEntries).toHaveLength(1);
    const xml = renderSitemapXml(postEntries);
    const loc = extractLoc(xml);

    const article: BlogArticleRecord = {
      documentId: "article-1",
      title: "Hello World",
      slug: "hello-world",
      body: "<p>Some body copy.</p>",
      excerpt: "An excerpt.",
      publishedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      canonicalUrl: null,
      featuredImage: null,
      seo: { noindex: false },
      category: null,
      tags: [],
      author: null,
    };
    const metadata = buildPostMetadataFrom(article, site, env);
    const html = renderHeadTags(metadata, { pathname: "/blog/hello-world" });
    const canonical = extractCanonicalHref(html);

    expect(loc).toBe(canonical);
  });

  // Phase 23, Plan 05, Task 2 -- the archive-surface counterpart to the
  // published-post tracer test above. `buildArchiveMetadata`
  // (app/_lib/render-blog.tsx) is async and network-fetching, so it cannot be
  // driven directly here without mocking Strapi; this test instead composes
  // the SAME canonical the route composes -- `absoluteUrl(origin,
  // resolveArchiveCanonicalPath(kind, termSlug, 1))`, the exact call
  // `buildArchiveMetadata` makes -- and drives Next's real head-tag generator
  // over it, on the other side of the SAME real sitemap serializer the post
  // test above uses.
  it("an archive entry (the blog index): the serialized <loc> equals the canonical href that surface's own metadata renders", () => {
    const post = sitemapPost({ slug: "hello", category: { slug: "news" } });
    const archiveEntries = buildBlogArchiveSitemapEntries([post], ORIGIN);
    const indexEntry = archiveEntries.find((e) => e.url === `${ORIGIN}/blog`);
    expect(indexEntry).toBeDefined();

    const xml = renderSitemapXml([indexEntry!]);
    const loc = extractLoc(xml);

    const metadata: Metadata = {
      title: "Blog",
      metadataBase: new URL(ORIGIN),
      alternates: {
        canonical: absoluteUrl(ORIGIN, resolveArchiveCanonicalPath("index", null, 1)),
      },
    };
    const html = renderHeadTags(metadata, { pathname: "/blog" });
    const canonical = extractCanonicalHref(html);

    expect(loc).toBe(canonical);
  });

  it("an archive entry (a category archive): the serialized <loc> equals the canonical href that surface's own metadata renders", () => {
    const post = sitemapPost({ slug: "hello", category: { slug: "news" } });
    const archiveEntries = buildBlogArchiveSitemapEntries([post], ORIGIN);
    const categoryEntry = archiveEntries.find((e) => e.url === `${ORIGIN}/blog/category/news`);
    expect(categoryEntry).toBeDefined();

    const xml = renderSitemapXml([categoryEntry!]);
    const loc = extractLoc(xml);

    const metadata: Metadata = {
      title: "News",
      metadataBase: new URL(ORIGIN),
      alternates: {
        canonical: absoluteUrl(ORIGIN, resolveArchiveCanonicalPath("category", "news", 1)),
      },
    };
    const html = renderHeadTags(metadata, { pathname: "/blog/category/news" });
    const canonical = extractCanonicalHref(html);

    expect(loc).toBe(canonical);
  });
});

describe("buildRobots — D-16 single allow group, host-agreement with the sitemap", () => {
  it("returns a single wildcard allow group and the sitemap URL for a resolved origin", () => {
    const robots = buildRobots(ORIGIN);
    expect(robots.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(robots.sitemap).toBe("https://acme.com/sitemap.xml");
  });

  it("returns the same wildcard allow group with no sitemap key when origin is null", () => {
    const robots = buildRobots(null);
    expect(robots.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(robots).not.toHaveProperty("sitemap");
  });

  it("carries no crawl-blocking key for a resolved or a null origin", () => {
    expect(buildRobots(ORIGIN)).not.toHaveProperty("disallow");
    expect(buildRobots(null)).not.toHaveProperty("disallow");
  });

  it("returns exactly one rules group, asserted by shape", () => {
    const robots = buildRobots(ORIGIN);
    expect(Array.isArray(robots.rules)).toBe(false);
  });

  it("agrees byte-for-byte with a sitemap URL composed independently from resolveSiteOrigin + absoluteUrl", () => {
    const independentOrigin = resolveSiteOrigin({ siteUrl: ORIGIN }, {});
    const independentSitemapUrl = absoluteUrl(independentOrigin as string, "/sitemap.xml");

    expect(buildRobots(ORIGIN).sitemap).toBe(independentSitemapUrl);
  });

  it("never emits a host key", () => {
    expect(buildRobots(ORIGIN)).not.toHaveProperty("host");
    expect(buildRobots(null)).not.toHaveProperty("host");
  });
});
