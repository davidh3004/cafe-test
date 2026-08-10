/**
 * Shared registration-contract assertions.
 *
 * Both the positive contract test (registration-contract.test.ts) and the
 * negative proof (contract-hardfail.test.ts) run these exact assertions, so the
 * negative test proves the same logic the build gate depends on.
 *
 * Throws on the first violation, so callers can wrap it in
 * `expect(() => assertContract(...)).toThrow()`.
 */
export function assertContract(win: any, expectedName: string): void {
  const registry = win.__THETA_THEMES__ ?? {};

  // (1) Registered under the expected name at all.
  const mod = registry[expectedName];
  if (mod === undefined || mod === null) {
    throw new Error(
      `Contract violation: __THETA_THEMES__["${expectedName}"] is not defined ` +
        `(keys: ${JSON.stringify(Object.keys(registry))})`,
    );
  }

  // (2) Exactly one key — guards against a stale name copied from another
  //     theme surviving alongside the real one.
  const keys = Object.keys(registry);
  if (keys.length !== 1 || keys[0] !== expectedName) {
    throw new Error(
      `Contract violation: expected exactly one registration key ` +
        `["${expectedName}"] but found ${JSON.stringify(keys)}`,
    );
  }

  // (3) At least one section — a theme with none is useless to the platform.
  const sectionCount = Object.keys(mod.sectionsComponents ?? {}).length;
  if (sectionCount <= 0) {
    throw new Error(
      `Contract violation: "${expectedName}" registered with empty sectionsComponents`,
    );
  }

  // (4) The module's own `name` agrees with the key it registered under.
  if (mod.name !== expectedName) {
    throw new Error(
      `Contract violation: module name "${mod.name}" does not match ` +
        `registration key "${expectedName}"`,
    );
  }
}
