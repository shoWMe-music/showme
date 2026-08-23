# Deployment status — what is live, and what is not

The standing answer to "what's deployed where". Update it when that changes.
Account/project map and the domain history live in
[handoff-2026-08-23-marketing-and-hosting.md](./handoff-2026-08-23-marketing-and-hosting.md).

## Live

| What | Where | Notes |
|---|---|---|
| **Marketing** | `www.showme.music` — Firebase Hosting, **gmail** `showme-production` | ⚠️ **STALE** — serving `main-D0FfydS8.js`, missing every 2026-08-23 fix. Deploys need the gmail account (`daniel@showme.music` gets 403) |
| **Marketing mirror** | `music-showme.web.app` — `music-showme` | Preview of the 2026-08-23 fixes. Do **not** overwrite; the web app has its own site |
| **Web app** | `showme-app.web.app` — `music-showme`, site `showme-app` | Deployed 2026-08-23. Auth on `music-showme` |
| **API** | Cloud Run `showme-api`, europe-north2, `prod-showme` | Revision `00006` (2026-08-23). Verifies tokens against **`music-showme`** — see 1c |
| **Cloud SQL** | `showme-production-db`, europe-north2, `prod-showme` | `db-custom-1-3840`. Schema at migration `0003`; **no application data yet** (0 profiles) |
| **HTTPS load balancer** | `prod-showme` | Provisioned, **no DNS record** — carrying zero traffic and still billing |

Deploy the web app with:

```bash
pnpm --filter @showme/web build          # reads apps/web/.env.production
npx firebase deploy --only hosting:web --project music-showme
```

## Follow-ups

### 1. ~~API on old code~~ — DONE 2026-08-23

Migration `0003` applied to production (4 applied, `booking_requests.currency` exists),
then the new image deployed as revision `showme-api-00005-7zr` from `e7bbc8b`. In that
order — the reverse would have broken every booking-request insert.

Verified after: health OK, `artistFee` + `currency` in the live OpenAPI, both CORS
origins still allowed, the marketing lead form still returns `{"ok":true}`, and an
insert including `currency` reaches the FK check (so the column accepts writes).

**Running a migration locally** needs a TCP tunnel — the `DATABASE_URL` secret uses a
Unix socket path that only resolves inside Cloud Run:

```bash
cloud-sql-proxy --port 55433 prod-showme:europe-north2:showme-production-db
# rebuild the URL as postgresql://postgres:<password>@127.0.0.1:55433/showme
DATABASE_URL=… pnpm --filter @showme/db exec drizzle-kit migrate
```

The proxy authenticates with **Application Default Credentials**, not the gcloud CLI
credentials — they expire separately and need `gcloud auth application-default login`
(browser). Note that overwrites the Firebase-admin impersonation ADC local API dev uses
for Storage signing; backup at
`~/.config/gcloud/application_default_credentials.firebase-impersonation.bak.json`.

### 1b. The API has no logs

`buildApp` sets `logger: false` (`apps/api/src/app.ts`), so `request.log.*` writes
nowhere — including every best-effort notification catch block. In production this means
a 500 arrives in Cloud Run logging with an **empty payload** and no diagnosable cause;
during this deploy a 500 had to be diagnosed by reproducing the query against the
database instead. It also hid an FK bug in the notification path for hours. Turning the
logger on is a small change with a large payoff.

### 1c. Cross-project auth — the API must be told which project issues tokens

Auth lives on **`music-showme`**; the API runs on **`prod-showme`**. `firebase-admin`
infers its project from the runtime when `FIREBASE_PROJECT_ID` is unset, so it inferred
`prod-showme`, and `verifyIdToken` rejected every `music-showme` token on the audience
check — surfacing as **"Invalid or expired token"** on sign-in. Fixed by setting
`FIREBASE_PROJECT_ID=music-showme` on the Cloud Run service (revision `00006`).

Verified with a real token: minted a custom token for the signed-in user, exchanged it
via `accounts:signInWithCustomToken`, and called the live API. The error moved from
"Invalid or expired token" to "No provisioned account for this identity" — i.e. the
token now verifies and only the Postgres account is missing, which is the onboarding
path (`POST /auth/session` returns 400 "needs a `kind`", which `AuthProvider` maps to
the onboarding flow).

**A new Hosting site is not automatically an authorized Auth domain.** `showme-app.web.app`
had to be added to Identity Platform's `authorizedDomains`, or Google sign-in fails with
`auth/unauthorized-domain`. Adding a domain later (e.g. `app.showme.music`) needs the same
step:

```bash
TOKEN=$(gcloud auth print-access-token)
curl -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: music-showme" \
  https://identitytoolkit.googleapis.com/admin/v2/projects/music-showme/config
# then PATCH ?updateMask=authorizedDomains with the full list plus the new domain
```

Note the `x-goog-user-project` header — without it the Identity Toolkit API 403s on
user ADC with a "requires a quota project" error.

### 1d. Marketing production is stale

`www.showme.music` serves `main-D0FfydS8.js`; the repo builds `main-9dPoRdKk.js`. Verified
absent from the live site: the phone hero-card clip fix (`transform-style: flat`), the
desktop chaos→order handoff, the touch scroll-snap, and the `firebase.json` no-cache
headers (`/assets/hero-scene.js` still returns `max-age=3600`).

All of it is committed and was verified on the `music-showme.web.app` mirror. Only the
deploy is missing, and it needs the **gmail** account:

```bash
pnpm --filter @showme/marketing build
npx firebase deploy --only hosting:marketing --project showme-production \
  --account daniel.islandman@gmail.com
```

### 1e. `apps/jobs` has never been deployed — the scheduled work does not run

There are **no Cloud Run Jobs** in `prod-showme`, and the **Cloud Scheduler API is not
even enabled**. So nothing in `apps/jobs` has ever executed in production:

| Job | Consequence of it never running |
|---|---|
| `reapExpiredOffers` | 30-day offers stay `pending` forever |
| `reapExpiredHandoffs` | 90-day venue handoffs never expire |
| `reapExpiredShares` | Share links never expire — the one with a security edge |
| `runExchangeRateRefresh` | `exchange_rate_cache` never refreshes; display FX goes stale |

Note ClickUp has "11 · Exchange-rate refresh scheduler" as **shipped** — that is the code,
not a running schedule. Deploying it needs: enable `cloudscheduler.googleapis.com`, a
Cloud Run Job built from `apps/jobs`, and a Scheduler trigger. None exist.

### 1f. `apps/site` — unidentified

A sixth Vite app (`@showme/site`, 65 files, its own router/sitemap/robots.txt) that appears
in no deploy plan and is not one of `cicd-plan.md`'s five units. Likely superseded by
`apps/marketing`. Worth confirming and deleting, or documenting why it stays.

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
