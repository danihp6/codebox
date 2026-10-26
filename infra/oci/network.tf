resource "oci_core_vcn" "cb" {
  compartment_id = var.compartment_ocid
  display_name   = "cb-vcn"
  cidr_blocks    = [var.vcn_cidr]
  dns_label      = "cbvcn"
}

resource "oci_core_internet_gateway" "cb" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.cb.id
  display_name   = "cb-igw"
  enabled        = true
}

resource "oci_core_route_table" "cb" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.cb.id
  display_name   = "cb-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.cb.id
  }
}

# One ingress rule and no other: SSH from the operator's /32. The daemon is reached through
# the Cloudflare tunnel, so 80/443 are never opened and nothing is admitted from 0.0.0.0/0.
resource "oci_core_security_list" "cb" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.cb.id
  display_name   = "cb-sl"

  ingress_security_rules {
    protocol  = "6"
    source    = var.admin_cidr
    stateless = false

    tcp_options {
      min = 22
      max = 22
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
    stateless   = false
  }
}

resource "oci_core_subnet" "cb" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.cb.id
  display_name               = "cb-subnet"
  cidr_block                 = var.subnet_cidr
  dns_label                  = "cbsubnet"
  route_table_id             = oci_core_route_table.cb.id
  security_list_ids          = [oci_core_security_list.cb.id]
  prohibit_public_ip_on_vnic = false
}
