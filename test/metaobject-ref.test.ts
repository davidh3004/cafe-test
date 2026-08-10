import { describe, it, expect } from "vitest";

import { resolveMetaobjectEntry } from "@/lib/metaobject-ref";

// Every shape the platform can hand a metaobject_ref block. Each one that is
// not usable data MUST collapse to null, so the component has exactly two
// branches instead of five.

const FIELDS = ["name", "role", "photo"] as const;

describe("resolveMetaobjectEntry", () => {
  it("returns null when nothing has been picked", () => {
    expect(resolveMetaobjectEntry(undefined, FIELDS)).toBeNull();
    expect(resolveMetaobjectEntry(null, FIELDS)).toBeNull();
    expect(resolveMetaobjectEntry("", FIELDS)).toBeNull();
  });

  it("returns null for a raw documentId string (the customizer case)", () => {
    // This is the one that crashes naive blocks: the client HAS picked someone,
    // but in the customizer the value is still just an id.
    expect(resolveMetaobjectEntry("k3f9x2mqp0", FIELDS)).toBeNull();
  });

  it("returns null for an empty object", () => {
    expect(resolveMetaobjectEntry({}, FIELDS)).toBeNull();
  });

  it("returns null when the referenced entry was deleted", () => {
    expect(resolveMetaobjectEntry({ __missing: true }, FIELDS)).toBeNull();
  });

  it("returns null for an object carrying no displayable fields", () => {
    expect(resolveMetaobjectEntry({ id: "abc", createdAt: "2026-01-01" }, FIELDS)).toBeNull();
  });

  it("returns null when every displayable field is blank", () => {
    expect(resolveMetaobjectEntry({ name: "", role: "   " }, FIELDS)).toBeNull();
  });

  it("returns null for non-object primitives", () => {
    expect(resolveMetaobjectEntry(42, FIELDS)).toBeNull();
    expect(resolveMetaobjectEntry(true, FIELDS)).toBeNull();
  });

  it("returns the entry when at least one displayable field has content", () => {
    const entry = { name: "Maria", role: "Barista" };
    expect(resolveMetaobjectEntry(entry, FIELDS)).toEqual(entry);
  });

  it("returns the entry on a partial fill", () => {
    const entry = { name: "Maria" };
    expect(resolveMetaobjectEntry(entry, FIELDS)).toEqual(entry);
  });

  it("counts a non-string field such as an image object", () => {
    const entry = { photo: { url: "https://example.test/m.jpg" } };
    expect(resolveMetaobjectEntry(entry, FIELDS)).toEqual(entry);
  });

  it("ignores fields that are not in the display list", () => {
    // `nickname` is real data but not something this block renders, so an entry
    // carrying only that is still treated as empty.
    expect(resolveMetaobjectEntry({ nickname: "Mari" }, FIELDS)).toBeNull();
  });
});
