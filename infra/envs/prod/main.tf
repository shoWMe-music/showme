# prod environment: an external HTTPS load balancer in front of the showme-api
# Cloud Run service, exposing it at api.showme.music.

module "api_load_balancer" {
  source = "../../modules/api-load-balancer"

  project_id        = var.project_id
  cloud_run_region  = var.cloud_run_region
  cloud_run_service = var.cloud_run_service
  domain            = var.domain
  cert_version      = var.cert_version
}

output "load_balancer_ip" {
  value       = module.api_load_balancer.load_balancer_ip
  description = "Point the api.showme.music A record at this IP."
}

output "ssl_certificate_name" {
  value = module.api_load_balancer.ssl_certificate_name
}

# The scheduled jobs: a Cloud Run Job running `apps/jobs` (the reapers plus the
# exchange-rate refresh) and the Cloud Scheduler trigger that starts it. Nothing in
# `apps/jobs` has ever executed in production, so expired offers, handoffs and shares
# stay in their pre-expiry status and an agreed-future representation termination
# never lands in stored state.

module "scheduled_jobs" {
  source = "../../modules/scheduled-jobs"

  project_id                         = var.project_id
  cloud_run_region                   = var.cloud_run_region
  scheduler_region                   = var.scheduler_region
  cloud_sql_instance_connection_name = var.cloud_sql_instance_connection_name
  image                              = var.jobs_image
  database_url_secret_name           = var.database_url_secret_name
  exchange_rate_api_secret_name      = var.exchange_rate_api_secret_name
}

output "scheduled_jobs_job_name" {
  value       = module.scheduled_jobs.job_name
  description = "Run it by hand: `gcloud run jobs execute <name> --region europe-north2`."
}

output "scheduled_jobs_schedule_name" {
  value = module.scheduled_jobs.scheduler_job_name
}

output "scheduled_jobs_runner_service_account" {
  value       = module.scheduled_jobs.runner_service_account_email
  description = "Identity the job runs as (Cloud SQL client + reader of its two secrets)."
}
