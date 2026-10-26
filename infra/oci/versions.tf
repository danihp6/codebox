terraform {
  required_version = ">= 1.10.0"

  required_providers {
    oci = {
      source  = "hashicorp/oci"
      version = "9.11.0"
    }
  }
}
