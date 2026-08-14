import { fetchPublishedArticleSlugs } from "@/lib/blog-client";
import { RenderPost, buildPostMetadata } from "../../_lib/render-blog";

/**
 * `/blog/{slug}` -- one published post (Phase 22, Plan 02, BLOG-07/BLOG-08).
 *
 * The Node.js runtime declaration below is required: `node:vm` powers the
 * server-side theme evaluator and does not exist on Edge -- same guard, same
 * reason, as `app/[slug]/page.tsx`
 * (see .planning/phases/12-server-side-theme-evaluation-infrastructure/SSR-07-THREAT-MODEL.md).
 *
 * This static `blog` segment wins route precedence over the sibling
 * `app/[slug]/page.tsx` catch-all by Next.js's static-before-dynamic rule --
 * a client page whose slug is literally `blog` becomes unreachable, a
 * stated D-1 trade (22-CONTEXT.md), not a collision detected at runtime.
 */
export const runtime = "nodejs";
export const revalidate = 10;

interface PostPageProps {
  params: Promise<{ slug: string }>;
}

/** D-6: enumerates published posts only. */
export async function generateStaticParams() {
  try {
    const slugs = await fetchPublishedArticleSlugs();
    return slugs.map((slug) => ({ slug }));
  } catch (error) {
    console.error("Failed to generate static params for blog posts:", error);
    return [];
  }
}

export async function generateMetadata({ params }: PostPageProps) {
  const { slug } = await params;
  return buildPostMetadata(slug);
}

export default async function PostPage({ params }: PostPageProps) {
  const { slug } = await params;
  return <RenderPost slug={slug} />;
}
