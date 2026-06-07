# This module is applied directly (by `examples/gcp-cloud-run/scripts/smoke.sh`
# and `hyperframes cloudrun deploy`), so it configures the google provider
# from its own variables. Credentials come from the environment — either
# Application Default Credentials (`gcloud auth application-default login`)
# or a `GOOGLE_OAUTH_ACCESS_TOKEN` env var.
#
# If you instead embed this as a CHILD module, delete this block and pass a
# configured provider from your root module.
provider "google" {
  project = var.project_id
  region  = var.region
}
