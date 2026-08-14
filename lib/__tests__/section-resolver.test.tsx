import { describe, expect, it, vi } from "vitest";
import {
  getSectionComponentKey,
  resolveSectionsForRender,
  sortSectionsForRender,
  buildSectionProps,
  convertStrapiDataToProps,
} from "../section-resolver";
import type { LoadedThemeModule } from "../theme-loader";
import type { StrapiPage } from "../strapi-client";
import type { ArticleProp } from "../article-contract";

function Noop() {
  return null;
}

function makeThemeModule(
  sectionsComponents: Record<string, React.ComponentType<Record<string, unknown>>>
): LoadedThemeModule {
  return {
    name: "test-theme",
    version: "0.0.0-test",
    sectionsComponents,
    sectionSettingsSchemas: {},
  };
}

describe("getSectionComponentKey — exact and case-insensitive lookup", () => {
  it("resolves an exact-match key", () => {
    const sectionsComponents = { hero: Noop };
    expect(getSectionComponentKey("hero", sectionsComponents)).toBe("hero");
  });

  it("resolves a case-insensitive match ('Header' matches 'header')", () => {
    const sectionsComponents = { header: Noop };
    expect(getSectionComponentKey("Header", sectionsComponents)).toBe("header");
  });

  it("returns null for a key absent from sectionsComponents", () => {
    const sectionsComponents = { hero: Noop };
    expect(getSectionComponentKey("footer", sectionsComponents)).toBeNull();
  });
});

describe("resolveSectionsForRender — orphan-section skip (D-12/MT-09)", () => {
  it("skips an unknown section key while its siblings survive", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "hero", order: 0, data: {} },
          { sectionKey: "unknown-section", order: 1, data: {} },
          { sectionKey: "footer", order: 2, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ hero: Noop, footer: Noop });
    const resolved = resolveSectionsForRender(page, themeModule);

    expect(resolved).toHaveLength(2);
    expect(resolved.map((r) => r.sectionKey)).toEqual(["hero", "footer"]);
  });
});

describe("sortSectionsForRender — order ascending + page_template array coercion (D-14)", () => {
  it("sorts sections by order ascending", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "footer", order: 2, data: {} },
          { sectionKey: "hero", order: 0, data: {} },
          { sectionKey: "body", order: 1, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const sorted = sortSectionsForRender(page);
    expect(sorted.map((s) => s.sectionKey)).toEqual(["hero", "body", "footer"]);
  });

  it("coerces an array-shaped page_template to its first element", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: [
        {
          sections: [{ sectionKey: "hero", order: 0, data: {} }],
        },
        {
          sections: [{ sectionKey: "should-not-appear", order: 0, data: {} }],
        },
      ],
    } as unknown as StrapiPage;

    const sorted = sortSectionsForRender(page);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].sectionKey).toBe("hero");
  });

  it("returns an empty array when the template has zero sections", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: { sections: [] },
    } as unknown as StrapiPage;

    expect(sortSectionsForRender(page)).toEqual([]);
  });
});

describe("buildSectionProps — renderBlocks presence (D-02 shared markup)", () => {
  const themeModule = makeThemeModule({ hero: Noop });

  it("omits renderBlocks when the section has no blocks", () => {
    const section = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    const props = buildSectionProps(section, 0, themeModule);
    expect(props.renderBlocks).toBeUndefined();
    expect(props.sectionName).toBe("hero");
  });

  it("provides renderBlocks when the section has at least one block", () => {
    const section = {
      sectionKey: "hero",
      order: 0,
      data: {},
      blocks: [{ blockType: "text", order: 0, data: {} }],
    };
    const props = buildSectionProps(section, 0, themeModule);
    expect(typeof props.renderBlocks).toBe("function");
  });

  it("derives sectionId from section.id, falling back to `${sectionKey}-${index}`", () => {
    const withId = { sectionKey: "hero", id: 42, order: 0, data: {}, blocks: [] };
    expect(buildSectionProps(withId, 0, themeModule).sectionId).toBe("42");

    const withoutId = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    expect(buildSectionProps(withoutId, 3, themeModule).sectionId).toBe("hero-3");
  });
});

describe("convertStrapiDataToProps — null/undefined data guard (CR-01)", () => {
  it("returns an empty object for null data instead of throwing", () => {
    expect(() => convertStrapiDataToProps(null as unknown as Record<string, unknown>)).not.toThrow();
    expect(convertStrapiDataToProps(null as unknown as Record<string, unknown>)).toEqual({});
  });

  it("returns an empty object for undefined data instead of throwing", () => {
    expect(() =>
      convertStrapiDataToProps(undefined as unknown as Record<string, unknown>)
    ).not.toThrow();
    expect(convertStrapiDataToProps(undefined as unknown as Record<string, unknown>)).toEqual({});
  });
});

describe("resolveSectionsForRender — resolution-time failures are isolated per-section (CR-01)", () => {
  it("a section with null `data` no longer throws and is NOT skipped -- it resolves with empty props", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "hero", order: 0, data: {} },
          { sectionKey: "broken", order: 1, data: null },
          { sectionKey: "footer", order: 2, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ hero: Noop, broken: Noop, footer: Noop });
    const resolved = resolveSectionsForRender(page, themeModule);

    expect(resolved.map((r) => r.sectionKey)).toEqual(["hero", "broken", "footer"]);
    const broken = resolved.find((r) => r.sectionKey === "broken")!;
    expect(broken.props.title).toBeUndefined();
  });

  it("a section whose `blocks` is a non-iterable value throws during prop-building -- skipped, siblings on both sides still resolve", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "hero", order: 0, data: {} },
          // `blocks` typed as an array, but a malformed CMS payload could
          // hand this function a plain object instead -- `[...({})]` throws
          // "object is not iterable", independent of the data-null guard.
          { sectionKey: "broken", order: 1, data: {}, blocks: {} },
          { sectionKey: "footer", order: 2, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ hero: Noop, broken: Noop, footer: Noop });
    const resolved = resolveSectionsForRender(page, themeModule);

    expect(resolved.map((r) => r.sectionKey)).toEqual(["hero", "footer"]);
  });

  it("calls the supplied onResolutionFailure reporter with (sectionKey, message) for a genuine resolution throw", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [{ sectionKey: "broken", order: 0, data: {}, blocks: {} }],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ broken: Noop });
    const reporter = vi.fn();
    resolveSectionsForRender(page, themeModule, reporter);

    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter).toHaveBeenCalledWith("broken", expect.stringContaining("iterable"));
  });

  it("does not call the reporter for the null-data case, since it no longer throws", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [{ sectionKey: "hero", order: 0, data: null }],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ hero: Noop });
    const reporter = vi.fn();
    resolveSectionsForRender(page, themeModule, reporter);

    expect(reporter).not.toHaveBeenCalled();
  });

  it("a reporter that itself throws does not propagate -- the section is still skipped, not the whole composition", () => {
    const page = {
      documentId: "p1",
      title: "Home",
      slug: "home",
      page_template: {
        sections: [
          { sectionKey: "broken", order: 0, data: {}, blocks: {} },
          { sectionKey: "hero", order: 1, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ broken: Noop, hero: Noop });
    const throwingReporter = vi.fn(() => {
      throw new Error("telemetry is down");
    });

    let resolved: ReturnType<typeof resolveSectionsForRender> | undefined;
    expect(() => {
      resolved = resolveSectionsForRender(page, themeModule, throwingReporter);
    }).not.toThrow();

    expect(resolved!.map((r) => r.sectionKey)).toEqual(["hero"]);
  });
});

describe("convertStrapiDataToProps — image/json URL normalization preserved", () => {
  it("normalizes a Next.js image-optimization URL for the image type", () => {
    const data = {
      photo: {
        type: "image",
        value: {
          id: 1,
          url: "/_next/image?url=https%3A%2F%2Fexample.com%2Fphoto.jpg&w=640&q=75",
        },
      },
    };
    const props = convertStrapiDataToProps(data);
    expect((props.photo as { url: string }).url).toBe("https://example.com/photo.jpg");
  });

  it("leaves a non-Next.js image URL unchanged for the image type", () => {
    const data = { photo: { type: "image", value: { id: 1, url: "https://e/plain.jpg" } } };
    const props = convertStrapiDataToProps(data);
    expect((props.photo as { url: string }).url).toBe("https://e/plain.jpg");
  });

  it("normalizes a Next.js image-optimization URL nested in a json-typed image object", () => {
    const data = {
      background: {
        type: "json",
        value: {
          id: 2,
          url: "/_next/image?url=https%3A%2F%2Fexample.com%2Fbg.jpg&w=1200&q=75",
        },
      },
    };
    const props = convertStrapiDataToProps(data);
    expect((props.background as { url: string }).url).toBe("https://example.com/bg.jpg");
  });

  it("passes through flat (already-converted) values unchanged", () => {
    const data = { title: "Hello" };
    expect(convertStrapiDataToProps(data)).toEqual({ title: "Hello" });
  });
});

describe("buildSectionProps — optional recordProps (Phase 21, D-06/D-16)", () => {
  const themeModule = makeThemeModule({ hero: Noop });
  const article: ArticleProp = {
    documentId: "a1",
    title: "A Post",
    slug: "a-post",
    body: "<p>Body</p>",
    excerpt: "",
    featuredImage: null,
    category: null,
    tags: [],
    author: null,
    publishedAt: null,
    updatedAt: null,
  };

  it("called WITHOUT record props (three arguments) returns exactly what it returns today -- no article key present", () => {
    const section = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    const props = buildSectionProps(section, 0, themeModule);
    expect(props).not.toHaveProperty("article");
    expect(props).not.toHaveProperty("archive");
  });

  it("called with an empty recordProps object still carries no article/archive key", () => {
    const section = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    const props = buildSectionProps(section, 0, themeModule, {});
    expect(props).not.toHaveProperty("article");
    expect(props).not.toHaveProperty("archive");
  });

  it("called WITH { article } spreads article into the returned prop bag alongside sectionId/sectionName/data", () => {
    const section = {
      sectionKey: "hero",
      order: 0,
      data: { title: { type: "text", value: "Hero" } },
      blocks: [],
    };
    const props = buildSectionProps(section, 0, themeModule, { article });

    expect(props.article).toBe(article);
    expect(props.sectionName).toBe("hero");
    expect(props.title).toBe("Hero");
  });
});

describe("buildSectionProps — optional relatedPosts (Phase 23, Plan 04, Task 3, D-4)", () => {
  const themeModule = makeThemeModule({ hero: Noop });
  const relatedPosts: ArticleProp[] = [
    {
      documentId: "r1",
      title: "Related Post",
      slug: "related-post",
      body: "<p>Body</p>",
      excerpt: "",
      featuredImage: null,
      category: null,
      tags: [],
      author: null,
      publishedAt: null,
      updatedAt: null,
    },
  ];

  it("when relatedPosts is absent from the record props, the resulting section prop bag has no relatedPosts key at all", () => {
    const section = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    const props = buildSectionProps(section, 0, themeModule);
    expect(Object.prototype.hasOwnProperty.call(props, "relatedPosts")).toBe(false);
  });

  it("when recordProps is an empty object, the resulting section prop bag has no relatedPosts key", () => {
    const section = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    const props = buildSectionProps(section, 0, themeModule, {});
    expect(Object.prototype.hasOwnProperty.call(props, "relatedPosts")).toBe(false);
  });

  it("when relatedPosts is present, it is spread into the returned prop bag", () => {
    const section = { sectionKey: "hero", order: 0, data: {}, blocks: [] };
    const props = buildSectionProps(section, 0, themeModule, { relatedPosts });
    expect(props.relatedPosts).toBe(relatedPosts);
  });

  it("every section in the composition receives relatedPosts when present", () => {
    const page = {
      documentId: "p1",
      title: "Post",
      slug: "post",
      page_template: {
        sections: [
          { sectionKey: "header", order: 0, data: {} },
          { sectionKey: "article-body", order: 1, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const multiSectionThemeModule = makeThemeModule({ header: Noop, "article-body": Noop });
    const resolved = resolveSectionsForRender(page, multiSectionThemeModule, undefined, {
      relatedPosts,
    });

    expect(resolved).toHaveLength(2);
    for (const section of resolved) {
      expect(section.props.relatedPosts).toBe(relatedPosts);
    }
  });
});

describe("resolveSectionsForRender — recordProps forwarded to every section (Phase 21, D-06)", () => {
  it("threads the same article object into EVERY resolved section's props, not only one", () => {
    const page = {
      documentId: "p1",
      title: "Post",
      slug: "post",
      page_template: {
        sections: [
          { sectionKey: "header", order: 0, data: {} },
          { sectionKey: "article-body", order: 1, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ header: Noop, "article-body": Noop });
    const article: ArticleProp = {
      documentId: "a1",
      title: "A Post",
      slug: "a-post",
      body: "<p>Body</p>",
      excerpt: "",
      featuredImage: null,
      category: null,
      tags: [],
      author: null,
      publishedAt: null,
      updatedAt: null,
    };

    const resolved = resolveSectionsForRender(page, themeModule, undefined, { article });

    expect(resolved).toHaveLength(2);
    for (const section of resolved) {
      expect(section.props.article).toBe(article);
    }
  });

  it("two sections sharing the same order value keep their stored array position", () => {
    const page = {
      documentId: "p1",
      title: "Post",
      slug: "post",
      page_template: {
        sections: [
          { sectionKey: "header", order: 0, data: {} },
          { sectionKey: "article-body", order: 0, data: {} },
        ],
      },
    } as unknown as StrapiPage;

    const themeModule = makeThemeModule({ header: Noop, "article-body": Noop });
    const resolved = resolveSectionsForRender(page, themeModule);

    expect(resolved.map((r) => r.sectionKey)).toEqual(["header", "article-body"]);
  });
});
