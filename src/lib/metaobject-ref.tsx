import * as React from "react";

/**
 * The `metaobject_ref` defensive contract.
 *
 * A metaobject reference is the one setting type that arrives in genuinely
 * different shapes depending on WHERE the component is rendering:
 *
 *   | Context                        | What `entry` is                    |
 *   |--------------------------------|------------------------------------|
 *   | Customizer, nothing picked yet | `undefined` or `{}`                |
 *   | Customizer, entry picked       | a raw documentId **string**        |
 *   | Published site, entry resolved | the full object `{ name, role, … }`|
 *   | Published site, entry deleted  | `{ __missing: true }`              |
 *
 * A block that assumes the object shape will crash in the customizer the moment
 * a client picks an entry — because there it is still just a string. That is
 * the single most common way a metaobject block breaks.
 *
 * `resolveMetaobjectEntry` collapses all the unusable shapes to `null`, so a
 * component only ever has two branches: render the entry, or render a
 * placeholder.
 */
export type MetaobjectEntry = Record<string, unknown> & { __missing?: boolean };

export function resolveMetaobjectEntry<T extends Record<string, unknown>>(
  entry: unknown,
  displayFields: ReadonlyArray<string>,
): T | null {
  // undefined / null / "" — nothing picked.
  if (!entry) return null;

  // A raw documentId. The customizer has not resolved it to data yet.
  if (typeof entry === "string") return null;

  if (typeof entry !== "object") return null;

  const candidate = entry as MetaobjectEntry;

  // The platform marks a reference whose target was deleted.
  if (candidate.__missing === true) return null;

  // An object with none of the fields we would display is not worth rendering
  // — treat `{}` and `{ id: "…" }` the same as nothing.
  const hasSomethingToShow = displayFields.some((field) => {
    const value = candidate[field];
    if (typeof value === "string") return value.trim().length > 0;
    return value != null;
  });

  return hasSomethingToShow ? (candidate as unknown as T) : null;
}

export interface MetaobjectPlaceholderProps {
  label?: string;
}

// What a client sees in the customizer before they have picked an entry, and
// what a visitor sees if the entry behind a block was deleted. Quiet on
// purpose — never an error message, never a stack trace.
export const MetaobjectPlaceholder = ({
  label = "Nothing selected",
}: MetaobjectPlaceholderProps): React.ReactNode => (
  <div className="flex min-h-40 items-center justify-center rounded-[var(--radius)] border border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground">
    {label}
  </div>
);
