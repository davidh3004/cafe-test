/**
 * Next.js client instrumentation entry
 * (https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client).
 *
 * This is the browser-side twin of instrumentation.ts. It follows Next.js's
 * client-file convention rather than that file's server-side `register()`
 * convention: this module runs in the browser and its side effects execute
 * at module evaluation, so it uses a top-level guard and a top-level
 * Sentry.init(...) call instead of exporting an async register function.
 *
 * Reads NEXT_PUBLIC_SENTRY_DSN, NOT the server-side SENTRY_DSN that
 * instrumentation.ts reads. The NEXT_PUBLIC_ prefix is required -- and is
 * not a copy-paste slip -- because this code runs in the browser, so the
 * value must be inlined into the bundle at build time. Both variables are
 * different, and both will need provisioning together when that work is
 * scheduled (see instrumentation.ts's header comment).
 *
 * Opt-in per tenant, on purpose: no tenant has a NEXT_PUBLIC_SENTRY_DSN
 * provisioned yet. Until per-tenant DSN provisioning is wired, this is a
 * no-op on every tenant site -- Sentry.init is never called, and the
 * structured console.error already emitted by
 * templates/theme-site/lib/theme-evaluator.ts remains the only surviving
 * record of a server-side degrade. Per-tenant DSN provisioning is a tracked
 * follow-up: Sentry project creation per tenant, SENTRY_DSN and
 * NEXT_PUBLIC_SENTRY_DSN threaded through the deploy pipeline, and a
 * redeploy per tenant. It rides with the rollout work, not with this phase.
 *
 * Capture path: Next.js's App Router client entry invokes React's root
 * hydration call with no third argument, so it never supplies a custom
 * onRecoverableError and there is no supported Next.js configuration
 * surface to inject one. React's default handler therefore
 * always applies: it calls the browser's native reportError(), which
 * dispatches a global "error" event indistinguishable from an uncaught
 * exception. Sentry's GlobalHandlers integration -- enabled by default in
 * this SDK's client Sentry.init(), with no explicit configuration below --
 * already listens for exactly that event. Do not hand-roll a window error
 * listener here: it would duplicate the SDK's own dedup, breadcrumb, and
 * transport logic, exactly the second-channel pattern this project's
 * server-side reporting rule already rejects.
 */
import * as Sentry from "@sentry/nextjs";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Only enable in production.
    enabled: process.env.NODE_ENV === "production",

    // Error reporting, not performance tracing, on tenant sites.
    tracesSampleRate: 0,

    // Don't send PII.
    sendDefaultPii: false,

    // Best-effort triage tag only -- NOT load-bearing for capture. Every
    // recoverable error is captured and sent regardless of whether its
    // message matches below; a future React release that rewords its
    // hydration-mismatch messages degrades triage convenience and nothing
    // else. Must never attach additional context -- this is a tagger, not
    // an enricher.
    beforeSend(event) {
      const message = event.exception?.values?.[0]?.value;
      const isHydrationMismatch =
        typeof message === "string" &&
        (message.includes("Hydration failed because") ||
          message.includes("There was an error while hydrating") ||
          message.includes("did not match"));

      if (isHydrationMismatch) {
        event.tags = { ...event.tags, hydration_mismatch: true };
      }

      return event;
    },
  });
}
