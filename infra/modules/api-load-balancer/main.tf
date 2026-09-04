# Global external Application Load Balancer fronting the Cloud Run API service so
# a custom domain can be attached to it. europe-north2 (Stockholm) does NOT support
# native Cloud Run domain mappings (the API returns HTTP 501 "not allowed in
# europe-north2"), so a global external HTTPS load balancer with a serverless
# network endpoint group is the supported way to put a custom domain in front of a
# Cloud Run service in that region.
#
# Traffic path: client → A record (global anycast IP) → HTTPS forwarding rule →
# target HTTPS proxy (managed cert) → URL map → backend service → serverless NEG →
# Cloud Run service.

locals {
  name = var.name_prefix
}

# Reserved global anycast IP. The domain's DNS A record points here; it is stable
# across LB changes, so keep it reserved even if the rest is torn down and rebuilt.
resource "google_compute_global_address" "default" {
  project = var.project_id
  name    = "${local.name}-ip"
}

# Serverless NEG targeting the Cloud Run service. This is regional and MUST live in
# the same region as the service; the rest of the LB is global.
resource "google_compute_region_network_endpoint_group" "serverless" {
  project               = var.project_id
  name                  = "${local.name}-neg"
  region                = var.cloud_run_region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.cloud_run_service
  }
}

# Global backend service wrapping the serverless NEG. Serverless NEGs use no health
# checks and no explicit protocol — the LB-to-Cloud-Run hop is Google-managed.
resource "google_compute_backend_service" "default" {
  project               = var.project_id
  name                  = "${local.name}-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"

  backend {
    group = google_compute_region_network_endpoint_group.serverless.id
  }
}

resource "google_compute_url_map" "default" {
  project         = var.project_id
  name            = "${local.name}-urlmap"
  default_service = google_compute_backend_service.default.id
}

# Google-managed SSL certificate. Provisioning to ACTIVE requires the domain's A
# record to already resolve to google_compute_global_address.default — so create the
# LB, add the DNS record, then wait (typically 15-60 min) for the cert to go ACTIVE.
# Until the domain resolves here the cert reports FAILED_NOT_VISIBLE. Google retries
# on its own, but a cert that has given up needs REPLACING: a managed cert cannot be
# re-provisioned in place, and a new one needs a new NAME, which is what
# `cert_version` is for.
#
# ── Why the default version is empty ─────────────────────────────────────────────
# The live certificate on prod is named `showme-api-lb-cert`, with no suffix: it was
# created before `cert_version` existed and it went ACTIVE on Google's own retry.
# `cert_version = "v1"` was written on 2026-08-23 to force the replacement that the
# retry then made unnecessary — and never applied. It sat in the code for eleven days
# as a trap: `name` forces replacement, so the next bare `terraform apply` in
# envs/prod would have replaced a healthy certificate. See the "what replacement
# costs" note below for why that is an outage and not a blip.
#
# So the default reproduces the name that is actually live, and the suffix is only
# added when a version is asked for. Do not re-introduce a default suffix to "tidy"
# the name — the tidying is a full TLS outage.
#
# ── What replacement costs, and when it is nonetheless right ─────────────────────
# `create_before_destroy` guarantees the proxy always references SOME certificate,
# which is NOT the same as always serving a VALID one. Terraform swaps the proxy onto
# the new cert the moment it is created, and a managed cert only begins validating
# once it is attached and serving — 15-60 minutes at PROVISIONING, during which every
# TLS handshake on this domain fails. Nothing in Terraform waits for ACTIVE.
#
# That price is worth paying in exactly one situation: the current certificate is
# ALREADY broken (FAILED_NOT_VISIBLE, or expired). Then there is no working TLS to
# lose and a straight replacement is the fix — the case this variable was built for.
#
# Never bump `cert_version` to rotate a HEALTHY certificate. A healthy one needs an
# overlap the single-resource shape here cannot express: attach the new cert
# alongside the old, wait for ACTIVE, then remove the old in a second apply. The
# procedure for that is in infra/README.md.
resource "google_compute_managed_ssl_certificate" "default" {
  project = var.project_id
  name    = var.cert_version == "" ? "${local.name}-cert" : "${local.name}-cert-${var.cert_version}"

  managed {
    domains = [var.domain]
  }

  # The HTTPS proxy holds a reference, so destroy-then-create fails with "resource in
  # use". This makes a replacement possible at all; it does not make one safe.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "default" {
  project          = var.project_id
  name             = "${local.name}-https-proxy"
  url_map          = google_compute_url_map.default.id
  ssl_certificates = [google_compute_managed_ssl_certificate.default.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  project               = var.project_id
  name                  = "${local.name}-https-rule"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.default.id
  ip_address            = google_compute_global_address.default.id
}

# Port 80 → 301 redirect to HTTPS, so http://api.showme.music also works.
resource "google_compute_url_map" "https_redirect" {
  project = var.project_id
  name    = "${local.name}-https-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "http" {
  project = var.project_id
  name    = "${local.name}-http-proxy"
  url_map = google_compute_url_map.https_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  project               = var.project_id
  name                  = "${local.name}-http-rule"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.http.id
  ip_address            = google_compute_global_address.default.id
}
