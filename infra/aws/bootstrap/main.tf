terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "bucket_name" {
  description = "Name of the Terraform state bucket; must match backend.tf in the root module."
  type        = string
  default     = "cb-codebox-tfstate"
}

variable "region" {
  description = "Region of the state bucket; must match backend.tf in the root module."
  type        = string
  default     = "eu-west-1"
}

resource "aws_s3_bucket" "state" {
  bucket        = var.bucket_name
  force_destroy = false

  tags = {
    Name      = var.bucket_name
    ManagedBy = "terraform-bootstrap"
  }

  # The state bucket outlives every stack it describes; a stray destroy must not take it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    bucket_key_enabled = true

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
