import { notFound, redirect } from "next/navigation";
import { parseBlogPageParam, resolveBlogPaginationPath } from "@/lib/blog-pagination";
import { NOT_FOUND_TITLE } from "@/lib/seo-resolve";
import { RenderArchive, buildArchiveMetadata } from "../../../_lib/render-blog";

/**
 * `/blog/page/{n}` -- the paginated blog index (Phase 22, Plan 06, BLOG-07,
 * D-5).
 *
 * A directory named `page` and a file named `page.tsx` coexist in the
 * PARENT folder (`app/blog/`) by design: `app/blog/page.tsx` serves `/blog`
 * and this file (`app/blog/page/[n]/page.tsx`) serves `/blog/page/{n}` -- it
 * reads like a conflict and is not one.
 *
 * `n=1` redirects to the bare `/blog` path -- D-5's entire mechanism: page 1
 * is served at exactly one URL, so two URLs never render identical content.
 * The redirect destination is always built via `resolveBlogPaginationPath`,
 * never a literal string, and the redirect happens BEFORE any fetch -- there
 * is nothing to read for a URL that is about to be replaced. A non-numeric,
 * zero, negative, padded or absurdly long segment 404s -- never coerced to
 * page 1.
 *
 * Node.js runtime required: same `node:vm` reason as every other blog route.
 */
export const runtime = "nodejs";
export const revalidate = 10;

interface PaginatedIndexPageProps {
  params: Promise<{ n: string }>;
}

export async function generateMetadata({ params }: PaginatedIndexPageProps) {
  const { n } = await params;
  const page = parseBlogPageParam(n);
  if (page === null) return { title: NOT_FOUND_TITLE };
  return buildArchiveMetadata({ kind: "index", page });
}

export default async function BlogIndexPaginatedPage({ params }: PaginatedIndexPageProps) {
  const { n } = await params;
  const page = parseBlogPageParam(n);
  if (page === null) notFound();
  if (page === 1) redirect(resolveBlogPaginationPath("index", null, 1));
  return <RenderArchive kind="index" page={page} />;
}
