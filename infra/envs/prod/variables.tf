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
variable "scheduler_region" {
  type    = string
  default = "europe-north1"
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
  type    = string
  default = "EXCHANGE_RATE_API"
}
