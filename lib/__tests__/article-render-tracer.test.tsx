import { describe, expect, it } from "vitest";

import { buildShellHtml } from "../server-shell";
import { React } from "../ssr-react-runtime";
import { buildArticleProp } from "../article-contract";
import { countH1OpenTags, PROMOTED_H1_ATTR } from "../heading-normalizer";
import type { LoadedThemeModule } from "../theme-loader";
import type { StrapiPage } from "../strapi-client";

/**
 * Tracer proof (Phase 21, Plan 01, Task 2): a manifest-declared `article`
 * template + a resolved post + a theme-provided section produce
 * server-rendered HTML containing the post's prose, through the ONE shared
 * `buildSectionProps` seam (`resolveSectionsForRender` -> `buildShellHtml`).
 *
 * Fake theme components below are built with `React.createElement` sourced
 * from `../ssr-react-runtime` (the SAME React copy `buildShellHtml` renders
 * with) rather than JSX, so this file never risks a mismatched-React-copy
 * failure the header comment on `ssr-react-runtime.ts` warns about.
 */

function Header(props: { article?: { title: string } }) {
  return React.createElement("h1", null, props.article?.title ?? "");
}

function ArticleBodySection(props: { article?: { body: string } }) {
  return React.createElement("div", {
    "data-testid": "article-body",
    dangerouslySetInnerHTML: { __html: props.article?.body ?? "" },
  });
}

function makeTracerThemeModule(): LoadedThemeModule {
  return {
    name: "tracer-theme",
    version: "0.0.0-test",
    sectionsComponents: {
      header: Header,
      "article-body": ArticleBodySection,
    },
    sectionSettingsSchemas: {},
  };
}

function pageWithSections(
  sections: Array<{ sectionKey: string; order: number }>,
  title = "My Post Title"
): StrapiPage {
  return {
    documentId: "post-1",
    title,
    slug: "my-post",
    page_template: {
      sections: sections.map((s) => ({ ...s, data: {} })),
    },
  } as unknown as StrapiPage;
}

describe("article render tracer — server HTML carries the post's prose AND its title via a non-body section (D-06, criteria 1+2)", () => {
  it("buildShellHtml returns a string containing the post's prose and the title rendered by the header section", () => {
    const article = buildArticleProp({
      documentId: "a1",
      title: "My Post Title",
      slug: "my-post",
      body: "<p>Real prose content for the tracer test.</p>",
      excerpt: "",
      featuredImage: null,
      category: null,
      tags: [],
      author: null,
      publishedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });

    const page = pageWithSections([
      { sectionKey: "header", order: 0 },
      { sectionKey: "article-body", order: 1 },
    ]);
    const themeModule = makeTracerThemeModule();

    const html = buildShellHtml({
      page,
      themeModule,
      themeName: "tracer-theme",
      recordProps: { article },
    });

    expect(html).not.toBeNull();
    // The prose, drawn from the fixture's body — not a class name, not a
    // wrapper element.
    expect(html).toContain("Real prose content for the tracer test.");
    // D-06's "every section" clause: the header section, which is NOT the
    // body slot, received `article` and rendered `article.title`.
    expect(html).toContain("My Post Title");
    expect(html).toContain('data-testid="article-body"');
  });

  it("without recordProps, the header section renders nothing for article.title (no article key present)", () => {
    const page = pageWithSections([
      { sectionKey: "header", order: 0 },
      { sectionKey: "article-body", order: 1 },
    ]);
    const themeModule = makeTracerThemeModule();

    const html = buildShellHtml({ page, themeModule, themeName: "tracer-theme" });

    expect(html).not.toBeNull();
    expect(html).not.toContain("My Post Title");
  });

  it("two sections sharing the same `order` value appear in the output in their stored array order", () => {
    const article = buildArticleProp({
      documentId: "a1",
      title: "Order Tie Title",
      slug: "order-tie",
      body: "<p>Order tie body.</p>",
      excerpt: "",
      featuredImage: null,
      category: null,
      tags: [],
      author: null,
      publishedAt: null,
      updatedAt: null,
    });

    // Both sections share order: 0 -- sortSectionsForRender is a STABLE sort,
    // so array position (header first) must win.
    const page = pageWithSections([
      { sectionKey: "header", order: 0 },
      { sectionKey: "article-body", order: 0 },
    ]);
    const themeModule = makeTracerThemeModule();

    const html = buildShellHtml({
      page,
      themeModule,
      themeName: "tracer-theme",
      recordProps: { article },
    });

    expect(html).not.toBeNull();
    expect(html!.indexOf("Order Tie Title")).toBeLessThan(html!.indexOf("Order tie body."));
  });

  it("a second <h1> inside the body is demoted by the UNMODIFIED heading normalizer, leaving the page with a single h1", () => {
    const article = buildArticleProp({
      documentId: "a1",
      title: "Header Title",
      slug: "heading-demote",
      body: "<h1>Repeated Heading</h1><p>rest of the body</p>",
      excerpt: "",
      featuredImage: null,
      category: null,
      tags: [],
      author: null,
      publishedAt: null,
      updatedAt: null,
    });

    const page = pageWithSections([
      { sectionKey: "header", order: 0 },
      { sectionKey: "article-body", order: 1 },
    ]);
    const themeModule = makeTracerThemeModule();

    const html = buildShellHtml({
      page,
      themeModule,
      themeName: "tracer-theme",
      recordProps: { article },
    });

    expect(html).not.toBeNull();
    // The header section's own <h1> (order 0) is first in document order and
    // survives untouched; the body's <h1> (order 1) is demoted to <h2>.
    expect(countH1OpenTags(html!)).toBe(1);
    expect(html).toContain("<h2>Repeated Heading</h2>");
    expect(html).not.toContain(PROMOTED_H1_ATTR);
  });
});
