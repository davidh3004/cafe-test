import type { BlogArticleRecord } from "./blog-client";

/**
 * D-5 related-post selection rules (Phase 23, Plan 04, Task 1, BLOG-10).
 * PURE, dependency-free module -- no network, no read of the global runtime
 * environment, never throws -- mirroring `blog-pagination.ts`'s conventions
 * (the sole other pure path/selection module in this app).
 *
 * `rankRelatedPosts` is the ONE place this codebase decides which posts are
 * "related" to a source post. `fetchRelatedArticles` (`blog-client.ts`)
 * supplies the candidate pool over the network; this module never does.
 */

/** The maximum number of related posts ever returned (D-5). */
export const RELATED_POSTS_CAP = 3;

/** Whether `article` carries a non-blank `publishedAt` -- the same
 * defence-in-depth gate every listing read in `blog-client.ts` applies,
 * re-applied here so this ranker is correct even if a future caller hands it
 * a broader candidate set than the query layer already filtered. */
function hasPublishedAt(article: BlogArticleRecord): boolean {
  return typeof article.publishedAt === "string" && article.publishedAt.trim() !== "";
}

/** A candidate's D-5 score against `source`: `"category"` when the
 * candidate's category slug equals the source's, else `"tag"` when the
 * candidate shares at least one tag slug with the source, else `null` --
 * meaning the candidate is dropped entirely rather than ranked last. */
function scoreCandidate(
  source: BlogArticleRecord,
  candidate: BlogArticleRecord
): "category" | "tag" | null {
  const sourceCategorySlug = source.category?.slug;
  if (sourceCategorySlug != null && candidate.category?.slug === sourceCategorySlug) {
    return "category";
  }
  const sourceTagSlugs = new Set((source.tags ?? []).map((tag) => tag.slug));
  if (sourceTagSlugs.size > 0) {
    const sharesTag = (candidate.tags ?? []).some((tag) => sourceTagSlugs.has(tag.slug));
    if (sharesTag) return "tag";
  }
  return null;
}

/** Ordinal weight for the total ordering below -- lower sorts first. */
const SCORE_WEIGHT: Record<"category" | "tag", number> = { category: 0, tag: 1 };

/**
 * D-5's deterministic related-post ranking: candidates sharing `source`'s
 * category rank above candidates sharing only a tag; ties break by
 * `publishedAt` descending, then by `documentId` ascending so the result is
 * TOTALLY ordered and identical on every call -- a partial order would let
 * two posts published in the same instant swap places between renders.
 *
 * `source` is always excluded by `documentId` comparison, regardless of how
 * it entered `candidates`. A candidate whose `publishedAt` is not a
 * non-blank string is excluded (defence in depth). A candidate matching
 * neither the source's category nor any of its tags is dropped entirely.
 * Duplicates (by `documentId`) keep only their highest-ranked occurrence.
 *
 * Returns `[]` when `source` has neither a category nor any tags, and when
 * no candidate matches -- a post with no taxonomy or no siblings has no
 * related list; the theme renders nothing rather than an empty shell.
 */
export function rankRelatedPosts(
  source: BlogArticleRecord,
  candidates: BlogArticleRecord[],
  cap: number = RELATED_POSTS_CAP
): BlogArticleRecord[] {
  const sourceHasCategory = source.category?.slug != null;
  const sourceHasTags = (source.tags ?? []).length > 0;
  if (!sourceHasCategory && !sourceHasTags) return [];

  const scored: Array<{ article: BlogArticleRecord; score: "category" | "tag" }> = [];
  const seenDocumentIds = new Map<string, number>();

  for (const candidate of candidates) {
    if (candidate.documentId === source.documentId) continue;
    if (!hasPublishedAt(candidate)) continue;
    const score = scoreCandidate(source, candidate);
    if (score === null) continue;

    const existingIndex = seenDocumentIds.get(candidate.documentId);
    if (existingIndex !== undefined) {
      // Keep only the highest-ranked occurrence: lower SCORE_WEIGHT wins;
      // on a tie, the first occurrence already encountered is kept.
      if (SCORE_WEIGHT[score] < SCORE_WEIGHT[scored[existingIndex].score]) {
        scored[existingIndex] = { article: candidate, score };
      }
      continue;
    }
    seenDocumentIds.set(candidate.documentId, scored.length);
    scored.push({ article: candidate, score });
  }

  scored.sort((a, b) => {
    const weightDiff = SCORE_WEIGHT[a.score] - SCORE_WEIGHT[b.score];
    if (weightDiff !== 0) return weightDiff;

    const aPublishedAt = a.article.publishedAt ?? "";
    const bPublishedAt = b.article.publishedAt ?? "";
    if (aPublishedAt !== bPublishedAt) {
      // Descending: the later (greater) publishedAt sorts first.
      return aPublishedAt > bPublishedAt ? -1 : 1;
    }

    // Final tiebreak: documentId ascending, so the total order never
    // depends on input order or iteration order.
    if (a.article.documentId < b.article.documentId) return -1;
    if (a.article.documentId > b.article.documentId) return 1;
    return 0;
  });

  return scored.slice(0, cap).map((entry) => entry.article);
}
