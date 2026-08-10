import * as React from "react";

import { BlocksSlot } from "@/lib/blocks-slot";
import { cn } from "@/lib/utils";

// Staff — "Meet the team". A grid of people pulled from metaobject entries.
//
// Two things here are worth copying into your own sections:
//
//   1. `columns` is a `range`, which gives the client a slider instead of a
//      free-text box. They cannot type 97.
//
//   2. The column classes come from a LOOKUP TABLE of complete class strings,
//      never from string interpolation. Tailwind scans your source as plain
//      text at build time; a class assembled at runtime like
//      `sm:grid-cols-${columns}` is invisible to that scan and the CSS for it
//      is simply never generated. The grid silently does nothing. Always write
//      the full class names out somewhere Tailwind can see them.
const columnClasses: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export interface StaffProps {
  eyebrow?: string;
  heading?: string;
  intro?: string;
  columns?: number;
  renderBlocks?: () => React.ReactNode;
  sectionId?: string;
  sectionName?: string;
}

export const Staff = ({
  eyebrow = "The people",
  heading = "Meet the team",
  intro = "",
  columns = 3,
  renderBlocks,
}: StaffProps): React.ReactNode => {
  // Defensive: a client could in principle save a value outside the slider's
  // range, and an unknown key would produce `undefined` in the className.
  const gridClass = columnClasses[columns] ?? columnClasses[3];

  return (
    <section className="bg-background section-padding-y">
      <div className="container mx-auto container-padding-x">
        <div className="max-w-2xl">
          {eyebrow && <p className="eyebrow text-brand">{eyebrow}</p>}
          {heading && (
            <h2 className="heading-lg mt-3 text-foreground text-balance">
              {heading}
            </h2>
          )}
          {intro && (
            <p className="mt-4 text-lg text-muted-foreground">{intro}</p>
          )}
        </div>

        <BlocksSlot
          renderBlocks={renderBlocks}
          className={cn("mt-10 grid grid-cols-1 gap-8", gridClass)}
        />
      </div>
    </section>
  );
};

export const staffSettingsSchema = [
  {
    id: "eyebrow",
    label: "Small line above the heading",
    type: "text",
    default: "The people",
  },
  {
    id: "heading",
    label: "Heading",
    type: "text",
    default: "Meet the team",
  },
  {
    id: "intro",
    label: "Intro paragraph",
    type: "textarea",
    default: "",
  },
  {
    id: "columns",
    label: "Columns on desktop",
    type: "range",
    default: 3,
    min: 2,
    max: 4,
    step: 1,
  },
];
