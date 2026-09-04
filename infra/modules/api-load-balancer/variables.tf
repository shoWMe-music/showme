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

# Suffix on the managed certificate's name. Empty means no suffix, which is the name
# the live prod certificate actually carries (`showme-api-lb-cert`) — so the default
# leaves a healthy certificate alone and `terraform plan` stays quiet.
#
# Setting this REPLACES the certificate, and replacement means 15-60 minutes of failed
# TLS on the domain while the new one provisions. That is the right trade only when the
# current certificate is already broken (FAILED_NOT_VISIBLE or expired). To rotate a
# healthy one you need an overlap instead — see the comment on the resource in main.tf
# and the procedure in infra/README.md.
variable "cert_version" {
  type        = string
  description = "Suffix for the managed SSL certificate name. Empty = the live unsuffixed name. Setting it replaces the certificate and drops TLS for 15-60 min; only do that when the current one has already failed."
  default     = ""
}
