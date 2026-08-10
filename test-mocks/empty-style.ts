/**
 * Test-only stand-in for `.css` imports (Phase 11 Plan 03, Task 2 infra fix).
 *
 * vitest.config.ts aliases any `.css` import to this module in tests. This
 * avoids routing CSS imports through Vite's `vite:css` plugin at all — the
 * app's `postcss.config.mjs` uses Tailwind v4's `@tailwindcss/postcss` plugin
 * as a bare string, which Next.js resolves specially but plain Vite/PostCSS
 * cannot invoke directly, causing "Invalid PostCSS Plugin" errors the moment
 * any `.css` file is transformed. CSS has no test-observable behavior in
 * render-smoke tests like `app/layout.test.tsx`, so mocking it out is correct,
 * not a workaround for a real bug.
 */
export default {};
