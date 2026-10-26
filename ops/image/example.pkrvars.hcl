# Dummy values: every OCID, subnet and AMI here is a placeholder, the image version and the
# commit are the ones a first build uses. A real prod.pkrvars.hcl is local and never committed
# (docs/vm-image.md §3).

compartment_ocid    = "ocid1.compartment.oc1..example"
subnet_ocid         = "ocid1.subnet.oc1..example"
availability_domain = "AD-1"
base_image_ocid     = "ocid1.image.oc1..example"
image_version       = "0.1.0"
git_sha             = "0000000"

aws_region         = "eu-west-1"
aws_subnet_id      = "subnet-0123456789abcdef0"
aws_source_ami     = "ami-0123456789abcdef0"
aws_instance_type  = "c7g.xlarge"
aws_ssh_username   = "ubuntu"
aws_spot_max_price = ""
