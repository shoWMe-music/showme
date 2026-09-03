variable "project_id" {
  type    = string
  default = "prod-showme"
}

variable "cloud_run_region" {
  type    = string
  default = "europe-north2"
}

variable "cloud_run_service" {
  type    = string
  default = "showme-api"
}

variable "domain" {
  type    = string
  default = "api.showme.music"
}

# --- Scheduled jobs (apps/jobs) ---------------------------------------------------

variable "cloud_sql_instance_connection_name" {
  type    = string
  default = "prod-showme:europe-north2:showme-production-db"
}

# Cloud Scheduler in Finland rather than Stockholm: availability in europe-north2 is
# not confirmed, and the trigger is a single HTTPS call per run, so the cross-region
# hop is free in every sense that matters. Change this to `europe-north2` if Scheduler
# is offered there — nothing else has to move.
# CLOUD SCHEDULER DOES NOT EXIST IN EITHER NORDIC REGION.
#
# Everything else here is `europe-north2` (Stockholm) — the database, Cloud Run,
# the API. Scheduler is not offered there, and it is not offered in `europe-north1`
# (Finland) either, which was this variable's original default and which failed the
# apply with `Location 'europe-north1' is not a valid location`. Confirmed against
# the project rather than assumed:
#
#   gcloud scheduler locations list --project prod-showme
#   → europe-central2, europe-west1..4, europe-west6, europe-west8, europe-west9 (+ non-EU)
#
# `europe-west1` (Belgium) is the pick: an EU region, so nothing about this crosses
# a border, and Google's oldest and most broadly supported European one.
#
# The cross-region hop costs nothing that matters. The scheduler's entire job is one
# authenticated POST to the Cloud Run Admin API telling it to start an execution —
# no payload, no personal data, and the deadline for that call is 60s against a
# round trip measured in milliseconds. The WORK still happens in Stockholm, next to
# the database.
variable "scheduler_region" {
  type    = string
  default = "europe-west1"
}

# The image running `apps/jobs`. `cloud-run-source-deploy` is the Artifact Registry
# repository Cloud Build creates for `gcloud run deploy --source .`, which is how
# showme-api was shipped, so the jobs image belongs beside it. This tag must EXIST
# before `terraform apply` — see infra/README.md for the build command.
variable "jobs_image" {
  type    = string
  default = "europe-north2-docker.pkg.dev/prod-showme/cloud-run-source-deploy/showme-jobs:latest"
}

variable "database_url_secret_name" {
  type    = string
  default = "DATABASE_URL"
}

variable "exchange_rate_api_secret_name" {
  type = string
  # No such secret exists on prod-showme. The FX refresh is display-only, so the
  # other six jobs run without it and this is set the day the key is bought.
  default = ""
}
