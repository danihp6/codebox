# A plan against a mocked provider: no tenancy, no credential and no network call. Every
# assertion reads the arguments this module sets, which is what `docs/oci.md` §1, §2 and §10
# hold to the contract.
#
# The ids are overridden during the plan phase so a rule can be followed from cb-rt and cb-sl
# to the resource it names; the mock provider generates everything else.

mock_provider "oci" {
  mock_data "oci_objectstorage_namespace" {
    defaults = {
      namespace = "cbtenancy"
    }
  }
}

override_resource {
  target          = oci_core_vcn.cb
  override_during = plan
  values = {
    id = "ocid1.vcn.oc1..cbtask47"
  }
}

override_resource {
  target          = oci_core_internet_gateway.cb
  override_during = plan
  values = {
    id = "ocid1.internetgateway.oc1..cbtask47"
  }
}

override_resource {
  target          = oci_core_route_table.cb
  override_during = plan
  values = {
    id = "ocid1.routetable.oc1..cbtask47"
  }
}

override_resource {
  target          = oci_core_security_list.cb
  override_during = plan
  values = {
    id = "ocid1.securitylist.oc1..cbtask47"
  }
}

variables {
  tenancy_ocid     = "ocid1.tenancy.oc1..cbtask47"
  compartment_ocid = "ocid1.compartment.oc1..cbtask47"
  region           = "eu-madrid-1"
  admin_cidr       = "203.0.113.7/32"
}

run "network" {
  command = plan

  assert {
    condition     = oci_core_vcn.cb.display_name == "cb-vcn" && one(oci_core_vcn.cb.cidr_blocks) == "10.0.0.0/16"
    error_message = "cb-vcn must be named cb-vcn and hold 10.0.0.0/16."
  }

  assert {
    condition     = oci_core_subnet.cb.display_name == "cb-subnet" && oci_core_subnet.cb.cidr_block == "10.0.1.0/24"
    error_message = "cb-subnet must be named cb-subnet and hold 10.0.1.0/24."
  }

  assert {
    condition     = oci_core_subnet.cb.route_table_id == oci_core_route_table.cb.id && contains(oci_core_subnet.cb.security_list_ids, oci_core_security_list.cb.id) && !oci_core_subnet.cb.prohibit_public_ip_on_vnic
    error_message = "cb-subnet must be public, on cb-rt and cb-sl."
  }
}

run "routing" {
  command = plan

  assert {
    condition     = oci_core_internet_gateway.cb.display_name == "cb-igw" && oci_core_internet_gateway.cb.enabled && oci_core_internet_gateway.cb.vcn_id == oci_core_vcn.cb.id
    error_message = "cb-igw must be enabled and attached to cb-vcn."
  }

  assert {
    condition = length(oci_core_route_table.cb.route_rules) == 1 && one([
      for rule in oci_core_route_table.cb.route_rules : rule.destination
      ]) == "0.0.0.0/0" && one([
      for rule in oci_core_route_table.cb.route_rules : rule.network_entity_id
    ]) == oci_core_internet_gateway.cb.id
    error_message = "cb-rt must send 0.0.0.0/0 to cb-igw, and nothing else."
  }
}

run "security_list" {
  command = plan

  assert {
    condition     = length(oci_core_security_list.cb.ingress_security_rules) == 1
    error_message = "cb-sl must have exactly one ingress rule."
  }

  assert {
    condition = alltrue([
      for rule in oci_core_security_list.cb.ingress_security_rules :
      rule.protocol == "6" && rule.source == var.admin_cidr && alltrue([
        for tcp in rule.tcp_options : tcp.min == 22 && tcp.max == 22
      ])
    ])
    error_message = "The only ingress rule must be tcp/22 from the admin /32."
  }

  assert {
    condition = !anytrue([
      for rule in oci_core_security_list.cb.ingress_security_rules : rule.source == "0.0.0.0/0"
    ])
    error_message = "cb-sl must not admit 0.0.0.0/0."
  }

  assert {
    condition = alltrue(flatten([
      for rule in oci_core_security_list.cb.ingress_security_rules : [
        for tcp in rule.tcp_options : !(tcp.min <= 80 && tcp.max >= 80) && !(tcp.min <= 443 && tcp.max >= 443)
      ]
    ]))
    error_message = "cb-sl must not open 80 or 443: the tunnel is the only public path."
  }

  assert {
    condition = length(oci_core_security_list.cb.egress_security_rules) == 1 && alltrue([
      for rule in oci_core_security_list.cb.egress_security_rules : rule.protocol == "all" && rule.destination == "0.0.0.0/0"
    ])
    error_message = "cb-sl must allow all egress."
  }
}

run "vault" {
  command = plan

  assert {
    condition     = oci_kms_vault.cb.display_name == "cb-vault" && oci_kms_vault.cb.vault_type == "DEFAULT"
    error_message = "cb-vault must be a DEFAULT vault named cb-vault."
  }

  assert {
    condition     = one(oci_kms_key.cb.key_shape).algorithm == "AES" && one(oci_kms_key.cb.key_shape).length == 32
    error_message = "The cb-vault master key must be AES with 32 bytes."
  }

  assert {
    condition     = length(oci_vault_secret.cb) == 4
    error_message = "cb-vault must hold exactly four secrets."
  }

  assert {
    condition = toset([
      for secret in oci_vault_secret.cb : secret.secret_name
    ]) == toset(["cb-github-app", "cb-session-secret", "cb-tunnel-token", "cb-provider-keys"])
    error_message = "The four secrets must be cb-github-app, cb-session-secret, cb-tunnel-token and cb-provider-keys."
  }

  assert {
    condition = alltrue([
      for secret in oci_vault_secret.cb : alltrue([
        for content in secret.secret_content : content.content_type == "BASE64" && base64decode(content.content) == "CHANGE_ME"
      ])
    ])
    error_message = "Every secret must be a BASE64 CHANGE_ME placeholder: a value is written by hand, never by the module."
  }
}

run "storage" {
  command = plan

  assert {
    condition     = oci_objectstorage_bucket.cb.name == "cb-backups"
    error_message = "The bucket must be cb-backups."
  }

  assert {
    condition     = oci_objectstorage_bucket.cb.versioning == "Disabled"
    error_message = "cb-backups must not version: docs/oci.md §10 fails the check when versioning is on."
  }

  assert {
    condition = length(oci_objectstorage_object_lifecycle_policy.cb.rules) == 1 && alltrue([
      for rule in oci_objectstorage_object_lifecycle_policy.cb.rules :
      rule.action == "DELETE" && rule.time_amount == "30" && rule.time_unit == "DAYS" && rule.is_enabled
    ])
    error_message = "cb-backups must delete its objects after 30 days."
  }

  assert {
    condition     = oci_objectstorage_object_lifecycle_policy.cb.bucket == oci_objectstorage_bucket.cb.name
    error_message = "The lifecycle policy must belong to cb-backups."
  }
}

run "iam" {
  command = plan

  assert {
    condition     = oci_identity_dynamic_group.cb_instance.name == "cb-instance-dg"
    error_message = "The dynamic group must be cb-instance-dg."
  }

  assert {
    condition     = strcontains(oci_identity_dynamic_group.cb_instance.matching_rule, "instance.compartment.id = '${var.compartment_ocid}'") && strcontains(oci_identity_dynamic_group.cb_instance.matching_rule, "instance.display-name = 'cb-instance'")
    error_message = "The dynamic group must match the compartment and the cb-instance display name, and nothing wider."
  }

  assert {
    condition     = oci_identity_policy.cb_ci.name == "cb-ci-policy" && length(oci_identity_policy.cb_ci.statements) == 13
    error_message = "cb-ci-policy must carry the eleven launch statements and the two state-object statements."
  }

  assert {
    condition     = contains(oci_identity_policy.cb_ci.statements, "Allow group cb-ci to read objects in compartment ${var.compartment_ocid} where target.bucket.name = 'cb-backups'") && contains(oci_identity_policy.cb_ci.statements, "Allow group cb-ci to manage objects in compartment ${var.compartment_ocid} where target.bucket.name = 'cb-backups'")
    error_message = "cb-ci-policy must read and write the Terraform state object in cb-backups."
  }

  assert {
    condition     = oci_identity_policy.cb_instance.name == "cb-instance-policy" && length(oci_identity_policy.cb_instance.statements) == 3
    error_message = "cb-instance-policy must carry the three statements of docs/oci.md §2."
  }
}

run "admin_cidr_rejects_open" {
  command = plan

  variables {
    admin_cidr = "0.0.0.0/0"
  }

  expect_failures = [var.admin_cidr]
}

run "admin_cidr_rejects_a_range" {
  command = plan

  variables {
    admin_cidr = "203.0.113.0/24"
  }

  expect_failures = [var.admin_cidr]
}

run "secret_names_rejects_a_foreign_name" {
  command = plan

  variables {
    secret_names = ["cb-github-app", "tunnel-token"]
  }

  expect_failures = [var.secret_names]
}
