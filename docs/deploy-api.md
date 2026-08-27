# Deploying `apps/api` to Cloud Run (manual runbook)

Goal: run the API publicly so the marketing contact form's leads reach ClickUp
(and the web app has a backend). Everything below is wired in the repo; this is the
manual sequence to actually provision + deploy. **Nothing here has been run.**

## What's already wired
- **Container**: `apps/api/Dockerfile` (build context = repo root) → a self-contained
  `dist/server.mjs` bundle (esbuild, `apps/api/esbuild.mjs`). Runtime image is just
  Node + that file; verified it boots to "listening" with zero `node_modules`.
- **Scripts**: `pnpm --filter @showme/api build` (bundle) and `start` (`node dist/server.mjs`).
- **Config is env-driven** (`apps/api/src/config.ts`): `PORT` defaults to 8080 (Cloud
  Run injects it), `HOST` to `0.0.0.0`. CORS and lead origins are env vars — no code
  change needed for the prod domain.
- **Marketing**: `apps/marketing/.env.production` points the form at
  `https://api.showme.music/api/v1/public/leads`.

## Prerequisites (provision once)
1. **Pick the project** — `prod-showme` (680839076083) is the intended prod target.
2. **Cloud SQL for PostgreSQL** — instance `showme-production-db`, chosen config:
   - **Edition** Enterprise · **PostgreSQL 18** (matches the test/dev image `postgres:18-alpine`)
   - **Region** `europe-north2` (Stockholm) — put Cloud Run in the SAME region (fall
     back to `europe-north1` for both if Cloud Run isn't offered in Stockholm)
   - **Machine** `db-custom-1-3840` (1 vCPU / 3.75 GB) — scale up at launch
   - **Storage** 10 GB SSD, **auto-increase ON** (storage only grows, so start small)
   - **Single zone** (enable HA at launch) · automated backup + PITR on
   - **Public IP on, no authorized networks** — Cloud Run reaches it via the connector
   - Then create a dedicated **`showme` database** + an app user (don't run the app as
     the `postgres` superuser). Connection name: `prod-showme:europe-north2:showme-production-db`.
3. **Secrets** (Secret Manager): `DATABASE_URL`, `CLICKUP_API_TOKEN`, and any of
   `FIREBASE_SERVICE_ACCOUNT`, `SHARE_JWT_SECRET`, `BREVO_API_KEY` you want live.
4. **Run migrations** against the Cloud SQL DB: `DATABASE_URL=... pnpm --filter @showme/db migrate`.

## Required env / secrets on the service

**This table is a claim; the service is the fact.** Read what is actually set
before changing anything — the same lesson `deployment-status.md` learned about
`__drizzle_migrations`:

```bash
gcloud run services describe showme-api --region europe-north2 --project prod-showme \
  --format="value(spec.template.spec.containers[0].env)"
```

As of 2026-08-27 the live service carries all of the following.

| Var | Needed for | Value |
|---|---|---|
| `DATABASE_URL` | **required to boot** | Cloud SQL connection string (secret) |
| `CLICKUP_API_TOKEN` | leads → ClickUp | personal token `pk_…` (secret) |
| `CLICKUP_LEADS_LIST_ID` | leads → ClickUp | `901524890050` |
| `LEADS_ALLOWED_ORIGINS` | who may POST the lead form | `https://showme.music,https://www.showme.music,https://showme-app.web.app,https://music-showme.web.app` |
| `CORS_ALLOWED_ORIGINS` | browser CORS (web + marketing) | same list as `LEADS_ALLOWED_ORIGINS` |
| `FIREBASE_PROJECT_ID` | authed routes | `music-showme` |
| `FIREBASE_STORAGE_BUCKET` | file storage | `music-showme.firebasestorage.app` |
| `PUBLIC_APP_BASE_URL` | **every link in every email** | `https://showme-app.web.app` |
| `BREVO_API_KEY` / `BREVO_SENDER` | sending email at all | secrets |
| `SHARE_JWT_SECRET` | the off-platform share front door | secret |
| `PORT` / `HOST` | — | leave unset; Cloud Run sets `PORT`, `HOST` defaults to `0.0.0.0` |

**The last four are what the settlement review flow runs on**, and each fails
quietly rather than loudly if it goes missing:

- No `PUBLIC_APP_BASE_URL` → `resolvePublicAppBaseUrl` falls back to the Vite dev
  server, so every invitation, share and settlement-review email ships a link to
  `http://localhost:5174`. The mail sends; it is simply useless.
- No `BREVO_API_KEY` → `createEmailSink` falls back to the no-op sink. Nothing is
  sent and no route errors, because sending is best-effort everywhere by design.
- No `SHARE_JWT_SECRET` → an off-platform recipient can request a code and never
  redeem it.

## Build + deploy — one command (Cloud Build from source)
The `Dockerfile` is at the repo root, so `--source .` builds + deploys in one step
(Cloud Build uses it; no manual image build/push or Artifact Registry setup):
> ### ⚠️ `--set-env-vars` and `--set-secrets` REPLACE. They do not merge.
>
> This is the single most dangerous line in this file. Both flags discard
> **every** variable and secret you do not name in that one invocation. The
> command below used to list three env vars and two secrets, and the service now
> carries six and five — so running the old version as written would have silently
> stripped `PUBLIC_APP_BASE_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`,
> `BREVO_API_KEY`, `BREVO_SENDER` and `SHARE_JWT_SECRET` from a healthy service.
>
> Nothing would have errored. The API boots fine without them: emails would just
> start pointing at `localhost`, then stop sending altogether, and off-platform
> share links would stop opening. A redeploy is exactly when nobody is looking for
> that.
>
> **For a routine code deploy, name no configuration at all** — a `--source`
> deploy inherits the existing env and secrets. That is the safe default below.
> Reach for `--update-env-vars` / `--update-secrets` (which merge) only when you
> are deliberately changing one, and never for `--set-*` unless you intend to
> define the entire set from scratch.

**Routine deploy — new code, configuration untouched:**
```bash
gcloud run deploy showme-api \
  --project prod-showme --region europe-north2 \
  --source . \
  --allow-unauthenticated \
  --add-cloudsql-instances prod-showme:europe-north2:showme-production-db
```

**Changing or adding one setting** — `--update-*` merges, leaving the rest alone:
```bash
gcloud run deploy showme-api \
  --project prod-showme --region europe-north2 --source . \
  --update-env-vars "PUBLIC_APP_BASE_URL=https://showme-app.web.app" \
  --update-secrets "BREVO_API_KEY=BREVO_API_KEY:latest"
```

**First deploy of a brand-new service only** — the full set, `--set-*`, nothing
inherited because there is nothing to inherit:
```bash
gcloud run deploy showme-api \
  --project prod-showme --region europe-north2 \
  --source . \
  --allow-unauthenticated \
  --add-cloudsql-instances prod-showme:europe-north2:showme-production-db \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,CLICKUP_API_TOKEN=CLICKUP_API_TOKEN:latest,BREVO_API_KEY=BREVO_API_KEY:latest,BREVO_SENDER=BREVO_SENDER:latest,SHARE_JWT_SECRET=SHARE_JWT_SECRET:latest" \
  --set-env-vars "^@@^CLICKUP_LEADS_LIST_ID=901524890050@@FIREBASE_PROJECT_ID=music-showme@@FIREBASE_STORAGE_BUCKET=music-showme.firebasestorage.app@@PUBLIC_APP_BASE_URL=https://showme-app.web.app@@LEADS_ALLOWED_ORIGINS=https://showme.music,https://www.showme.music,https://showme-app.web.app,https://music-showme.web.app@@CORS_ALLOWED_ORIGINS=https://showme.music,https://www.showme.music,https://showme-app.web.app,https://music-showme.web.app"
```
- `^@@^` sets `@` as the env-var delimiter so the comma-separated origin lists aren't split.
- `--allow-unauthenticated` is correct: the API is publicly reachable and enforces auth
  *per route* via the Firebase token (the leads route is intentionally `public`).
- First run will prompt to enable Cloud Build / Artifact Registry APIs — say yes.
- If Cloud Run isn't offered in `europe-north2`, use `europe-north1` (the connector still
  reaches the Stockholm DB; add `--region europe-north1`).

**Alternative (build the image yourself):** `docker build -t IMAGE .` → push to Artifact
Registry → `gcloud run deploy showme-api --image IMAGE …` with the same flags.

## Map the domain + point the form at it
1. **Custom domain**: map `api.showme.music` to the `showme-api` Cloud Run service
   (`gcloud run domain-mappings create --service showme-api --domain api.showme.music …`),
   then add the DNS records it returns.
2. If your API origin differs from `https://api.showme.music/api/v1`, update
   `apps/marketing/.env.production` (`VITE_LEAD_ENDPOINT`).
3. **Rebuild + redeploy the marketing site** so the form calls the live API:
   ```bash
   pnpm --filter @showme/marketing build
   firebase deploy --only hosting --project showme-production --account daniel.islandman@gmail.com
   ```

## Smoke test
```bash
curl -s https://api.showme.music/api/v1/health            # → ok
curl -s -X POST https://api.showme.music/api/v1/public/leads \
  -H 'content-type: application/json' \
  -H 'origin: https://www.showme.music' \
  -d '{"name":"Test","email":"t@example.com","message":"hi"}'
```
Then confirm the lead landed in ClickUp list `901524890050`, and submit the real form
on `showme.music` (no browser prompt, "message sent").
