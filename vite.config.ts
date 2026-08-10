import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));

// PascalCase IIFE global, derived from the package name so it stays in sync on
// rename. Cosmetic only — the platform reads window.__THETA_THEMES__, not this.
const iifeGlobalName = pkg.name
  .split(/[^a-zA-Z0-9]+/)
  .filter(Boolean)
  .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
  .join("");

export default defineConfig({
  define: {
    // JSON.stringify is required — `define` is a raw text substitution.
    // The deploy workflow sets THEME_NAME from the Strapi theme record so the
    // bundle registers under the same name the deployed site looks it up by.
    // Falls back to package.json for local builds.
    __THEME_NAME__: JSON.stringify(process.env.THEME_NAME || pkg.name),
    __THEME_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  publicDir: "public",
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: iifeGlobalName,
      fileName: () => "theme.bundle.js",
      formats: ["iife"],
    },
    cssCodeSplit: false,
    copyPublicDir: true,
    rollupOptions: {
      // The platform injects these as globals before loading the bundle.
      // Never bundle them — every entry here needs a matching output.globals
      // mapping to the exact global name the platform assigns.
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
        "lucide-react",
      ],
      output: {
        format: "iife",
        inlineDynamicImports: true,
        globals: {
          react: "React",
          "react-dom": "ReactDOM",
          "react/jsx-runtime": "jsxRuntime",
          "class-variance-authority": "cva",
          clsx: "clsx",
          "tailwind-merge": "twMerge",
          "lucide-react": "LucideReact",
        },
        entryFileNames: "theme.bundle.js",
        chunkFileNames: "theme.bundle.js",
        assetFileNames: "theme.bundle.[ext]",
      },
    },
  },
});
