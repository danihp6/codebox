locals {
  # A placeholder, never a secret: the operator writes each value into Vault by hand (D20), so
  # nothing credential-shaped is ever in the tree or in the Terraform state.
  secret_placeholder = base64encode("CHANGE_ME")
}

resource "oci_kms_vault" "cb" {
  compartment_id = var.compartment_ocid
  display_name   = var.vault_name
  vault_type     = "DEFAULT"
}

resource "oci_kms_key" "cb" {
  compartment_id      = var.compartment_ocid
  display_name        = "cb-vault-key"
  management_endpoint = oci_kms_vault.cb.management_endpoint
  protection_mode     = "SOFTWARE"

  key_shape {
    algorithm = "AES"
    length    = 32
  }
}

resource "oci_vault_secret" "cb" {
  for_each       = toset(var.secret_names)
  compartment_id = var.compartment_ocid
  vault_id       = oci_kms_vault.cb.id
  key_id         = oci_kms_key.cb.id
  secret_name    = each.value

  secret_content {
    content_type = "BASE64"
    content      = local.secret_placeholder
  }
}
