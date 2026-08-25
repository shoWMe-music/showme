output "job_name" {
  value       = google_cloud_run_v2_job.scheduled_jobs.name
  description = "Cloud Run Job name; run it by hand with `gcloud run jobs execute`."
}

output "scheduler_job_name" {
  value       = google_cloud_scheduler_job.scheduled_jobs.name
  description = "Cloud Scheduler job name; force a run with `gcloud scheduler jobs run`."
}

output "runner_service_account_email" {
  value       = google_service_account.runner.email
  description = "Identity the job runs as — grant it any further access it needs."
}

output "trigger_service_account_email" {
  value       = google_service_account.trigger.email
  description = "Identity Cloud Scheduler uses to start the job."
}
