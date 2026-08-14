import { RenderArchive, buildArchiveMetadata } from "../../../_lib/render-blog";

/**
 * `/blog/category/{term}` -- one category archive, page 1 (Phase 22, Plan
 * 06, BLOG-07, D-3). Shares the SAME `archive` template as `/blog` and
 * `/blog/tag/{term}`, differing only by `ArchiveProp.term`.
 *
 * `generateStaticParams` returns an empty array deliberately: category
 * archives render on demand under ISR, and pre-rendering every category at
 * build time is not worth a build-time fan-out.
 *
 * Node.js runtime required: same `node:vm` reason as every other blog route.
 */
export const runtime = "nodejs";
export const revalidate = 10;

interface CategoryArchivePageProps {
  params: Promise<{ term: string }>;
}

export async function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: CategoryArchivePageProps) {
  const { term } = await params;
  return buildArchiveMetadata({ kind: "category", termSlug: term, page: 1 });
}

export default async function BlogCategoryArchivePage({ params }: CategoryArchivePageProps) {
  const { term } = await params;
  return <RenderArchive kind="category" termSlug={term} page={1} />;
}
