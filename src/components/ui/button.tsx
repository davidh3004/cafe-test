import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// A single shared button. Variants live here, not scattered across sections,
// so a restyle is one edit. Colours come from tokens only.
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-foreground hover:bg-brand-hover",
        accent: "bg-accent text-accent-foreground hover:opacity-90",
        outline: "border border-border bg-transparent text-foreground hover:bg-muted",
      },
      size: {
        sm: "h-9 px-4",
        md: "h-11 px-6",
        lg: "h-13 px-8 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof buttonVariants> {}

// Rendered as an anchor: a theme section is content, and every call to action
// in this theme is a link. No onClick, no state — sections stay pure.
export const Button = ({
  className,
  variant,
  size,
  ...props
}: ButtonProps): React.ReactNode => (
  <a className={cn(buttonVariants({ variant, size }), className)} {...props} />
);
