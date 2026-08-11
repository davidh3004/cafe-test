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

/** Constant-time-ish comparison so the secret can't be probed byte by byte. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
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

  let body: { path?: string; slug?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty/invalid body is fine — fall through to revalidating everything.
  }

  // Accept either an explicit path or a bare slug. A slug of the homepage still
  // needs `/` purged too, and the caller does not necessarily know which page is
  // the homepage, so a slug purge always includes the root.
  const paths = new Set<string>();
  if (body.path) {
    paths.add(body.path);
  } else if (body.slug) {
    paths.add(`/${body.slug}`);
    paths.add("/");
  } else {
    paths.add("/");
    // layout purge cascades to every page under it
    paths.add("/[slug]");
  }

  for (const path of paths) {
    revalidatePath(path, path === "/[slug]" ? "page" : undefined);
  }

  return NextResponse.json({ revalidated: true, paths: [...paths] });
}
