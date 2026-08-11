/**
 * Rendered-head-tag test harness (Phase 14, Plan 06; extended Plan 07 with a
 * sitemap-XML export).
 *
 * WHY THIS EXISTS: Phase 14's two UAT gaps, G-14-4 (`og:site_name` missing on
 * every page) and G-14-5 (a sitemap `<loc>` disagreeing with its own
 * canonical tag), were BOTH invisible to the 653 pure-resolver unit tests
 * that existed before this plan. Every builder in `seo-resolve.ts` is
 * individually correct — the loss only happens once Next COMPOSES layout and
 * page metadata (deep-merge vs. wholesale replace) and RENDERS it into tags
 * (URL normalization against `trailingSlash`). That composition and
 * rendering layer is exactly what this module exercises, by driving Next's
 * OWN shipped resolvers and tag generators — never a local re-implementation
 * of Next's merge or URL-normalization rules. A hand-rolled model of those
 * rules would only ever assert our belief about Next's behavior, which is
 * precisely the blind spot that let both gaps ship.
 *
 * `renderSitemapXml` (Plan 07) is the second half of the G-14-5 proof:
 * it delegates to Next's OWN `resolveSitemap` — the exact function Next uses
 * to serialize a `sitemap.ts` module's return value into the served
 * `sitemap.xml` document — rather than hand-assembling XML. `resolveSitemap`
 * interpolates each entry's `url` into `<loc>` completely verbatim, applying
 * NO URL normalization of its own; that asymmetry against Next's canonical
 * normalizer (which DOES collapse a root URL under `trailingSlash: false`)
 * is exactly what gap G-14-5 was. A local XML serializer here would
 * re-introduce the identical "test asserts our model, not the framework"
 * blind spot this harness exists to remove.
 *
 * `resolveComposedTitle` (Phase 15, Plan 03) closes RESEARCH assumption A2 /
 * Pitfall 4: whether the root layout's `title.template` actually reaches a
 * leaf page's plain-string `title` in THIS template's real two-segment route
 * tree (root layout + leaf page, no intermediate layout) cannot be settled
 * by a single static read of `accumulateMetadata`'s "skip the last two
 * items" loop condition — that condition is genuinely ambiguous for a
 * two-item array, and Phase 14 already shipped two real bugs (G-14-4,
 * G-14-5) by trusting exactly that kind of read. `resolveComposedTitle`
 * drives Next's own `resolveTitle` twice — once for the root layout title
 * (with no stashed template, matching the root of the accumulation chain),
 * then for the leaf page title (stashing the FIRST call's resolved
 * `template`, exactly how Next's own metadata accumulation threads a
 * template down to a child segment) — and returns the leaf's resolved
 * `absolute` string. No `%s` substitution is hand-rolled anywhere in this
 * file; `resolveTitleTemplate`'s literal global replace, called internally
 * by `resolveTitle`, is the only thing that ever performs the substitution.
 *
 * `templates/theme-site/package.json` pins `next` to an EXACT version (no
 * caret), so the internal module paths imported below are stable for that
 * pinned version. If a Next upgrade moves or renames any of them, the
 * correct response is to re-point these imports at the new location —
 * NEVER to replace them with a hand-written approximation of Next's
 * behavior. That would silently reintroduce the exact blind spot this file
 * exists to close.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  resolveOpenGraph,
  resolveTwitter,
} from "next/dist/lib/metadata/resolvers/resolve-opengraph";
import { resolveAlternates } from "next/dist/lib/metadata/resolvers/resolve-basics";
import { OpenGraphMetadata, TwitterMetadata } from "next/dist/lib/metadata/generate/opengraph";
import { AlternatesMetadata } from "next/dist/lib/metadata/generate/alternate";
import { resolveSitemap } from "next/dist/build/webpack/loaders/metadata/resolve-route-data";
import { resolveTitle } from "next/dist/lib/metadata/resolvers/resolve-title";
import type { MetadataContext } from "next/dist/lib/metadata/types/resolvers";
import type { Metadata, MetadataRoute } from "next";
import nextConfig from "../../../next.config";

export interface RenderHeadTagsOptions {
  pathname: string;
}

/**
 * Composes a Next `Metadata` object through Next's own shipped
 * `resolveOpenGraph` / `resolveTwitter` / `resolveAlternates` resolvers and
 * renders the result through Next's own `OpenGraphMetadata` /
 * `TwitterMetadata` / `AlternatesMetadata` tag generators, returning the
 * rendered head markup as a string.
 *
 * `trailingSlash` is read from the template's own `next.config` default
 * export, defaulting to `false` only when the key is absent — never
 * hardcoded. This is load-bearing: Next's URL normalizer branches on
 * `trailingSlash`, so if that config value ever changes, these tests
 * re-evaluate against the new behavior and fail loudly instead of asserting
 * stale semantics.
 */
export function renderHeadTags(
  metadata: Metadata,
  options: RenderHeadTagsOptions
): string {
  const metadataContext: MetadataContext = {
    pathname: options.pathname,
    trailingSlash: nextConfig.trailingSlash ?? false,
    isStaticMetadataRouteFile: false,
  };

  const metadataBase = metadata.metadataBase ?? null;

  const resolvedAlternates = resolveAlternates(
    metadata.alternates,
    metadataBase,
    metadataContext
  );
  const resolvedOpenGraph = resolveOpenGraph(
    metadata.openGraph,
    metadataBase,
    metadataContext,
    null
  );
  const resolvedTwitter = resolveTwitter(
    metadata.twitter,
    metadataBase,
    metadataContext,
    null
  );

  const markup = React.createElement(
    React.Fragment,
    null,
    AlternatesMetadata({ alternates: resolvedAlternates }),
    OpenGraphMetadata({ openGraph: resolvedOpenGraph }),
    TwitterMetadata({ twitter: resolvedTwitter })
  );

  return renderToStaticMarkup(markup);
}

/**
 * Serializes a `MetadataRoute.Sitemap` array into the served `sitemap.xml`
 * document, by delegating to Next's OWN `resolveSitemap` — the exact
 * function Next's build pipeline uses to turn a `sitemap.ts` module's return
 * value into the response body a crawler receives. `resolveSitemap`
 * interpolates each entry's `url` into `<loc>` completely verbatim, with no
 * URL normalization of its own (see this module's header comment) — the
 * asymmetry against `renderHeadTags`'s canonical normalization is exactly
 * what gap G-14-5 was.
 */
export function renderSitemapXml(entries: MetadataRoute.Sitemap): string {
  return resolveSitemap(entries);
}

/**
 * Composes a root layout's `title` value with a leaf page's `title` value in
 * a two-segment route tree, through Next's OWN `resolveTitle` — never a
 * hand-rolled `%s` substitution (see this module's header comment). Returns
 * the leaf's fully resolved title string, exactly what Next renders into
 * `<title>`.
 *
 * Mirrors how Next's real metadata accumulation threads a template down the
 * route tree: the root call passes `stashedTemplate: null` (nothing has
 * accumulated yet), and the resolved `template` from THAT call is stashed
 * into the leaf call — which is the only way `resolveTitle`'s second
 * parameter is ever populated in the real accumulation chain. If
 * `resolveTitle`'s call shape at the pinned Next version ever changes, this
 * function is repointed at the new shape — never approximated.
 */
export function resolveComposedTitle(
  layoutTitle: Metadata["title"],
  pageTitle: Metadata["title"]
): string {
  const resolvedLayout = resolveTitle(layoutTitle, null);
  const resolvedLeaf = resolveTitle(pageTitle, resolvedLayout.template);
  return resolvedLeaf.absolute;
}
