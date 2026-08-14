import { fetchSite } from "@/lib/strapi-client";
import { resolveBlogNotFoundCopy } from "@/lib/blog-render";

/**
 * The blog-scoped 404 boundary (Phase 22, Plan 02, D-10).
 *
 * Next.js resolves `notFound()` to the NEAREST `not-found.tsx` regardless of
 * what triggered it, so `app/blog/[slug]/page.tsx` cannot hand this boundary
 * a reason -- this file resolves the reason itself, off the live theme's own
 * manifest, via `resolveBlogNotFoundCopy` (D-4's stated degrade when the
 * theme declares no blog support, else a plain post-not-found message).
 *
 * Deliberately scoped to `app/blog/`, not a replacement for the
 * template-wide `app/not-found.tsx` -- that file stays the catch-all for
 * every mistyped URL; putting blog copy there would greet every visitor who
 * fat-fingered any URL, not only a degraded blog surface.
 */
export default async function BlogNotFound() {
  const site = await fetchSite();
  const { heading, body } = resolveBlogNotFoundCopy(site?.liveTheme?.sectionsManifest);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">{heading}</h1>
        <p className="text-lg text-muted-foreground mt-2">{body}</p>
      </div>
    </div>
  );
}
