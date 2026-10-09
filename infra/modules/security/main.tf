terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  trail_name = "${var.name}-trail"
  logs_arn   = aws_s3_bucket.logs.arn
}

# ── Account-wide: no S3 bucket in this account can ever be made public ──
resource "aws_s3_account_public_access_block" "this" {
  count                   = var.enable_account_public_access_block ? 1 : 0
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ── One customer-managed key (rotated yearly) for audit logs and alert topic ──
data "aws_iam_policy_document" "key" {
  statement {
    sid       = "AccountAdministration"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${local.account_id}:root"]
    }
  }
  statement {
    sid       = "CloudTrailEncrypt"
    actions   = ["kms:GenerateDataKey*", "kms:DescribeKey"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:cloudtrail:arn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:*:${local.account_id}:trail/*"]
    }
  }
  statement {
    sid       = "AlarmsAndEventsPublishToEncryptedTopic"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey*"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
  statement {
    sid       = "ConfigWritesToLogBucket"
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    resources = ["*"]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_kms_key" "security" {
  description             = "${var.name} audit logs and alert topic"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.key.json
}

resource "aws_kms_alias" "security" {
  name          = "alias/${var.name}-security"
  target_key_id = aws_kms_key.security.key_id
}

# ── Alert topic ──
resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = aws_kms_key.security.arn
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email # AWS emails a confirmation link: click it once.
}

# ── Audit log bucket (CloudTrail, optionally AWS Config) ──
resource "aws_s3_bucket" "logs" {
  bucket        = "${var.name}-audit-logs-${local.account_id}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket                  = aws_s3_bucket.logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.security.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "archive-then-expire"
    status = "Enabled"
    filter {}

    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }
    expiration {
      days = var.audit_log_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "logs" {
  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [local.logs_arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:${data.aws_region.current.name}:${local.account_id}:trail/${local.trail_name}"]
    }
  }
  statement {
    sid       = "CloudTrailWrite"
    actions   = ["s3:PutObject"]
    resources = ["${local.logs_arn}/cloudtrail/AWSLogs/${local.account_id}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudtrail:${data.aws_region.current.name}:${local.account_id}:trail/${local.trail_name}"]
    }
  }
  statement {
    sid       = "ConfigAclCheck"
    actions   = ["s3:GetBucketAcl", "s3:ListBucket"]
    resources = [local.logs_arn]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
  statement {
    sid       = "ConfigWrite"
    actions   = ["s3:PutObject"]
    resources = ["${local.logs_arn}/config/AWSLogs/${local.account_id}/Config/*"]
    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [local.logs_arn, "${local.logs_arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket     = aws_s3_bucket.logs.id
  policy     = data.aws_iam_policy_document.logs.json
  depends_on = [aws_s3_bucket_public_access_block.logs]
}

# ── CloudTrail: who did what in the AWS account, all regions, tamper-evident ──
resource "aws_cloudtrail" "this" {
  count                         = var.enable_cloudtrail ? 1 : 0
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.logs.id
  s3_key_prefix                 = "cloudtrail"
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  kms_key_id                    = aws_kms_key.security.arn

  depends_on = [aws_s3_bucket_policy.logs]
}

# ── GuardDuty: threat detection (an account can have only one detector) ──
resource "aws_guardduty_detector" "this" {
  count  = var.enable_guardduty ? 1 : 0
  enable = true
}

# ── AWS Config and Security Hub: off by default (per-item charges) ──
resource "aws_iam_role" "config" {
  count = var.enable_config || var.enable_security_hub ? 1 : 0
  name  = "${var.name}-config"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "config.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "config" {
  count      = var.enable_config || var.enable_security_hub ? 1 : 0
  role       = aws_iam_role.config[0].name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWS_ConfigRole"
}

resource "aws_config_configuration_recorder" "this" {
  count    = var.enable_config || var.enable_security_hub ? 1 : 0
  name     = var.name
  role_arn = aws_iam_role.config[0].arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = false
  }
}

resource "aws_config_delivery_channel" "this" {
  count          = var.enable_config || var.enable_security_hub ? 1 : 0
  name           = var.name
  s3_bucket_name = aws_s3_bucket.logs.id
  s3_key_prefix  = "config"
  depends_on     = [aws_config_configuration_recorder.this, aws_s3_bucket_policy.logs]
}

resource "aws_config_configuration_recorder_status" "this" {
  count      = var.enable_config || var.enable_security_hub ? 1 : 0
  name       = aws_config_configuration_recorder.this[0].name
  is_enabled = true
  depends_on = [aws_config_delivery_channel.this]
}

resource "aws_securityhub_account" "this" {
  count                    = var.enable_security_hub ? 1 : 0
  enable_default_standards = false
  depends_on               = [aws_config_configuration_recorder_status.this]
}

resource "aws_securityhub_standards_subscription" "foundational" {
  count         = var.enable_security_hub ? 1 : 0
  standards_arn = "arn:${data.aws_partition.current.partition}:securityhub:${data.aws_region.current.name}::standards/aws-foundational-security-best-practices/v/1.0.0"
  depends_on    = [aws_securityhub_account.this]
}

# ── Budgets: gross monthly spend (credits NOT netted off, so you see the real burn) ──
resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit             = false
    include_discount           = true
    include_refund             = false
    include_support            = true
    include_tax                = true
    include_upfront            = true
    include_recurring          = true
    include_other_subscription = true
    include_subscription       = true
    use_amortized              = false
    use_blended                = false
  }

  dynamic "notification" {
    for_each = var.budget_alert_percentages
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# Total spend against your Activate credits: warns before the credits run out.
resource "aws_budgets_budget" "credits" {
  count        = var.credits_total_usd > 0 ? 1 : 0
  name         = "${var.name}-activate-credits"
  budget_type  = "COST"
  limit_amount = tostring(var.credits_total_usd)
  limit_unit   = "USD"
  time_unit    = "ANNUALLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}

# ── CloudWatch alarms -> SNS -> your email ──
locals {
  # The alarm set is fixed (known at plan time); only the dimension values come from resources.
  alb_dims = { LoadBalancer = var.alb_arn_suffix }
  tg_dims  = { LoadBalancer = var.alb_arn_suffix, TargetGroup = var.target_group_arn_suffix }
  ecs_dims = { ClusterName = var.ecs_cluster_name, ServiceName = var.ecs_service_name }
  rds_dims = { DBInstanceIdentifier = var.db_instance_id }

  alarms = merge(
    {
      alb-5xx = {
        description = "The load balancer or the API returned 10 or more 5xx errors in 5 minutes."
        namespace   = "AWS/ApplicationELB"
        metric      = "HTTPCode_ELB_5XX_Count"
        statistic   = "Sum"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = 10
        period      = 300
        periods     = 1
        dimensions  = local.alb_dims
      }
      target-5xx = {
        description = "API tasks returned 10 or more 5xx errors in 5 minutes."
        namespace   = "AWS/ApplicationELB"
        metric      = "HTTPCode_Target_5XX_Count"
        statistic   = "Sum"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = 10
        period      = 300
        periods     = 1
        dimensions  = local.alb_dims
      }
    },
    {
      unhealthy-hosts = {
        description = "At least one API task has been failing its health check for 10 minutes."
        namespace   = "AWS/ApplicationELB"
        metric      = "UnHealthyHostCount"
        statistic   = "Maximum"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = 1
        period      = 300
        periods     = 2
        dimensions  = local.tg_dims
      }
    },
    {
      ecs-cpu-high = {
        description = "API CPU above 85 percent for 15 minutes: scale up or add tasks."
        namespace   = "AWS/ECS"
        metric      = "CPUUtilization"
        statistic   = "Average"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = 85
        period      = 300
        periods     = 3
        dimensions  = local.ecs_dims
      }
      ecs-memory-high = {
        description = "API memory above 85 percent for 15 minutes: raise api_memory or look for a leak."
        namespace   = "AWS/ECS"
        metric      = "MemoryUtilization"
        statistic   = "Average"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = 85
        period      = 300
        periods     = 3
        dimensions  = local.ecs_dims
      }
    },
    {
      rds-cpu-high = {
        description = "Database CPU above 80 percent for 15 minutes."
        namespace   = "AWS/RDS"
        metric      = "CPUUtilization"
        statistic   = "Average"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = 80
        period      = 300
        periods     = 3
        dimensions  = local.rds_dims
      }
      rds-free-storage-low = {
        description = "Database free storage is low (storage autoscaling may be at its ceiling)."
        namespace   = "AWS/RDS"
        metric      = "FreeStorageSpace"
        statistic   = "Minimum"
        operator    = "LessThanThreshold"
        threshold   = var.rds_free_storage_bytes_threshold
        period      = 300
        periods     = 1
        dimensions  = local.rds_dims
      }
      rds-connections-high = {
        description = "Many database connections in use: check for a connection leak or add capacity."
        namespace   = "AWS/RDS"
        metric      = "DatabaseConnections"
        statistic   = "Maximum"
        operator    = "GreaterThanOrEqualToThreshold"
        threshold   = var.rds_connections_threshold
        period      = 300
        periods     = 2
        dimensions  = local.rds_dims
      }
      rds-freeable-memory-low = {
        description = "Database freeable memory is very low."
        namespace   = "AWS/RDS"
        metric      = "FreeableMemory"
        statistic   = "Average"
        operator    = "LessThanThreshold"
        threshold   = var.rds_freeable_memory_bytes_threshold
        period      = 300
        periods     = 3
        dimensions  = local.rds_dims
      }
    },
    startswith(var.db_instance_class, "db.t") ? {
      rds-cpu-credits-low = {
        description = "Burstable database is running out of CPU credits: move to a larger class."
        namespace   = "AWS/RDS"
        metric      = "CPUCreditBalance"
        statistic   = "Minimum"
        operator    = "LessThanThreshold"
        threshold   = 30
        period      = 300
        periods     = 3
        dimensions  = local.rds_dims
      }
    } : {},
  )
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  comparison_operator = each.value.operator
  threshold           = each.value.threshold
  period              = each.value.period
  evaluation_periods  = each.value.periods
  dimensions          = each.value.dimensions
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}
