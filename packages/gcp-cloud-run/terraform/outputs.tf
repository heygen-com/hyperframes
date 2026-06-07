output "render_bucket_name" {
  description = "GCS bucket holding plan tarballs, chunk outputs, and final renders. Pass as renderToCloudRun({ bucketName })."
  value       = google_storage_bucket.render.name
}

output "service_url" {
  description = "HTTPS URL of the Cloud Run render service. Pass as renderToCloudRun({ serviceUrl })."
  value       = google_cloud_run_v2_service.render.uri
}

output "workflow_name" {
  description = "Workflow id. Pass as renderToCloudRun({ workflowId })."
  value       = google_workflows_workflow.render.name
}

output "workflow_id_full" {
  description = "Fully-qualified workflow resource name."
  value       = google_workflows_workflow.render.id
}

output "run_service_account_email" {
  description = "Render service identity (read/write the render bucket)."
  value       = google_service_account.run_sa.email
}

output "workflow_service_account_email" {
  description = "Workflow identity (invokes the render service)."
  value       = google_service_account.workflow_sa.email
}

output "region" {
  description = "Region everything was deployed into. Pass as renderToCloudRun({ location })."
  value       = var.region
}
