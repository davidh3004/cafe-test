import { describe, expect, it, vi } from "vitest";

import {
  BLOG_UNSUPPORTED_HEADING,
  BLOG_UNSUPPORTED_BODY,
  resolveBlogSurfaceSupport,
  type BlogDegradeReporter,
} from "../blog-degrade";
import type { TemplateSupportManifest } from "../article-contract";

const VALID_ARTICLE_ONLY_MANIFEST: TemplateSupportManifest = {
  sections: [{ key: "article-body", name: "Article Body" }],
  templates: [{ key: "article", name: "Article", sections: ["article-body"] }],
  version: "1",
};

const VALID_ARCHIVE_ONLY_MANIFEST: TemplateSupportManifest = {
  sections: [{ key: "archive-list", name: "Archive List" }],
  templates: [{ key: "archive", name: "Archive", sections: ["archive-list"] }],
  version: "1",
};

const VALID_BOTH_MANIFEST: TemplateSupportManifest = {
  sections: [
    { key: "article-body", name: "Article Body" },
    { key: "archive-list", name: "Archive List" },
  ],
  templates: [
    { key: "article", name: "Article", sections: ["article-body"] },
    { key: "archive", name: "Archive", sections: [] }, // archive declared, but missing its required slot
  ],
  version: "1",
};

const NO_DECLARATIONS_MANIFEST: TemplateSupportManifest = {
  sections: [],
  version: "1",
};

const EMPTY_DECLARATION_LIST_MANIFEST: TemplateSupportManifest = {
  sections: [],
  templates: [],
  version: "1",
};

const ARTICLE_MISSING_BODY_SLOT_MANIFEST: TemplateSupportManifest = {
  sections: [],
  templates: [{ key: "article", name: "Article", sections: [] }],
  version: "1",
};

describe("resolveBlogSurfaceSupport", () => {
  it("returns a supported result for a valid article declaration", () => {
    const result = resolveBlogSurfaceSupport(VALID_ARTICLE_ONLY_MANIFEST, "article");
    expect(result.supported).toBe(true);
  });

  it("returns unsupported with heading, body and 404 for an undefined manifest", () => {
    const result = resolveBlogSurfaceSupport(undefined, "article");
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.heading).toBe(BLOG_UNSUPPORTED_HEADING);
      expect(result.body).toBe(BLOG_UNSUPPORTED_BODY);
      expect(result.status).toBe(404);
    }
  });

  it("returns unsupported for a null manifest", () => {
    const result = resolveBlogSurfaceSupport(null, "article");
    expect(result.supported).toBe(false);
  });

  it("returns unsupported for a manifest with no template declarations at all", () => {
    const result = resolveBlogSurfaceSupport(NO_DECLARATIONS_MANIFEST, "article");
    expect(result.supported).toBe(false);
  });

  it("returns unsupported for an empty declaration list", () => {
    const result = resolveBlogSurfaceSupport(EMPTY_DECLARATION_LIST_MANIFEST, "article");
    expect(result.supported).toBe(false);
  });

  it("returns unsupported for an article declaration whose section list omits the body slot", () => {
    const result = resolveBlogSurfaceSupport(ARTICLE_MISSING_BODY_SLOT_MANIFEST, "article");
    expect(result.supported).toBe(false);
  });

  it("returns unsupported for the article surface when the manifest declares only an archive", () => {
    const result = resolveBlogSurfaceSupport(VALID_ARCHIVE_ONLY_MANIFEST, "article");
    expect(result.supported).toBe(false);
  });

  it("returns unsupported's status as exactly 404", () => {
    const result = resolveBlogSurfaceSupport(undefined, "archive");
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.status).toBe(404);
    }
  });

  it("applies the identical rule to the archive surface", () => {
    const supported = resolveBlogSurfaceSupport(VALID_ARCHIVE_ONLY_MANIFEST, "archive");
    expect(supported.supported).toBe(true);

    const unsupported = resolveBlogSurfaceSupport(VALID_ARCHIVE_ONLY_MANIFEST, "article");
    expect(unsupported.supported).toBe(false);
  });

  it("resolves article and archive independently within the same manifest and sequence (D-12)", () => {
    const article = resolveBlogSurfaceSupport(VALID_BOTH_MANIFEST, "article");
    const archive = resolveBlogSurfaceSupport(VALID_BOTH_MANIFEST, "archive");
    expect(article.supported).toBe(true);
    expect(archive.supported).toBe(false); // archive declared but missing its required slot
  });

  it("invokes the reporter exactly once with a boolean-only context when unsupported", () => {
    const report = vi.fn();
    resolveBlogSurfaceSupport(NO_DECLARATIONS_MANIFEST, "article", report);
    expect(report).toHaveBeenCalledTimes(1);
    const [surfaceArg, contextArg] = report.mock.calls[0];
    expect(surfaceArg).toBe("article");
    expect(typeof contextArg).toBe("object");
    for (const value of Object.values(contextArg as Record<string, unknown>)) {
      expect(typeof value).toBe("boolean");
    }
  });

  it("does not invoke the reporter when supported", () => {
    const report = vi.fn();
    resolveBlogSurfaceSupport(VALID_ARTICLE_ONLY_MANIFEST, "article", report);
    expect(report).not.toHaveBeenCalled();
  });

  it("still returns the unsupported result when a supplied reporter throws", () => {
    const throwingReporter: BlogDegradeReporter = () => {
      throw new Error("telemetry boom");
    };
    const result = resolveBlogSurfaceSupport(NO_DECLARATIONS_MANIFEST, "article", throwingReporter);
    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.heading).toBe(BLOG_UNSUPPORTED_HEADING);
      expect(result.status).toBe(404);
    }
  });
});
