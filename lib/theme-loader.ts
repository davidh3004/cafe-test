/**
 * Load theme bundle from URL
 * Theme bundles must expose themselves on window.__THETA_THEMES__[themeName]
 */

import React from "react";
import ReactDOM from "react-dom";
import * as jsxRuntime from "react/jsx-runtime";
import * as classVarianceAuthority from "class-variance-authority";
import * as clsxModule from "clsx";
import * as LucideReact from "lucide-react";
import * as tailwindMerge from "tailwind-merge";

export interface LoadedThemeModule {
  name: string;
  version: string;
  sectionsComponents: Record<string, React.ComponentType<Record<string, unknown>>>;
  sectionSettingsSchemas: Record<string, Array<{ id: string; label: string; type: string }>>;
  /** Theme-level reusable blocks (keyed by blockType) */
  blocksComponents?: Record<string, React.ComponentType<Record<string, unknown>>>;
  blockSettingsSchemas?: Record<string, Array<{ id: string; label: string; type: string }>>;
  /** Per-section block configuration (blocks allowed, maxBlocks, localBlocks) */
  sectionBlocksConfig?: Record<string, {
    blocks: Array<{ type: string }>;
    maxBlocks?: number;
    localBlocks?: Array<{
      type: string;
      name: string;
      component: React.ComponentType<Record<string, unknown>>;
      settings: Array<{ id: string; label: string; type: string }>;
    }>;
  }>;
}

declare global {
  interface Window {
    __THETA_THEMES__?: Record<string, LoadedThemeModule>;
  }
}

const themeCache = new Map<string, LoadedThemeModule>();
const loadingPromises = new Map<string, Promise<LoadedThemeModule>>();

/**
 * Load a theme bundle from a CDN URL
 */
export async function loadThemeFromUrl(
  url: string,
  themeName: string
): Promise<LoadedThemeModule> {
  // Check cache first
  const cached = themeCache.get(themeName);
  if (cached) {
    return cached;
  }

  // Check if already loading
  const existing = loadingPromises.get(themeName);
  if (existing) {
    return existing;
  }

  // Create loading promise
  const loadPromise = new Promise<LoadedThemeModule>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Theme loading is only supported in browser environment"));
      return;
    }

    // Initialize global namespace if needed
    window.__THETA_THEMES__ = window.__THETA_THEMES__ || {};
    // Expose React/ReactDOM/jsxRuntime/cva/clsx/twMerge/LucideReact so theme bundle (IIFE with externals) can use them.
    // Theme expects the "cva" global to be the module namespace (so bundle can use xn.cva).
    const w = window as Window & {
      React?: typeof React;
      ReactDOM?: typeof ReactDOM;
      jsxRuntime?: typeof jsxRuntime;
      cva?: typeof classVarianceAuthority;
      clsx?: typeof clsxModule;
      twMerge?: typeof tailwindMerge;
      LucideReact?: typeof LucideReact;
    };
    if (!w.React) w.React = React;
    if (!w.ReactDOM) w.ReactDOM = ReactDOM;
    if (!w.jsxRuntime) w.jsxRuntime = jsxRuntime;
    if (!w.cva) w.cva = classVarianceAuthority;
    if (!w.clsx) w.clsx = clsxModule;
    if (!w.twMerge) w.twMerge = tailwindMerge;
    if (!w.LucideReact) w.LucideReact = LucideReact;
    // Shim process.env for theme bundle (browser has no process)
    const win = window as Window & { process?: { env: Record<string, string> } };
    if (typeof win.process === "undefined") {
      win.process = { env: { NODE_ENV: "production" } };
    }

    // Create script element
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Theme load timeout: ${themeName}`));
    }, 30000); // 30 second timeout

    const cleanup = () => {
      clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };

    const onLoad = () => {
      cleanup();

      // Check if theme registered itself
      const module = window.__THETA_THEMES__?.[themeName];
      if (module) {
        themeCache.set(themeName, module);
        loadingPromises.delete(themeName);
        resolve(module);
      } else {
        reject(new Error(`Theme did not register: ${themeName}`));
      }
    };

    const onError = () => {
      cleanup();
      loadingPromises.delete(themeName);
      reject(new Error(`Failed to load theme: ${themeName}`));
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);

    // Append to document
    document.head.appendChild(script);
  });

  loadingPromises.set(themeName, loadPromise);
  return loadPromise;
}

/**
 * Get a loaded theme from cache
 */
export function getLoadedTheme(themeName: string): LoadedThemeModule | null {
  return themeCache.get(themeName) || null;
}
