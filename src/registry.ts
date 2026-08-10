import type React from "react";

import { Hero, heroSettingsSchema } from "./sections/Hero";
import { Menu, menuSettingsSchema } from "./sections/Menu";
import { Highlights, highlightsSettingsSchema } from "./sections/Highlights";
import { Visit, visitSettingsSchema } from "./sections/Visit";
import { Staff, staffSettingsSchema } from "./sections/Staff";
import { Highlight, highlightSettingsSchema } from "./blocks/Highlight";
import { MenuItem, menuItemSettingsSchema } from "./blocks/MenuItem";
import { StaffMember, staffMemberSettingsSchema } from "./blocks/StaffMember";

// ---------------------------------------------------------------------------
// The registry is the heart of a theme: five maps, all keyed by the same
// lowercase/kebab-case strings. Adding a section or block means adding an entry
// to each relevant map. If the keys drift apart, the platform will find a
// component with no schema (no editor controls) or a schema with no component
// (a section that renders nothing).
// ---------------------------------------------------------------------------

// 1. Section components, keyed by section type.
export const sectionsComponents: Record<
  string,
  React.ComponentType<Record<string, unknown>>
> = {
  hero: Hero as React.ComponentType<Record<string, unknown>>,
  menu: Menu as React.ComponentType<Record<string, unknown>>,
  highlights: Highlights as React.ComponentType<Record<string, unknown>>,
  visit: Visit as React.ComponentType<Record<string, unknown>>,
  staff: Staff as React.ComponentType<Record<string, unknown>>,
};

// 2. Section settings schemas — SAME KEYS as sectionsComponents.
export const sectionSettingsSchemas = {
  hero: heroSettingsSchema,
  menu: menuSettingsSchema,
  highlights: highlightsSettingsSchema,
  visit: visitSettingsSchema,
  staff: staffSettingsSchema,
};

// 3. Global block components. Available to any section that references them,
//    including via the `@theme` wildcard. Prefix a key with `_` to keep it out
//    of `@theme` while still allowing an explicit reference.
export const blocksComponents: Record<
  string,
  React.ComponentType<Record<string, unknown>>
> = {
  highlight: Highlight as React.ComponentType<Record<string, unknown>>,
};

// 4. Global block settings schemas — SAME KEYS as blocksComponents.
export const blockSettingsSchemas = {
  highlight: highlightSettingsSchema,
};

// 5. Which blocks each section accepts.
//      { type: "@theme" }  — every non-private global block
//      { type: "x" }       — only that type
//      localBlocks         — declared inline, exclusive to this section
//    A section with no entry here simply accepts no blocks.
export const sectionBlocksConfig: Record<
  string,
  {
    blocks: Array<{ type: string }>;
    maxBlocks?: number;
    localBlocks?: Array<{
      type: string;
      name: string;
      component?: React.ComponentType<Record<string, unknown>>;
      settings: Array<Record<string, unknown>>;
    }>;
  }
> = {
  menu: {
    // Section-local: menu-item exists only here, so it is declared inline and
    // deliberately absent from blocksComponents / blockSettingsSchemas.
    blocks: [{ type: "menu-item" }],
    maxBlocks: 20,
    localBlocks: [
      {
        type: "menu-item",
        name: "Menu item",
        component: MenuItem as React.ComponentType<Record<string, unknown>>,
        settings: menuItemSettingsSchema,
      },
    ],
  },

  highlights: {
    // Wildcard: picks up every non-private global block automatically, so a new
    // global block becomes usable here without touching this file again.
    blocks: [{ type: "@theme" }],
    maxBlocks: 6,
  },

  staff: {
    // Section-local again, but note the difference from `menu-item`: this
    // block's content comes from a metaobject REFERENCE, not typed-in text.
    // The client picks a person the CMS already knows about.
    blocks: [{ type: "staff-member" }],
    maxBlocks: 12,
    localBlocks: [
      {
        type: "staff-member",
        name: "Team member",
        component: StaffMember as React.ComponentType<Record<string, unknown>>,
        settings: staffMemberSettingsSchema,
      },
    ],
  },

  // `hero` and `visit` have NO entry: they are settings-only sections.
};
