variable "tenancy_ocid" {
  description = "OCID of the tenancy: the home of the dynamic group and the namespace of the bucket."
  type        = string
}

variable "compartment_ocid" {
  description = "OCID of the compartment every resource of this module lives in."
  type        = string
}

variable "region" {
  description = "OCI region, for example eu-madrid-1."
  type        = string
}

variable "admin_cidr" {
  description = "The operator's address, as a single IPv4 /32: the only source the security list admits on port 22."
  type        = string

  validation {
    condition     = can(cidrhost(var.admin_cidr, 0)) && can(regex("/32$", var.admin_cidr))
    error_message = "admin_cidr must be one IPv4 address in /32 form (for example 203.0.113.7/32); a range, and 0.0.0.0/0 in particular, is not accepted."
  }
}

variable "instance_name" {
  description = "Display name the dynamic group matches; the CB_OCI_INSTANCE_NAME launch.sh passes."
  type        = string
  default     = "cb-instance"
}

variable "vcn_cidr" {
  description = "CIDR block of cb-vcn."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR block of cb-subnet."
  type        = string
  default     = "10.0.1.0/24"
}

variable "vault_name" {
  description = "Display name of the KMS vault that holds the four secrets."
  type        = string
  default     = "cb-vault"
}

variable "bucket_name" {
  description = "Name of the Object Storage bucket: the nightly dumps and the Terraform state object."
  type        = string
  default     = "cb-backups"
}

variable "secret_names" {
  description = "The Vault secrets, by their cb-* names; the module writes a CHANGE_ME placeholder in each."
  type        = list(string)
  default     = ["cb-github-app", "cb-session-secret", "cb-tunnel-token", "cb-provider-keys"]

  validation {
    condition     = alltrue([for name in var.secret_names : can(regex("^cb-", name))])
    error_message = "Every secret name must carry the cb- prefix (docs/oci.md §1, D22)."
  }
}
