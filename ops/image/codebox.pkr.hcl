packer {
  required_version = ">= 1.9.0"

  required_plugins {
    oracle = {
      version = ">= 1.0.2"
      source  = "github.com/hashicorp/oracle"
    }
  }
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment of the build instance and of the resulting image."
}

variable "subnet_ocid" {
  type        = string
  description = "Subnet with egress, so the build instance can reach apt, Node and npm."
}

variable "availability_domain" {
  type        = string
  description = "Availability domain of the build instance, for example AD-1."
}

variable "base_image_ocid" {
  type        = string
  description = "Ubuntu 24.04 LTS arm64 platform image OCID for the region."
}

variable "image_version" {
  type        = string
  description = "Release the image is cut for; stamped into /etc/codebox/image.json."
}

variable "git_sha" {
  type        = string
  description = "Commit the image is built from; part of the image display name."
}

variable "node_version" {
  type        = string
  description = "Node 24 release installed from the official arm64 tarball."
  default     = "24.22.1"
}

variable "opencode_version" {
  type        = string
  description = "opencode CLI release baked into the image."
  default     = "1.19.4"
}

variable "oci_config_file" {
  type        = string
  description = "OCI CLI config the builder authenticates with; it holds the tenancy user, the key path and the region, and never a secret of Codebox."
  default     = "~/.oci/config"
}

variable "cloudflared_channel" {
  type        = string
  description = "Release channel of cloudflared (stable is the only one this template ships)."
  default     = "stable"
}

source "oracle-oci" "codebox" {
  availability_domain = var.availability_domain
  base_image_ocid     = var.base_image_ocid
  compartment_ocid    = var.compartment_ocid
  subnet_ocid         = var.subnet_ocid
  shape               = "VM.Standard.A1.Flex"
  image_name          = "cb-image-${var.image_version}-${var.git_sha}"
  ssh_username        = "ubuntu"
  access_cfg_file     = var.oci_config_file

  # The plugin has no boot-volume field: OCI creates the volume at launch, so the 100 GB of
  # the free tier is `launch.sh`'s CB_OCI_BOOT_GB (default 100), not an image property.

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }
}

build {
  sources = ["source.oracle-oci.codebox"]

  provisioner "shell" {
    inline = ["mkdir -p /tmp/codebox/units /tmp/codebox/vm"]
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox.service"
    destination = "/tmp/codebox/units/codebox.service"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox-opencode.service"
    destination = "/tmp/codebox/units/codebox-opencode.service"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/cloudflared.service"
    destination = "/tmp/codebox/units/cloudflared.service"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox-backup.service"
    destination = "/tmp/codebox/units/codebox-backup.service"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox-backup.timer"
    destination = "/tmp/codebox/units/codebox-backup.timer"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/lib.sh"
    destination = "/tmp/codebox/vm/lib.sh"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/cloud-init.sh"
    destination = "/tmp/codebox/vm/cloud-init.sh"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/install.sh"
    destination = "/tmp/codebox/vm/install.sh"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/upgrade.sh"
    destination = "/tmp/codebox/vm/upgrade.sh"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/backup.sh"
    destination = "/tmp/codebox/vm/backup.sh"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/restore.sh"
    destination = "/tmp/codebox/vm/restore.sh"
  }

  provisioner "file" {
    source      = "${path.root}/scripts/90-verify.sh"
    destination = "/tmp/codebox/90-verify.sh"
  }

  provisioner "shell" {
    environment_vars = [
      "CB_IMAGE_VERSION=${var.image_version}",
      "CB_IMAGE_COMMIT=${var.git_sha}",
      "CB_IMAGE_BUILT_AT={{timestamp}}",
      "NODE_VERSION=${var.node_version}",
      "OPENCODE_VERSION=${var.opencode_version}",
    ]
    execute_command = "chmod +x {{.Path}}; {{.Vars}} sudo -E bash -eux '{{.Path}}'"
    scripts = [
      "${path.root}/scripts/10-base.sh",
      "${path.root}/scripts/20-node.sh",
      "${path.root}/scripts/30-tools.sh",
      "${path.root}/scripts/40-opencode.sh",
      "${path.root}/scripts/50-cloudflared.sh",
      "${path.root}/scripts/60-service.sh",
      "${path.root}/scripts/70-harden.sh",
      "${path.root}/scripts/90-verify.sh",
    ]
  }
}
