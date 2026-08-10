import * as React from "react";

import { BlocksSlot } from "@/lib/blocks-slot";

// Menu — a heading over a repeating list of `menu-item` blocks.
//
// This is the pattern to copy whenever content REPEATS and the client controls
// how many there are. The section owns the frame (heading, spacing, grid); each
// row is a block the client can add, reorder, or delete.
//
// `menu-item` is declared as a SECTION-LOCAL block in registry.ts: it only
// makes sense inside this section, so it is deliberately not offered anywhere
// else in the theme.
export interface MenuProps {
  eyebrow?: string;
  heading?: string;
  note?: string;
  renderBlocks?: () => React.ReactNode;
  sectionId?: string;
  sectionName?: string;
}

export const Menu = ({
  eyebrow = "The list",
  heading = "What we're pouring",
  note = "Prices include tax. Oat milk is on the house.",
  renderBlocks,
}: MenuProps): React.ReactNode => {
  return (
    <section id="menu" className="bg-muted section-padding-y">
      <div className="container mx-auto container-padding-x">
        <div className="max-w-2xl">
          {eyebrow && <p className="eyebrow text-brand">{eyebrow}</p>}
          {heading && (
            <h2 className="heading-lg mt-3 text-foreground text-balance">{heading}</h2>
          )}
        </div>

        <BlocksSlot
          renderBlocks={renderBlocks}
          className="mt-10 grid grid-cols-1 gap-x-12 gap-y-2 md:grid-cols-2"
        />

        {note && <p className="mt-8 text-sm text-muted-foreground">{note}</p>}
      </div>
    </section>
  );
};

export const menuSettingsSchema = [
  {
    id: "eyebrow",
    label: "Small line above the heading",
    type: "text",
    default: "The list",
  },
  {
    id: "heading",
    label: "Heading",
    type: "text",
    default: "What we're pouring",
  },
  {
    id: "note",
    label: "Footnote",
    type: "text",
    default: "Prices include tax. Oat milk is on the house.",
    info: "Shown in small text under the list.",
  },
];
