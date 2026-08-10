import * as React from "react";

// MenuItem — one row of the menu. A SECTION-LOCAL block: it is declared inline
// in sectionBlocksConfig["menu"].localBlocks and is not registered in the
// theme-wide block maps, so it can never be added to any other section.
//
// Blocks are leaf nodes. A block cannot contain blocks.
export interface MenuItemProps {
  name?: string;
  description?: string;
  price?: string;
  badge?: string;
  blockId?: string;
  blockType?: string;
}

// A curated enum, not free text. The client picks from a list, so the styling
// stays under the theme's control and an arbitrary value can never reach the
// DOM as markup.
const badgeLabels: Record<string, string> = {
  none: "",
  new: "New",
  popular: "Popular",
  seasonal: "Seasonal",
  decaf: "Decaf",
};

export const MenuItem = ({
  name = "Cortado",
  description = "",
  price = "",
  badge = "none",
}: MenuItemProps): React.ReactNode => {
  // Defensive lookup — an unknown badge value degrades to no badge rather
  // than crashing or rendering something unexpected.
  const badgeLabel = badgeLabels[badge] ?? "";

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-4">
      <div className="min-w-0">
        <h3 className="font-semibold text-foreground">
          {name}
          {badgeLabel && (
            <span className="ml-2 rounded-full bg-accent px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-accent-foreground">
              {badgeLabel}
            </span>
          )}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {price && (
        <span className="shrink-0 font-semibold tabular-nums text-foreground">
          {price}
        </span>
      )}
    </div>
  );
};

export const menuItemSettingsSchema = [
  {
    id: "name",
    label: "Item",
    type: "text",
    default: "Cortado",
  },
  {
    id: "description",
    label: "Description",
    type: "text",
    default: "",
  },
  {
    id: "price",
    label: "Price",
    type: "text",
    default: "",
    info: "Typed as text so you can write RD$180 or 3.50 — whatever suits.",
  },
  {
    id: "badge",
    label: "Badge",
    type: "select",
    default: "none",
    options: [
      { value: "none", label: "No badge" },
      { value: "new", label: "New" },
      { value: "popular", label: "Popular" },
      { value: "seasonal", label: "Seasonal" },
      { value: "decaf", label: "Decaf" },
    ],
  },
];
