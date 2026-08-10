/**
 * Ambient declarations for the four `next/dist/compiled/*` React entry points
 * that `lib/ssr-react-runtime.ts` imports.
 *
 * Next ships those copies as prebuilt JavaScript with NO `.d.ts` alongside
 * them, so TypeScript cannot resolve them on its own. The tenant build
 * type-checks (`templates/theme-site/next.config.ts` deliberately sets no
 * `typescript.ignoreBuildErrors`), so without this shim every import in
 * `ssr-react-runtime.ts` fails the build with TS7016.
 *
 * Each module is declared as a re-export of the corresponding PUBLIC package's
 * types. That is accurate rather than a convenient lie: Next's compiled copies
 * are bundles of the very same React release the public packages describe (both
 * report `19.2.0-canary-3fbfb9ba-20250409` in the pinned Next 15.3.8), so their
 * runtime surface matches `@types/react` / `@types/react-dom`. Declaring them
 * `any` would silence TS7016 just as effectively while discarding every
 * call-site type check in `ssr-react-runtime.ts` — including the ones that
 * would catch a genuine React API change on the next Next upgrade.
 *
 * `import X = require("...")` is the canonical way to alias a module whose
 * types use `export =` (which is how `@types/react` declares itself);
 * `export * from` is correct for the other three, which use named exports.
 *
 * WHY THIS FILE LIVES UNDER `lib/`: `TemplateCopyService.shouldPreserveFile`
 * force-copies every `lib/` file into a tenant repo on every sync, whereas a
 * file anywhere else is written once and then preserved forever. A shim that
 * can go stale in a tenant repo while `lib/ssr-react-runtime.ts` around it is
 * updated is exactly the split-template build break that `lib/live-resolve.ts`
 * already caused once.
 */

declare module "next/dist/compiled/react" {
  import React = require("react");
  export = React;
}

declare module "next/dist/compiled/react/jsx-runtime" {
  export * from "react/jsx-runtime";
}

declare module "next/dist/compiled/react-dom" {
  export * from "react-dom";
}

declare module "next/dist/compiled/react-dom/server" {
  export * from "react-dom/server";
}
