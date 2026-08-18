variable "project_id" {
  type        = string
  description = "GCP project hosting the Cloud Run service and the load balancer."
}

variable "cloud_run_region" {
  type        = string
  description = "Region of the Cloud Run service (the serverless NEG must match it)."
}

variable "cloud_run_service" {
  type        = string
  description = "Name of the Cloud Run service to put behind the load balancer."
}

variable "domain" {
  type        = string
  description = "Custom domain to serve (a managed cert is provisioned for it)."
}

variable "name_prefix" {
  type        = string
  description = "Prefix for the names of the load-balancer resources."
  default     = "showme-api-lb"
}
