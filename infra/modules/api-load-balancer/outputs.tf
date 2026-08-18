output "load_balancer_ip" {
  value       = google_compute_global_address.default.address
  description = "Global anycast IP. Create the domain's DNS A record pointing here."
}

output "ssl_certificate_name" {
  value       = google_compute_managed_ssl_certificate.default.name
  description = "Managed cert name; check its status with `gcloud compute ssl-certificates describe`."
}
