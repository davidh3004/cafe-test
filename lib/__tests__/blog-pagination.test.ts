import { describe, expect, it } from "vitest";
import {
  BLOG_PAGE_SIZE,
  resolveBlogBasePath,
  resolveBlogPaginationPath,
  parseBlogPageParam,
  isBlogPageInRange,
  resolvePostPath,
} from "../blog-pagination";

/**
 * Phase 22 Plan 03, Task 1 (BLOG-07, D-5). One case per bullet in the
 * plan's `<behavior>` block for `blog-pagination.ts`, the pure module that
 * is the SOLE producer of every blog listing URL.
 */

describe("blog-pagination.ts", () => {
  it("exports BLOG_PAGE_SIZE as 10", () => {
    expect(BLOG_PAGE_SIZE).toBe(10);
  });

  describe("resolveBlogPaginationPath", () => {
    it('resolveBlogPaginationPath("index", null, 1) returns /blog', () => {
      expect(resolveBlogPaginationPath("index", null, 1)).toBe("/blog");
    });

    it('resolveBlogPaginationPath("index", null, 2) returns /blog/page/2', () => {
      expect(resolveBlogPaginationPath("index", null, 2)).toBe("/blog/page/2");
    });

    it('resolveBlogPaginationPath("category", "news", 1) returns /blog/category/news', () => {
      expect(resolveBlogPaginationPath("category", "news", 1)).toBe(
        "/blog/category/news"
      );
    });

    it('resolveBlogPaginationPath("category", "news", 3) returns /blog/category/news/page/3', () => {
      expect(resolveBlogPaginationPath("category", "news", 3)).toBe(
        "/blog/category/news/page/3"
      );
    });

    it('resolveBlogPaginationPath("tag", "release", 1) returns /blog/tag/release', () => {
      expect(resolveBlogPaginationPath("tag", "release", 1)).toBe(
        "/blog/tag/release"
      );
    });

    it('resolveBlogPaginationPath("tag", "release", 2) returns /blog/tag/release/page/2', () => {
      expect(resolveBlogPaginationPath("tag", "release", 2)).toBe(
        "/blog/tag/release/page/2"
      );
    });

    it("a page value below 1 collapses to the base path -- never a URL for page 0", () => {
      expect(resolveBlogPaginationPath("index", null, 0)).toBe("/blog");
      expect(resolveBlogPaginationPath("category", "news", 0)).toBe(
        "/blog/category/news"
      );
    });

    it("a negative page value collapses to the base path -- never a URL for a negative page", () => {
      expect(resolveBlogPaginationPath("index", null, -1)).toBe("/blog");
      expect(resolveBlogPaginationPath("tag", "release", -5)).toBe(
        "/blog/tag/release"
      );
    });

    it("a term slug containing a slash or a space is URL-encoded on the way into the path", () => {
      expect(resolveBlogPaginationPath("category", "a/b", 1)).toBe(
        "/blog/category/a%2Fb"
      );
      expect(resolveBlogPaginationPath("tag", "a b", 1)).toBe(
        "/blog/tag/a%20b"
      );
    });
  });

  describe("resolveBlogBasePath", () => {
    it('resolveBlogBasePath("index") returns /blog regardless of termSlug', () => {
      expect(resolveBlogBasePath("index")).toBe("/blog");
      expect(resolveBlogBasePath("index", "ignored")).toBe("/blog");
    });

    it("encodes the term slug for category and tag kinds", () => {
      expect(resolveBlogBasePath("category", "news")).toBe(
        "/blog/category/news"
      );
      expect(resolveBlogBasePath("tag", "release")).toBe("/blog/tag/release");
    });
  });

  describe("parseBlogPageParam", () => {
    it('parseBlogPageParam("2") returns 2', () => {
      expect(parseBlogPageParam("2")).toBe(2);
    });

    it('parseBlogPageParam("1") returns 1', () => {
      expect(parseBlogPageParam("1")).toBe(1);
    });

    const rejectedCases: Array<[string, string | string[] | undefined]> = [
      ["the string \"0\"", "0"],
      ["the string \"-1\"", "-1"],
      ["the string \"1.5\"", "1.5"],
      ["the string \"02\" (leading zero)", "02"],
      ["the string \"2a\" (trailing non-digit)", "2a"],
      ["the string \" 2\" (leading whitespace)", " 2"],
      ["the empty string", ""],
      [
        "a value long enough to be a denial-of-service attempt",
        "9".repeat(50),
      ],
      ["undefined", undefined],
      ["a string array", ["2"]],
    ];

    it.each(rejectedCases)(
      "parseBlogPageParam returns null for %s",
      (_label, raw) => {
        expect(parseBlogPageParam(raw)).toBeNull();
      }
    );
  });

  describe("isBlogPageInRange", () => {
    it("isBlogPageInRange(1, 0) is true -- an empty blog still serves its page 1", () => {
      expect(isBlogPageInRange(1, 0)).toBe(true);
    });

    it("isBlogPageInRange(2, 1) is false", () => {
      expect(isBlogPageInRange(2, 1)).toBe(false);
    });

    it("isBlogPageInRange(2, 2) is true", () => {
      expect(isBlogPageInRange(2, 2)).toBe(true);
    });
  });

  // Phase 23, Plan 01, Task 2 (D-1): the sole producer of a post's own path.
  describe("resolvePostPath", () => {
    it('resolvePostPath("hello-world") returns /blog/hello-world', () => {
      expect(resolvePostPath("hello-world")).toBe("/blog/hello-world");
    });

    it("percent-encodes a slug containing a slash so it cannot forge a different route", () => {
      expect(resolvePostPath("a/b")).toBe("/blog/a%2Fb");
    });

    it("percent-encodes a slug containing a space", () => {
      expect(resolvePostPath("a b")).toBe("/blog/a%20b");
    });

    it("returns /blog/ for an empty slug rather than throwing", () => {
      expect(resolvePostPath("")).toBe("/blog/");
    });
  });
});
