terraform {
  required_version = ">= 1.17.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.45.2"
    }
  }
}
