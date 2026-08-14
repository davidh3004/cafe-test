/**
 * The published theme-facing article contract (Phase 21, Plan 01 Task 1/2).
 *
 * Mirrored twin: `lib/theme-contract/article-contract.ts` (platform). The
 * two are separate Next.js apps — `lib/services/template-copy.service.ts`
 * copies THIS directory (`templates/theme-site/`) STANDALONE into each
 * tenant repo, so an import across that boundary is physically impossible.
 * Change one, change both — a divergence between the two mirrors is caught
 * by `__tests__/lib/theme-contract/mirror-drift.test.ts`, not left to
 * discover in production.
 *
 * This mirror additionally exports the BUILDER functions (`buildArticleProp`,
 * `buildArchiveProp`) and `SectionRecordProps` — the platform mirror
 * publishes only the shape, this mirror is where a `StrapiArticle`-shaped
 * read result is turned into the published `ArticleProp`.
 *
 * Reversibility (21-CONTEXT.md D-06): the `article`/`archive` prop shape is
 * a ONE-WAY contract. Theme code lives in repos the platform does not own;
 * once a theme is built against a field name, removing or renaming it
 * breaks that theme in the field with no platform-side migration path.
 *
 * Decision record: Phase 21 Plan 01 Task 1 (checkpoint:decision) confirmed
 * this exact shape — option `approve-as-proposed` — with no divergence from
 * `<planner_decisions>` DIS-1/DIS-2/DIS-3/DIS-6. See
 * `.planning/phases/21-theme-article-template-contract/21-01-SUMMARY.md`.
 */

import { deriveExcerpt } from "./derive-excerpt";

/**
 * The CMS origin a relative Strapi media path is resolved against.
 *
 * Read at module scope from the SAME env var `strapi-client.ts` derives its
 * GraphQL endpoint from, so a tenant whose CMS is reachable has reachable
 * media by construction — never a second, independently-configured base.
 */
const MEDIA_BASE_URL = (process.env.NEXT_PUBLIC_STRAPI_URL ?? "").trim().replace(/\/+$/, "");

/**
 * Resolve a Strapi media url to an ABSOLUTE CMS url.
 *
 * Strapi's DEFAULT local-disk upload provider stores media urls relative to
 * the CMS (`/uploads/cover.jpg`), and no tenant currently runs an S3/R2
 * bucket (`project-theta-strapi/src/utils/upload-provider.ts` engages the S3
 * provider only when `S3_BUCKET` is set). A relative url handed to a theme is
 * rendered as `<img src="/uploads/cover.jpg">` and resolves against the
 * TENANT's origin, not the CMS — so every featured image 404s and the card
 * paints an empty box.
 *
 * This is the SAME trap `resolveShareImage` documents for `og:image`
 * (`seo-resolve.ts`, T-14-10) and `absolutizeFormatUrls` documents for
 * `srcset` variants (`strapi-client.ts`). Both of those seams already
 * absolutize; the theme-facing `article` prop was the one path that did not,
 * which is why a post's JSON-LD image was absolute while the image a visitor
 * actually saw was relative.
 *
 * Normalized HERE, inside `buildArticleProp`, because this function is the
 * ONLY builder permitted to produce a theme-facing article value — one seam
 * covers the post, archive and related-posts paths at once. Fixing it in the
 * theme instead would have to land in every theme repo (they cannot import
 * from this one) and no theme can know the CMS origin anyway.
 *
 * An ALREADY-absolute url is returned byte-identical: a cloud upload provider
 * stores absolute urls, and re-prefixing would corrupt them. An unset base
 * degrades to the url unchanged rather than emitting a malformed absolute
 * url — the same fail-open posture every other read in this app takes.
 */
export function absolutizeMediaUrl(url: string, baseUrl: string = MEDIA_BASE_URL): string {
  if (typeof url !== "string" || url.trim() === "") return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  // Trimmed HERE, not only on the module-scope default: a caller-injected
  // base is just as likely to carry a trailing slash, and joining it to a
  // leading-slash url would emit `https://cms//uploads/x.jpg`.
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) return url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

// ---- Reserved keys (DIS-1) ----

/** The manifest `templates[]` key for a single-post template. */
export const ARTICLE_TEMPLATE_KEY = "article" as const;

/** The manifest `templates[]` key for the one listing template that covers
 * `/blog`, category archives and tag archives (21-CONTEXT.md D-03). */
export const ARCHIVE_TEMPLATE_KEY = "archive" as const;

/** The reserved section key a theme registers as the prose slot inside an
 * `article` template (D-05). */
export const ARTICLE_BODY_SECTION_KEY = "article-body" as const;

/** The reserved section key a theme registers as the post-list slot inside
 * an `archive` template. */
export const ARCHIVE_LIST_SECTION_KEY = "archive-list" as const;

/** Reserved-key matching is exact, case-sensitive `===` against these ASCII
 * literals — no trimming, no case folding, no Unicode normalization. */
export const RESERVED_TEMPLATE_KEYS = [ARTICLE_TEMPLATE_KEY, ARCHIVE_TEMPLATE_KEY] as const;

export type ReservedTemplateKey = (typeof RESERVED_TEMPLATE_KEYS)[number];

/**
 * DIS-2: template declarations ride the EXISTING `ThemeSectionsManifest.version`
 * string — no second manifest version field. This constant versions ONLY the
 * `article`/`archive` PROP contract below, independently, as a platform-owned
 * integer. Additive fields do not bump it; a removed or renamed field does.
 * Themes never declare it.
 */
export const THEME_ARTICLE_CONTRACT_VERSION = 1;

// ---- Manifest template declaration (DIS-1) ----

/**
 * One entry of `ThemeSectionsManifest.templates[]`. `sections` is REQUIRED
 * — it names the theme's OWN manifest-declared section keys that
 * pre-populate this template at seed time (21-02).
 */
export interface ThemeTemplateDeclaration {
  key: ReservedTemplateKey;
  name: string;
  description?: string;
  sections: string[];
}

// ---- The `article` prop (DIS-3) ----

/**
 * Exactly eleven fields, all required, none ever `undefined`. Empty values
 * are expressed as `""` / `null` / `[]` so a theme never needs an
 * optional-chaining guard. `featuredImage` deliberately omits alt text in
 * v1 — the reference theme falls back to `article.title` as the alt text.
 */
export interface ArticleProp {
  documentId: string;
  title: string;
  slug: string;
  body: string;
  excerpt: string;
  featuredImage: { url: string; width: number | null; height: number | null } | null;
  category: { name: string; slug: string; description: string | null } | null;
  tags: Array<{ name: string; slug: string; description: string | null }>;
  author: { name: string; avatarUrl: string | null } | null;
  publishedAt: string | null;
  updatedAt: string | null;
}

/**
 * Runtime constant listing `ArticleProp`'s keys, in declaration order — the
 * mechanical guard that makes "exactly these fields, no more, no fewer"
 * checkable by a test rather than aspirational prose.
 */
export const ARTICLE_PROP_FIELDS: readonly string[] = [
  "documentId",
  "title",
  "slug",
  "body",
  "excerpt",
  "featuredImage",
  "category",
  "tags",
  "author",
  "publishedAt",
  "updatedAt",
];

// ---- The `archive` prop (DIS-6) ----

/**
 * `posts` reuses the SAME `ArticleProp` shape per post — one published
 * contract, not two. `term` is always an object (`kind: "all"`, `name: ""`
 * for the blog index) rather than nullable.
 */
export interface ArchiveProp {
  posts: ArticleProp[];
  term: { kind: "all" | "category" | "tag"; name: string; description: string | null };
  page: { current: number; pageSize: number; pageCount: number; total: number };
}

export const ARCHIVE_PROP_FIELDS: readonly string[] = ["posts", "term", "page"];

// ---- D-11/D-12: whole-template support check + reserved-key resolution
// (Phase 21, Plan 02 Task 2) ----

/**
 * Loosely-typed manifest input for the predicates below — structurally
 * compatible with `services/types.ts`'s `ThemeSectionsManifest` (this mirror
 * lives in a standalone app with no import path to `services/`, matching the
 * platform mirror's own "publishes the contract, doesn't own the Strapi
 * read/write surface" discipline).
 */
export interface TemplateSupportManifest {
  sections?: Array<{ key: string; name?: string; description?: string; icon?: string }>;
  templates?: ThemeTemplateDeclaration[];
  version?: string;
}

/**
 * The section slot key that makes each reserved template key count as
 * "supported" — D-11's whole-template check, and D-12's identical
 * archive-side rule. A fixed platform rule, not configuration.
 */
export const REQUIRED_SLOT_FOR_TEMPLATE: Readonly<Record<ReservedTemplateKey, string>> =
  Object.freeze({
    [ARTICLE_TEMPLATE_KEY]: ARTICLE_BODY_SECTION_KEY,
    [ARCHIVE_TEMPLATE_KEY]: ARCHIVE_LIST_SECTION_KEY,
  });

/**
 * True when `manifest.templates` contains an entry keyed EXACTLY `key`.
 * Reserved-key matching is case-sensitive `===` — no trimming, case
 * folding or Unicode normalization (see RESERVED_TEMPLATE_KEYS above).
 * Tolerates a null/undefined/malformed manifest by returning `false` rather
 * than throwing — a theme with no `theta.config.json` is the day-one
 * default, not an error state.
 */
export function declaresTemplate(
  manifest: TemplateSupportManifest | null | undefined,
  key: ReservedTemplateKey
): boolean {
  const templates = manifest?.templates;
  if (!Array.isArray(templates)) return false;
  return templates.some((t) => t?.key === key);
}

/**
 * D-11's whole-template check, shared by `declaresArticleSupport` and
 * `declaresArchiveSupport` via one predicate parameterised by key — not two
 * divergent copies. Made ONLY on the DECLARATION: true when a `key`
 * declaration exists AND its `sections` array contains the reserved slot
 * that makes it count as supported. It never inspects a theme module, a
 * rendered tree or a component registry — that's what makes criterion 4
 * statically decidable. Rejected alternative: a per-section "render what
 * resolves" degrade, which would let a post render its chrome with the
 * prose silently missing — it looks correct and is empty, and tells nobody.
 */
function declaresTemplateSupport(
  manifest: TemplateSupportManifest | null | undefined,
  key: ReservedTemplateKey
): boolean {
  const templates = manifest?.templates;
  if (!Array.isArray(templates)) return false;
  const declaration = templates.find((t) => t?.key === key);
  if (!declaration || !Array.isArray(declaration.sections)) return false;
  const requiredSlot = REQUIRED_SLOT_FOR_TEMPLATE[key];
  return declaration.sections.includes(requiredSlot);
}

/** D-11: true only when the manifest declares an `article` template AND its
 * `sections` includes the article-body slot key. */
export function declaresArticleSupport(
  manifest: TemplateSupportManifest | null | undefined
): boolean {
  return declaresTemplateSupport(manifest, ARTICLE_TEMPLATE_KEY);
}

/** D-12: the IDENTICAL rule against the archive-side slot, evaluated
 * completely independently of `declaresArticleSupport` — a theme may
 * support one and not the other, and neither falls back to the other. */
export function declaresArchiveSupport(
  manifest: TemplateSupportManifest | null | undefined
): boolean {
  return declaresTemplateSupport(manifest, ARCHIVE_TEMPLATE_KEY);
}

/**
 * Derives a NEW template's seed sections from the intersection of the
 * theme's OWN manifest-declared sections and the named template
 * declaration's `sections` list, in the DECLARATION's order. A declaration
 * naming a section the theme does not declare contributes nothing for that
 * name — `seedSectionsFromManifest`'s existing invariant (a seeded section
 * can never be a key the manifest did not declare) is enforced by narrowing
 * the INPUT here, not by narrowing that function's output. Tolerates a
 * null/undefined/malformed manifest by returning an empty section list.
 */
export function sectionsForTemplate(
  manifest: TemplateSupportManifest | null | undefined,
  key: ReservedTemplateKey
): {
  sections: Array<{ key: string; name: string; description?: string; icon?: string }>;
  version: string;
} {
  const themeSections = manifest?.sections;
  const templates = manifest?.templates;
  const declaration = Array.isArray(templates)
    ? templates.find((t) => t?.key === key)
    : undefined;

  if (
    !Array.isArray(themeSections) ||
    !declaration ||
    !Array.isArray(declaration.sections)
  ) {
    return { sections: [], version: manifest?.version ?? "" };
  }

  const byKey = new Map(
    themeSections
      .filter((s): s is { key: string; name: string; description?: string; icon?: string } =>
        Boolean(s && typeof s.key === "string")
      )
      .map((s) => [s.key, s])
  );

  const sections = declaration.sections
    .filter((name) => byKey.has(name))
    .map((name) => byKey.get(name)!);

  return { sections, version: manifest?.version ?? "" };
}

/**
 * D-01's reserved-key resolution — mirrors `resolvePageForLiveTheme`'s shape
 * (`templates/theme-site/lib/live-resolve.ts`): accept the FULL, unfiltered
 * template list, narrow in JS by theme document id first and reserved key
 * second, return `null` on no match. A `null` return is the degrade signal
 * 21-04 consumes; an inline GraphQL relation filter is never trusted as
 * authoritative here, matching that module's own comment.
 */
export function resolveTemplateByKey<
  T extends { key?: string | null; theme?: { documentId?: string | null } | null }
>(
  templates: T[] | null | undefined,
  themeDocumentId: string,
  key: ReservedTemplateKey
): T | null {
  if (!Array.isArray(templates)) return null;
  const match = templates.find(
    (t) => t?.theme?.documentId === themeDocumentId && t?.key === key
  );
  return match ?? null;
}

// ---- Record props threaded through the shared render seam (D-16) ----

/**
 * The optional trailing argument `buildSectionProps`/`resolveSectionsForRender`
 * accept (`section-resolver.tsx`). Absent members mean "this page composition
 * carries no post" — a page-template caller passes nothing, so its returned
 * prop bag stays byte-identical to today's.
 *
 * `relatedPosts` (Phase 23, Plan 04, Task 3, BLOG-10/D-4): a post's
 * taxonomy-derived related-post list rides THIS seam, not a twelfth
 * `ArticleProp` field, because a related list is additional context for the
 * page — not a twelfth attribute of the article record. Reuses `ArticleProp`
 * per item (one published contract, not two). Declared ONLY in this
 * theme-site mirror — the platform mirror (`lib/theme-contract/article-contract.ts`)
 * declares no `SectionRecordProps` at all, so this additive change touches
 * exactly one file and requires no mirror update; `mirror-drift.test.ts`
 * asserts on the prop field constants and support predicates and never on
 * `SectionRecordProps`, which is what makes this change provably safe
 * against the D-4/D-12 contract freeze (`ArticleProp` stays eleven fields,
 * `THEME_ARTICLE_CONTRACT_VERSION` stays `1`).
 */
export interface SectionRecordProps {
  article?: ArticleProp | null;
  archive?: ArchiveProp | null;
  relatedPosts?: ArticleProp[] | null;
}

// ---- Building the `article` prop from a Strapi read result ----

/**
 * The read shape `buildArticleProp` accepts — structurally identical to
 * `services/types.ts`'s `StrapiArticle` (platform), duplicated here because
 * this file lives in a standalone app with no import path to `lib/` (see
 * this file's header). Every member the platform's `StrapiArticle` selects
 * is represented; optional/nullable exactly where the platform type allows.
 */
export interface ArticleSourceRecord {
  documentId: string;
  title: string;
  slug: string;
  body?: string | null;
  excerpt?: string | null;
  featuredImage?: { url: string; width?: number | null; height?: number | null } | null;
  category?: { name: string; slug: string; description?: string | null } | null;
  tags?: Array<{ name: string; slug: string; description?: string | null }> | null;
  author?: { name: string; avatar?: { url: string } | null } | null;
  publishedAt?: string | null;
  updatedAt?: string | null;
}

/**
 * Hand-picks each field off `article` — never spreads the source object, so
 * a future `StrapiArticle` relation cannot leak into the published prop
 * unreviewed (T-21-02). Absent scalars coerce to `""` for
 * `body`/`title`/`slug`, `null` for `publishedAt`/`updatedAt`/`featuredImage`/
 * `category`/`author`, and `[]` for `tags` — never `undefined` anywhere in
 * the returned object graph.
 *
 * Excerpt resolution (DIS-7, completed in Task 3): the stored `excerpt`
 * trimmed when non-empty; else `deriveExcerpt(body)` when the body is
 * non-empty; else `""`. Every theme therefore receives the same excerpt —
 * no theme reimplements the derivation.
 *
 * Media resolution: `featuredImage.url` and `author.avatarUrl` are resolved
 * to ABSOLUTE CMS urls (see `absolutizeMediaUrl`). `baseUrl` defaults to the
 * module-scope CMS origin so no call site can forget to pass it — the
 * omission that made every featured image 404 in the first place — and is
 * injectable only so tests can pin a base without touching `process.env`.
 */
export function buildArticleProp(
  article: ArticleSourceRecord,
  baseUrl: string = MEDIA_BASE_URL
): ArticleProp {
  const body = typeof article.body === "string" ? article.body : "";
  const storedExcerpt = typeof article.excerpt === "string" ? article.excerpt.trim() : "";
  const excerpt = storedExcerpt !== "" ? storedExcerpt : body !== "" ? deriveExcerpt(body) : "";

  return {
    documentId: article.documentId,
    title: article.title ?? "",
    slug: article.slug ?? "",
    body,
    excerpt,
    // Absolutized BEFORE it reaches any theme — see absolutizeMediaUrl.
    featuredImage: article.featuredImage
      ? {
          url: absolutizeMediaUrl(article.featuredImage.url, baseUrl),
          width: article.featuredImage.width ?? null,
          height: article.featuredImage.height ?? null,
        }
      : null,
    category: article.category
      ? {
          name: article.category.name,
          slug: article.category.slug,
          description: article.category.description ?? null,
        }
      : null,
    tags: (article.tags ?? []).map((tag) => ({
      name: tag.name,
      slug: tag.slug,
      description: tag.description ?? null,
    })),
    // `avatarUrl` carries the identical relative-path defect and is
    // absolutized through the identical seam — never one without the other.
    author: article.author
      ? {
          name: article.author.name,
          avatarUrl: article.author.avatar?.url
            ? absolutizeMediaUrl(article.author.avatar.url, baseUrl)
            : null,
        }
      : null,
    publishedAt: article.publishedAt ?? null,
    updatedAt: article.updatedAt ?? null,
  };
}

/**
 * Builds the `archive` prop from an already-resolved post list and term/page
 * state (Phase 22 populates the real connection query; this phase defines,
 * injects and unit-tests the shape only, per `<planner_decisions>` DIS-6).
 */
export function buildArchiveProp(
  args: {
    posts: ArticleSourceRecord[];
    term: { kind: "all" | "category" | "tag"; name: string; description: string | null };
    page: { current: number; pageSize: number; pageCount: number; total: number };
  },
  baseUrl: string = MEDIA_BASE_URL
): ArchiveProp {
  return {
    posts: args.posts.map((post) => buildArticleProp(post, baseUrl)),
    term: args.term,
    page: args.page,
  };
}
