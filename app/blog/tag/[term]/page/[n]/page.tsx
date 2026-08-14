import { notFound, redirect } from "next/navigation";
import { parseBlogPageParam, resolveBlogPaginationPath } from "@/lib/blog-pagination";
import { NOT_FOUND_TITLE } from "@/lib/seo-resolve";
import { RenderArchive, buildArchiveMetadata } from "../../../../../_lib/render-blog";

/**
 * `/blog/tag/{term}/page/{n}` -- the paginated tag archive (Phase 22, Plan
 * 06, BLOG-07, D-3/D-5).
 *
 * A directory named `page` and a file named `page.tsx` coexist in the
 * PARENT folder (`app/blog/tag/[term]/`) by design -- same reasoning as
 * `app/blog/page/[n]/page.tsx`'s own doc comment.
 *
 * `n=1` redirects to the bare `/blog/tag/{term}` path -- D-5's page-1
 * collapse, built via `resolveBlogPaginationPath`, never a literal string,
 * BEFORE any fetch. A non-numeric, zero, negative, padded or absurdly long
 * segment 404s -- never coerced to page 1.
 *
 * Node.js runtime required: same `node:vm` reason as every other blog route.
 */
export const runtime = "nodejs";
export const revalidate = 10;

interface TagArchivePaginatedPageProps {
  params: Promise<{ term: string; n: string }>;
}

export async function generateMetadata({ params }: TagArchivePaginatedPageProps) {
  const { term, n } = await params;
  const page = parseBlogPageParam(n);
  if (page === null) return { title: NOT_FOUND_TITLE };
  return buildArchiveMetadata({ kind: "tag", termSlug: term, page });
}

export default async function BlogTagArchivePaginatedPage({
  params,
}: TagArchivePaginatedPageProps) {
  const { term, n } = await params;
  const page = parseBlogPageParam(n);
  if (page === null) notFound();
  if (page === 1) redirect(resolveBlogPaginationPath("tag", term, 1));
  return <RenderArchive kind="tag" termSlug={term} page={page} />;
}
