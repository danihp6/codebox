locals {
  # The statements of docs/oci.md §2, in the same order. The two Object Storage lines at the
  # end of the cb-ci block exist for one object: the Terraform state file of this module.
  cb_ci_statements = [
    "Allow group cb-ci to manage instances in tenancy",
    "Allow group cb-ci to use volumes in tenancy",
    "Allow group cb-ci to use vnics in tenancy",
    "Allow group cb-ci to use private-ips in tenancy",
    "Allow group cb-ci to use public-ips in tenancy",
    "Allow group cb-ci to use subnets in tenancy",
    "Allow group cb-ci to use vcns in tenancy",
    "Allow group cb-ci to use security-lists in tenancy",
    "Allow group cb-ci to use route-tables in tenancy",
    "Allow group cb-ci to use internet-gateways in tenancy",
    "Allow group cb-ci to read instance-images in tenancy",
    "Allow group cb-ci to read objects in compartment ${var.compartment_ocid} where target.bucket.name = '${var.bucket_name}'",
    "Allow group cb-ci to manage objects in compartment ${var.compartment_ocid} where target.bucket.name = '${var.bucket_name}'",
  ]

  cb_instance_statements = [
    "Allow dynamic-group cb-instance-dg to read secret-bundles in compartment ${var.compartment_ocid}",
    "Allow dynamic-group cb-instance-dg to read objects in compartment ${var.compartment_ocid} where target.bucket.name = '${var.bucket_name}'",
    "Allow dynamic-group cb-instance-dg to manage objects in compartment ${var.compartment_ocid} where target.bucket.name = '${var.bucket_name}'",
  ]
}

# The rule provision.sh used: the instance's compartment and its display name, and nothing
# wider. A new display name needs launch.sh's CB_OCI_INSTANCE_NAME and this variable together.
resource "oci_identity_dynamic_group" "cb_instance" {
  compartment_id = var.tenancy_ocid
  name           = "cb-instance-dg"
  description    = "cb-instance, matched by compartment and display name"
  matching_rule  = "instance.compartment.id = '${var.compartment_ocid}', instance.display-name = '${var.instance_name}'"
}

resource "oci_identity_policy" "cb_ci" {
  compartment_id = var.compartment_ocid
  name           = "cb-ci-policy"
  description    = "Launch, volumes, VNIC, network reads and the Terraform state object in cb-backups"
  statements     = local.cb_ci_statements
}

resource "oci_identity_policy" "cb_instance" {
  compartment_id = var.compartment_ocid
  name           = "cb-instance-policy"
  description    = "cb-instance reads its own secrets and writes the backups bucket"
  statements     = local.cb_instance_statements

  # The statements name the dynamic group, and OCI rejects a statement for a principal that
  # does not exist yet.
  depends_on = [oci_identity_dynamic_group.cb_instance]
}
