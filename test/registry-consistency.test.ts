import { describe, it, expect } from "vitest";

import {
  sectionsComponents,
  sectionSettingsSchemas,
  blocksComponents,
  blockSettingsSchemas,
  sectionBlocksConfig,
} from "@/registry";

// The five maps only work if their keys line up. These checks catch the single
// most common authoring mistake — adding a section to one map and forgetting
// another — at test time instead of at render time in a client's browser.

describe("registry consistency", () => {
  it("every section component has a settings schema", () => {
    expect(Object.keys(sectionsComponents).sort()).toEqual(
      Object.keys(sectionSettingsSchemas).sort(),
    );
  });

  it("every global block component has a settings schema", () => {
    expect(Object.keys(blocksComponents).sort()).toEqual(
      Object.keys(blockSettingsSchemas).sort(),
    );
  });

  it("every key in sectionBlocksConfig is a real section", () => {
    for (const key of Object.keys(sectionBlocksConfig)) {
      expect(sectionsComponents).toHaveProperty(key);
    }
  });

  it("every referenced block type resolves to a component", () => {
    for (const [sectionKey, config] of Object.entries(sectionBlocksConfig)) {
      const localTypes = (config.localBlocks ?? []).map((b) => b.type);

      for (const entry of config.blocks) {
        if (entry.type === "@theme") continue; // wildcard, resolved at runtime
        const resolvable =
          localTypes.includes(entry.type) || entry.type in blocksComponents;
        expect(
          resolvable,
          `section "${sectionKey}" allows block "${entry.type}" but nothing provides it`,
        ).toBe(true);
      }
    }
  });

  it("every local block declares a component and settings", () => {
    for (const config of Object.values(sectionBlocksConfig)) {
      for (const block of config.localBlocks ?? []) {
        expect(block.component).toBeTypeOf("function");
        expect(Array.isArray(block.settings)).toBe(true);
      }
    }
  });

  it("every setting has an id, a label and a type", () => {
    const allSchemas = [
      ...Object.values(sectionSettingsSchemas),
      ...Object.values(blockSettingsSchemas),
    ];

    for (const schema of allSchemas) {
      for (const setting of schema as Array<Record<string, unknown>>) {
        expect(typeof setting.id).toBe("string");
        expect(typeof setting.label).toBe("string");
        expect(typeof setting.type).toBe("string");
      }
    }
  });

  it("setting ids are unique within each schema", () => {
    for (const [key, schema] of Object.entries(sectionSettingsSchemas)) {
      const ids = (schema as Array<{ id: string }>).map((s) => s.id);
      expect(new Set(ids).size, `duplicate setting id in section "${key}"`).toBe(
        ids.length,
      );
    }
  });
});
