import "./index.css";
import {
  sectionsComponents,
  sectionSettingsSchemas,
  blocksComponents,
  blockSettingsSchemas,
  sectionBlocksConfig,
} from "./registry";
export * from "./registry";

// `__THEME_NAME__` / `__THEME_VERSION__` are substituted at build time from
// package.json (see vite.config.ts). The name is never hardcoded here — it has
// exactly one source of truth, and the contract test enforces that.
declare const __THEME_NAME__: string;
declare const __THEME_VERSION__: string;
const themeName = __THEME_NAME__;

(window as any).__THETA_THEMES__ = (window as any).__THETA_THEMES__ || {};
(window as any).__THETA_THEMES__[themeName] = {
  name: themeName,
  version: __THEME_VERSION__,
  sectionsComponents,
  sectionSettingsSchemas,
  blocksComponents,
  blockSettingsSchemas,
  sectionBlocksConfig,
};
