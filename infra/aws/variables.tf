variable "aws_region" {
  description = "AWS region for every resource in the stack."
  type        = string
  default     = "eu-west-1"

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.aws_region))
    error_message = "aws_region must be an AWS region code such as eu-west-1."
  }
}

variable "admin_cidr" {
  description = "The operator's public IPv4 address as a single-host CIDR; the only source admitted on tcp/22."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && endswith(var.admin_cidr, "/32")
    error_message = "admin_cidr must be one IPv4 host in /32 form, for example 203.0.113.7/32."
  }

  validation {
    condition     = var.admin_cidr != "0.0.0.0/0"
    error_message = "admin_cidr must never be 0.0.0.0/0: SSH is restricted to the operator's address."
  }
}

variable "vpc_cidr" {
  description = "CIDR of the VPC."
  type        = string
  default     = "10.42.0.0/16"

  validation {
    condition     = can(cidrnetmask(var.vpc_cidr))
    error_message = "vpc_cidr must be an IPv4 CIDR block."
  }
}

variable "public_subnet_cidr" {
  description = "CIDR of the single public subnet."
  type        = string
  default     = "10.42.1.0/24"

  validation {
    condition     = can(cidrnetmask(var.public_subnet_cidr))
    error_message = "public_subnet_cidr must be an IPv4 CIDR block."
  }
}

variable "ami_id" {
  description = "AMI to boot; empty means the most recent Canonical Ubuntu 24.04 arm64 image."
  type        = string
  default     = ""

  validation {
    condition     = var.ami_id == "" || can(regex("^ami-[0-9a-f]{8,17}$", var.ami_id))
    error_message = "ami_id must be empty or an ami-* identifier."
  }
}

variable "instance_type" {
  description = "Spot instance type; the documented degradation is c7g.xlarge."
  type        = string
  default     = "c7g.2xlarge"

  validation {
    condition     = can(regex("^[a-z0-9]+\\.[a-z0-9]+$", var.instance_type))
    error_message = "instance_type must look like c7g.2xlarge."
  }
}

variable "spot_max_price" {
  description = "Hourly price cap for the spot request, in USD."
  type        = string
  default     = "0.40"

  validation {
    condition     = can(regex("^[0-9]+(\\.[0-9]+)?$", var.spot_max_price))
    error_message = "spot_max_price must be a decimal hourly price such as 0.40; it is never empty."
  }
}

variable "root_volume_gb" {
  description = "Size of the encrypted gp3 root volume, in GiB."
  type        = number
  default     = 100

  validation {
    condition     = var.root_volume_gb >= 20
    error_message = "root_volume_gb must be at least 20 GiB."
  }
}

variable "backup_bucket_name" {
  description = "Name of the versioned dump bucket; S3 names are global, so it is overridable."
  type        = string
  default     = "cb-codebox-backups"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.backup_bucket_name))
    error_message = "backup_bucket_name must be a valid S3 bucket name."
  }
}

variable "budget_limit_usd" {
  description = "Monthly cost budget in USD that raises the alarm."
  type        = number
  default     = 50

  validation {
    condition     = var.budget_limit_usd > 0
    error_message = "budget_limit_usd must be positive."
  }
}

variable "budget_alert_email" {
  description = "Address that receives the 80 % budget notification; empty skips the subscriber."
  type        = string
  default     = ""

  validation {
    condition     = var.budget_alert_email == "" || can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.budget_alert_email))
    error_message = "budget_alert_email must be empty or an email address."
  }
}

variable "project" {
  description = "Value of the Project tag on every resource."
  type        = string
  default     = "codebox"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project))
    error_message = "project must be a lowercase slug."
  }
}
