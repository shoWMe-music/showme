# Infrastructure (Terraform)

All infrastructure lives here as Terraform. `gcloud` is only for the one-time state
bucket bootstrap and interactive logins — everything else is `terraform apply`.

```
infra/
  modules/
    api-load-balancer/   # external HTTPS LB → serverless NEG → Cloud Run service
  envs/
    prod/                # prod-showme: puts api.showme.music in front of showme-api
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

## If the certificate is stuck at FAILED_NOT_VISIBLE

A Google-managed certificate can only provision **after** the domain already resolves to
the load balancer's IP. Create the cert first and it fails, reporting:

```bash
gcloud compute ssl-certificates describe showme-api-lb-cert-v1 \
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

If it is still failing after that, the cert has to be **replaced** — a managed cert
cannot be re-provisioned in place. Bump `cert_version` and apply:

```bash
cd infra/envs/prod
terraform apply -var="cert_version=v2"
```

`create_before_destroy` means the new cert is minted and attached before the old one is
removed, so the proxy is never without a certificate. Without it the apply fails with
"resource in use", since the HTTPS proxy references the cert.

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
