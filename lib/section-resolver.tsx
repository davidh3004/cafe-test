/**
 * The shared render seam (Phase 13, D-01/D-02).
 *
 * Section-key normalization, block resolution, and Strapi->props conversion,
 * extracted verbatim from `page-renderer.tsx` so BOTH the server render path
 * (`app/_lib/render-page.tsx`, a Server Component) and the client render path
 * (`lib/page-renderer.tsx`, a client component marked with the framework's
 * client-boundary directive) can call the SAME functions. This module
 * deliberately carries no such directive of its own: Next.js turns every
 * import from a client-boundary module into a client reference, so a Server
 * Component physically cannot call these functions while they lived in
 * `page-renderer.tsx`. It contains JSX (it exports `BlockRenderer`) but stays
 * framework-neutral otherwise.
 *
 * This is a lift-and-move, not a redesign (13-PATTERNS.md § lib/section-resolver.ts) --
 * every function below preserves its prior behavior and name exactly.
 */

import type { LoadedThemeModule } from "./theme-loader";
import type { StrapiPage, StrapiBlock, StrapiSection } from "./strapi-client";

/** Normalize section key for lookup (lowercase, trim). */
export function normalizeSectionKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Normalize block type for lookup (lowercase, trim). */
export function normalizeBlockType(type: string): string {
  return type.trim().toLowerCase();
}

/**
 * If url is a Next.js image optimization URL (/_next/image?url=...), return the actual image URL.
 * Otherwise return the url unchanged. Ensures build/deploy always gets the real Strapi URL.
 */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (url == null || typeof url !== "string" || url.trim() === "") return url ?? null;
  if (!url.includes("_next/image")) return url;
  try {
    const idx = url.indexOf("?");
    if (idx === -1) return url;
    const params = new URLSearchParams(url.slice(idx));
    const actual = params.get("url");
    return actual ? decodeURIComponent(actual) : url;
  } catch {
    return url;
  }
}

/**
 * Resolve block component from theme module.
 * Checks blocksComponents first, then localBlocks in sectionBlocksConfig.
 */
export function getBlockComponent(
  blockType: string,
  sectionKey: string,
  themeModule: LoadedThemeModule
): React.ComponentType<Record<string, unknown>> | null {
  const blocksComponents = themeModule.blocksComponents ?? {};
  // Direct match
  if (blocksComponents[blockType]) return blocksComponents[blockType];
  const normalized = normalizeBlockType(blockType);
  const themeMatch = Object.keys(blocksComponents).find(
    (k) => normalizeBlockType(k) === normalized
  );
  if (themeMatch) return blocksComponents[themeMatch];

  // Check local blocks for this section
  const sectionConfig = themeModule.sectionBlocksConfig?.[sectionKey];
  const localBlocks = sectionConfig?.localBlocks ?? [];
  const local = localBlocks.find((l) => normalizeBlockType(l.type) === normalized);
  return local?.component ?? null;
}

/**
 * Resolve section key from page/CMS to theme's sectionsComponents key.
 * Tries exact match first, then normalized match so "header" matches "Header".
 */
export function getSectionComponentKey(
  sectionKey: string,
  sectionsComponents: Record<string, React.ComponentType<Record<string, unknown>>>
): string | null {
  if (sectionsComponents[sectionKey]) return sectionKey;
  const normalized = normalizeSectionKey(sectionKey);
  const match = Object.keys(sectionsComponents).find(
    (k) => normalizeSectionKey(k) === normalized
  );
  return match ?? null;
}

/**
 * Convert Strapi typed data to flat component props
 * Strapi stores: { title: { type: 'text', value: 'Hello' } }
 * Components expect: { title: 'Hello' }
 *
 * Handles all field types including images, videos, page references, etc.
 *
 * CR-01 (13-06 review fix): `data` is typed to allow `null`/`undefined`
 * because Strapi legitimately returns exactly that for a section added but
 * never configured -- `strapi-client.ts`'s own `mergeData`/`collectFrom`
 * helpers already guard the same field with `data ?? {}` in some places, so
 * this shape is anticipated elsewhere in this codebase. `Object.entries(data
 * ?? {})` below is defense-in-depth: even with this guard,
 * `resolveSectionsForRender`'s per-section try/catch (section-resolver.tsx)
 * is what actually bounds a resolution-time throw to one section instead of
 * the whole page -- this guard just means the common null-data case doesn't
 * need that isolation mechanism to kick in at all.
 */
export function convertStrapiDataToProps(
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  for (const [key, typedValue] of Object.entries(data ?? {})) {
    if (typedValue && typeof typedValue === "object" && "type" in typedValue && "value" in typedValue) {
      const typed = typedValue as { type: string; value: unknown };

      // Handle different field types
      switch (typed.type) {
        case "text":
        case "textarea":
        case "number":
        case "boolean":
        case "color":
        case "url":
        case "video_url":
        case "font_picker":
        case "richtext":
        case "html":
        case "text_alignment":
          // Simple types: extract value directly
          props[key] = typed.value;
          break;

        case "image": {
          // Image type: value is file ID or image object
          // Always return an object structure (never null/undefined) so theme components can safely access .url
          if (typed.value && typeof typed.value === "object") {
            const obj = typed.value as { id?: number | null; url?: string | null };
            const url = normalizeImageUrl(obj.url) ?? obj.url ?? null;
            props[key] = { ...obj, url };
          } else if (typeof typed.value === "number") {
            // Just an ID, construct image object
            props[key] = {
              id: typed.value,
              url: null, // URL will be resolved by component if needed
            };
          } else {
            // Value is null, undefined, or unexpected type - return empty object structure
            props[key] = {
              id: null,
              url: null,
            };
          }
          break;
        }

        case "video": {
          // Video type: similar to image
          // Always return an object structure (never null/undefined) so theme components can safely access .url
          if (typed.value && typeof typed.value === "object") {
            props[key] = typed.value;
          } else if (typeof typed.value === "number") {
            props[key] = {
              id: typed.value,
              url: null,
            };
          } else {
            // Value is null, undefined, or unexpected type - return empty object structure
            props[key] = {
              id: null,
              url: null,
            };
          }
          break;
        }

        case "metaobject_ref": {
          // MVP: refs are pre-resolved server-side in strapi-client.ts (push model).
          // This case is a fallback -- passes the raw documentId string to the theme.
          // TODO: When the theme has its own API client, it will receive this documentId
          // and fetch the entry data directly, removing the need for server-side resolution.
          props[key] = typed.value;
          break;
        }

        case "page_reference": {
          // Page reference: value might be string (slug) or object
          props[key] = typed.value;
          break;
        }

        case "json": {
          // JSON type: check if it's an image/video stored as JSON
          const jsonValue = typed.value;
          if (jsonValue && typeof jsonValue === "object" && !Array.isArray(jsonValue)) {
            const obj = jsonValue as Record<string, unknown>;
            // If it looks like an image/video object, normalize url so build/deploy gets real Strapi URL
            if (("id" in obj || "url" in obj) && !("slug" in obj && "title" in obj)) {
              const rawUrl = typeof obj.url === "string" ? obj.url : null;
              const url = normalizeImageUrl(rawUrl) ?? rawUrl;
              props[key] = { ...obj, url };
            } else {
              props[key] = jsonValue;
            }
          } else {
            props[key] = jsonValue;
          }
          break;
        }

        default:
          // Unknown type: try to extract value, fallback to full object
          props[key] = typed.value ?? typedValue;
      }
    } else {
      // Already flat, use as-is
      props[key] = typedValue;
    }
  }

  return props;
}

export interface BlockRendererProps {
  block: StrapiBlock;
  sectionKey: string;
  themeModule: LoadedThemeModule;
}

export function BlockRenderer({ block, sectionKey, themeModule }: BlockRendererProps) {
  const BlockComponent = getBlockComponent(block.blockType, sectionKey, themeModule);
  if (!BlockComponent) {
    console.warn(`Block component not found: ${block.blockType} (section: ${sectionKey})`);
    return (
      <div className="p-2 border border-dashed border-muted rounded text-sm text-muted-foreground">
        Block "{block.blockType}" not found in theme
      </div>
    );
  }
  const props = convertStrapiDataToProps(block.data);
  const componentProps = {
    ...props,
    blockId: block.id?.toString(),
    blockType: block.blockType,
  };
  return <BlockComponent {...componentProps} />;
}

/**
 * Sort a page's sections by `order` ascending, coercing an array-shaped
 * `page_template` (D-14) to its first element -- the same defensive
 * coercion `page-renderer.tsx` performed inline before this extraction.
 */
export function sortSectionsForRender(page: StrapiPage): StrapiSection[] {
  const template = Array.isArray(page.page_template)
    ? page.page_template[0]
    : page.page_template;
  const sections = template?.sections || [];
  return [...sections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Build the flat prop bag for one section: converted Strapi data, plus
 * `sectionId`/`sectionName` metadata, plus -- only when the section has at
 * least one block -- a `renderBlocks` function mapping the section's blocks
 * (sorted by `order` ascending) through `BlockRenderer`. Lifted verbatim from
 * `PageRenderer`'s prior inline main-branch logic (D-02: the server string
 * and the client tree must be the same markup, guaranteed by calling one
 * shared function).
 */
export function buildSectionProps(
  section: StrapiSection,
  index: number,
  themeModule: LoadedThemeModule
): Record<string, unknown> {
  const props = convertStrapiDataToProps(section.data);

  const componentProps: Record<string, unknown> = {
    ...props,
    sectionId: section.id?.toString() || `${section.sectionKey}-${index}`,
    sectionName: section.sectionKey,
  };

  const sortedBlocks = [...(section.blocks || [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  if (sortedBlocks.length > 0) {
    componentProps.renderBlocks = () =>
      sortedBlocks.map((block, blockIndex) => (
        <BlockRenderer
          key={block.id ?? `${section.sectionKey}-block-${blockIndex}`}
          block={block}
          sectionKey={section.sectionKey}
          themeModule={themeModule}
        />
      ));
  }

  return componentProps;
}

export interface ResolvedSection {
  sectionKey: string;
  index: number;
  keyForReact: string | number;
  Component: React.ComponentType<Record<string, unknown>>;
  props: Record<string, unknown>;
}

/**
 * Callback invoked (CR-01) when a section's PROPS fail to build --
 * `buildSectionProps`/`convertStrapiDataToProps` throwing on a malformed
 * `data`/`blocks` shape that the defensive guards elsewhere didn't cover --
 * as opposed to the missing-component-key skip above, which is silent by
 * design (D-12/MT-09) and never reported.
 *
 * A plain `(sectionKey, message) => void` rather than a direct dependency on
 * `reportSectionRenderFailure` (`lib/theme-evaluator.ts`): that module pulls
 * in `node:vm`, so `lib/section-resolver.tsx` -- which must stay importable
 * from BOTH the server (`app/_lib/render-page.tsx`) and the client bundle
 * (`lib/page-renderer.tsx`, a client-boundary module) -- cannot import it
 * directly without pulling `node:vm` into the browser bundle. The one
 * server-side caller (`lib/server-shell.tsx`, itself server-only) supplies a
 * closure over `reportSectionRenderFailure(themeName, ...)`; the client
 * caller passes nothing, matching today's precedent that the client path
 * reports resolution/render problems only via `console.warn`, never Sentry.
 */
export type SectionResolutionFailureReporter = (sectionKey: string, message: string) => void;

/**
 * Resolve a page's sections against a loaded theme module, in render order.
 *
 * Two independent failure modes are tolerated, each isolated to the ONE
 * section that failed -- every other section in the composition still
 * resolves:
 *   - A section whose key is absent from `themeModule.sectionsComponents` is
 *     SKIPPED (omitted from the returned array) after a `console.warn` naming
 *     the missing `sectionKey` -- the existing orphan-section behavior (D-12
 *     / MT-09): never throw, never show debug chrome to end users.
 *   - CR-01 (13-06 review fix): a section whose `buildSectionProps` call
 *     throws (malformed `data`/`blocks` that slipped past
 *     `convertStrapiDataToProps`'s own null guard) is likewise SKIPPED after
 *     a `console.warn`, and reported through `onResolutionFailure` when the
 *     caller supplied one. Before this, such a throw propagated out of this
 *     `forEach` callback entirely, aborting resolution for every section in
 *     the composition -- the exact bug this fix closes. Resolution and
 *     rendering now share the SAME isolation boundary (this function is the
 *     one seam both the server shell and the client tree call), so a
 *     resolution-time failure can never diverge between the two render
 *     paths the way two separate try/catch blocks could.
 */
export function resolveSectionsForRender(
  page: StrapiPage,
  themeModule: LoadedThemeModule,
  onResolutionFailure?: SectionResolutionFailureReporter
): ResolvedSection[] {
  const sortedSections = sortSectionsForRender(page);
  const resolved: ResolvedSection[] = [];

  sortedSections.forEach((section, index) => {
    const resolvedKey = getSectionComponentKey(
      section.sectionKey,
      themeModule.sectionsComponents
    );
    const Component = resolvedKey ? themeModule.sectionsComponents[resolvedKey] : null;

    if (!Component) {
      console.warn(`Section component not found: ${section.sectionKey}`);
      return;
    }

    try {
      resolved.push({
        sectionKey: section.sectionKey,
        index,
        keyForReact: section.id || index,
        Component,
        props: buildSectionProps(section, index, themeModule),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Section resolution failed, skipping: ${section.sectionKey}`, err);
      if (onResolutionFailure) {
        try {
          onResolutionFailure(section.sectionKey, message);
        } catch {
          // Swallow: a telemetry failure must never turn this already-
          // degraded path into a throw -- mirrors the guarded reporter calls
          // in lib/server-shell.tsx (renderResolvedSectionsToHtml,
          // buildShellHtml's own catch).
        }
      }
    }
  });

  return resolved;
}
