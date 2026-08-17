# CI/CD + GCP hosting plan — 2026-08-09

The plan to take the substantially-built monorepo from "runs locally" to "automated CI, PR
previews, and one-command prod deploys on GCP." Decisions here are settled (see the
_Decisions_ section); the _Task list_ at the end is the build order.

---

## Goals

1. **CI on every PR** — build, typecheck, lint, unit/integration tests, e2e. Red PR = no merge.
2. **PR previews** — every PR gets a live, isolated URL (frontends + a real backend) on the
   **`dev-showme`** project. Prod is never touched by a preview.
3. **Prod deploy on merge to `main`** — build → push → migrate → deploy, keyless (WIF).
4. **All infrastructure as Terraform** — no click-ops as the source of truth.

---

## Current state (verified 2026-08-09)

- **No deploy infra exists.** No `.github/`, no Dockerfiles, no IaC. `firebase.json` is
  emulator-only; `.firebaserc` → throwaway `demo-showme`.
- **GCP projects exist but are empty shells** — Run/SQL/Artifact/Secret APIs not even enabled
  in any project.
  - `prod-showme` (680839076083) — prod target. Empty.
  - `dev-showme` (452202806556) — PR-preview target. Empty.
  - `music-showme` (1098805934399) — current Firebase (Auth/Hosting/Storage). To be superseded.
- **Billing:** one account (`011B8E-E9F108-D608FA`), all three projects linked,
  `billingEnabled: true`. Google-for-Startups credits apply at the **billing-account level** →
  shared across every linked project automatically. (Credit balance is console-only.)
- **Access:** `daniel@showme.music` is **owner** on both `prod-showme` and `dev-showme`.
- **Auth gotcha:** local ADC impersonates `firebase-adminsdk-fbsvc@music-showme` (keyless
  Storage signing for local API dev), **not** the user. Terraform needs user ADC instead —
  see _Prerequisites_. The impersonation ADC is backed up to
  `~/.config/gcloud/application_default_credentials.firebase-impersonation.bak.json`.

### The five deployable units

| App | Type | Target | Build today | Deploy target |
|---|---|---|---|---|
| `api` | Fastify + Zod | Cloud Run service | ❌ none (runs via `tsx`) | Cloud Run (`api.` subdomain) |
| `stream` | SSE (LISTEN/NOTIFY) | Cloud Run service | ❌ none (node strip-types) | Cloud Run (`stream.`, min-instances ≥1, no CDN) |
| `jobs` | cron tasks | Cloud Run Job | ❌ none | Cloud Run Job + Cloud Scheduler |
| `web` | React 19 SPA (Vite) | Firebase Hosting | ✅ `vite build` | Hosting (SPA) |
| `marketing` | static MPA (Vite) | Firebase Hosting | ✅ `vite build` | Hosting (static) |

**Two structural gaps:**
- `api`/`stream` have **no build step** → add esbuild bundling (decided).
- **`apps/ssr` does not exist** — PLAN.md's full-SSR public service is unbuilt. Out of scope
  here; CI/CD covers the five apps that exist, with an SSR slot left for later.

---

## Decisions (settled)

- **Two environments:** prod on `prod-showme`, PR previews on `dev-showme`. `music-showme`
  superseded (Firebase moves into the two env projects).
- **Terraform for all infra**, one reusable `modules/environment` instantiated per project.
- **Containers: esbuild bundle** → `node:22-slim` images (fast Cloud Run cold starts).
- **Dev backend is shared** — all open PRs point at one `dev-showme` API tracking the latest
  build. Per-PR isolation via Cloud Run tagged revisions is a later option, not v1.
- **Keyless CI→GCP auth** via Workload Identity Federation (no SA JSON keys).

---

## Target architecture

```
                    GitHub  (main + PRs)
                       │  keyless auth · Workload Identity Federation
        ┌──────────────┴───────────────┐
   push to main                    pull request
        │                               │
        ▼                               ▼
  ── prod-showme ──               ── dev-showme ──
  Artifact Registry               Artifact Registry (or pull prod's)
  Cloud Run: api/stream           Cloud Run: api/stream (shared dev)
  Cloud Run Job: jobs             Cloud SQL: dev Postgres (small tier)
  Cloud SQL: prod Postgres        Firebase Hosting: PREVIEW channels → dev API
  Firebase Hosting: web+marketing Secret Manager: dev values
  Firebase Auth + Storage         Firebase Auth + Storage (dev)
  Secret Manager: prod values
  Cloud Scheduler → jobs
```

Both env projects are structurally identical (same Terraform module); they differ only in
vars: project id, SQL tier, min-instances, domains, and whether Hosting deploys to the live
channel (prod) or preview channels (dev).

---

## Prerequisites (manual, one-time — mostly yours)

1. ✅ `firebase login --reauth` — done.
2. ✅ Billing linked to both projects, credits shared account-wide — confirmed.
3. ✅ `gcloud config set project prod-showme` — done.
4. ⬜ **Terraform ADC** — run `gcloud auth application-default login` (interactive browser;
   Claude can't do this headless). Sets ADC to your owner user so Terraform can provision.
   Then `gcloud auth application-default set-quota-project prod-showme`.
   - Trade-off: this replaces the Firebase-admin impersonation ADC local API dev uses for
     Storage signing. Backup exists (see above); restore with `cp` when doing local API work,
     or better, have the API impersonate explicitly in code so ADC can stay as user creds.
5. ⬜ **Terraform state bucket** — Claude will script:
   `gcloud storage buckets create gs://showme-tfstate-<suffix> --location=europe-north2
   --uniform-bucket-level-access` with versioning on. (Bootstrap is the one non-TF step;
   everything else is declarative.)

---

## Work breakdown

### 1. Terraform (`infra/`)
- `bootstrap/` notes — state bucket (created out-of-band), backend config.
- `modules/environment/` — the reusable per-project stack:
  - `apis.tf` — enable Run, SQL Admin, Artifact Registry, Secret Manager, IAM Credentials,
    Cloud Scheduler, Cloud Build, Firebase, Identity Platform.
  - `sql.tf` — Cloud SQL Postgres 17 (europe-north2), database + app user. Cloud SQL
    connector (no VPC) to start.
  - `artifact_registry.tf` — one Docker repo.
  - `secrets.tf` — Secret Manager entries (values set out-of-band; not in state).
  - `cloud_run.tf` — `api` + `stream` services, `jobs` Job; per-service SA, secret env,
    Cloud SQL attach; `stream` tuned for SSE.
  - `scheduler.tf` — Cloud Scheduler → jobs (exchange-rate refresh, reapers).
  - `firebase.tf` (google-beta) — Firebase on the project, web app, Hosting site, Identity
    Platform (Email/Password + Google), Storage bucket.
  - `iam.tf` — least-privilege SAs (Cloud SQL client, Secret accessor, Storage signer for api).
  - `wif.tf` — Workload Identity pool/provider bound to the GitHub repo + deployer SA.
- `envs/prod/` and `envs/dev/` — thin instantiations of the module with per-env vars +
  remote-state backend.

### 2. Containers
- Add `build` (esbuild bundle → `dist/server.js`) to `api` and `stream`; `jobs` entrypoint.
- `Dockerfile` per service (`node:22-slim`, copy `dist/`, non-root, `PORT`), `.dockerignore`.
- Migration path: reuse the api image with a `drizzle-kit migrate` entrypoint (Cloud Run Job).

### 3. Firebase config
- Real `.firebaserc` (prod + dev aliases) and `firebase.json`: `web` + `marketing` Hosting
  targets, SPA rewrite for web, `api.`/`stream.` subdomain wiring per PLAN. Keep the emulator
  block for local dev.

### 4. GitHub Actions (`.github/workflows/`)
- `ci.yml` (PR): pnpm install (cached) → `build`/`typecheck`/`lint` → Vitest (Postgres
  service container for Testcontainers) → Playwright e2e (auth emulator + seed).
- `preview.yml` (PR): build images → deploy to `dev-showme` Cloud Run + migrate dev DB →
  build `web`/`marketing` pointed at dev API → `firebase hosting:channel:deploy pr-N` →
  comment preview URLs.
- `deploy.yml` (push `main`): WIF auth → build+push 3 images → **migrate (gated)** → deploy
  api/stream/jobs to Cloud Run → deploy web+marketing to Hosting live → smoke test.
- `terraform.yml` (`infra/**`): `fmt`/`validate`/`plan` on PR; `apply` on main (manual approve).

### 5. Secrets (Secret Manager, per env)
`DATABASE_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `SHARE_JWT_SECRET`,
`CLICKUP_API_TOKEN` (+ `CLICKUP_LEADS_LIST_ID`), `LEADS_ALLOWED_ORIGINS`, Brevo key, FX key.
Public `VITE_FIREBASE_*` (web) are build-time, non-secret, injected per env.

---

## Open items to resolve in-flight (non-blocking)

- **Firebase Auth consolidation** — moving Auth into prod/dev projects means new
  `VITE_FIREBASE_*` web config and (pre-launch) throwaway users. Enabling the Google provider
  may need one console toggle TF can't do.
- **Domains/DNS** — real domain for prod `api.`/`stream.`/app + marketing; TLS via Hosting +
  Cloud Run domain mappings. Placeholder `showme.example` still in marketing.
- **Dev DB seeding** — previews want a seeded, disposable dev DB (`@showme/db seed`).
- **Cloud Armor** — edge rate-limiting for `/public/leads` (STATUS note) once infra exists.

---

## Task list (build order)

- [ ] **Bootstrap** — user runs ADC login + set-quota-project; Claude creates TF state bucket.
- [ ] **Terraform module + core** — APIs, Artifact Registry, Secret Manager, Cloud SQL, WIF;
      `apply` to both envs.
- [ ] **Containers** — esbuild scripts + Dockerfiles for api/stream/jobs; prove they run.
- [ ] **Cloud Run + Firebase TF** — services, jobs, scheduler, Firebase/Hosting/Auth; `apply`.
- [ ] **Firebase config** — real `firebase.json`/`.firebaserc` + subdomains.
- [ ] **CI workflow** — PRs green (build/test/e2e).
- [ ] **Deploy workflow** — WIF → images → migrate → Cloud Run → Hosting (manual first run).
- [ ] **Preview workflow** — dev-showme backend + Hosting channels + PR comment.
- [ ] **Cutover** — DNS/domains, seed dev DB, supersede music-showme, Cloud Armor.
</content>
