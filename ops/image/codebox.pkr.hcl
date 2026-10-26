packer {
  required_version = ">= 1.9.0"

  required_plugins {
    oracle = {
      version = ">= 1.0.2"
      source  = "github.com/hashicorp/oracle"
    }
    amazon = {
      version = ">= 1.3.0"
      source  = "github.com/hashicorp/amazon"
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

variable "aws_region" {
  type        = string
  description = "Region of the build instance and of the resulting AMI."
  default     = "eu-west-1"
}

variable "aws_subnet_id" {
  type        = string
  description = "Subnet with egress, so the build instance can reach apt, Node and npm."
}

variable "aws_source_ami" {
  type        = string
  description = "Ubuntu 24.04 LTS arm64 base AMI; empty resolves the newest Canonical arm64 AMI in the region."
  default     = ""
}

variable "aws_instance_type" {
  type        = string
  description = "Build instance type; arm64 so the image is arm64 on arm64."
  default     = "c7g.xlarge"
}

variable "aws_ssh_username" {
  type        = string
  description = "SSH user of the AWS base image, the Canonical default."
  default     = "ubuntu"
}

variable "aws_spot_max_price" {
  type        = string
  description = "Maximum hourly price of a spot build instance; empty builds on demand."
  default     = ""
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

source "amazon-ebs" "codebox" {
  region        = var.aws_region
  subnet_id     = var.aws_subnet_id
  source_ami    = var.aws_source_ami
  instance_type = var.aws_instance_type
  ssh_username  = var.aws_ssh_username
  spot_price    = var.aws_spot_max_price
  ami_name      = "cb-image-${var.image_version}-${var.git_sha}"

  # Empty source_ami falls back to the newest Canonical Ubuntu 24.04 arm64 AMI of the region,
  # so a build with -var aws_source_ami= works without pinning an ID that expires.
  source_ami_filter {
    filters = {
      name                = "ubuntu/images/hvm-ssd/ubuntu-noble-24.04-arm64-server-*"
      root-device-type    = "ebs"
      virtualization-type = "hvm"
    }
    owners      = ["099720109477"]
    most_recent = true
  }

  tags = {
    Name              = "cb-image-${var.image_version}-${var.git_sha}"
    "codebox:version" = var.image_version
    "codebox:commit"  = var.git_sha
  }
}

build {
  sources = ["source.oracle-oci.codebox", "source.amazon-ebs.codebox"]

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
    source      = "${path.root}/../vm/systemd/codebox-keepalive.service"
    destination = "/tmp/codebox/units/codebox-keepalive.service"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox-keepalive.timer"
    destination = "/tmp/codebox/units/codebox-keepalive.timer"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/systemd/codebox-spot-notice.service"
    destination = "/tmp/codebox/units/codebox-spot-notice.service"
  }

  provisioner "file" {
    source      = "${path.root}/../vm/keepalive.sh"
    destination = "/tmp/codebox/vm/keepalive.sh"
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
    source      = "${path.root}/../vm/spot-notice.sh"
    destination = "/tmp/codebox/vm/spot-notice.sh"
  }

  provisioner "file" {
    source      = "${path.root}/scripts/90-verify.sh"
    destination = "/tmp/codebox/90-verify.sh"
  }

  # Every scripts/NN-*.sh is a build step and the numeric prefix is the order, so a new step
  # joins the build without a second edit of this template.
  provisioner "shell" {
    environment_vars = [
      "CB_IMAGE_VERSION=${var.image_version}",
      "CB_IMAGE_COMMIT=${var.git_sha}",
      "CB_IMAGE_BUILT_AT={{timestamp}}",
      "NODE_VERSION=${var.node_version}",
      "OPENCODE_VERSION=${var.opencode_version}",
    ]
    execute_command = "chmod +x {{.Path}}; {{.Vars}} sudo -E bash -eux '{{.Path}}'"
    scripts         = [for f in fileset("${abspath(path.root)}/scripts", "*.sh") : "${abspath(path.root)}/scripts/${f}"]
  }
}
