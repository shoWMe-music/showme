# The scheduled jobs (`apps/jobs`) as a Cloud Run Job plus the Cloud Scheduler
# trigger that starts it.
#
# What runs: `apps/jobs/src/index.ts` — one process that executes all five jobs in
# sequence (expired performer offers, expired venue handoffs, expired shares,
# agreed-future representation terminations, and the display-only exchange-rate
# refresh), each isolated in its own try/catch, printing a JSON summary and exiting
# non-zero if any of them failed.
#
# Why a Cloud Run *Job* and not a service: this is a batch process that runs to
# completion and exits. It serves no traffic and listens on no port, so a Cloud Run
# service would fail its startup probe.
#
# Trigger path: Cloud Scheduler → (OAuth as the trigger service account) → Cloud Run
# Admin API `jobs.run` → one execution → one task → the container.

locals {
  name = var.name_prefix
}

# Cloud Scheduler has never been used in this project, so its API is off. Everything
# else the job needs (Cloud Run, Secret Manager, Cloud SQL Admin) is already enabled
# by the showme-api service, so only this one is declared here.
#
# `disable_on_destroy = false` because disabling a project-wide API is a far larger
# blast radius than the resources in this module — tearing the schedule down must not
# switch Scheduler off for anything else that might later depend on it.
resource "google_project_service" "cloud_scheduler" {
  project            = var.project_id
  service            = "cloudscheduler.googleapis.com"
  disable_on_destroy = false
}

# Two service accounts, deliberately. The RUNNER is the job's own identity: it reads
# the secrets and talks to Cloud SQL. The TRIGGER only has permission to start the
# job. Splitting them means a compromised scheduler trigger cannot read DATABASE_URL,
# and the runner cannot start extra executions of itself.
resource "google_service_account" "runner" {
  project      = var.project_id
  account_id   = "${local.name}-runner"
  display_name = "Runs the ${local.name} Cloud Run Job (database + secrets)"
}

resource "google_service_account" "trigger" {
  project      = var.project_id
  account_id   = "${local.name}-trigger"
  display_name = "Cloud Scheduler identity that starts the ${local.name} job"
}

# Cloud SQL access. The job reaches the instance the same way showme-api does — over
# the built-in Cloud SQL connector, using the unix socket under /cloudsql mounted
# below — and that connector authenticates as this service account, so it needs
# `cloudsql.client`. The role is only grantable at the project level; there is no
# per-instance IAM for it.
resource "google_project_iam_member" "runner_cloud_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runner.email}"
}

# Secret access is granted per secret rather than project-wide, so the runner can read
# exactly the two values it needs and none of the other secrets on the project
# (CLICKUP_API_TOKEN, FIREBASE_SERVICE_ACCOUNT, SHARE_JWT_SECRET, BREVO_API_KEY).
resource "google_secret_manager_secret_iam_member" "runner_database_url" {
  project   = var.project_id
  secret_id = var.database_url_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runner.email}"
}

resource "google_secret_manager_secret_iam_member" "runner_exchange_rate_api" {
  project   = var.project_id
  secret_id = var.exchange_rate_api_secret_name
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runner.email}"
}

resource "google_cloud_run_v2_job" "scheduled_jobs" {
  project  = var.project_id
  name     = local.name
  location = var.cloud_run_region

  # The job holds no state and is rebuilt from this file in minutes; the guard rail
  # that matters here is on the database, not on the schedule.
  deletion_protection = false

  template {
    # Exactly one task. The reapers are set-based UPDATEs over the same rows, so two
    # tasks running at once would race for the same work and the exchange-rate refresh
    # would spend two of the free tier's monthly API calls to write identical rows.
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.runner.email

      # One retry. Every job is idempotent — the reapers filter on the status they are
      # about to leave (`pending` → `expired`), and a representation termination is
      # committed per representation — so a retry after a partial run simply finishes
      # the remainder. Retrying more than once is not worth it: the next scheduled run
      # is at most `var.schedule` away and does the same work.
      max_retries = 1

      # Generous ceiling, not an expectation. The reapers touch a handful of rows and
      # the FX refresh is a single HTTP call; the timeout exists so a job wedged on a
      # lock is killed rather than billed.
      timeout = "600s"

      containers {
        image = var.image

        # `apps/jobs` reads its whole configuration from the environment: DATABASE_URL
        # (it exits 1 immediately without one) and EXCHANGE_RATE_API (the FX refresh
        # throws without it, which fails the whole execution — so it is required, not
        # optional, until the orchestrator learns to skip a job it has no key for).
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.database_url_secret_name
              version = "latest"
            }
          }
        }

        env {
          name = "EXCHANGE_RATE_API"
          value_source {
            secret_key_ref {
              secret  = var.exchange_rate_api_secret_name
              version = "latest"
            }
          }
        }

        # The DATABASE_URL secret holds a unix-socket URL
        # (`/cloudsql/<connection name>/...`) that only resolves inside a Cloud Run
        # container with the instance attached — this mount is what makes that path
        # exist. Same shape as showme-api's `--add-cloudsql-instances`.
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "512Mi"
          }
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [var.cloud_sql_instance_connection_name]
        }
      }
    }
  }
}

# The trigger service account may start this job and do nothing else with it.
resource "google_cloud_run_v2_job_iam_member" "trigger_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_job.scheduled_jobs.location
  name     = google_cloud_run_v2_job.scheduled_jobs.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.trigger.email}"
}

resource "google_cloud_scheduler_job" "scheduled_jobs" {
  project = var.project_id
  name    = "${local.name}-schedule"
  region  = var.scheduler_region

  description = "Runs the ${local.name} Cloud Run Job (reapers + exchange-rate refresh)."
  schedule    = var.schedule

  # Everything in this system is stored and reasoned about in UTC (docs/timezones.md);
  # the reapers are duration-based expiries measured from a UTC `created_at`, so there
  # is no local-time boundary for the schedule to align with. A UTC schedule also does
  # not shift twice a year under daylight saving.
  time_zone = "Etc/UTC"

  # The Cloud Run Admin API returns as soon as the execution is CREATED — it does not
  # wait for the container. So this deadline covers the API call, not the job's work.
  attempt_deadline = "60s"

  retry_config {
    # A retry here only re-issues `jobs.run`; it does not re-run a job that already
    # started. One retry covers a transient API blip without risking a second
    # execution racing the first for long.
    retry_count = 1
  }

  http_target {
    http_method = "POST"

    # The documented endpoint for starting a Cloud Run Job from Cloud Scheduler: the
    # REGIONAL Cloud Run Admin API host, v1 `namespaces` surface, `:run` verb. The
    # namespace is the project id.
    uri = "https://${var.cloud_run_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.project_id}/jobs/${google_cloud_run_v2_job.scheduled_jobs.name}:run"

    # An OAuth token, not OIDC: the callee is a Google API (run.googleapis.com), which
    # expects a Google access token. OIDC is for calling your own Cloud Run services.
    oauth_token {
      service_account_email = google_service_account.trigger.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [
    google_project_service.cloud_scheduler,
    google_cloud_run_v2_job_iam_member.trigger_invoker,
  ]
}
