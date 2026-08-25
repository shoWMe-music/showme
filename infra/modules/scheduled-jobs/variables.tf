variable "project_id" {
  type        = string
  description = "GCP project hosting the Cloud Run Job, the schedule and the secrets."
}

variable "cloud_run_region" {
  type        = string
  description = "Region for the Cloud Run Job (put it with the Cloud SQL instance)."
}

# Cloud Scheduler is not offered in every region Cloud Run is — europe-north2
# (Stockholm) is a young region, and the same thinness is why the API needed a load
# balancer instead of a domain mapping. The trigger is one HTTPS call per run, so
# hosting the schedule a region away costs nothing measurable; keep it separate from
# `cloud_run_region` so it can be moved without moving the job.
variable "scheduler_region" {
  type        = string
  description = "Region for the Cloud Scheduler job. Need not match cloud_run_region."
}

variable "cloud_sql_instance_connection_name" {
  type        = string
  description = "Cloud SQL connection name, `<project>:<region>:<instance>`, mounted at /cloudsql."
}

variable "image" {
  type        = string
  description = "Container image running `apps/jobs` (see infra/README.md for how it is built)."
}

variable "database_url_secret_name" {
  type        = string
  description = "Secret Manager secret holding DATABASE_URL (the unix-socket form)."
}

variable "exchange_rate_api_secret_name" {
  type        = string
  description = "Secret Manager secret holding the ExchangeRate-API key (EXCHANGE_RATE_API)."
}

# Every four hours, and the binding constraint is the exchange-rate refresh, not the
# reapers: `apps/jobs/src/exchange-rate.ts` exports this same expression as
# `REFRESH_CRON` because 6 runs/day ≈ 180 API calls/month sits well inside the free
# tier's 1500, while hourly (720) starts to crowd it.
#
# Four hours is ample for the reapers. Offers expire at 30 days and handoffs at 90, so
# a few hours of lag is invisible. Shares and representation terminations are the
# time-sensitive pair, and both are already CORRECT on read without this job ever
# running — `apps/api/src/routes/shares.ts` 404s a share whose `expiresAt` has passed,
# and every representation reader asks `isRepresentationActiveAt`. What the reapers do
# is make the STORED state agree. So the window this schedule sets is convergence lag,
# not a window of wrong answers.
variable "schedule" {
  type        = string
  description = "Unix cron for the trigger, in UTC."
  default     = "0 */4 * * *"
}

variable "name_prefix" {
  type        = string
  description = "Prefix for the names of the job, schedule and service accounts."
  default     = "showme-jobs"
}
