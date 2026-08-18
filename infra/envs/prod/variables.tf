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
