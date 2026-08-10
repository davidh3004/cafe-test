import * as React from "react";

import { Coffee, Croissant, Leaf, Wifi, Clock, Heart } from "lucide-react";

// Highlight — a GLOBAL block. It is registered in blocksComponents /
// blockSettingsSchemas, so any section whose config includes `@theme` (or names
// it explicitly) can use it. Prefix a block type with `_` to keep it out of the
// `@theme` wildcard while still allowing explicit references.
export interface HighlightProps {
  icon?: string;
  title?: string;
  body?: string;
  blockId?: string;
  blockType?: string;
}

// Enum value -> Lucide component. A lookup table, never a dynamic component
// name built from client input.
const iconMap: Record<string, React.FC<{ className?: string; "aria-hidden"?: boolean }>> =
  {
    coffee: Coffee,
    croissant: Croissant,
    leaf: Leaf,
    wifi: Wifi,
    clock: Clock,
    heart: Heart,
  };

export const Highlight = ({
  icon = "coffee",
  title = "Roasted in house",
  body = "",
}: HighlightProps): React.ReactNode => {
  // Unknown value degrades to the default glyph instead of throwing.
  const Icon = iconMap[icon] ?? Coffee;

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-7">
      <span className="inline-flex size-11 items-center justify-center rounded-full bg-brand text-brand-foreground">
        <Icon aria-hidden className="size-5" />
      </span>

      {title && (
        <h3 className="mt-5 font-semibold text-card-foreground">{title}</h3>
      )}
      {body && <p className="mt-2 text-sm text-muted-foreground">{body}</p>}
    </div>
  );
};

export const highlightSettingsSchema = [
  {
    id: "icon",
    label: "Icon",
    type: "select",
    default: "coffee",
    options: [
      { value: "coffee", label: "Coffee" },
      { value: "croissant", label: "Pastry" },
      { value: "leaf", label: "Plant-based" },
      { value: "wifi", label: "Wi-Fi" },
      { value: "clock", label: "Quick service" },
      { value: "heart", label: "Local favourite" },
    ],
  },
  {
    id: "title",
    label: "Title",
    type: "text",
    default: "Roasted in house",
  },
  {
    id: "body",
    label: "Description",
    type: "textarea",
    default: "",
  },
];
