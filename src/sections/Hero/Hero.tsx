import * as React from "react";

import { Button } from "@/components/ui/button";
import { ThemeImage, type ThemeImageValue } from "@/lib/theme-image";
import { cn } from "@/lib/utils";

// Hero — the opening band. A two-column split on desktop, stacked on mobile.
// No child blocks: this section is a single fixed statement, so it takes flat
// settings only and has no entry in sectionBlocksConfig.
//
// Every prop has a default, because a section is rendered the moment a client
// adds it — before they have typed anything.
export interface HeroProps {
  eyebrow?: string;
  heading?: string;
  body?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  image?: ThemeImageValue | string;
  alignment?: "left" | "center";
  sectionId?: string;
  sectionName?: string;
}

export const Hero = ({
  eyebrow = "Open daily, 7am – 6pm",
  heading = "Coffee worth walking for",
  body = "Small-batch roasting, pastries baked each morning, and a room built for lingering.",
  ctaLabel = "See the menu",
  ctaUrl = "#menu",
  image,
  alignment = "left",
}: HeroProps): React.ReactNode => {
  const centered = alignment === "center";

  return (
    <section className="bg-background section-padding-y">
      <div className="container mx-auto container-padding-x">
        <div
          className={cn(
            "grid items-center gap-10",
            centered ? "grid-cols-1" : "lg:grid-cols-2",
          )}
        >
          <div className={cn("flex flex-col", centered && "items-center text-center")}>
            {eyebrow && <p className="eyebrow text-brand">{eyebrow}</p>}

            {heading && (
              <h1 className="heading-xl mt-3 text-foreground text-balance">{heading}</h1>
            )}

            {body && (
              <p className="mt-5 max-w-prose text-lg text-muted-foreground">{body}</p>
            )}

            {ctaLabel && (
              <div className="mt-8">
                <Button href={ctaUrl} size="lg">
                  {ctaLabel}
                </Button>
              </div>
            )}
          </div>

          {!centered && (
            <ThemeImage
              image={image}
              className="aspect-[4/3] w-full rounded-[var(--radius)]"
              placeholderLabel="Add a hero image"
            />
          )}
        </div>
      </div>
    </section>
  );
};

// Each `id` becomes the exact prop name above. Each `default` is what the
// customizer pre-fills when a client drops this section onto a page.
export const heroSettingsSchema = [
  {
    id: "eyebrow",
    label: "Small line above the heading",
    type: "text",
    default: "Open daily, 7am – 6pm",
  },
  {
    id: "heading",
    label: "Heading",
    type: "text",
    default: "Coffee worth walking for",
  },
  {
    id: "body",
    label: "Intro paragraph",
    type: "textarea",
    default:
      "Small-batch roasting, pastries baked each morning, and a room built for lingering.",
  },
  {
    id: "ctaLabel",
    label: "Button text",
    type: "text",
    default: "See the menu",
    info: "Leave empty to hide the button.",
  },
  {
    id: "ctaUrl",
    label: "Button link",
    type: "url",
    default: "#menu",
  },
  {
    id: "image",
    label: "Hero image",
    type: "image_picker",
  },
  {
    id: "alignment",
    label: "Layout",
    type: "select",
    default: "left",
    options: [
      { value: "left", label: "Text left, image right" },
      { value: "center", label: "Centred, no image" },
    ],
  },
];
