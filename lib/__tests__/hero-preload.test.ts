import { describe, expect, it } from "vitest";
// RED (Phase 11, Plan 03, Task 1): `../hero-preload` is built in this same task
// (D-04). This suite MUST fail now (module absent) so the pure hero-image-url
// resolver has an automated gate before app/[slug]/page.tsx wires the preload
// link through it.
//
// Contract under test — extractFirstHeroImageUrl(page):
//   - reads the SAME section/block shape page-renderer.tsx already reads
//     (sectionKey "hero", block type "hero-slide", data.backgroundImage.value.url)
//   - resolves the FIRST slide by block `order`, not array index
//   - coerces page_template array-or-single exactly like page-renderer.tsx
//   - never throws on missing/malformed data — always degrades to null
import { extractFirstHeroImageUrl } from "../hero-preload";
import type { StrapiPage } from "../strapi-client";

describe("extractFirstHeroImageUrl — pure hero background-image URL resolver (D-04)", () => {
  it("Test 1: resolves the hero-slide background image URL", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [
              {
                blockType: "hero-slide",
                order: 0,
                data: {
                  backgroundImage: {
                    type: "image",
                    value: { id: 1, url: "https://e/hero.jpg" },
                  },
                },
              },
            ],
          },
        ],
      },
    } as unknown as StrapiPage;

    expect(extractFirstHeroImageUrl(page)).toBe("https://e/hero.jpg");
  });

  it("Test 2: with multiple hero-slide blocks, resolves the URL from the LOWEST order block, not array index 0", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [
              {
                blockType: "hero-slide",
                order: 1,
                data: {
                  backgroundImage: {
                    type: "image",
                    value: { id: 2, url: "https://e/second-slide.jpg" },
                  },
                },
              },
              {
                blockType: "hero-slide",
                order: 0,
                data: {
                  backgroundImage: {
                    type: "image",
                    value: { id: 1, url: "https://e/first-slide.jpg" },
                  },
                },
              },
            ],
          },
        ],
      },
    } as unknown as StrapiPage;

    expect(extractFirstHeroImageUrl(page)).toBe("https://e/first-slide.jpg");
  });

  it("Test 3: resolves correctly when page_template is an ARRAY (manyToMany union shape, D-14)", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: [
        {
          sections: [
            {
              sectionKey: "hero",
              order: 0,
              data: {},
              blocks: [
                {
                  blockType: "hero-slide",
                  order: 0,
                  data: {
                    backgroundImage: {
                      type: "image",
                      value: { id: 1, url: "https://e/array-hero.jpg" },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as StrapiPage;

    expect(extractFirstHeroImageUrl(page)).toBe("https://e/array-hero.jpg");
  });

  it("Test 4: returns null when no section has sectionKey 'hero' (case-insensitive match)", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "footer", order: 0, data: {}, blocks: [] },
          { sectionKey: "header", order: 1, data: {}, blocks: [] },
        ],
      },
    } as unknown as StrapiPage;

    expect(extractFirstHeroImageUrl(page)).toBeNull();

    // Case-insensitive match still resolves when present under a different case.
    const pageWithCasedHero = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "Hero",
            order: 0,
            data: {},
            blocks: [
              {
                blockType: "Hero-Slide",
                order: 0,
                data: {
                  backgroundImage: {
                    type: "image",
                    value: { id: 1, url: "https://e/cased.jpg" },
                  },
                },
              },
            ],
          },
        ],
      },
    } as unknown as StrapiPage;

    expect(extractFirstHeroImageUrl(pageWithCasedHero)).toBe("https://e/cased.jpg");
  });

  it("Test 5: returns null (never throws) when the hero-slide block has no/malformed backgroundImage", () => {
    const noBackgroundImage = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [{ blockType: "hero-slide", order: 0, data: {} }],
          },
        ],
      },
    } as unknown as StrapiPage;
    expect(extractFirstHeroImageUrl(noBackgroundImage)).toBeNull();

    const missingUrl = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [
              {
                blockType: "hero-slide",
                order: 0,
                data: { backgroundImage: { type: "image", value: { id: 1 } } },
              },
            ],
          },
        ],
      },
    } as unknown as StrapiPage;
    expect(extractFirstHeroImageUrl(missingUrl)).toBeNull();

    const emptyUrl = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [
              {
                blockType: "hero-slide",
                order: 0,
                data: {
                  backgroundImage: { type: "image", value: { id: 1, url: "" } },
                },
              },
            ],
          },
        ],
      },
    } as unknown as StrapiPage;
    expect(extractFirstHeroImageUrl(emptyUrl)).toBeNull();

    const noHeroSlideBlock = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [{ blockType: "some-other-block", order: 0, data: {} }],
          },
        ],
      },
    } as unknown as StrapiPage;
    expect(extractFirstHeroImageUrl(noHeroSlideBlock)).toBeNull();
  });

  it("Test 6: returns null when page itself is null/undefined", () => {
    expect(extractFirstHeroImageUrl(null)).toBeNull();
    expect(extractFirstHeroImageUrl(undefined)).toBeNull();
  });
});
