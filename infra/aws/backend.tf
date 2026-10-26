terraform {
  # The bucket is created once by bootstrap/; its default name must match this literal.
  # Native S3 locking (use_lockfile) replaces the DynamoDB table.
  backend "s3" {
    bucket       = "cb-codebox-tfstate"
    key          = "infra/aws/terraform.tfstate"
    region       = "eu-west-1"
    encrypt      = true
    use_lockfile = true
  }
}
