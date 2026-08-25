terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Remote state in GCS. Bootstrap the bucket once with gcloud (see infra/README.md)
  # before `terraform init` — the state bucket is the one piece that can't be
  # Terraform-managed from empty (chicken-and-egg).
  # NOTE the prefix is historical: this state now holds the whole prod environment
  # (load balancer AND scheduled jobs), not just the load balancer. Renaming it would
  # orphan the existing state object, so it stays as it is.
  backend "gcs" {
    bucket = "prod-showme-tfstate"
    prefix = "prod/api-load-balancer"
  }
}

provider "google" {
  project = var.project_id
  region  = var.cloud_run_region
}
