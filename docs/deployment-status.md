# Deployment status — what is live, and what is not

The standing answer to "what's deployed where". Update it when that changes.
Account/project map and the domain history live in
[handoff-2026-08-23-marketing-and-hosting.md](./handoff-2026-08-23-marketing-and-hosting.md).

## Live

| What | Where | Notes |
|---|---|---|
| **Marketing** | `www.showme.music` — Firebase Hosting, **gmail** `showme-production` | `daniel@showme.music` gets 403 on this project; deploys need the gmail account |
| **Marketing mirror** | `music-showme.web.app` — `music-showme` | Preview of the 2026-08-23 fixes. Do **not** overwrite; the web app has its own site |
| **Web app** | `showme-app.web.app` — `music-showme`, site `showme-app` | Deployed 2026-08-23. Auth on `music-showme` |
| **API** | Cloud Run `showme-api`, europe-north2, `prod-showme` | Reachable on its `run.app` origin |
| **Cloud SQL** | `showme-production-db`, europe-north2, `prod-showme` | `db-custom-1-3840` |
| **HTTPS load balancer** | `prod-showme` | Provisioned, **no DNS record** — carrying zero traffic and still billing |

Deploy the web app with:

```bash
pnpm --filter @showme/web build          # reads apps/web/.env.production
npx firebase deploy --only hosting:web --project music-showme
```

## Follow-ups

### 1. The API on Cloud Run is running OLD code — migrate before you deploy it

The image predates the 2026-08-23 work (no `artistFee`/`currency` on booking requests,
no message publish, none of the nine notification triggers).

**`packages/db/migrations/0003_booking_request_currency.sql` is not applied to the
production database.** Deploying the new API image without running it first means
`INSERT` on `booking_requests` hits a missing `currency` column, and **every booking
request from the live marketing form starts failing**. Migrate first, deploy second.

Harmless while the old image is serving: it never writes that column.

### 2. Deploy the SSE service

Built, containerised and documented in [deploy-stream.md](./deploy-stream.md) — never
deployed. Nothing breaks without it: `VITE_STREAM_URL` is deliberately blank in
`apps/web/.env.production`, so the app refetches on navigation instead of updating live.

To ship it: create an Artifact Registry repo, build `Dockerfile.stream`, deploy at
`--min-instances 0 --timeout 3600`, then set `VITE_STREAM_URL` to its `run.app` URL and
add that origin to the stream's own `CORS_ALLOWED_ORIGINS`. Do **not** give it a custom
subdomain — europe-north2 has no Cloud Run domain mappings, so that means a second load
balancer costing more than the compute.

### 3. Attach `app.showme.music`

The app is on `.web.app` for now. The domain needs a GoDaddy record plus a Hosting
custom-domain setup on the `showme-app` site, and then the new origin added to the API's
`CORS_ALLOWED_ORIGINS`.

### 4. The idle load balancer

Either DNS-wire `api.showme.music` to it or tear it down. It has been billing for
infrastructure serving no traffic since it was provisioned.

### 5. Verify a real login against the deployed app

Unverified: the seeded `@e2e.showme.test` accounts exist only in the local Auth
emulator, not in `music-showme`. The deployed app boots, renders auth, and reaches the
API cross-origin — but no one has signed in to it yet.

## Hosting header gotcha, in case it bites again

Firebase Hosting matches headers on the **request path**, and **the last matching rule
wins**. A rule on `/index.html` therefore never applies to the bare `/` (a directory
index) nor to SPA routes like `/events` (rewrites keep their original request path). The
web app's config uses a `**` catch-all for the shell and re-asserts `/assets/**` after
it, verified live: shell `no-cache`, hashed bundle `immutable`.

The marketing site still has the un-fixed version of this — its root `/` serves
`max-age=3600`. The same two-rule pattern would fix it.
