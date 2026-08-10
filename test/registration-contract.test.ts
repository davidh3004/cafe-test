import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as cva from "class-variance-authority";
import * as clsx from "clsx";
import * as twMerge from "tailwind-merge";
import * as LucideReact from "lucide-react";
import { assertContract } from "./contract-assertions";

// THE BUILD GATE.
//
// Loads the freshly-built dist/theme.bundle.js inside a jsdom window with the
// externalized globals shimmed, and asserts it self-registered correctly.
// `yarn build` chains this test, so a bundle that registers under the wrong key
// fails the build instead of failing silently in a client's browser.
//
// Security: this only ever evaluates the locally-built in-repo artifact, never
// a remote or untrusted URL.

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

// Mirror vite.config's expression exactly, so this validates the real key both
// locally and under the deploy workflow (which sets THEME_NAME).
const EXPECTED_NAME: string = process.env.THEME_NAME || pkg.name;

describe("theme registration contract", () => {
  let win: any;

  beforeAll(() => {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      runScripts: "dangerously", // let the IIFE execute
    });
    win = dom.window;

    // The globals the bundle's IIFE reads on invocation. ReactDOM is named in
    // the invocation but never called during registration, so a stub is enough.
    win.React = React;
    win.ReactDOM = {};
    win.jsxRuntime = jsxRuntime;
    win.cva = cva;
    win.clsx = clsx;
    win.twMerge = twMerge;
    win.LucideReact = LucideReact;
    win.__THETA_THEMES__ = {};
    win.process = { env: { NODE_ENV: "production" } };

    win.eval(readFileSync(resolve(__dirname, "../dist/theme.bundle.js"), "utf-8"));
  });

  it("registers under the resolved theme name", () => {
    expect(win.__THETA_THEMES__[EXPECTED_NAME]).toBeDefined();
  });

  it("registers under exactly one key", () => {
    expect(Object.keys(win.__THETA_THEMES__)).toEqual([EXPECTED_NAME]);
  });

  it("has non-empty sections", () => {
    const mod = win.__THETA_THEMES__[EXPECTED_NAME];
    expect(Object.keys(mod.sectionsComponents ?? {}).length).toBeGreaterThan(0);
  });

  it("module name matches the registration key", () => {
    expect(win.__THETA_THEMES__[EXPECTED_NAME].name).toBe(EXPECTED_NAME);
  });

  it("passes the shared assertContract helper end-to-end", () => {
    expect(() => assertContract(win, EXPECTED_NAME)).not.toThrow();
  });
});
