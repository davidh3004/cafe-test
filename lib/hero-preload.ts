/**
 * Pure hero-image-URL resolver for the server-rendered LCP preload hint (D-04).
 *
 * `PageRenderer` (page-renderer.tsx) is a client component that shows a blank
 * placeholder until the theme JS bundle downloads/executes, so the hero image is
 * never in the initial server-rendered HTML and has no `fetchPriority` hint
 * (lcp-discovery-insight). This helper reads the SAME section/block shape
 * page-renderer.tsx already reads (sectionKey "hero", block type "hero-slide",
 * `data.backgroundImage.value.url`) so `app/[slug]/page.tsx` can emit a
 * `<link rel="preload" as="image" fetchPriority="high">` for that URL BEFORE the
 * theme bundle is even requested.
 *
 * Defensive by construction (mirrors `resolvePageForLiveTheme`'s null-safe style
 * in `live-resolve.ts`): every access is optional-chained with an explicit `null`
 * fallback. Never throws.
 */

import type { StrapiBlock, StrapiPage, StrapiPageTemplate, StrapiSection } from "./strapi-client";

/** Normalize a section/block key for lookup (trim + lowercase). */
function normalizeKey(key: unknown): string {
  return typeof key === "string" ? key.trim().toLowerCase() : "";
}

/**
 * Resolve the single bound template from the page_template array-or-single union
 * (manyToMany, D-14) — mirrors the `Array.isArray(page.page_template) ? ... : ...`
 * coercion in page-renderer.tsx.
 */
function singleTemplate(
  page: StrapiPage
): StrapiPageTemplate | null {
  const tmpl = page.page_template;
  if (tmpl == null) return null;
  return Array.isArray(tmpl) ? tmpl[0] ?? null : tmpl;
}

/** Find the section whose sectionKey normalizes to "hero". */
function findHeroSection(template: StrapiPageTemplate | null): StrapiSection | null {
  const sections = template?.sections ?? [];
  return sections.find((section) => normalizeKey(section.sectionKey) === "hero") ?? null;
}

/**
 * Find the first (lowest-order) block in the hero section whose blockType
 * normalizes to "hero-slide". Sorts blocks by `order` ascending first, mirroring
 * page-renderer.tsx's `sortedBlocks` pattern, so "first" means lowest order, not
 * array index 0.
 */
function findFirstHeroSlideBlock(heroSection: StrapiSection | null): StrapiBlock | null {
  const blocks = [...(heroSection?.blocks ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  return blocks.find((block) => normalizeKey(block.blockType) === "hero-slide") ?? null;
}

/** Extract a non-empty string URL from a `{ type: 'image', value: { url } }` field. */
function extractImageUrl(backgroundImage: unknown): string | null {
  if (backgroundImage == null || typeof backgroundImage !== "object") return null;
  const value = (backgroundImage as { value?: unknown }).value;
  if (value == null || typeof value !== "object") return null;
  const url = (value as { url?: unknown }).url;
  return typeof url === "string" && url.trim() !== "" ? url : null;
}

/**
 * Resolve the hero section's first-slide background image URL, or `null` when
 * unresolvable for any reason (no page, no hero section, no hero-slide block, no
 * backgroundImage, missing/empty url). Never throws.
 */
export function extractFirstHeroImageUrl(
  page: StrapiPage | null | undefined
): string | null {
  if (page == null) return null;

  const template = singleTemplate(page);
  const heroSection = findHeroSection(template);
  const heroBlock = findFirstHeroSlideBlock(heroSection);
  if (!heroBlock) return null;

  return extractImageUrl(heroBlock.data?.backgroundImage);
}
