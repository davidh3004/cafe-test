import { RenderPage, buildPageMetadata, resolveHomepageSlug } from "./_lib/render-page";

/**
 * Root route — renders the homepage IN PLACE.
 *
 * This used to `redirect()` to `/{slug}`, which cost a full extra round trip
 * (measured: 1.55s for the 307, then the real page — ~3.0s to first byte for
 * anyone landing on the domain root) and canonicalized the homepage to `/home`
 * rather than `/`, splitting link authority between two URLs for the same
 * content.
 *
 * See app/[slug]/page.tsx for why this is ISR rather than force-dynamic.
 */

// See app/[slug]/page.tsx for why this route explicitly declares the Node.js runtime.
export const runtime = "nodejs";
export const revalidate = 10;

export async function generateMetadata() {
  return buildPageMetadata(await resolveHomepageSlug());
}

export default async function HomePage() {
  const slug = await resolveHomepageSlug();

  // Deliberately a soft empty state rather than notFound(). `fetchPages` swallows
  // Strapi failures and returns [], so a transient outage during the build is
  // indistinguishable here from a genuinely empty CMS — and a hard 404 baked into
  // the prerendered root would then be served until the next revalidation. This
  // self-heals within the `revalidate` window instead.
  if (!slug) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold">No pages found</p>
          <p className="text-sm text-muted-foreground">
            Please create pages in your CMS
          </p>
        </div>
      </div>
    );
  }

  return <RenderPage slug={slug} />;
}
