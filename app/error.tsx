"use client";

import { useEffect } from "react";

/**
 * When NEXT_REDIRECT is caught by the error boundary (e.g. from redirect() in RSC),
 * perform a client-side redirect so the user is not shown "Failed to load ...".
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const digest = error?.digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) {
      const parts = digest.split(";");
      const url = parts[2];
      if (url && typeof window !== "undefined") {
        window.location.replace(url);
      }
    }
  }, [error]);

  // Do not show error UI for redirects; redirect happens in useEffect
  if ((error?.digest ?? "").startsWith("NEXT_REDIRECT")) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <p className="text-lg font-semibold text-destructive">Error</p>
        <p className="text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong"}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
