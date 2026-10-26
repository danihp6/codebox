data "oci_objectstorage_namespace" "cb" {
  compartment_id = var.tenancy_ocid
}

# Versioning stays off: the module has no undo, and docs/oci.md §10 fails the check when it is
# on. The 30-day lifecycle is the retention D33 asks for.
resource "oci_objectstorage_bucket" "cb" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.cb.namespace
  name           = var.bucket_name
  access_type    = "NoPublicAccess"
  storage_tier   = "Standard"
  versioning     = "Disabled"
}

resource "oci_objectstorage_object_lifecycle_policy" "cb" {
  namespace = data.oci_objectstorage_namespace.cb.namespace
  bucket    = oci_objectstorage_bucket.cb.name

  rules {
    action      = "DELETE"
    name        = "expire-30-days"
    time_amount = "30"
    time_unit   = "DAYS"
    is_enabled  = true
  }
}
