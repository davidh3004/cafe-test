/**
 * Edge enforcement for stored CMS redirects (Phase 16 Plan 01, REDIR-02/03).
 *
 * A thin glue layer only — no fetch logic, no cache, no validation. All
 * network and caching lives in `lib/redirect-resolve.ts`; the bot filter and
 * the click beacon live in `lib/redirect-clicks.ts`. This file only awaits
 * `getRedirectMap()`, calls `resolveRedirect()`, and hands the beacon to
 * `waitUntil`.
 *
 * WHY ENFORCEMENT LIVES HERE, NOT IN `RenderPage` (D-01):
 * `app/[slug]/page.tsx` is a single-segment dynamic route with no catch-all,
 * so a check inside `RenderPage` before its `notFound()` structurally cannot
 * see a multi-segment source like `/blog/old-post`. And `redirect()` /
 * `permanentRedirect()` from `next/navigation` yield 307/308, not the
 * 301/302 D-02 requires.
 *
 * WHY THIS RUNS ON EDGE:
 * Node-runtime middleware needs a Next canary at this template's pinned Next
 * 15.3.8 — Edge is the only option available. The Edge instance count is
 * also what makes the module-scope TTL cache's hit rate lower in production
 * than a per-lambda estimate would suggest (RESEARCH.md A3): each warm Edge
 * isolate holds its own cache slot, so the effective fetch rate across a
 * tenant's traffic is "roughly once per TTL window PER warm instance," not
 * once per TTL window total.
 *
 * D-06: no purge or revalidate route exists for this cache, deliberately —
 * it would clear one warm instance out of many while looking authoritative.
 * The documented ~30s lag (`REDIRECT_MAP_TTL_MS`) is the accepted behaviour.
 *
 * D-04: no built-in redirect from the homepage slug to `/` lives here. `/`
 * and `/{homepage-slug}` both keep serving 200 with canonical declaring `/`
 * — consciously closed, see `redirect-resolve.ts`'s D-10 deny-list comment.
 * The only reason `/` appears in this subsystem at all is that deny-list
 * refusing it as a redirect SOURCE.
 */

import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
import { getRedirectMap, resolveRedirect } from "./lib/redirect-resolve";
import { reportRedirectClick, shouldCountClick } from "./lib/redirect-clicks";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
  const map = await getRedirectMap();
  const match = resolveRedirect(request.nextUrl.pathname, map);

  if (match) {
    // REQ-2. `event.waitUntil` — never `await` — is the whole safety story
    // here: the beacon runs after the redirect response has been handed to
    // the visitor, so a slow or dead ingest endpoint costs an uncounted
    // click and nothing else. Awaiting would put the platform's uptime on
    // the critical path of every tenant's redirects, which is a far worse
    // trade than losing a number off a dashboard.
    //
    // `reportRedirectClick` never rejects, so this cannot produce an
    // unhandled rejection inside the isolate.
    if (shouldCountClick(match.trackClicks, request.headers.get("user-agent"))) {
      event.waitUntil(reportRedirectClick(request.nextUrl.pathname));
    }

    // `new URL(destination, base)` covers BOTH destination shapes with no
    // branch: an absolute `https://partner.com/x` ignores the base entirely
    // per the WHATWG URL spec, while an internal `/x` resolves against the
    // request's own origin. This is load-bearing, not incidental — a
    // hand-rolled `${origin}${destination}` concatenation here would
    // silently emit `https://tenant.com/https://partner.com/x` for every
    // external row that `buildRedirectMap` now admits.
    return NextResponse.redirect(
      new URL(match.destination, request.url),
      match.status
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Static literal required by Next.js — config.matcher cannot read an
    // imported constant. Excludes _next/static, _next/image, api, the
    // metadata files, and any dotted path segment (static-asset guard,
    // mirroring the dashboard's own root `middleware.ts`).
    "/((?!_next/static|_next/image|api|favicon.ico|sitemap.xml|robots.txt|.*\\..*).*)",
  ],
};
