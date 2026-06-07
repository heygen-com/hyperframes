# HyperFrames distributed render stack on Google Cloud.
#
# Topology (the GCP twin of the AWS Lambda adapter's SAM template):
#
#   GCS bucket  ←→  Cloud Run service (plan / renderChunk / assemble)
#                        ▲
#                        │ OIDC-authenticated http.post per step
#                        │
#                   Cloud Workflows  (Plan → parallel RenderChunk → Assemble)
#
# Two service accounts keep least-privilege boundaries:
#   - run_sa     : the render service's identity; read/write the bucket only.
#   - workflow_sa: the workflow's identity; invoke the render service only.

locals {
  workflow_source = var.workflow_source_path != "" ? var.workflow_source_path : "${path.module}/workflow.yaml"
  name            = var.project_name
}

# ── Storage: plan tarballs, chunk outputs, final renders ─────────────────────
resource "google_storage_bucket" "render" {
  name                        = "${local.name}-render-${var.project_id}"
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = var.bucket_force_destroy

  # Render artifacts (plan tarballs, chunk files) are disposable scratch.
  # Sweep them after 7 days so the bucket doesn't accumulate cost; final
  # outputs that adopters want to keep should be copied elsewhere.
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}

# ── Service accounts ─────────────────────────────────────────────────────────
resource "google_service_account" "run_sa" {
  account_id   = "${local.name}-run"
  project      = var.project_id
  display_name = "HyperFrames render service (Cloud Run)"
}

resource "google_service_account" "workflow_sa" {
  account_id   = "${local.name}-wf"
  project      = var.project_id
  display_name = "HyperFrames render orchestration (Workflows)"
}

# Render service reads inputs + writes outputs in the render bucket only.
resource "google_storage_bucket_iam_member" "run_sa_bucket" {
  bucket = google_storage_bucket.render.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.run_sa.email}"
}

# ── Cloud Run render service ─────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "render" {
  name     = "${local.name}-render"
  project  = var.project_id
  location = var.region
  # Authenticated only — no public invoker binding. Only the workflow SA can
  # call it. Ingress stays "all" because Workflows reaches the service over
  # Google's front door, not the VPC.
  ingress = "INGRESS_TRAFFIC_ALL"
  # Let `terraform destroy` (and replacement on image bumps) remove the
  # service without a manual console step. The render service is stateless —
  # all durable artifacts live in GCS.
  deletion_protection = false

  template {
    service_account = google_service_account.run_sa.email
    timeout         = "${var.request_timeout_seconds}s"
    # One render (chunk / plan / assemble) per instance — each uses the whole
    # box's CPU + memory + /tmp. The workflow's concurrency_limit governs how
    # many instances run at once.
    max_instance_request_concurrency = 1

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # Keep CPU allocated only during request processing (request-based
        # billing). Renders are entirely request-scoped.
        cpu_idle = true
      }

      env {
        # Scopes every event's GCS URIs to this bucket (the handler's
        # GCS_URI_NOT_ALLOWED guard). Defense against request injection.
        name  = "HYPERFRAMES_RENDER_BUCKET"
        value = google_storage_bucket.render.name
      }

      startup_probe {
        http_get {
          path = "/healthz"
        }
        timeout_seconds   = 5
        period_seconds    = 10
        failure_threshold = 6
      }
    }
  }
}

# Only the workflow's identity may invoke the render service.
resource "google_cloud_run_v2_service_iam_member" "workflow_invokes_run" {
  name     = google_cloud_run_v2_service.render.name
  project  = var.project_id
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.workflow_sa.email}"
}

# ── Cloud Workflows orchestration ────────────────────────────────────────────
resource "google_workflows_workflow" "render" {
  name            = "${local.name}-render"
  project         = var.project_id
  region          = var.region
  service_account = google_service_account.workflow_sa.id
  source_contents = file(local.workflow_source)
  # Allow `terraform destroy` to remove the workflow without a manual step;
  # the definition is reproducible from this module.
  deletion_protection = false
}

# ── Runaway-request alert (backstop against a fan-out bug) ────────────────────
resource "google_monitoring_alert_policy" "runaway_requests" {
  project      = var.project_id
  display_name = "${local.name}-render runaway request count"
  combiner     = "OR"

  conditions {
    display_name = "Render service request count > threshold (1h)"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"cloud_run_revision\"",
        "resource.labels.service_name = \"${google_cloud_run_v2_service.render.name}\"",
        "metric.type = \"run.googleapis.com/request_count\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = var.render_request_alarm_threshold
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = var.notification_channels
}

# ── Workflow-failure alert ───────────────────────────────────────────────────
# Request-count alone misses a render that fails 100% of the time at low
# volume. Alert on any FAILED workflow execution so a broken render path is
# visible even when traffic is light.
resource "google_monitoring_alert_policy" "workflow_failures" {
  project      = var.project_id
  display_name = "${local.name}-render workflow execution failures"
  combiner     = "OR"

  conditions {
    display_name = "Failed workflow executions (5m)"
    condition_threshold {
      filter = join(" AND ", [
        "resource.type = \"workflows.googleapis.com/Workflow\"",
        "resource.labels.workflow_id = \"${google_workflows_workflow.render.name}\"",
        "metric.type = \"workflows.googleapis.com/finished_execution_count\"",
        "metric.labels.status = \"FAILED\"",
      ])
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = var.notification_channels
}
