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
