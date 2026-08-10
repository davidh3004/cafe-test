import * as React from "react";

import { ThemeImage, type ThemeImageValue } from "@/lib/theme-image";
import {
  resolveMetaobjectEntry,
  MetaobjectPlaceholder,
} from "@/lib/metaobject-ref";

// StaffMember — a section-local block whose content comes from a METAOBJECT
// ENTRY rather than from typed-in settings.
//
// Why this matters: the client defines their staff once, in Content →
// Metaobjects, and then references those people from any page. Editing
// someone's job title updates every page that mentions them. Typed-in settings
// would mean editing the same person in five places.
//
// The `metaobjectType` in the schema below ("staff_member") must match the KEY
// of a metaobject definition in the tenant's CMS. If no definition with that
// key exists, the picker will simply have nothing to offer.

// The shape we expect once the platform has resolved the reference. Every field
// is optional — a client may have filled in only some of them.
export interface StaffEntry extends Record<string, unknown> {
  name?: string;
  role?: string;
  photo?: ThemeImageValue | string;
}

export interface StaffMemberProps {
  entry?: unknown;
  showRole?: boolean;
  blockId?: string;
  blockType?: string;
}

// The fields worth rendering. If an entry has none of them, it is treated as
// empty and the placeholder shows instead.
const DISPLAY_FIELDS = ["name", "role", "photo"] as const;

export const StaffMember = ({
  entry,
  showRole = true,
}: StaffMemberProps): React.ReactNode => {
  const person = resolveMetaobjectEntry<StaffEntry>(entry, DISPLAY_FIELDS);

  // One guard, every unusable shape. See lib/metaobject-ref.tsx.
  if (!person) {
    return <MetaobjectPlaceholder label="Pick a team member" />;
  }

  return (
    <figure className="flex flex-col">
      <ThemeImage
        image={person.photo}
        alt={person.name ?? ""}
        className="aspect-square w-full rounded-[var(--radius)]"
        placeholderLabel="No photo"
      />

      <figcaption className="mt-4">
        {person.name && (
          <p className="font-semibold text-foreground">{person.name}</p>
        )}
        {showRole && person.role && (
          <p className="mt-0.5 text-sm text-muted-foreground">{person.role}</p>
        )}
      </figcaption>
    </figure>
  );
};

export const staffMemberSettingsSchema = [
  {
    id: "entry",
    label: "Team member",
    type: "metaobject_ref",
    // Must match the metaobject definition key in the tenant's CMS.
    metaobjectType: "staff_member",
    info: "Create people under Content -> Metaobjects, then pick one here.",
  },
  {
    id: "showRole",
    label: "Show job title",
    type: "checkbox",
    default: true,
  },
];
