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
import {
  absolutizeFormatUrls,
  collectImageIds,
  mergeImageFormats,
  type StrapiPage,
} from "../strapi-client";

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
    const metaById = new Map([[42, { formats: { thumbnail: { url: "/t.jpg", width: 245 } } }]]);
    const merged = mergeImageFormats(page, metaById);
    const heroValue = (merged.page_template as { sections: Array<{ data: Record<string, unknown> }> })
      .sections[0].data.hero as { value: { id: number; url: string; formats?: unknown } };
    expect(heroValue.value.formats).toEqual({ thumbnail: { url: "/t.jpg", width: 245 } });
    expect(heroValue.value.id).toBe(42);
    expect(heroValue.value.url).toBe("/x.jpg");
  });

  it("Test 2b: leaves an image value unchanged (no formats key added, no throw) when its id has no formatsById entry", () => {
    const page = pageWithHero({ id: 99, url: "/y.jpg" });
    const metaById = new Map([[42, { formats: { thumbnail: { url: "/t.jpg", width: 245 } } }]]);
    const merged = mergeImageFormats(page, metaById);
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
    const metaById = new Map([
      [5, { formats: { thumbnail: { url: "/logo-t.jpg", width: 100 } } }],
      [8, { formats: { thumbnail: { url: "/icon-t.jpg", width: 50 } } }],
    ]);
    const merged = mergeImageFormats(page, metaById);

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

// PERF-03 ROOT CAUSE (found 2026-08-10 by reading a live tenant's RSC payload).
// The dashboard's strapiAdapter persists a fully-picked image — id AND url, i.e.
// virtually every image on every tenant — as `{ type: 'json', value: {id,url} }`,
// NOT `{ type: 'image' }`. The predicate gating this whole pipeline only matched
// `type: 'image'`, so collectImageIds returned [], resolveImageFormats took its
// zero-ids early return, and no request was ever issued: no 403, no warn, no
// trace. These pin the real production shape so it can never regress to
// tag-only matching again.
describe("json-tagged image values — the shape real content actually has", () => {
  function jsonImagePage(value: unknown): StrapiPage {
    return {
      documentId: "page-1",
      title: "Home",
      slug: "home",
      page_template: {
        documentId: "tmpl-1",
        sections: [
          {
            sectionKey: "hero-slide",
            order: 0,
            // Byte-for-byte the shape observed in the live payload.
            data: { backgroundImage: { type: "json", value } },
          },
        ],
      },
    };
  }

  function bgValueOf(page: StrapiPage) {
    return (
      page.page_template as { sections: Array<{ data: Record<string, unknown> }> }
    ).sections[0].data.backgroundImage as { value: Record<string, unknown> };
  }

  it("collects the id from a json-tagged {id,url} image value", () => {
    expect(
      collectImageIds(jsonImagePage({ id: 1, url: "https://cms/uploads/a.jpg" }))
    ).toEqual([1]);
  });

  it("merges formats AND dimensions into a json-tagged image value", () => {
    const merged = mergeImageFormats(
      jsonImagePage({ id: 1, url: "https://cms/uploads/a.jpg" }),
      new Map([
        [1, { formats: { large: { url: "/l.jpg", width: 1000 } }, width: 2500, height: 1400 }],
      ])
    );

    expect(bgValueOf(merged).value).toEqual({
      id: 1,
      url: "https://cms/uploads/a.jpg",
      formats: { large: { url: "/l.jpg", width: 1000 } },
      width: 2500,
      height: 1400,
    });
  });

  it("ignores a json-tagged page reference — {id, slug, title} has no url", () => {
    const reference = { id: "42", slug: "about", title: "About" };
    const page = jsonImagePage(reference);

    expect(collectImageIds(page)).toEqual([]);
    // Asserted on the VALUE, not the whole page: mergeImageFormats normalizes
    // `blocks: []` onto every section regardless of any match, so a
    // whole-object comparison would fail on that pre-existing shape change
    // rather than on anything this predicate did.
    const merged = mergeImageFormats(page, new Map([[42, { width: 10, height: 10 }]]));
    expect(bgValueOf(merged).value).toEqual(reference);
  });

  it("ignores the WR-04 url-only round-trip value — {id: null, url} has no id to look up", () => {
    expect(collectImageIds(jsonImagePage({ id: null, url: "/uploads/a.jpg" }))).toEqual([]);
  });

  it("ignores json values that are not object-shaped at all", () => {
    expect(collectImageIds(jsonImagePage("just a string"))).toEqual([]);
    expect(collectImageIds(jsonImagePage(null))).toEqual([]);
    expect(collectImageIds(jsonImagePage(42))).toEqual([]);
  });

  it("still handles the id-only `type: image` shape the adapter writes when no url is known", () => {
    expect(collectImageIds(pageWithHero(7))).toEqual([7]);
  });
});

// LIVE REGRESSION 2026-08-10: making `formats` flow exposed that Strapi stores
// variant urls CMS-relative. A relative `srcset` candidate resolves against the
// TENANT origin, so all 7 variants 404 — and since a browser selects from
// `srcset` and ignores `src` whenever srcset is present, every image fetched
// 200 on its `src` and painted nothing. Same trap resolveShareImage documents
// as T-14-10.
describe("absolutizeFormatUrls — a relative srcset candidate 404s on the tenant origin", () => {
  const BASE = "https://cms.example.com";

  it("absolutizes each variant url against the CMS base", () => {
    const out = absolutizeFormatUrls(
      {
        thumbnail: { url: "/uploads/thumbnail_x.png", width: 156 },
        large: { url: "/uploads/large_x.png", width: 1000 },
      },
      BASE
    ) as Record<string, { url: string; width: number }>;

    expect(out.thumbnail.url).toBe("https://cms.example.com/uploads/thumbnail_x.png");
    expect(out.large.url).toBe("https://cms.example.com/uploads/large_x.png");
    // Every other key is carried through untouched.
    expect(out.large.width).toBe(1000);
  });

  it("leaves an already-absolute url byte-identical — a cloud provider stores those", () => {
    const formats = { large: { url: "https://cdn.example.com/large_x.png" } };
    const out = absolutizeFormatUrls(formats, BASE) as Record<string, { url: string }>;
    expect(out.large.url).toBe("https://cdn.example.com/large_x.png");
  });

  it("joins correctly whether or not the base has a trailing slash or the url a leading one", () => {
    const one = absolutizeFormatUrls({ a: { url: "uploads/x.png" } }, "https://cms.example.com/") as Record<string, { url: string }>;
    expect(one.a.url).toBe("https://cms.example.com/uploads/x.png");
    const two = absolutizeFormatUrls({ a: { url: "/uploads/x.png" } }, "https://cms.example.com/") as Record<string, { url: string }>;
    expect(two.a.url).toBe("https://cms.example.com/uploads/x.png");
  });

  it("preserves a subpath-hosted CMS base", () => {
    const out = absolutizeFormatUrls({ a: { url: "/uploads/x.png" } }, "https://example.com/cms") as Record<string, { url: string }>;
    expect(out.a.url).toBe("https://example.com/cms/uploads/x.png");
  });

  it("degrades to the input untouched for a missing base or malformed formats", () => {
    const formats = { a: { url: "/uploads/x.png" } };
    expect(absolutizeFormatUrls(formats, "")).toBe(formats);
    expect(absolutizeFormatUrls(null, BASE)).toBeNull();
    expect(absolutizeFormatUrls("nope", BASE)).toBe("nope");
  });

  it("passes through entries with no usable url rather than inventing one", () => {
    const out = absolutizeFormatUrls(
      { a: { width: 100 }, b: null, c: { url: "   " } },
      BASE
    ) as Record<string, unknown>;

    expect(out.a).toEqual({ width: 100 });
    expect(out.b).toBeNull();
    expect(out.c).toEqual({ url: "   " });
  });
});

describe("mergeImageFormats — intrinsic width/height (Phase 18, item 12)", () => {
  function heroValueOf(page: StrapiPage) {
    return (
      page.page_template as { sections: Array<{ data: Record<string, unknown> }> }
    ).sections[0].data.hero as {
      value: { id: number; url: string; width?: number; height?: number; formats?: unknown };
    };
  }

  it("merges width/height alongside formats without touching id/url", () => {
    const page = pageWithHero({ id: 42, url: "/x.jpg" });
    const merged = mergeImageFormats(
      page,
      new Map([[42, { formats: { thumbnail: { url: "/t.jpg", width: 245 } }, width: 1600, height: 900 }]])
    );

    expect(heroValueOf(merged).value).toEqual({
      id: 42,
      url: "/x.jpg",
      formats: { thumbnail: { url: "/t.jpg", width: 245 } },
      width: 1600,
      height: 900,
    });
  });

  it("merges dimensions for a file that has NO formats — the SVG/small-raster case the old skip dropped", () => {
    const merged = mergeImageFormats(
      pageWithHero({ id: 42, url: "/logo.svg" }),
      new Map([[42, { width: 200, height: 40 }]])
    );

    expect(heroValueOf(merged).value).toEqual({
      id: 42,
      url: "/logo.svg",
      width: 200,
      height: 40,
    });
    expect("formats" in heroValueOf(merged).value).toBe(false);
  });

  it("adds no width/height key at all when Strapi has no dimensions", () => {
    const merged = mergeImageFormats(
      pageWithHero({ id: 42, url: "/x.jpg" }),
      new Map([[42, { formats: { thumbnail: { url: "/t.jpg" } } }]])
    );
    const value = heroValueOf(merged).value;

    expect("width" in value).toBe(false);
    expect("height" in value).toBe(false);
  });

  it("ignores zero/negative dimensions rather than emitting a nonsense box", () => {
    const merged = mergeImageFormats(
      pageWithHero({ id: 42, url: "/x.jpg" }),
      new Map([[42, { width: 0, height: -5 }]])
    );

    expect(heroValueOf(merged).value).toEqual({ id: 42, url: "/x.jpg" });
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
    // Phase 18: dimensions ride the SAME request as formats — no second round trip.
    expect(decodeURIComponent(calls[0])).toContain("fields[2]=width");
    expect(decodeURIComponent(calls[0])).toContain("fields[3]=height");
    const hero = (out.page_template as { sections: { data: Record<string, { value: { formats?: unknown } }> }[] })
      .sections[0].data.hero;
    // Absolutized against the CMS base (env-stubbed to `strapi.test`) on the way
    // through — a relative variant url would 404 against the tenant origin and
    // blank the image. See absolutizeFormatUrls.
    expect(hero.value.formats).toEqual({
      webp: { url: "https://strapi.test/w.webp" },
    });
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
