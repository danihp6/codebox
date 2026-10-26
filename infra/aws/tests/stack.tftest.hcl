mock_provider "aws" {
  mock_data "aws_ami" {
    defaults = {
      id = "ami-0123456789abcdef0"
    }
  }
}

variables {
  admin_cidr = "203.0.113.7/32"
}

run "plan_security_group" {
  command = plan

  assert {
    condition     = length(aws_security_group.host.ingress) == 1
    error_message = "The host security group must have exactly one ingress rule."
  }

  assert {
    condition     = tolist(aws_security_group.host.ingress)[0].from_port == 22 && tolist(aws_security_group.host.ingress)[0].to_port == 22
    error_message = "The only ingress rule must be tcp/22."
  }

  assert {
    condition     = toset(tolist(aws_security_group.host.ingress)[0].cidr_blocks) == toset([var.admin_cidr])
    error_message = "The SSH ingress rule must admit the admin /32 and nothing else."
  }

  assert {
    condition     = alltrue([for rule in aws_security_group.host.ingress : !contains(rule.cidr_blocks, "0.0.0.0/0")])
    error_message = "No ingress rule may contain 0.0.0.0/0."
  }

  assert {
    condition     = alltrue([for rule in aws_security_group.host.ingress : !contains([80, 443], rule.from_port) && !contains([80, 443], rule.to_port)])
    error_message = "No ingress rule may use port 80 or 443."
  }
}

run "plan_instance" {
  command = plan

  assert {
    condition     = aws_instance.host.metadata_options[0].http_tokens == "required"
    error_message = "The instance must require IMDSv2."
  }

  assert {
    condition     = aws_instance.host.metadata_options[0].http_endpoint == "enabled"
    error_message = "The instance metadata endpoint must be enabled."
  }

  assert {
    condition     = aws_instance.host.instance_market_options[0].market_type == "spot"
    error_message = "The instance must be a spot instance."
  }

  assert {
    condition     = aws_instance.host.instance_market_options[0].spot_options[0].max_price == var.spot_max_price
    error_message = "The spot request must carry the max_price cap."
  }

  assert {
    condition     = aws_instance.host.instance_market_options[0].spot_options[0].spot_instance_type == "one-time"
    error_message = "The spot request must be one-time."
  }

  assert {
    condition     = aws_instance.host.root_block_device[0].volume_type == "gp3" && aws_instance.host.root_block_device[0].encrypted && aws_instance.host.root_block_device[0].volume_size == var.root_volume_gb
    error_message = "The root volume must be an encrypted gp3 of root_volume_gb."
  }

  assert {
    condition     = aws_instance.host.ami == "ami-0123456789abcdef0"
    error_message = "An empty ami_id must fall back to the Canonical Ubuntu lookup."
  }
}

run "plan_ami_override" {
  command = plan

  variables {
    ami_id = "ami-0fedcba9876543210"
  }

  assert {
    condition     = aws_instance.host.ami == "ami-0fedcba9876543210"
    error_message = "A non-empty ami_id must win over the Canonical lookup."
  }
}

run "plan_backup_bucket" {
  command = plan

  assert {
    condition     = aws_s3_bucket_versioning.backups.versioning_configuration[0].status == "Enabled"
    error_message = "The backup bucket must be versioned."
  }

  assert {
    condition     = one(aws_s3_bucket_server_side_encryption_configuration.backups.rule).apply_server_side_encryption_by_default[0].sse_algorithm == "AES256"
    error_message = "The backup bucket must default to SSE-S3 (AES256)."
  }

  assert {
    condition     = aws_s3_bucket_lifecycle_configuration.backups.rule[0].expiration[0].days == 30
    error_message = "Backup objects must expire after 30 days."
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.backups.block_public_policy && aws_s3_bucket_public_access_block.backups.restrict_public_buckets
    error_message = "The backup bucket must block public access."
  }
}

run "plan_instance_policy" {
  command = plan

  override_resource {
    target          = aws_s3_bucket.backups
    override_during = plan

    values = {
      arn = "arn:aws:s3:::cb-codebox-backups"
      id  = "cb-codebox-backups"
    }
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.backup_bucket.policy).Statement :
      statement.Resource != "*" &&
      !(can(tostring(statement.Action)) && tostring(statement.Action) == "*") &&
      !(can(tolist(statement.Action)) && contains(tolist(statement.Action), "*"))
    ])
    error_message = "The inline policy may neither use Resource \"*\" nor Action \"*\"."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.backup_bucket.policy).Statement :
      startswith(statement.Resource, "arn:aws:s3:::${var.backup_bucket_name}")
    ])
    error_message = "The inline policy may only touch the backup bucket."
  }
}

run "plan_budget" {
  command = plan

  assert {
    condition     = aws_budgets_budget.monthly.budget_type == "COST" && aws_budgets_budget.monthly.time_unit == "MONTHLY"
    error_message = "The budget must be a monthly COST budget."
  }

  assert {
    condition     = aws_budgets_budget.monthly.limit_amount == tostring(var.budget_limit_usd)
    error_message = "The budget limit must follow budget_limit_usd."
  }

  assert {
    condition     = length(aws_budgets_budget.monthly.notification) == 0
    error_message = "An empty budget_alert_email must skip the subscriber."
  }
}

run "plan_budget_with_alert_email" {
  command = plan

  variables {
    budget_alert_email = "operator@example.com"
  }

  assert {
    condition     = one(aws_budgets_budget.monthly.notification).threshold == 80 && one(aws_budgets_budget.monthly.notification).notification_type == "ACTUAL"
    error_message = "A non-empty budget_alert_email must add one 80 % actual-spend notification."
  }
}

run "rejects_wildcard_admin_cidr" {
  command = plan

  variables {
    admin_cidr = "0.0.0.0/0"
  }

  expect_failures = [var.admin_cidr]
}

run "rejects_wide_admin_cidr" {
  command = plan

  variables {
    admin_cidr = "203.0.113.0/24"
  }

  expect_failures = [var.admin_cidr]
}

run "rejects_empty_spot_price" {
  command = plan

  variables {
    spot_max_price = ""
  }

  expect_failures = [var.spot_max_price]
}
