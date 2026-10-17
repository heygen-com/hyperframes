terraform {
  required_version = ">= 1.16.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.45.2"
    }
  }
}
