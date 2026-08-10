import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The defensive contract for an `image_picker` setting.
 *
 * The value arrives in more shapes than you would hope:
 *   - `{ url, alt?, width?, height? }`  once a client has picked an image
 *   - `undefined`                        on a fresh section
 *   - `{}`                               mid-edit in the customizer
 *   - a bare string                      from some legacy saved payloads
 *
 * Anything that is not a usable url renders a neutral placeholder. A section
 * must never crash because a client has not chosen a picture yet.
 */
export interface ThemeImageValue {
  url?: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface ThemeImageProps {
  image?: ThemeImageValue | string;
  alt?: string;
  className?: string;
  placeholderLabel?: string;
}

function resolveUrl(image?: ThemeImageValue | string): string | null {
  if (!image) return null;
  if (typeof image === "string") return image.trim() ? image : null;
  if (typeof image.url === "string" && image.url.trim()) return image.url;
  return null;
}

export const ThemeImage = ({
  image,
  alt,
  className,
  placeholderLabel = "Add an image",
}: ThemeImageProps): React.ReactNode => {
  const url = resolveUrl(image);

  if (!url) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-sm text-muted-foreground",
          className,
        )}
        aria-hidden="true"
      >
        {placeholderLabel}
      </div>
    );
  }

  const resolvedAlt =
    alt ?? (typeof image === "object" && image?.alt ? image.alt : "");

  return <img src={url} alt={resolvedAlt} className={cn("object-cover", className)} />;
};
