terraform {
  backend "s3" {
    bucket = "cb-backups"
    key    = "infra/oci/terraform.tfstate"

    use_lockfile = true
    encrypt      = true

    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    use_path_style              = true

    # OCI Object Storage speaks the S3 API, but its namespace is per tenancy: the endpoint is
    # not guessed here. `region` and `endpoints` come from `-backend-config` (see README).
    endpoints {}
  }
}
