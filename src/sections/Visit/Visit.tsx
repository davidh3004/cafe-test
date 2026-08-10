import * as React from "react";

import { Button } from "@/components/ui/button";

// Visit — address, opening hours and a link out to a map. No child blocks.
//
// Note `hours` is a `textarea` split on newlines rather than a repeating block.
// That is a deliberate judgement call: opening hours are always about seven
// short lines, and forcing a client to add seven blocks would be worse than
// letting them type seven lines. Reach for blocks when the count genuinely
// varies and each item has structure; use a textarea when it is just lines.
export interface VisitProps {
  heading?: string;
  address?: string;
  hours?: string;
  phone?: string;
  mapLabel?: string;
  mapUrl?: string;
  sectionId?: string;
  sectionName?: string;
}

export const Visit = ({
  heading = "Come find us",
  address = "12 Calle El Conde\nZona Colonial, Santo Domingo",
  hours = "Mon – Fri  7:00 – 18:00\nSaturday  8:00 – 18:00\nSunday  8:00 – 14:00",
  phone = "",
  mapLabel = "Open in maps",
  mapUrl = "",
}: VisitProps): React.ReactNode => {
  const addressLines = address.split("\n").filter(Boolean);
  const hourLines = hours.split("\n").filter(Boolean);

  return (
    <section className="bg-brand text-brand-foreground section-padding-y">
      <div className="container mx-auto container-padding-x">
        {heading && <h2 className="heading-lg text-balance">{heading}</h2>}

        <div className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {addressLines.length > 0 && (
            <div>
              <h3 className="eyebrow opacity-80">Address</h3>
              <address className="mt-2 not-italic leading-relaxed">
                {addressLines.map((line, i) => (
                  <span key={i} className="block">
                    {line}
                  </span>
                ))}
              </address>
              {phone && <p className="mt-2 opacity-90">{phone}</p>}
            </div>
          )}

          {hourLines.length > 0 && (
            <div>
              <h3 className="eyebrow opacity-80">Hours</h3>
              <dl className="mt-2 leading-relaxed">
                {hourLines.map((line, i) => (
                  <dd key={i} className="ml-0">
                    {line}
                  </dd>
                ))}
              </dl>
            </div>
          )}

          {mapUrl && mapLabel && (
            <div className="flex items-start">
              <Button href={mapUrl} variant="accent">
                {mapLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export const visitSettingsSchema = [
  {
    id: "heading",
    label: "Heading",
    type: "text",
    default: "Come find us",
  },
  {
    id: "address",
    label: "Address",
    type: "textarea",
    default: "12 Calle El Conde\nZona Colonial, Santo Domingo",
    info: "One line per line of the address.",
  },
  {
    id: "hours",
    label: "Opening hours",
    type: "textarea",
    default:
      "Mon – Fri  7:00 – 18:00\nSaturday  8:00 – 18:00\nSunday  8:00 – 14:00",
    info: "One line per day or range.",
  },
  {
    id: "phone",
    label: "Phone",
    type: "text",
    default: "",
  },
  {
    id: "mapLabel",
    label: "Map button text",
    type: "text",
    default: "Open in maps",
  },
  {
    id: "mapUrl",
    label: "Map link",
    type: "url",
    default: "",
    info: "Leave empty to hide the button.",
  },
];
