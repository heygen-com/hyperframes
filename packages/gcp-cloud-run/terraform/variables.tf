variable "project_id" {
  type        = string
  description = "GCP project id to deploy the render stack into."
}

variable "region" {
  type        = string
  description = "Region for the Cloud Run service, Workflow, and bucket."
  default     = "us-central1"
}

variable "project_name" {
  type        = string
  description = "Name prefix applied to the service / workflow / bucket / service accounts."
  default     = "hyperframes"
}

variable "image" {
  type        = string
  description = "Fully-qualified container image for the render service (e.g. us-central1-docker.pkg.dev/PROJECT/REPO/hyperframes-render:TAG), built from packages/gcp-cloud-run/Dockerfile."
}

variable "cpu" {
  type        = string
  description = "vCPU per Cloud Run instance. Allowed: 1, 2, 4, 8. Renders are CPU-bound; 4 is a good default."
  default     = "4"
}

variable "memory" {
  type        = string
  description = "Memory per Cloud Run instance. Must be ≥ 2Gi per vCPU at cpu=4. Headroom for Chrome + ffmpeg + the chunk's frames in /tmp."
  default     = "16Gi"
}

variable "request_timeout_seconds" {
  type        = number
  description = "Per-request timeout. Cloud Run hard cap is 3600s; a single chunk should finish well inside this."
  default     = 3600
}

variable "min_instances" {
  type        = number
  description = "Min Cloud Run instances. Default 0 (scale-to-zero) is cheapest but means the first render after idle pays a cold start (image pull + Chrome + bun boot, ~20-30s). Set to 1 to keep one warm if first-render latency matters."
  default     = 0
}

variable "max_instances" {
  type        = number
  description = "Max Cloud Run instances. Each chunk pins one instance (request concurrency = 1), and the workflow fans out up to the plan's chunk count (which never exceeds Config.maxParallelChunks). Keep this >= the largest maxParallelChunks you render with, or excess chunks queue behind 429s + retry backoff. Also a runaway-cost backstop."
  default     = 100
}

variable "workflow_source_path" {
  type        = string
  description = "Path to the Cloud Workflows YAML. Defaults to the copy shipped with this module."
  default     = ""
}

variable "render_request_alarm_threshold" {
  type        = number
  description = "Cloud Monitoring alert fires when render-service request count exceeds this in a 1-hour window. Backstop against a runaway fan-out."
  default     = 1000
}

variable "notification_channels" {
  type        = list(string)
  description = "Cloud Monitoring notification channel ids for the runaway-request alert. Empty disables notifications (the policy still records)."
  default     = []
}

variable "bucket_force_destroy" {
  type        = bool
  description = "Allow `terraform destroy` to delete the render bucket even when it still holds objects. Off by default to match the AWS adapter's RETAIN policy."
  default     = false
}
