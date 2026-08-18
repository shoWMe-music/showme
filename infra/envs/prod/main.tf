# prod environment: an external HTTPS load balancer in front of the showme-api
# Cloud Run service, exposing it at api.showme.music.

module "api_load_balancer" {
  source = "../../modules/api-load-balancer"

  project_id        = var.project_id
  cloud_run_region  = var.cloud_run_region
  cloud_run_service = var.cloud_run_service
  domain            = var.domain
}

output "load_balancer_ip" {
  value       = module.api_load_balancer.load_balancer_ip
  description = "Point the api.showme.music A record at this IP."
}

output "ssl_certificate_name" {
  value = module.api_load_balancer.ssl_certificate_name
}
