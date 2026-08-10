/**
 * Next.js instrumentation hook (https://nextjs.org/docs/app/guides/instrumentation).
 *
 * Opt-in per tenant, on purpose: no tenant has a SENTRY_DSN provisioned yet
 * (Phase 12 Plan 02 planner decision 3). Until per-tenant DSN provisioning
 * is wired, this is a no-op on every tenant site -- register() returns
 * immediately, @sentry/nextjs is never imported, and the structured
 * console.error already emitted by templates/theme-site/lib/theme-evaluator.ts
 * remains the only surviving record of a degrade.
 *
 * Phase 13's SSR-06 shipped the client-side half of this plumbing in
 * instrumentation-client.ts, next to this file. Both files remain no-ops on
 * every tenant today because neither SENTRY_DSN (this file) nor
 * NEXT_PUBLIC_SENTRY_DSN (instrumentation-client.ts) is provisioned
 * anywhere yet. Provisioning -- one Sentry project per tenant, both env
 * vars threaded through the deploy pipeline, and a redeploy per tenant for
 * either value to take effect -- is a tracked follow-up that rides with the
 * rollout work, not with this phase.
 */
export async function register() {
  // Only the Node.js runtime has node:vm and only the Node.js runtime is
  // where theme-evaluator.ts's reportEvaluationFailure seam runs -- the Edge
  // and browser runtimes have nothing to report and must stay untouched.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  // Opt-in: a tenant with no DSN configured pays nothing and behaves exactly
  // as it does today.
  if (!process.env.SENTRY_DSN) {
    return;
  }

  const Sentry = await import("@sentry/nextjs");

  Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Only enable in production.
    enabled: process.env.NODE_ENV === "production",

    // Error reporting, not performance tracing, on tenant sites.
    tracesSampleRate: 0,

    // Don't send PII.
    sendDefaultPii: false,
  });
}
