/**
 * Pure post-metadata resolver for `/blog/{slug}` (Phase 23, BLOG-09/BLOG-10).
 * Mirrors `seo-resolve.ts`'s own discipline: no network, no read of the
 * global runtime environment (`env` is a PARAMETER), no side effects, never
 * throws -- so `buildPostMetadataFrom` can be unit-pinned against synthetic
 * article/site objects, and so `discovery-resolve.ts`'s cross-layer
 * byte-identity proof can drive it directly without a mock.
 *
 * Plan 01 (Task 2) established the not-found gate, the canonical composed
 * through `resolvePostCanonical` (the D-1 single-producer guarantee), and a
 * bare title/excerpt-as-description pass. Plan 03 (D-3, this widening) rides
 * Phase 15's EXACT site-to-record tier chain -- resolveSiteDefaults,
 * resolveShareImage, resolveCanonicalOverride (via resolvePostCanonical),
 * applyTitleTemplate, buildLanguageAlternates -- every one of them already
 * generic in signature, none typed to `StrapiPage`. No blog-specific
 * fallback ladder is invented here; see `buildPageMetadataFrom`
 * (`seo-resolve.ts`) for the page-side twin this function stays structurally
 * identical to.
 *
 * The excerpt continues to be produced SOLELY by `buildArticleProp`
 * (`article-contract.ts`) -- this module derives no excerpt of its own
 * (grep-verified: the body-to-excerpt deriver's export is never imported or
 * referenced here). D-3 treats that excerpt as the description chain's
 * MIDDLE rung (the post's own value), not a fourth tier invented by this
 * plan.
 */

import type { Metadata } from "next";
import type { StrapiSite } from "./strapi-client";
import type { BlogArticleRecord } from "./blog-client";
import { buildArticleProp } from "./article-contract";
import {
  resolveSiteOrigin,
  resolveLocale,
  resolveSiteTitleTemplate,
  resolveSiteDefaults,
  applyTitleTemplate,
  resolvePostCanonical,
  buildLanguageAlternates,
  resolveShareImage,
  NOT_FOUND_TITLE,
  type SeoEnv,
} from "./seo-resolve";

/**
 * Assembles the full Next `Metadata` object for one published post.
 *
 * `NOT_FOUND_TITLE` for a missing article or one whose `publishedAt` is not
 * a non-empty string -- the same D-6 defence-in-depth gate every other blog
 * read in this app applies.
 *
 * Title (D-3): the post's own `seo.title` trimmed, falling back to the
 * post's title. Deliberately NO site tier -- `buildPageMetadataFrom`'s
 * recorded title/description asymmetry (Phase 15, D-10) is not reopened
 * here. The resolved title is then composed through `applyTitleTemplate` +
 * `resolveSiteTitleTemplate`, emitted as `title.absolute` only when the
 * template actually changes it (mirrors `buildPostMetadata`'s own reasoning:
 * `/blog/{slug}` is a child segment of the root layout, so Next already
 * applies the layout's plain-string template automatically -- composing it
 * here too and emitting `title.absolute` bypasses that automatic merge
 * rather than stacking on top of it).
 *
 * Description (D-3's three named rungs, in order): (1) the post's own
 * explicit `seo.description` trimmed -- the per-post override; (2) the
 * post's own excerpt, already produced by `buildArticleProp` -- D-3's middle
 * "post value" rung, never re-derived here; (3) the site default from
 * `resolveSiteDefaults(site).description`. Blank at all three tiers omits
 * the `description` key entirely, matching `buildPageMetadataFrom`'s
 * never-emit-a-blank-key rule -- an absent tag is better for a crawler than
 * an empty one.
 *
 * Robots: mirrors `buildPageMetadataFrom`'s directive -- `index` is the
 * negation of a strictly-true `seo.noindex`, `follow` is always `true`. This
 * reads the SAME `seo.noindex` field `isPostSitemapEligible`
 * (`discovery-resolve.ts`) reads for sitemap eligibility; a second,
 * independently maintained flag is exactly the drift a one-signal rule
 * exists to prevent (T-23-14).
 *
 * Canonical: `resolvePostCanonical` (unchanged from Plan 01) -- a valid
 * per-post `canonicalUrl` override wins over the computed `/blog/{slug}`
 * URL. `metadataBase`, `alternates` (canonical + `buildLanguageAlternates`'s
 * self-referential hreflang pair) and `openGraph.url` are all decided by the
 * SAME `origin !== null` gate `buildPageMetadataFrom` uses (Pitfall-2
 * single-gate discipline) -- never three independent checks.
 *
 * Share image (D-3 criterion 3): `resolveShareImage(article.seo?.shareImage,
 * cmsBase) ?? resolveShareImage(site?.seo?.shareImage, cmsBase)` -- the
 * IDENTICAL two-call expression `buildPageMetadataFrom` already uses, both
 * resolved against the CMS base URL (`env.NEXT_PUBLIC_STRAPI_URL`), never
 * the tenant origin (`resolveShareImage`'s own doc comment explains why).
 * Attached to both `openGraph.images` and `twitter.images` only when it
 * resolved, width/height carried through only when `resolveShareImage`
 * supplied them; neither tier resolving omits the image key entirely from
 * both blocks and sets `twitter.card` to `summary` rather than substituting
 * a placeholder.
 *
 * `openGraph`/`twitter` mirror `buildPageMetadataFrom`'s assembly: title on
 * both, `openGraph.type` is `"article"` (a post, not a generic page),
 * `openGraph.siteName` when the site name resolves, and `description` on
 * both only when a description resolved.
 */
export function buildPostMetadataFrom(
  article: BlogArticleRecord | null | undefined,
  site: StrapiSite | null | undefined,
  env: SeoEnv | null | undefined
): Metadata {
  if (!article || !article.publishedAt) {
    return { title: NOT_FOUND_TITLE };
  }

  const articleProp = buildArticleProp(article);
  const origin = resolveSiteOrigin(site, env);
  const locale = resolveLocale(site);
  const { siteName, description: siteDefaultDescription } = resolveSiteDefaults(site);

  // D-3 title tier: post's own SEO title wins, else the post title. No site
  // tier -- see this function's doc comment.
  const title = article.seo?.title?.trim() || articleProp.title;
  const templated = applyTitleTemplate(resolveSiteTitleTemplate(site), title);

  // D-3 description tiers: explicit per-post override, then the post's own
  // excerpt (buildArticleProp's derivation -- not re-derived here), then the
  // site default.
  const description =
    article.seo?.description?.trim() || articleProp.excerpt || siteDefaultDescription;

  // Reads the SAME field the sitemap eligibility filter reads (T-23-14).
  const noindex = article.seo?.noindex === true;

  const openGraph: Record<string, unknown> = { title, type: "article" };
  if (siteName) openGraph.siteName = siteName;
  const twitter: Record<string, unknown> = { title };
  if (description) {
    openGraph.description = description;
    twitter.description = description;
  }

  const metadata: Record<string, unknown> = {
    title: templated !== title ? { absolute: templated } : title,
    robots: { index: !noindex, follow: true },
  };
  if (description) metadata.description = description;

  // Origin-gated block (Pitfall 2): metadataBase, alternates and
  // openGraph.url are all decided by this ONE conditional -- see this
  // function's doc comment.
  if (origin !== null) {
    const canonical = resolvePostCanonical(article, origin);
    metadata.metadataBase = new URL(origin);
    metadata.alternates = {
      canonical,
      languages: buildLanguageAlternates(locale, canonical),
    };
    openGraph.url = canonical;
  }

  // Share-image tier chain: the post's own resolves first, falling through
  // to the site's via nullish coalescing -- the identical expression
  // buildPageMetadataFrom uses for pages.
  const resolvedImage =
    resolveShareImage(article.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL) ??
    resolveShareImage(site?.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL);
  if (resolvedImage) {
    openGraph.images = [
      {
        url: resolvedImage.url,
        ...(resolvedImage.width !== undefined ? { width: resolvedImage.width } : {}),
        ...(resolvedImage.height !== undefined ? { height: resolvedImage.height } : {}),
      },
    ];
    twitter.card = "summary_large_image";
    twitter.images = [resolvedImage.url];
  } else {
    // D-04 (Phase 14): no bundled placeholder substituted -- the text card
    // is the correct degradation.
    twitter.card = "summary";
  }

  metadata.openGraph = openGraph;
  metadata.twitter = twitter;

  return metadata as Metadata;
}
