output "vcn_id" {
  description = "OCID of cb-vcn."
  value       = oci_core_vcn.cb.id
}

output "subnet_id" {
  description = "OCID of cb-subnet; CB_OCI_SUBNET_ID for ops/oci/launch.sh."
  value       = oci_core_subnet.cb.id
}

output "vault_id" {
  description = "OCID of cb-vault."
  value       = oci_kms_vault.cb.id
}

output "bucket_name" {
  description = "Name of the backups bucket."
  value       = oci_objectstorage_bucket.cb.name
}

output "instance_name" {
  description = "Display name the dynamic group matches; CB_OCI_INSTANCE_NAME for ops/oci/launch.sh."
  value       = var.instance_name
}

output "dynamic_group_id" {
  description = "OCID of cb-instance-dg."
  value       = oci_identity_dynamic_group.cb_instance.id
}
