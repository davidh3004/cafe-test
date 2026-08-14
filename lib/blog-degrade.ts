/**
 * The stated blog-surface degrade (Phase 21, Plan 04, D-09/D-11/D-12).
 *
 * A live theme that declares no `article` (or no `archive`) template must
 * never produce a blank page or a crash — it must produce ONE stated result
 * carrying real, visitor-facing copy and an HTTP status. This module is that
 * one resolver.
 *
 * **The 404 status is load-bearing, not decoration.** It keeps an
 * unsupported post/archive URL OUT of the tenant's index, so Phase 23's
 * sitemap-versus-canonical byte-identical equality is never poisoned by a
 * page that states it has no content. A caller that accidentally serves this
 * result as a 200 would silently break that downstream invariant — the
 * status is therefore part of the RETURNED VALUE, not a choice left to the
 * route that renders it.
 *
 * **D-11 makes this a whole-template check made on the DECLARATION.** The
 * resolver delegates entirely to `declaresArticleSupport` /
 * `declaresArchiveSupport` (`./article-contract`) — it does not re-derive
 * that rule, so there remains exactly one definition of "does this theme
 * support posts" in the codebase. Because the check reads only the
 * manifest, the answer is available WITHOUT rendering anything.
 *
 * **A section declared but missing from the theme bundle at render time is a
 * different, pre-existing case** and is NOT this module's concern — that
 * stays `resolveSectionsForRender`'s existing warn-and-skip behaviour
 * (`section-resolver.tsx`). This resolver only ever inspects the manifest
 * declaration, never a loaded theme module or component registry.
 *
 * **Scope: this phase does not modify `app/not-found.tsx`.** That file is
 * the catch-all for EVERY 404 in this template (mistyped URLs included), so
 * putting "no blog layout yet" copy there would greet every visitor who
 * fat-fingered any URL, not only a degraded blog surface. There is also no
 * post-detail ROUTE in this phase to attach a themed 404 to (D-15 explicitly
 * rejects building a throwaway one). This module therefore delivers the
 * decision, the copy, the status and the telemetry as tested units;
 * Phase 22's post/archive routes are the first real callers that wire this
 * resolver to an actual request and response.
 */

import {
  declaresArticleSupport,
  declaresArchiveSupport,
  declaresTemplate,
  REQUIRED_SLOT_FOR_TEMPLATE,
  ARTICLE_TEMPLATE_KEY,
  type TemplateSupportManifest,
  type ReservedTemplateKey,
} from "./article-contract";

/** DIS-4: the fixed visitor-facing copy, no theme override in v1. These are
 * the ONE source of truth — Phase 22's route and every test read these
 * constants rather than retyping the strings. */
export const BLOG_UNSUPPORTED_HEADING = "Posts aren't available yet";
export const BLOG_UNSUPPORTED_BODY =
  "This site doesn't have a blog layout yet, so posts can't be shown.";

/** Which blog surface support is being resolved for. Kept as the same two
 * reserved keys the manifest declares against (D-12: independent, no
 * fallback from one to the other). */
export type BlogSurface = ReservedTemplateKey;

export type BlogSurfaceSupport =
  | { supported: true }
  | { supported: false; heading: string; body: string; status: 404 };

/**
 * DIS-5: mirrors `SectionResolutionFailureReporter`'s shape
 * (`section-resolver.tsx`) — the resolver stays PURE and takes an OPTIONAL
 * reporter callback rather than importing `seo-report.ts` directly, so a
 * caller with no real request (a unit test, a preview) never triggers
 * telemetry. `context` is boolean-only, preserving `seo-report.ts`'s
 * established no-values discipline (T-21-11): never a theme name, never a
 * manifest's content, never a CMS field value.
 */
export type BlogDegradeReporter = (
  surface: BlogSurface,
  context: Record<string, boolean>
) => void;

/**
 * Resolves whether the live theme's manifest supports `surface`. Delegates
 * entirely to `declaresArticleSupport`/`declaresArchiveSupport` (D-11/D-12)
 * — never throws on a null, undefined or malformed manifest, matching those
 * predicates' own tolerance.
 *
 * When unsupported and `report` was supplied, invokes it exactly once
 * inside its own swallowing try/catch (T-21-12) — mirroring the guarded
 * reporter calls already in `section-resolver.tsx` and `server-shell.tsx` —
 * so a telemetry failure can never turn this graceful degrade into a throw.
 */
export function resolveBlogSurfaceSupport(
  manifest: TemplateSupportManifest | null | undefined,
  surface: BlogSurface,
  report?: BlogDegradeReporter
): BlogSurfaceSupport {
  const supported =
    surface === ARTICLE_TEMPLATE_KEY
      ? declaresArticleSupport(manifest)
      : declaresArchiveSupport(manifest);

  if (supported) {
    return { supported: true };
  }

  if (report) {
    try {
      report(surface, {
        manifestPresent: manifest != null,
        declarationsPresent: Array.isArray(manifest?.templates),
        templateDeclared: declaresTemplate(manifest, surface),
        requiredSlotListed: declaresRequiredSlotListed(manifest, surface),
      });
    } catch {
      // Swallow: a telemetry failure must never escalate a graceful degrade
      // into a throw (T-21-12), matching every other reporter call site in
      // this template.
    }
  }

  return {
    supported: false,
    heading: BLOG_UNSUPPORTED_HEADING,
    body: BLOG_UNSUPPORTED_BODY,
    status: 404,
  };
}

/** Boolean-only helper for the reporter context: true only when the surface
 * has a declaration AND that declaration's `sections` lists the required
 * slot — independent of whether the whole declaration counts as supported. */
function declaresRequiredSlotListed(
  manifest: TemplateSupportManifest | null | undefined,
  surface: BlogSurface
): boolean {
  const templates = manifest?.templates;
  if (!Array.isArray(templates)) return false;
  const declaration = templates.find((t) => t?.key === surface);
  if (!declaration || !Array.isArray(declaration.sections)) return false;
  return declaration.sections.includes(REQUIRED_SLOT_FOR_TEMPLATE[surface]);
}
