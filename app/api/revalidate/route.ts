import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/**
 * On-demand revalidation.
 *
 * The page routes moved from `force-dynamic` to ISR, which removed ~1.5s of
 * Strapi round-trip from every request. The tradeoff is that a customizer
 * save/publish would otherwise take up to `revalidate` seconds to appear on the
 * live site. This endpoint closes that gap: the platform POSTs here after a
 * save, publish, or liveTheme switch, and the affected path is purged
 * immediately.
 *
 * Auth: a shared secret in the `x-revalidate-secret` header, compared against
 * REVALIDATE_SECRET. Fails CLOSED in the sense that matters — an unset secret
 * disables the endpoint entirely (503) rather than leaving it open, so an
 * existing deployment that has not been given the env var is never exposed.
 */

export const dynamic = "force-dynamic";

/**
 * D-11: the twin of `MAX_REVALIDATE_PATHS` in
 * `lib/revalidate/trigger-revalidation.ts`. These are two separately
 * deployed apps with no import path between them, so the cap is enforced
 * independently on this side too — see T-22-04. An unbounded array would
 * turn one authorised request into an unbounded number of cache operations.
 */
const MAX_REVALIDATE_PATHS = 32;

/** A dynamic route segment looks like `[slug]` or `[term]` — matched
 * anywhere in the path, not just the previously-hardcoded `/[slug]` case. */
const DYNAMIC_SEGMENT_PATTERN = /\[[^/]+\]/;

/** Constant-time-ish comparison so the secret can't be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Boundary validation for a `paths[]` entry: a non-empty string beginning
 * with a slash — anything else is dropped without failing the request. */
function isValidPathEntry(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.startsWith("/");
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;

  if (!secret) {
    // Not configured — the endpoint does not exist as far as callers are
    // concerned. Time-based `revalidate` still keeps the site fresh.
    return NextResponse.json(
      { revalidated: false, reason: "revalidation not configured" },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-revalidate-secret");
  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json(
      { revalidated: false, reason: "invalid secret" },
      { status: 401 }
    );
  }

  let body: { path?: string; slug?: string; paths?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body is fine — fall through to revalidating everything.
  }

  // D-11: collect from the widened `paths[]` array first (validated and
  // capped at the boundary), then also collect the single `path` or the
  // `slug` pair when present — a `Set` already backs the collection, so
  // deduplication comes free when the platform sends both `path` and
  // `paths` on the same request. Only when NOTHING was collected does the
  // full-site purge pair from before this widening apply.
  const paths = new Set<string>();

  if (Array.isArray(body.paths)) {
    for (const entry of body.paths) {
      if (paths.size >= MAX_REVALIDATE_PATHS) break;
      if (isValidPathEntry(entry)) {
        paths.add(entry);
      }
    }
  }

  // Accept either an explicit path or a bare slug. A slug of the homepage still
  // needs `/` purged too, and the caller does not necessarily know which page is
  // the homepage, so a slug purge always includes the root.
  if (body.path) {
    paths.add(body.path);
  } else if (body.slug) {
    paths.add(`/${body.slug}`);
    paths.add("/");
  }

  if (paths.size === 0) {
    paths.add("/");
    // layout purge cascades to every page under it
    paths.add("/[slug]");
  }

  // A bracketed dynamic segment (e.g. `/[slug]`, `/blog/tag/[term]`) is
  // purged as a route PATTERN so every page it matches is cleared in one
  // call; a path with no bracket is purged as a literal URL. This
  // generalizes the previously-hardcoded `path === "/[slug]"` equality
  // check into the rule D-7's paginated/term archive patterns need, while
  // the original hardcoded case keeps working under it unchanged.
  for (const path of paths) {
    revalidatePath(path, DYNAMIC_SEGMENT_PATTERN.test(path) ? "page" : undefined);
  }

  return NextResponse.json({ revalidated: true, paths: [...paths] });
}
