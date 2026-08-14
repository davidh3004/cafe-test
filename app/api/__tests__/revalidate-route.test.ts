import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Contract under test — templates/theme-site/app/api/revalidate/route.ts
// (D-01, D-11, T-22-03, T-22-04, T-22-14). This is the FIRST test file for
// this route — it has existed since the pre-milestone ISR work but had no
// caller and no test until Phase 17-04 wired triggerRevalidation, then
// Phase 22 Plan 04 widened it to accept a `paths` array (D-11).
//
//   - An unset REVALIDATE_SECRET still returns 503 and purges nothing.
//   - A wrong/missing secret header still returns 401 and purges nothing —
//     both auth branches are reached BEFORE the array branch (T-22-03).
//   - A body carrying a valid `paths` array purges every entry once each and
//     echoes them in the response.
//   - A body carrying both a single `path` and an array purges both,
//     deduplicated via the existing Set.
//   - A `path`-only or `slug`-only body behaves exactly as before this
//     widening, including the slug's root purge.
//   - An empty/unparseable body still triggers the full-site purge pair.
//   - Array entries that are not strings, are empty, or lack a leading slash
//     are dropped without failing the request (T-22-04).
//   - The array is capped; entries beyond the cap are dropped rather than
//     purged (T-22-04).
//   - A bracketed dynamic segment purges as a route pattern; a path with no
//     bracket purges as a literal — the previously-hardcoded `/[slug]` case
//     keeps working under the new general rule.
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { POST } from "@/app/api/revalidate/route";

const ORIGINAL_SECRET = process.env.REVALIDATE_SECRET;

function postRequest(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== undefined) {
    headers["x-revalidate-secret"] = secret;
  }
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function postRawBody(raw: string, secret?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== undefined) {
    headers["x-revalidate-secret"] = secret;
  }
  return new Request("http://localhost/api/revalidate", {
    method: "POST",
    headers,
    body: raw,
  });
}

beforeEach(() => {
  process.env.REVALIDATE_SECRET = "test-secret-value";
  revalidatePath.mockClear();
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.REVALIDATE_SECRET;
  } else {
    process.env.REVALIDATE_SECRET = ORIGINAL_SECRET;
  }
});

describe("POST /api/revalidate — auth branches reached before the array branch (T-22-03)", () => {
  it("returns 503 and purges nothing when REVALIDATE_SECRET is unset", async () => {
    delete process.env.REVALIDATE_SECRET;

    const res = await POST(postRequest({ paths: ["/blog"] }, "anything"));

    expect(res.status).toBe(503);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 401 and purges nothing when the secret header is missing", async () => {
    const res = await POST(postRequest({ paths: ["/blog"] }));

    expect(res.status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns 401 and purges nothing when the secret header is wrong", async () => {
    const res = await POST(postRequest({ paths: ["/blog"] }, "wrong-secret"));

    expect(res.status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("POST /api/revalidate — paths[] array purges every entry (D-11)", () => {
  it("purges every array entry once each and echoes them in the response", async () => {
    const res = await POST(
      postRequest(
        { paths: ["/blog", "/blog/category/shoes"] },
        "test-secret-value"
      )
    );

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/blog", undefined);
    expect(revalidatePath).toHaveBeenCalledWith("/blog/category/shoes", undefined);
    const json = await res.json();
    expect(json.revalidated).toBe(true);
    expect(new Set(json.paths)).toEqual(new Set(["/blog", "/blog/category/shoes"]));
  });

  it("purges both the array's entries and a companion single path, deduplicated, never twice", async () => {
    const res = await POST(
      postRequest(
        { path: "/blog", paths: ["/blog", "/blog/page/2"] },
        "test-secret-value"
      )
    );

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    const calledPaths = revalidatePath.mock.calls.map((call) => call[0]);
    expect(calledPaths.filter((p) => p === "/blog").length).toBe(1);
    expect(calledPaths).toContain("/blog/page/2");
  });

  it("drops array entries that are not strings, are empty, or lack a leading slash, without failing the request", async () => {
    const res = await POST(
      postRequest(
        {
          paths: ["/blog", "", "no-leading-slash", 42, null, "/blog/tag/x"],
        },
        "test-secret-value"
      )
    );

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    const calledPaths = revalidatePath.mock.calls.map((call) => call[0]);
    expect(new Set(calledPaths)).toEqual(new Set(["/blog", "/blog/tag/x"]));
  });

  it("caps the collected array at the shared limit — entries beyond the cap are dropped rather than purged", async () => {
    const manyPaths = Array.from({ length: 50 }, (_, i) => `/blog/tag/t${i}`);

    const res = await POST(postRequest({ paths: manyPaths }, "test-secret-value"));

    expect(res.status).toBe(200);
    expect(revalidatePath.mock.calls.length).toBeLessThan(50);
    expect(revalidatePath.mock.calls.length).toBeLessThanOrEqual(32);
  });
});

describe("POST /api/revalidate — pre-existing single-path/slug/empty behavior is unchanged", () => {
  it("a single path behaves exactly as today", async () => {
    const res = await POST(postRequest({ path: "/about" }, "test-secret-value"));

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/about", undefined);
    expect(await res.json()).toEqual({ revalidated: true, paths: ["/about"] });
  });

  it("a bare slug purges the slug path AND the root, exactly as today", async () => {
    const res = await POST(postRequest({ slug: "about" }, "test-secret-value"));

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/about", undefined);
    expect(revalidatePath).toHaveBeenCalledWith("/", undefined);
  });

  it("an empty body still triggers the full-site purge pair, exactly as today", async () => {
    const res = await POST(postRequest({}, "test-secret-value"));

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/", undefined);
    expect(revalidatePath).toHaveBeenCalledWith("/[slug]", "page");
  });

  it("an unparseable body still triggers the full-site purge pair, exactly as today", async () => {
    const res = await POST(postRawBody("not json", "test-secret-value"));

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/", undefined);
    expect(revalidatePath).toHaveBeenCalledWith("/[slug]", "page");
  });
});

describe("POST /api/revalidate — dynamic-segment pattern purge generalized (D-7)", () => {
  it("purges a path with a bracketed dynamic segment as a route pattern (second arg 'page')", async () => {
    const res = await POST(
      postRequest({ paths: ["/blog/tag/[term]"] }, "test-secret-value")
    );

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/blog/tag/[term]", "page");
  });

  it("purges a path with no bracket as a literal (second arg undefined)", async () => {
    const res = await POST(
      postRequest({ paths: ["/blog/my-post"] }, "test-secret-value")
    );

    expect(res.status).toBe(200);
    expect(revalidatePath).toHaveBeenCalledWith("/blog/my-post", undefined);
  });

  it("still purges the previously-hardcoded /[slug] pattern correctly under the general rule", async () => {
    await POST(postRequest({}, "test-secret-value"));

    expect(revalidatePath).toHaveBeenCalledWith("/[slug]", "page");
  });
});
