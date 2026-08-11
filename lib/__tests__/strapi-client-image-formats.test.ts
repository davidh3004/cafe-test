import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// RED (Phase 11, Plan 02, Task 2): `collectImageIds`/`mergeImageFormats` are built
// in this same task (D-01 frontend half — resolve real Strapi `formats` onto every
// image field at READ time, never persisted at save time). This suite MUST fail
// now (member absent) so the fresh-at-read resolution has an automated gate.
//
// Contract under test:
//   - collectImageIds(page) walks sections, blocks, AND metafields (same shape as
//     resolvePageMetaobjectRefs's referencedIds collection), dedupes, collects both
//     bare numeric ids and {id,url} object ids.
//   - mergeImageFormats(page, formatsById) immutably writes `formats` INTO the
//     existing {type:'image', value:{id,url}} wrapper (value.formats) without
//     touching id/url, leaves unmatched ids untouched, never throws.
import { collectImageIds, mergeImageFormats, type StrapiPage } from "../strapi-client";

function pageWithHero(heroValue: unknown): StrapiPage {
  return {
    documentId: "page-1",
    title: "Home",
    slug: "home",
    page_template: {
      documentId: "tmpl-1",
      sections: [
        {
          sectionKey: "hero",
          order: 0,
          data: { hero: { type: "image", value: heroValue } },
        },
      ],
    },
  };
}

describe("collectImageIds — walks sections/blocks/metafields, dedupes (D-01)", () => {
  it("Test 1a: collects an image id from section data ({id,url} object)", () => {
    const page = pageWithHero({ id: 42, url: "/x.jpg" });
    expect(collectImageIds(page)).toEqual([42]);
  });

  it("Test 1b: dedupes the same image id referenced in a section AND a block", () => {
    const page: StrapiPage = {
      documentId: "page-1",
      title: "Home",
      slug: "home",
      page_template: {
        documentId: "tmpl-1",
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: { hero: { type: "image", value: { id: 42, url: "/x.jpg" } } },
            blocks: [
              {
                blockType: "logo",
                order: 0,
                data: { logo: { type: "image", value: { id: 42, url: "/x.jpg" } } },
              },
            ],
          },
        ],
      },
    };
    expect(collectImageIds(page)).toEqual([42]);
  });

  it("Test 1c: collects a bare numeric id (no url yet)", () => {
    const page = pageWithHero(7);
    expect(collectImageIds(page)).toEqual([7]);
  });

  it("Test 1d: returns [] when no image fields exist anywhere", () => {
    const page: StrapiPage = {
      documentId: "page-1",
      title: "Home",
      slug: "home",
      page_template: {
        documentId: "tmpl-1",
        sections: [{ sectionKey: "hero", order: 0, data: { title: { type: "text", value: "Hi" } } }],
      },
    };
    expect(collectImageIds(page)).toEqual([]);
  });
});

describe("mergeImageFormats — immutable formats merge into value.formats (D-01)", () => {
  it("Test 2a: writes formats INTO value.formats, leaves id/url unchanged", () => {
    const page = pageWithHero({ id: 42, url: "/x.jpg" });
    const formatsById = new Map([[42, { thumbnail: { url: "/t.jpg", width: 245 } }]]);
    const merged = mergeImageFormats(page, formatsById);
    const heroValue = (merged.page_template as { sections: Array<{ data: Record<string, unknown> }> })
      .sections[0].data.hero as { value: { id: number; url: string; formats?: unknown } };
    expect(heroValue.value.formats).toEqual({ thumbnail: { url: "/t.jpg", width: 245 } });
    expect(heroValue.value.id).toBe(42);
    expect(heroValue.value.url).toBe("/x.jpg");
  });

  it("Test 2b: leaves an image value unchanged (no formats key added, no throw) when its id has no formatsById entry", () => {
    const page = pageWithHero({ id: 99, url: "/y.jpg" });
    const formatsById = new Map([[42, { thumbnail: { url: "/t.jpg", width: 245 } }]]);
    const merged = mergeImageFormats(page, formatsById);
    const heroValue = (merged.page_template as { sections: Array<{ data: Record<string, unknown> }> })
      .sections[0].data.hero as { value: { id: number; url: string; formats?: unknown } };
    expect(heroValue.value).toEqual({ id: 99, url: "/y.jpg" });
    expect("formats" in heroValue.value).toBe(false);
  });

  it("Test 3: merges formats for image fields nested in blocks AND page.metafields (same traversal shape as collectImageIds)", () => {
    const page: StrapiPage = {
      documentId: "page-1",
      title: "Home",
      slug: "home",
      metafields: { logo: { type: "image", value: { id: 5, url: "/logo.jpg" } } },
      page_template: {
        documentId: "tmpl-1",
        sections: [
          {
            sectionKey: "hero",
            order: 0,
            data: {},
            blocks: [
              {
                blockType: "feature",
                order: 0,
                data: { icon: { type: "image", value: { id: 8, url: "/icon.jpg" } } },
              },
            ],
          },
        ],
      },
    };
    const formatsById = new Map([
      [5, { thumbnail: { url: "/logo-t.jpg", width: 100 } }],
      [8, { thumbnail: { url: "/icon-t.jpg", width: 50 } }],
    ]);
    const merged = mergeImageFormats(page, formatsById);

    const metaLogo = (merged.metafields as Record<string, { value: { formats?: unknown } }>).logo;
    expect(metaLogo.value.formats).toEqual({ thumbnail: { url: "/logo-t.jpg", width: 100 } });

    const blockIcon = (
      merged.page_template as {
        sections: Array<{ blocks: Array<{ data: Record<string, { value: { formats?: unknown } }> }> }>;
      }
    ).sections[0].blocks[0].data.icon;
    expect(blockIcon.value.formats).toEqual({ thumbnail: { url: "/icon-t.jpg", width: 50 } });
  });
});

// INCIDENT 2026-08-06 regression guard.
//
// The suite above only ever covered the two PURE functions. `resolveImageFormats`
// — the function that actually talks to Strapi — had no test at all, which is why
// a wholly invalid query (`uploadFiles(filters:{id:...}){ id formats }`, rejected
// by Strapi 5 as "Cannot query field \"id\" on type \"UploadFile\"") sat in
// production silently swallowed by its own fail-open catch, discarding every
// WebP format the Phase-11 backfill generated.
//
// These pin the network contract: filter by NUMERIC id (what the customizer
// persists into content), request the id+formats fields, and merge the result.
describe("resolveImageFormats — Upload REST contract (incident 2026-08-06)", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // strapi-client reads STRAPI_BASE_URL/TOKEN at module load, so the env must
    // be stubbed and the module re-imported for the request to be attempted at
    // all (otherwise fetchUploadFileFormats short-circuits on an empty base URL).
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_STRAPI_URL", "strapi.test");
    vi.stubEnv("NEXT_PUBLIC_STRAPI_TOKEN", "test-token");
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("filters by numeric id and merges the returned formats", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: unknown) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => [{ id: 7, formats: { webp: { url: "/w.webp" } } }],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { resolveImageFormats } = await import("../strapi-client");
    const out = await resolveImageFormats(pageWithHero({ id: 7, url: "/a.jpg" }));

    expect(calls[0]).toContain("/api/upload/files");
    // Must filter by numeric id — documentId is NOT what content stores.
    expect(decodeURIComponent(calls[0])).toContain("filters[id][$in][0]=7");
    const hero = (out.page_template as { sections: { data: Record<string, { value: { formats?: unknown } }> }[] })
      .sections[0].data.hero;
    expect(hero.value.formats).toEqual({ webp: { url: "/w.webp" } });
  });

  it("fails open and returns the page unchanged when the request errors", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden" }) as unknown as Response) as unknown as typeof fetch;
    const page = pageWithHero({ id: 7, url: "/a.jpg" });
    const { resolveImageFormats } = await import("../strapi-client");
    await expect(resolveImageFormats(page)).resolves.toEqual(page);
  });

  it("makes no request at all when the page has no image fields", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const { resolveImageFormats } = await import("../strapi-client");
    await resolveImageFormats({ documentId: "p", title: "t", slug: "s", page_template: { documentId: "tm", sections: [] } });
    expect(spy).not.toHaveBeenCalled();
  });
});
