import { describe, expect, it } from "vitest";
import { RELATED_POSTS_CAP, rankRelatedPosts } from "../blog-related";
import type { BlogArticleRecord } from "../blog-client";

/**
 * Phase 23 Plan 04, Task 1 (BLOG-10, D-5). One case per bullet in the plan's
 * acceptance criteria for `blog-related.ts`'s pure ranking module. No
 * network, no mocking -- every fixture is a synthetic `BlogArticleRecord`.
 */

function makeArticle(overrides: Partial<BlogArticleRecord> = {}): BlogArticleRecord {
  return {
    documentId: "doc-1",
    title: "Title",
    slug: "slug",
    body: "<p>body</p>",
    excerpt: "",
    publishedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    canonicalUrl: null,
    featuredImage: null,
    seo: null,
    category: { name: "News", slug: "news", description: null },
    tags: [{ name: "Release", slug: "release", description: null }],
    author: null,
    ...overrides,
  };
}

describe("blog-related.ts — RELATED_POSTS_CAP", () => {
  it("is 3", () => {
    expect(RELATED_POSTS_CAP).toBe(3);
  });
});

describe("rankRelatedPosts", () => {
  it("ranks a same-category candidate ahead of a shared-tag candidate even when the tag candidate is newer", () => {
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const categoryMatch = makeArticle({
      documentId: "category-match",
      category: { name: "News", slug: "news", description: null },
      tags: [],
      publishedAt: "2026-01-01T00:00:00.000Z",
    });
    const tagMatch = makeArticle({
      documentId: "tag-match",
      category: { name: "Other", slug: "other", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
      publishedAt: "2026-08-10T00:00:00.000Z",
    });

    const result = rankRelatedPosts(source, [tagMatch, categoryMatch]);

    expect(result.map((a) => a.documentId)).toEqual(["category-match", "tag-match"]);
  });

  it("excludes the source post when it is present in the candidate list", () => {
    const source = makeArticle({ documentId: "source" });
    const result = rankRelatedPosts(source, [source]);
    expect(result).toEqual([]);
  });

  it("excludes a candidate with a blank publishedAt even when it shares the source's category", () => {
    const source = makeArticle({ documentId: "source" });
    const blankPublishedAt = makeArticle({ documentId: "blank", publishedAt: "" });
    const nullPublishedAt = makeArticle({ documentId: "null-pub", publishedAt: null });

    const result = rankRelatedPosts(source, [blankPublishedAt, nullPublishedAt]);
    expect(result).toEqual([]);
  });

  it("excludes a candidate matching neither the category nor any tag entirely", () => {
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const noMatch = makeArticle({
      documentId: "no-match",
      category: { name: "Other", slug: "other", description: null },
      tags: [{ name: "Different", slug: "different", description: null }],
    });

    const result = rankRelatedPosts(source, [noMatch]);
    expect(result).toEqual([]);
  });

  it("never returns more than three entries when more than three candidates match", () => {
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
    });
    const candidates = Array.from({ length: 5 }, (_, index) =>
      makeArticle({
        documentId: `candidate-${index}`,
        category: { name: "News", slug: "news", description: null },
        publishedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
      })
    );

    const result = rankRelatedPosts(source, candidates);
    expect(result).toHaveLength(RELATED_POSTS_CAP);
  });

  it("orders two candidates with identical publishedAt deterministically by documentId, and repeated calls return the same order", () => {
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
    });
    const sameInstant = "2026-08-01T00:00:00.000Z";
    const candidateB = makeArticle({
      documentId: "b-candidate",
      category: { name: "News", slug: "news", description: null },
      publishedAt: sameInstant,
    });
    const candidateA = makeArticle({
      documentId: "a-candidate",
      category: { name: "News", slug: "news", description: null },
      publishedAt: sameInstant,
    });

    const firstCall = rankRelatedPosts(source, [candidateB, candidateA]);
    const secondCall = rankRelatedPosts(source, [candidateB, candidateA]);

    expect(firstCall.map((a) => a.documentId)).toEqual(["a-candidate", "b-candidate"]);
    expect(secondCall.map((a) => a.documentId)).toEqual(["a-candidate", "b-candidate"]);
  });

  it("returns an empty array when the source has no category and no tags", () => {
    const source = makeArticle({ documentId: "source", category: null, tags: [] });
    const candidate = makeArticle({
      documentId: "candidate",
      category: { name: "News", slug: "news", description: null },
    });

    const result = rankRelatedPosts(source, [candidate]);
    expect(result).toEqual([]);
  });

  it("uses a cap parameter when supplied, overriding RELATED_POSTS_CAP", () => {
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
    });
    const candidates = Array.from({ length: 5 }, (_, index) =>
      makeArticle({
        documentId: `candidate-${index}`,
        category: { name: "News", slug: "news", description: null },
        publishedAt: `2026-08-0${index + 1}T00:00:00.000Z`,
      })
    );

    const result = rankRelatedPosts(source, candidates, 1);
    expect(result).toHaveLength(1);
  });

  it("deduplicates by documentId, keeping the highest-ranked occurrence", () => {
    const source = makeArticle({
      documentId: "source",
      category: { name: "News", slug: "news", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const tagOccurrence = makeArticle({
      documentId: "dup",
      category: { name: "Other", slug: "other", description: null },
      tags: [{ name: "Release", slug: "release", description: null }],
    });
    const categoryOccurrence = makeArticle({
      documentId: "dup",
      category: { name: "News", slug: "news", description: null },
      tags: [],
    });

    const result = rankRelatedPosts(source, [tagOccurrence, categoryOccurrence]);
    expect(result).toHaveLength(1);
    expect(result[0].category?.slug).toBe("news");
  });
});
