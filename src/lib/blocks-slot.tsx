import * as React from "react";

// Shared zero-blocks guard + layout convention. Every section that accepts
// child blocks uses this instead of re-deriving the check.
//
// `renderBlocks` reaches a section in two different shapes:
//
//   1. On the published site — `undefined` when the section has no blocks, or a
//      function returning an ARRAY of block elements when it has some.
//   2. In the customizer — ALWAYS present. The host renders its drop-target
//      slot inside a wrapper carrying inline `display: contents`.
//
// LAYOUT GOES ON OUR OWN WRAPPER, NEVER ON THE SLOT. The customizer slot's
// inline `display: contents` would beat any `display` we set on it, collapsing
// the grid and letting blocks stack. Putting className on a real <div> AROUND
// renderBlocks() lays blocks out identically in both contexts.
export interface BlocksSlotProps {
  renderBlocks?: () => React.ReactNode;
  empty?: React.ReactNode;
  className?: string;
}

export const BlocksSlot = ({
  renderBlocks,
  empty = <EmptyState />,
  className,
}: BlocksSlotProps): React.ReactNode => {
  const rendered = renderBlocks?.();

  // Published-zero: no function at all, or a function that returned nothing.
  if (rendered == null || (Array.isArray(rendered) && rendered.length === 0)) {
    return empty;
  }

  return <div className={className ?? ""}>{rendered}</div>;
};

// Shown on the published site when a block slot is empty. Deliberately quiet:
// a live visitor should see a tidy gap, not a debug message.
export const EmptyState = (): React.ReactNode => (
  <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
    Nothing here yet.
  </div>
);
