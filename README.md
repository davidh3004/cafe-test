# Theme Site Template

This is a Next.js template for deploying themes as standalone websites.

## Environment Variables

- `NEXT_PUBLIC_STRAPI_URL` - Strapi base URL (without /graphql suffix, e.g., `https://theta-strapi.ngrok.app`)
- `NEXT_PUBLIC_STRAPI_TOKEN` - Strapi access token
- `NEXT_PUBLIC_THEME_BUNDLE_URL` - URL to the theme bundle JavaScript file
- `NEXT_PUBLIC_THEME_NAME` - Name of the theme (used for loading from window.__THETA_THEMES__)
- `NEXT_PUBLIC_SITE_SUBDOMAIN` - Subdomain for this site

### Server Rendering & Error Reporting (Phase 13)

- `THETA_DISABLE_SSR_SHELL` - server-side only; deliberately has no `NEXT_PUBLIC_` prefix, since a client-visible kill switch would defeat its own purpose. Default is unset, which means server-side section rendering is **on**. Setting it to any non-empty value **other than** the literal strings `0` or `false` turns server rendering off and returns this tenant to the previous client-only behavior, with no code change and no rollback deploy. The two literal exceptions are deliberate and worth calling out explicitly: an operator who sets this variable to `false` intending to *enable* server rendering gets the enabled behavior anyway, because the predicate is one step stricter than a bare truthiness check for exactly that reason. A change to this variable in a Vercel project's environment settings takes effect on the next redeploy, not immediately.
- `SENTRY_DSN` - server-side error reporting DSN. Currently **unset on every tenant**. While unset, the server-side instrumentation hook (`instrumentation.ts`) is a no-op, and a structured `console.error` is the only surviving record of a server-side degrade.
- `NEXT_PUBLIC_SENTRY_DSN` - client-side error reporting DSN, inlined into the bundle at build time. This is a genuinely different variable from `SENTRY_DSN` above, not the same value repeated with a prefix. Currently **unset on every tenant** — while unset, the client-side reporting seam (`instrumentation-client.ts`) is inert and reports nothing.

Provisioning both DSNs per tenant — one Sentry project per tenant, both variables threaded through the deploy pipeline, one redeploy each to pick them up — is standing follow-up work, not something this phase shipped. An operator who wants error reporting for a given tenant today needs to do this provisioning themselves; it does not happen automatically as part of any existing deploy step.

## Build Process

1. Fetches all pages from Strapi at build time
2. Generates static routes for each page slug
3. Builds Next.js app with theme bundle
4. Deploys to Vercel

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm start
```
