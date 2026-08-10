# theta-theme-cafe

A small Theta theme for a cafe or restaurant site. Written from scratch as a
worked example of the theme-authoring workflow — four sections, two blocks, and
every convention the platform expects.

```
theta-theme-cafe/
├── package.json          # name = the theme identity (single source of truth)
├── vite.config.ts        # IIFE library build -> dist/theme.bundle.{js,css}
├── vercel.json           # cache policy for the built bundle (see below)
├── vitest.config.ts
├── tsconfig.json
├── test/
│   ├── contract-assertions.ts        # shared registration assertions
│   ├── registration-contract.test.ts # build gate: bundle self-registers right
│   ├── contract-hardfail.test.ts     # proves the gate actually rejects
│   ├── registry-consistency.test.ts  # the five maps agree with each other
│   ├── metaobject-ref.test.ts        # every shape a reference can arrive in
│   └── vercel-headers.test.ts        # the cache policy can't silently regress
└── src/
    ├── index.ts          # registration envelope (window.__THETA_THEMES__)
    ├── index.css         # design tokens — the only place colour is defined
    ├── registry.ts       # the five maps
    ├── lib/
    │   ├── utils.ts             # cn()
    │   ├── blocks-slot.tsx      # the zero-blocks guard, shared by all sections
    │   ├── theme-image.tsx      # the defensive image_picker contract
    │   └── metaobject-ref.tsx   # the defensive metaobject_ref contract
    ├── components/ui/button.tsx
    ├── sections/  Hero · Menu · Highlights · Visit · Staff
    └── blocks/    Highlight (global) · MenuItem, StaffMember (section-local)
```

## Commands

```bash
npm install
npm run build       # vite build + contract test — this is what CI runs
npm test            # 41 tests
npm run typecheck
npm run watch       # rebuild on change, for live dev against the platform
```

`build` runs the Vite build **and then** the contract test, so a bundle that
registers under the wrong key fails the build rather than the site.

Every script uses `npm` rather than `yarn` so the same commands work on a CI
runner regardless of which package manager happens to be installed. The deploy
workflow invokes `build` directly, so a `yarn`-only script would fail *after*
successfully producing the bundle — a confusing way to break.

## Cache policy (`vercel.json`)

The platform appends `?v=<lastDeployedAt>` to every theme asset URL it renders.
A versioned URL is safe to cache forever: a rebuild produces a new URL rather
than a stale one under the same key.

But three cases reach the bundle with **no** version token — a theme that has
never been deployed, an operator-set CSS URL override, and anyone hitting the
bare path directly. So the rules are **query-gated**:

| Request | Cache-Control |
|---|---|
| `theme.bundle.js?v=…` | `max-age=31536000, immutable` |
| `theme.bundle.js` | `max-age=0, must-revalidate` |

If an un-versioned request ever received `immutable`, a visitor's browser would
pin a stale bundle **with no way for the server to recall it** — there is no
purge path for a browser cache once `immutable` is accepted. `vercel-headers.test.ts`
pins this, and includes two negative cases proving the check actually fires.

Note this file must live in the **theme's own repo**. The bundle is served from
the theme's own Vercel deployment, so the tenant site's config has no effect on
these responses.

## What each section demonstrates

| Section | Blocks | The point |
|---|---|---|
| `hero` | none | Flat settings only. Shows `image_picker` handled defensively and a `select` that changes layout. |
| `menu` | `menu-item` (local) | Repeating content via a **section-local** block — one that exists nowhere else in the theme. |
| `highlights` | `@theme` wildcard | Accepts every non-private global block, so new global blocks appear here automatically. |
| `visit` | none | A judgement call: opening hours are a `textarea` split on newlines, not seven blocks. |
| `staff` | `staff-member` (local) | **`metaobject_ref`** — content that lives in the CMS and is referenced, not typed. Also `range`, and the Tailwind dynamic-class trap. |

### Settings types deliberately not used

`richtext` and `html` are the two that need `dangerouslySetInnerHTML`. The
platform stores that HTML **raw, with no sanitization**, so a theme that renders
it must sanitize first — DOMPurify in the browser, and a string-based fallback
where there is no DOM (the server render), because DOMPurify silently no-ops
without a DOM and would pass hostile HTML straight through.

That is a real security surface, not a formatting choice. See
`theta-theme-fixocargo/src/lib/rich-text.tsx` for a worked implementation before
you add one here.

## The rules this theme follows

1. **The name lives in `package.json` and nowhere else.** `vite.config.ts` bakes
   it in as `__THEME_NAME__`; `src/index.ts` reads that constant. Never type the
   theme name into a source file.
2. **Sections and blocks are pure.** No `useState`, no event handlers, no
   fetching. Every value arrives as a prop. This is what lets the platform
   render the same tree on the server and in the browser and get the same HTML.
3. **Never touch `document`, `matchMedia` or `localStorage` during render.** The
   server-side sandbox does not provide them. If you need them, put them in a
   `useEffect`, which only ever runs in the browser.
4. **Every prop has a default.** A section renders the moment a client adds it,
   before they have typed anything.
5. **Every setting `id` is the exact prop name.** `id: "ctaLabel"` becomes
   `props.ctaLabel`. camelCase.
6. **No hex literals.** Colour comes from tokens in `index.css`, so a rebrand is
   one file.
7. **Enums, not free text, for anything that drives styling.** Icons and badges
   are `select` fields with a lookup table and a defensive fallback, so an
   unexpected value degrades instead of crashing.
8. **Blocks are leaves.** Only sections render blocks, via `renderBlocks()`. A
   block can never contain another block.

## Adding a section

1. `src/sections/MySection/MySection.tsx` — export the component and
   `mySectionSettingsSchema`.
2. `src/sections/MySection/index.ts` — `export * from "./MySection";`
3. Register it in `src/registry.ts`, in **both** `sectionsComponents` and
   `sectionSettingsSchemas`, under the same key.
4. If it takes children, add a `sectionBlocksConfig` entry.
5. `npx vitest run` — `registry-consistency.test.ts` will tell you if you missed
   a map.

## Rebranding

Edit the token block at the top of `src/index.css`. Six values control the
entire theme. Nothing else needs to change.
