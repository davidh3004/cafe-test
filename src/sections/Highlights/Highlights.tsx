import * as React from "react";

import { BlocksSlot } from "@/lib/blocks-slot";

// Highlights — a three-up grid of `highlight` blocks.
//
// Unlike Menu, this section accepts blocks via the `@theme` wildcard, which
// expands to every non-private block the theme registers globally. That is the
// right choice when a section is a generic container and you want new theme
// blocks to become available here automatically as you add them.
export interface HighlightsProps {
  heading?: string;
  renderBlocks?: () => React.ReactNode;
  sectionId?: string;
  sectionName?: string;
}

export const Highlights = ({
  heading = "Why people come back",
  renderBlocks,
}: HighlightsProps): React.ReactNode => {
  return (
    <section className="bg-background section-padding-y">
      <div className="container mx-auto container-padding-x">
        {heading && (
          <h2 className="heading-lg text-center text-foreground text-balance">
            {heading}
          </h2>
        )}

        <BlocksSlot
          renderBlocks={renderBlocks}
          className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        />
      </div>
    </section>
  );
};

export const highlightsSettingsSchema = [
  {
    id: "heading",
    label: "Heading",
    type: "text",
    default: "Why people come back",
  },
];
