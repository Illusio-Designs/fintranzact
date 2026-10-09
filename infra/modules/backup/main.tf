terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.80"
      configuration_aliases = [aws.dr]
    }
  }
}

# Local (Mumbai) vault with its own key.
resource "aws_kms_key" "backup" {
  description             = "${var.name} AWS Backup vault"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_backup_vault" "this" {
  name        = "${var.name}-vault"
  kms_key_arn = aws_kms_key.backup.arn
}

# Disaster-recovery vault in a second region (data leaves India only if you turn this on).
resource "aws_kms_key" "dr" {
  count                   = var.enable_cross_region_copy ? 1 : 0
  provider                = aws.dr
  description             = "${var.name} AWS Backup DR vault"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_backup_vault" "dr" {
  count       = var.enable_cross_region_copy ? 1 : 0
  provider    = aws.dr
  name        = "${var.name}-vault-dr"
  kms_key_arn = aws_kms_key.dr[0].arn
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${var.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

data "aws_iam_policy_document" "kms" {
  statement {
    sid       = "UseSourceKeys"
    actions   = ["kms:Decrypt", "kms:DescribeKey", "kms:CreateGrant", "kms:GenerateDataKey*", "kms:ReEncrypt*"]
    resources = concat([aws_kms_key.backup.arn], var.source_kms_key_arns)
  }
}

resource "aws_iam_role_policy" "kms" {
  name   = "use-database-key"
  role   = aws_iam_role.backup.id
  policy = data.aws_iam_policy_document.kms.json
}

resource "aws_backup_plan" "this" {
  name = "${var.name}-daily"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.this.name
    schedule          = var.schedule_cron
    start_window      = 60
    completion_window = 240

    lifecycle {
      delete_after = var.retention_days
    }

    dynamic "copy_action" {
      for_each = var.enable_cross_region_copy ? [1] : []
      content {
        destination_vault_arn = aws_backup_vault.dr[0].arn
        lifecycle {
          delete_after = var.dr_retention_days
        }
      }
    }
  }
}

resource "aws_backup_selection" "this" {
  name         = "${var.name}-resources"
  iam_role_arn = aws_iam_role.backup.arn
  plan_id      = aws_backup_plan.this.id
  resources    = var.resource_arns
}
