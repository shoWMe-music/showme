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
2. **Cloud SQL for PostgreSQL** (europe-north2 / Stockholm per PLAN.md). Create the
   instance + database + user; note the connection name `PROJECT:REGION:INSTANCE`.
3. **Secrets** (Secret Manager): `DATABASE_URL`, `CLICKUP_API_TOKEN`, and any of
   `FIREBASE_SERVICE_ACCOUNT`, `SHARE_JWT_SECRET`, `BREVO_API_KEY` you want live.
4. **Run migrations** against the Cloud SQL DB: `DATABASE_URL=... pnpm --filter @showme/db migrate`.

## Required env / secrets on the service
| Var | Needed for | Value |
|---|---|---|
| `DATABASE_URL` | **required to boot** | Cloud SQL connection string (secret) |
| `CLICKUP_API_TOKEN` | leads → ClickUp | personal token `pk_…` (secret) |
| `CLICKUP_LEADS_LIST_ID` | leads → ClickUp | `901524890050` |
| `LEADS_ALLOWED_ORIGINS` | who may POST the lead form | `https://showme.music,https://www.showme.music` |
| `CORS_ALLOWED_ORIGINS` | browser CORS (web + marketing) | `https://showme.music,https://www.showme.music,https://app.showme.music` |
| `FIREBASE_PROJECT_ID` / `FIREBASE_SERVICE_ACCOUNT` / `FIREBASE_STORAGE_BUCKET` | authed routes + storage | from the Firebase project (optional for leads-only) |
| `PORT` / `HOST` | — | leave unset; Cloud Run sets `PORT`, `HOST` defaults to `0.0.0.0` |

## Build + deploy
```bash
PROJECT=prod-showme
REGION=europe-north2
INSTANCE="$PROJECT:$REGION:showme-db"   # your Cloud SQL connection name

# Build + push the image (context = repo root; note the -f path)
IMAGE="$REGION-docker.pkg.dev/$PROJECT/showme/api:$(git rev-parse --short HEAD)"
docker build -f apps/api/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
# (or one-shot: gcloud builds submit --tag "$IMAGE" -f apps/api/Dockerfile .)

gcloud run deploy showme-api \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$INSTANCE" \
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,CLICKUP_API_TOKEN=CLICKUP_API_TOKEN:latest" \
  --set-env-vars "CLICKUP_LEADS_LIST_ID=901524890050,LEADS_ALLOWED_ORIGINS=https://showme.music\,https://www.showme.music,CORS_ALLOWED_ORIGINS=https://showme.music\,https://www.showme.music"
```
`--allow-unauthenticated` is correct: the API is publicly reachable and enforces auth
*per route* via the Firebase token (the leads route is intentionally `public`).

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
