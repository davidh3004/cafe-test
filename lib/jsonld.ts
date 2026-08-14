/**
 * schema.org JSON-LD for the deployed per-tenant theme-site.
 *
 * Every served page previously carried ZERO structured data. This module is
 * the single seam that emits it, and — like `seo-resolve.ts`, whose resolvers
 * it consumes rather than re-deriving — every export is PURE (no network, no
 * side effects, never throws) so the whole emission is unit-pinnable against
 * synthetic Strapi objects.
 *
 * THE TWO RULES THAT SHAPE EVERYTHING HERE
 *
 * 1. Never invent data. A node is emitted only when the tenant actually
 *    authored the values that make it meaningful; a property is omitted
 *    entirely rather than filled with a placeholder, a guess, or a default
 *    string. This is the same discipline `resolveSiteDefaults` applies to
 *    `<title>` (D-12) and `resolveShareImage` applies to `og:image` (D-03/
 *    D-04), applied to structured data — where the cost of a wrong value is
 *    higher, because Google surfaces it as a factual claim about the
 *    business. Concretely, three things this module deliberately does NOT do:
 *      - No `Organization.logo`: the tenant's share image is an OG card, not
 *        a logo, and Google reads `logo` as the brand mark. Presenting one as
 *        the other is inventing a fact, so `logo` is simply absent until the
 *        platform has a real logo field.
 *      - No hardcoded breadcrumb root label. A literal `"Home"` would inject
 *        an English string into a Spanish page — the exact class of defect
 *        the `<html lang>` fix addressed. The root crumb is named with the
 *        tenant's own site name, and when there is no site name there is no
 *        BreadcrumbList at all.
 *      - No invented dates, ratings, prices, addresses, phone numbers or
 *        `sameAs` profiles. None of those exist in the Site/Page schema.
 *
 * 2. Never disagree with the rendered `<head>`. The `WebPage`'s `url`/`@id`
 *    come from `resolvePageCanonical` — literally the same function
 *    `buildPageMetadataFrom` builds `<link rel="canonical">` from, extracted
 *    for exactly this reason. `inLanguage` comes from the same `resolveLocale`
 *    that fills `<html lang>`. `name`/`description` resolve through the same
 *    page-then-site tiers `buildPageMetadataFrom` uses. A JSON-LD graph whose
 *    URL or language contradicts the page's own head tags is worse than no
 *    graph: Google reconciles the conflict by discarding the node.
 *
 * WHY A `@graph` AND NOT SEPARATE SCRIPTS. The nodes cross-reference each
 * other by `@id` (`WebPage.isPartOf` → `WebSite`, `WebSite.publisher` →
 * `Organization`). One `@graph` in one script lets those references resolve
 * without repeating each node's full body, and is the shape Google's own
 * structured-data documentation uses for site-wide entities.
 *
 * NOINDEX. A `noindex` page still gets its graph. `robots` governs indexing;
 * structured data on a page that is not indexed is inert, and suppressing it
 * would introduce a second, subtler divergence between what a page says and
 * what it means, for no crawler-visible benefit.
 */

import {
  resolveLocale,
  resolvePageCanonical,
  resolvePostCanonical,
  resolveShareImage,
  resolveSiteDefaults,
  resolveSiteOrigin,
} from "./seo-resolve";
import type { SeoEnv } from "./seo-resolve";
import type { StrapiPage, StrapiSite } from "./strapi-client";
import type { BlogArticleRecord } from "./blog-client";

/** What `buildJsonLdGraph` returns: a JSON-LD document, or `null` for "emit
 * nothing" (see `buildJsonLdGraph`'s three null cases). */
export type JsonLdGraph = Record<string, unknown>;

/**
 * A date string safe to emit as `datePublished`/`dateModified`, or `null`.
 *
 * Strapi supplies ISO-8601 timestamps, so this is a shape check, not a
 * conversion: the stored value is emitted VERBATIM when it parses, never
 * re-serialized through `Date.prototype.toISOString`. Re-serializing would
 * silently rewrite the tenant's own timestamp (and shift it to UTC), which is
 * the same no-re-encoding discipline `seo-resolve.ts` states for canonical
 * URLs. Never throws — `Date.parse` returns `NaN` rather than throwing for
 * unparseable input.
 */
function validDate(candidate: string | null | undefined): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

/**
 * The `Organization` and `WebSite` nodes shared by both a page's graph and a
 * post's graph (Phase 23, Plan 02, Task 1 — extracted from `buildJsonLdGraph`
 * when `buildArticleJsonLdGraph` became the second consumer). Module-private:
 * `buildJsonLdGraph` and `buildArticleJsonLdGraph` are the only two callers,
 * so the two graphs assemble their shared half through exactly one place and
 * cannot drift apart.
 *
 * Preserves every gate exactly as `buildJsonLdGraph` applied it inline before
 * this extraction: `Organization` is emitted only when a non-blank site name
 * resolves, and `WebSite` gains its `name`/`publisher` members only under
 * that same condition. Node order and key order are unchanged.
 */
function buildSiteWideNodes(
  site: StrapiSite | null | undefined,
  origin: string,
  locale: string
): {
  organizationId: string;
  websiteId: string;
  nodes: Record<string, unknown>[];
} {
  const { siteName } = resolveSiteDefaults(site);
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const nodes: Record<string, unknown>[] = [];

  // Organization — emitted only when the tenant has a name to put on it. A
  // nameless Organization node is pure noise: nothing else in the graph
  // becomes more legible for having a publisher with no identity.
  if (siteName) {
    nodes.push({
      "@type": "Organization",
      "@id": organizationId,
      name: siteName,
      url: origin,
    });
  }

  const website: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": websiteId,
    url: origin,
    inLanguage: locale,
  };
  if (siteName) {
    website.name = siteName;
    website.publisher = { "@id": organizationId };
  }
  nodes.push(website);

  return { organizationId, websiteId, nodes };
}

/**
 * Build the page's JSON-LD document, or `null` to emit no script at all.
 *
 * Three null cases, all of them "there is nothing honest to say":
 *   - no page, or an unpublished page (mirrors `buildPageMetadataFrom`'s own
 *     first guard — an unpublished page renders a 404, and a 404 must not
 *     claim to be a `WebPage`);
 *   - no resolvable origin (D-07): every `@id` in this graph is an absolute
 *     URL, and there is no absolute URL without an origin. A relative `@id`
 *     would collide across tenants;
 *   - no resolvable page name.
 *
 * `homepageSlug` is `resolveHomepageSlugFrom(pages)`, threaded through for
 * the same D-08 reason `buildPageMetadataFrom` needs it: it is what lets the
 * canonical (and therefore this graph's `@id`) collapse to the site root for
 * a homepage resolved by convention rather than by an explicit flag.
 */
export function buildJsonLdGraph(
  page: StrapiPage | null | undefined,
  site: StrapiSite | null | undefined,
  env: SeoEnv | null | undefined,
  homepageSlug?: string | null
): JsonLdGraph | null {
  if (!page || !page.publishedAt) return null;

  const origin = resolveSiteOrigin(site, env);
  if (origin === null) return null;

  const canonical = resolvePageCanonical(page, origin, homepageSlug);
  const locale = resolveLocale(site);
  const { siteName, description: siteDefaultDescription } =
    resolveSiteDefaults(site);

  // Same tiers as buildPageMetadataFrom, deliberately: page SEO title then
  // page title (no site tier — D-10's asymmetry), page description then the
  // site default then omission.
  const name = page.seo?.title?.trim() || page.title?.trim();
  if (!name) return null;
  const description = page.seo?.description?.trim() || siteDefaultDescription;

  // Resolved against the CMS host, never the site origin — the page tier
  // falling through to the site tier, exactly as og:image does.
  const image =
    resolveShareImage(page.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL) ??
    resolveShareImage(site?.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL);

  const { websiteId, nodes: siteWideNodes } = buildSiteWideNodes(
    site,
    origin,
    locale
  );
  const webPageId = `${canonical}#webpage`;

  const graph: Record<string, unknown>[] = [...siteWideNodes];

  const webPage: Record<string, unknown> = {
    "@type": "WebPage",
    "@id": webPageId,
    url: canonical,
    name,
    inLanguage: locale,
    isPartOf: { "@id": websiteId },
  };
  if (description) webPage.description = description;

  const datePublished = validDate(page.publishedAt);
  if (datePublished) webPage.datePublished = datePublished;
  const dateModified = validDate(page.updatedAt);
  if (dateModified) webPage.dateModified = dateModified;

  if (image) {
    const imageObject: Record<string, unknown> = {
      "@type": "ImageObject",
      url: image.url,
    };
    // Real dimensions only, never guessed (D-03) — resolveShareImage already
    // drops non-positive/absent sizes, so an absent key here means Strapi had
    // no dimensions, not that they were dropped in transit.
    if (image.width !== undefined) imageObject.width = image.width;
    if (image.height !== undefined) imageObject.height = image.height;
    webPage.primaryImageOfPage = imageObject;
  }

  graph.push(webPage);

  // BreadcrumbList — two crumbs, site root then this page, and ONLY for a
  // page that is not itself the root (a one-crumb breadcrumb describing the
  // page you are already on is noise Google ignores). Gated on `siteName`
  // because the root crumb has to be NAMED, and the only honest name
  // available is the tenant's own — see rule 1 in this module's header on why
  // a literal "Home" is not an option.
  if (canonical !== origin && siteName) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: siteName,
          item: origin,
        },
        {
          "@type": "ListItem",
          position: 2,
          name,
          item: canonical,
        },
      ],
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Build a published post's JSON-LD document, or `null` to emit no script at
 * all (Phase 23, Plan 02, Task 2, BLOG-09).
 *
 * D-9: `Article` REPLACES the `WebPage` node a page would emit — the rest of
 * the graph (`Organization`, `WebSite`, `BreadcrumbList`) stays, built
 * through the SAME `buildSiteWideNodes` helper `buildJsonLdGraph` uses, so
 * the two graphs cannot drift. A post's graph therefore never carries a
 * `WebPage` node, and a page's graph never carries an `Article` node.
 *
 * Same three null cases as `buildJsonLdGraph`, restated for a post: no
 * article, an article whose `publishedAt` is not a non-blank string (a 404
 * must not claim to be an `Article` any more than it may claim to be a
 * `WebPage`), no resolvable origin, or no resolvable headline.
 *
 * The canonical is resolved through `resolvePostCanonical` — the SAME
 * function the post's rendered `<link rel="canonical">` comes from
 * (`buildPostMetadataFrom`) — so this graph's `@id`/`url` can never
 * contradict the head (T-23-08).
 *
 * D-2: every degrade branch still emits a VALID `Article` node. A post with
 * no author, no image, or no parseable dates simply omits those members —
 * never `null`, `undefined`, or an empty object. Invalid structured data is
 * worse than absent structured data: a crawler penalises the former and
 * merely ignores the latter.
 */
export function buildArticleJsonLdGraph(
  article: BlogArticleRecord | null | undefined,
  site: StrapiSite | null | undefined,
  env: SeoEnv | null | undefined
): JsonLdGraph | null {
  if (!article || !article.publishedAt) return null;

  const origin = resolveSiteOrigin(site, env);
  if (origin === null) return null;

  const canonical = resolvePostCanonical(article, origin);
  const locale = resolveLocale(site);
  const { siteName, description: siteDefaultDescription } =
    resolveSiteDefaults(site);

  // Same page-tier-then-record-title asymmetry buildJsonLdGraph documents,
  // with no site tier for the headline.
  const headline = article.seo?.title?.trim() || article.title?.trim();
  if (!headline) return null;
  const description =
    article.seo?.description?.trim() || siteDefaultDescription;

  // Image tier: the post's own SEO share image first, then its featured
  // image, then the site's share image — all resolved against the CMS host,
  // never the site origin, exactly as buildJsonLdGraph resolves a page's.
  const image =
    resolveShareImage(article.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL) ??
    resolveShareImage(
      article.featuredImage,
      env?.NEXT_PUBLIC_STRAPI_URL
    ) ??
    resolveShareImage(site?.seo?.shareImage, env?.NEXT_PUBLIC_STRAPI_URL);

  const { websiteId, nodes: siteWideNodes } = buildSiteWideNodes(
    site,
    origin,
    locale
  );
  const articleId = `${canonical}#article`;

  const graph: Record<string, unknown>[] = [...siteWideNodes];

  const articleNode: Record<string, unknown> = {
    "@type": "Article",
    "@id": articleId,
    url: canonical,
    headline,
    inLanguage: locale,
    isPartOf: { "@id": websiteId },
    mainEntityOfPage: canonical,
  };
  if (description) articleNode.description = description;

  const datePublished = validDate(article.publishedAt);
  if (datePublished) articleNode.datePublished = datePublished;
  const dateModified = validDate(article.updatedAt);
  if (dateModified) articleNode.dateModified = dateModified;

  // A Person with no name is exactly the stub D-2 forbids — attach only when
  // a non-blank author name exists.
  const authorName = article.author?.name?.trim();
  if (authorName) {
    articleNode.author = { "@type": "Person", name: authorName };
  }

  if (image) {
    const imageObject: Record<string, unknown> = {
      "@type": "ImageObject",
      url: image.url,
    };
    // Real dimensions only, never guessed — resolveShareImage already drops
    // non-positive/absent sizes, so an absent key here means Strapi had no
    // dimensions, not that they were dropped in transit.
    if (image.width !== undefined) imageObject.width = image.width;
    if (image.height !== undefined) imageObject.height = image.height;
    articleNode.image = imageObject;
  }

  graph.push(articleNode);

  // BreadcrumbList — same two-crumb shape and same siteName gate
  // buildJsonLdGraph uses. Deliberately NO listing crumb (e.g. "Blog")
  // between the root and this post: naming it would require inventing a
  // literal English label string, precisely the invented-data defect this
  // module's header rejects (rule 1) — a post's own path is never the site
  // root, so the `canonical !== origin` gate is here for shape-parity with
  // buildJsonLdGraph, not because a post can ever equal the origin.
  if (canonical !== origin && siteName) {
    graph.push({
      "@type": "BreadcrumbList",
      "@id": `${canonical}#breadcrumb`,
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: siteName,
          item: origin,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: headline,
          item: canonical,
        },
      ],
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * Serialize a graph for injection into `<script type="application/ld+json">`.
 *
 * SECURITY — this is the whole reason serialization is its own exported,
 * separately-tested function rather than an inline `JSON.stringify` at the
 * JSX call site. A `<script>` element's content is raw text, NOT escaped by
 * React the way an attribute or a text child is: the only way to emit JSON-LD
 * is `dangerouslySetInnerHTML`, and inside it the HTML parser ends the script
 * at the first literal `</script`, whatever the JSON quoting says. A page
 * title, description or site name is tenant-authored Strapi content, so a
 * value containing `</script><script>…` would break out of the JSON context
 * and execute as script in every visitor's browser — stored XSS reaching
 * every page that renders it.
 *
 * `<` is therefore escaped to the six characters `\u003c`, which no HTML parser
 * can read as a tag opener while `JSON.parse` still reads it as `<`, so the
 * consumed data is byte-identical. `>` and `&` are escaped for the same
 * belt-and-braces reason Next's own metadata serializer escapes them (they
 * cannot terminate a script element on their own, but escaping them costs
 * nothing and removes any need to reason about parser edge cases such as
 * `<!--`). U+2028/U+2029 are escaped because they are literal line
 * terminators to a JavaScript parser but legal raw characters inside a JSON
 * string.
 *
 * Never throws for the objects this module builds — every value in them is a
 * string, a finite number, or a plain object/array (no cycles, no BigInt, no
 * `undefined`-only keys).
 */
export function serializeJsonLd(graph: JsonLdGraph): string {
  return JSON.stringify(graph)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
