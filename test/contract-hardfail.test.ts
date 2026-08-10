import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";

import { assertContract } from "./contract-assertions";

// Proves the gate actually rejects. A build gate nobody has watched fail is not
// a gate — these cases feed deliberately-wrong registrations to the same
// assertions the real contract test uses, and require each to throw.

function windowWith(registry: Record<string, unknown>): any {
  const win = new JSDOM("<!doctype html><html></html>").window as any;
  win.__THETA_THEMES__ = registry;
  return win;
}

describe("registration contract rejects bad bundles", () => {
  it("rejects a bundle registered under the wrong key", () => {
    const win = windowWith({
      "some-other-theme": { name: "some-other-theme", sectionsComponents: { hero: () => null } },
    });
    expect(() => assertContract(win, "theta-theme-cafe")).toThrow(/is not defined/);
  });

  it("rejects a bundle that registered under two keys", () => {
    const win = windowWith({
      "theta-theme-cafe": { name: "theta-theme-cafe", sectionsComponents: { hero: () => null } },
      "theta-theme-cafe-old": { name: "theta-theme-cafe-old", sectionsComponents: {} },
    });
    expect(() => assertContract(win, "theta-theme-cafe")).toThrow(
      /exactly one registration key/,
    );
  });

  it("rejects a bundle with no sections", () => {
    const win = windowWith({
      "theta-theme-cafe": { name: "theta-theme-cafe", sectionsComponents: {} },
    });
    expect(() => assertContract(win, "theta-theme-cafe")).toThrow(
      /empty sectionsComponents/,
    );
  });

  it("rejects a module whose name disagrees with its key", () => {
    const win = windowWith({
      "theta-theme-cafe": { name: "wrong-name", sectionsComponents: { hero: () => null } },
    });
    expect(() => assertContract(win, "theta-theme-cafe")).toThrow(
      /does not match registration key/,
    );
  });

  it("rejects an empty registry", () => {
    expect(() => assertContract(windowWith({}), "theta-theme-cafe")).toThrow();
  });
});
