# Infrastructure (Terraform)

All infrastructure lives here as Terraform. `gcloud` is only for the one-time state
bucket bootstrap and interactive logins — everything else is `terraform apply`.

```
infra/
  modules/
    api-load-balancer/   # external HTTPS LB → serverless NEG → Cloud Run service
    scheduled-jobs/      # Cloud Run Job (apps/jobs) + Cloud Scheduler trigger
  envs/
    prod/                # prod-showme: the load balancer and the scheduled jobs
```

> **Why an LB for the API domain?** `europe-north2` (Stockholm) doesn't support
> native Cloud Run domain mappings (the API returns `HTTP 501`). A global external
> HTTPS load balancer with a serverless NEG is the supported way to attach a custom
> domain to a Cloud Run service in that region.

## One-time bootstrap (gcloud)

The Terraform state bucket is the single chicken-and-egg piece — create it once:

```bash
gcloud storage buckets create gs://prod-showme-tfstate \
  --project prod-showme --location europe-north2 \
  --uniform-bucket-level-access
gcloud storage buckets update gs://prod-showme-tfstate --versioning
```

Terraform authenticates with your user credentials via Application Default
Credentials:

```bash
gcloud auth application-default login
```

## Provision `api.showme.music` (envs/prod)

```bash
cd infra/envs/prod
terraform init
terraform plan
terraform apply
```

`apply` prints `load_balancer_ip`. Then:

1. **Add the DNS A record** in the `showme.music` zone:
   `api  A  <load_balancer_ip>` (TTL 300).
2. **Wait for the managed cert to go ACTIVE** (needs the A record resolving first;
   typically 15–60 min):
   ```bash
   gcloud compute ssl-certificates describe showme-api-lb-cert \
     --global --project prod-showme --format="value(managed.status)"
   ```
   Wait for `ACTIVE`.
3. **Smoke test:** `curl -s https://api.showme.music/api/v1/health` → `{"status":"ok"}`.

## The certificate: replacing one is an outage, so read this first

**Renaming `google_compute_managed_ssl_certificate.default` replaces it, and replacing
it takes `https://api.showme.music` down for 15-60 minutes.** Terraform points the HTTPS
proxy at the new certificate as soon as it is created, but a managed certificate only
starts validating once it is attached and serving. Nothing waits for `ACTIVE`. For that
whole window every browser and every app client fails the TLS handshake — the product is
down, not degraded.

`create_before_destroy` does not save you. It guarantees the proxy always references
*some* certificate; it says nothing about that certificate being valid.

This bit prod: `cert_version` shipped with a default of `"v1"` on 2026-08-23 to force a
replacement that was needed at the time, the certificate then went `ACTIVE` on Google's
own retry, and the now-pointless rename sat in the code for eleven days. Any bare
`terraform apply` in `envs/prod` would have taken the API offline. The default is now
`""`, which reproduces the live name `showme-api-lb-cert`, and `terraform plan` is quiet.

Check the live one before touching anything:

```bash
gcloud compute ssl-certificates list --global --project prod-showme \
  --format="table(name,managed.status,managed.domains,expireTime)"
```

### If it is ACTIVE — do not replace it

There is nothing to fix. Renew is automatic. If you genuinely need a *healthy*
certificate rotated (a domain added, say), it has to **overlap**, because a managed cert
cannot validate before it is attached:

1. Add the new certificate as a second resource in the module and put **both** ids in
   `google_compute_target_https_proxy.default.ssl_certificates`. Apply. The old cert
   keeps serving every handshake; the new one provisions behind it.
2. Wait for the new one to report `ACTIVE` (15-60 min) — poll with the `describe`
   command below. Do not proceed on a `PROVISIONING`.
3. Remove the old certificate from the list, and then the old resource. Apply again.

Two applies, in that order, with a wait between. There is no one-shot version of this.

### If it is FAILED_NOT_VISIBLE or expired — replacing it is the fix

A managed certificate can only provision **after** the domain already resolves to the
load balancer's IP. Create the cert first and it fails:

```bash
gcloud compute ssl-certificates describe showme-api-lb-cert \
  --global --project prod-showme --format="value(managed.status,managed.domainStatus)"
# PROVISIONING   api.showme.music=FAILED_NOT_VISIBLE
```

Google retries by itself, so if the DNS record was added recently, **wait up to an hour
and re-check before changing anything**. Confirm the record is globally visible first —
this is what the provisioning check actually looks at:

```bash
dig +short @8.8.8.8 api.showme.music A     # must equal the LB's static IP
curl -sI http://api.showme.music/api/v1/health | head -1   # 301 → the LB is wired
```

Still failing after that? Then there is no working TLS to lose, and a straight
replacement is correct — a managed cert cannot be re-provisioned in place, and a fresh
one needs a fresh name. Bump `cert_version`:

```bash
cd infra/envs/prod
terraform apply -var="cert_version=v2"
```

Then persist the value in `envs/prod/variables.tf` so the next plan is quiet, and leave
it there — do not reset it to `""` afterwards, or the next apply renames the cert back
and replaces it again.

## Cut the marketing form over to the custom domain

Once the cert is ACTIVE and the health check passes over `api.showme.music`:

1. In `apps/marketing/.env.production`, set
   `VITE_LEAD_ENDPOINT=https://api.showme.music/api/v1/public/leads`
   (reverting the interim `run.app` origin).
2. Rebuild + redeploy marketing:
   ```bash
   pnpm --filter @showme/marketing build
   firebase deploy --only hosting --project showme-production --account daniel.islandman@gmail.com
   ```

## Optional hardening (after cutover)

Once all traffic goes through the LB, restrict the service so the raw `run.app`
URL is no longer directly reachable — do this **only after** the cutover, since the
form uses `run.app` until then:

```bash
gcloud run services update showme-api --region europe-north2 --project prod-showme \
  --ingress internal-and-cloud-load-balancing
```

Consider adding a Cloud Armor policy to the backend service for WAF + rate limiting.

## Schedule the jobs in production (envs/prod, `modules/scheduled-jobs`)

`apps/jobs` has never run in production. Until this is applied, no reaper runs: 30-day
performer offers and 90-day venue handoffs keep their `pending` status forever, expired
shares are never revoked, an agreed-future representation termination never lands in
stored state, and `exchange_rate_cache` goes stale.

Reads are already correct without it — the share route 404s a share past its `expiresAt`
and every representation reader asks `isRepresentationActiveAt` — so this closes
**stored-state drift**, not a correctness hole. That is also why the schedule can be
four-hourly rather than tight.

### What it declares

| Resource | Why |
|---|---|
| Cloud Run **Job** `showme-jobs` | `apps/jobs` runs to completion and serves no traffic, so a service would fail its startup probe |
| Cloud Scheduler job `showme-jobs-schedule` | `0 */4 * * *` UTC → `POST …/jobs/showme-jobs:run` |
| Service account `showme-jobs-runner` | The job's identity: `roles/cloudsql.client` + `secretAccessor` on **exactly** its two secrets |
| Service account `showme-jobs-trigger` | Cloud Scheduler's identity: `roles/run.invoker` on the job and nothing else |
| `google_project_service` `cloudscheduler` | The API is off on `prod-showme` — nothing has ever used Scheduler there |

**Why every four hours:** the binding constraint is the exchange-rate refresh, not the
reapers. `apps/jobs/src/exchange-rate.ts` exports the same `0 */4 * * *` as
`REFRESH_CRON` because 6 runs/day ≈ 180 calls/month sits well inside ExchangeRate-API's
free 1500, while hourly (720) starts to crowd it. The reapers lose nothing at that
cadence: two of them measure 30 and 90 days, and the two time-sensitive ones already
answer correctly on read.

### Before `terraform apply` — three things must exist

1. **The container image.** `Dockerfile.jobs` (repo root) and `apps/jobs/esbuild.mjs`
   now exist, so this is just a build — the API image still cannot be reused with a
   different command, since it contains only the API's `dist/server.mjs`.

   Build and push to the tag `var.jobs_image` names (the same Artifact Registry
   repository Cloud Build made for `gcloud run deploy showme-api --source .`):

   ```bash
   IMAGE=europe-north2-docker.pkg.dev/prod-showme/cloud-run-source-deploy/showme-jobs:latest
   docker build -f Dockerfile.jobs -t "$IMAGE" .
   docker push "$IMAGE"
   ```

   Terraform owns the image reference, so shipping a new build later means pushing the
   tag **and** re-applying (or `terraform apply -var="jobs_image=…:<new tag>"`).

2. **The `EXCHANGE_RATE_API` secret.** `DATABASE_URL` already exists (showme-api uses
   it); this one does not. The FX refresh throws without a key and that fails the whole
   execution, so it is required, not optional:

   ```bash
   printf %s "<key>" | gcloud secrets create EXCHANGE_RATE_API \
     --project prod-showme --replication-policy automatic --data-file=-
   ```

3. **Cloud Scheduler in `europe-west1`.** Cloud Scheduler exists in **neither** Nordic
   region. `var.scheduler_region` was `europe-north1` (Finland) on the assumption it was
   only Stockholm that was thin, and that failed the apply outright with
   `Location 'europe-north1' is not a valid location`. Confirmed against the project
   rather than assumed:

   ```bash
   gcloud scheduler locations list --project prod-showme
   # europe-central2, europe-west1..4, europe-west6, europe-west8, europe-west9 (+ non-EU)
   ```

   `europe-west1` (Belgium) is the pick: an EU region, so nothing crosses a border, and
   Google's oldest and most broadly supported European one. The hop costs nothing that
   matters — the scheduler's whole job is one authenticated POST to the Cloud Run Admin
   API with no payload and a 60s deadline. The *work* still happens in Stockholm, next
   to the database.

### Apply and verify

```bash
cd infra/envs/prod
terraform init
terraform plan
terraform apply
```

Then prove it end to end, without waiting four hours for the trigger:

```bash
# 1. The job runs at all (this is the container + secrets + Cloud SQL path).
gcloud run jobs execute showme-jobs --project prod-showme --region europe-north2 --wait

# 2. Its output is the orchestrator's JSON summary — `errors: []` is the pass.
gcloud logging read \
  'resource.type=cloud_run_job AND resource.labels.job_name=showme-jobs' \
  --project prod-showme --limit 20 --format='value(textPayload)'

# 3. The SCHEDULE works — this exercises the trigger service account and run.invoker,
#    which step 1 does not.
gcloud scheduler jobs run showme-jobs-schedule --project prod-showme --location europe-west1
gcloud run jobs executions list --job showme-jobs --project prod-showme --region europe-north2
```

A run that fails only on `exchangeRates: EXCHANGE_RATE_API is not set` means step 2 of
the prerequisites was skipped — the reapers themselves still ran, and their counts are
in the same JSON line.
