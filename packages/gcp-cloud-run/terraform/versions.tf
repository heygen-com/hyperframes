terraform {
  required_version = ">= 1.16.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.45.2"
    }
  }
}
