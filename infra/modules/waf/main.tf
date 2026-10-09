terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# One web ACL. Use it twice: scope CLOUDFRONT (provider in us-east-1) and
# scope REGIONAL (the load balancer, provider in ap-south-1).

locals {
  # Paths that must never be blocked by managed rules: payment-provider and
  # carrier webhooks (they are authenticated by HMAC signature or token) and
  # the biometric attendance push (token authenticated, JSON bodies).
  allow_prefixes = ["/webhooks/"]
  allow_exact    = ["/api/attendance/push"]
}

resource "aws_wafv2_web_acl" "this" {
  name        = var.name
  description = "Fintranzact edge protection - ${var.scope}"
  scope       = var.scope

  default_action {
    allow {}
  }

  # 0: webhooks and device pushes skip every other rule.
  rule {
    name     = "allow-webhooks"
    priority = 0
    action {
      allow {}
    }
    statement {
      or_statement {
        dynamic "statement" {
          for_each = local.allow_prefixes
          content {
            byte_match_statement {
              search_string         = statement.value
              positional_constraint = "STARTS_WITH"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
        dynamic "statement" {
          for_each = local.allow_exact
          content {
            byte_match_statement {
              search_string         = statement.value
              positional_constraint = "EXACTLY"
              field_to_match {
                uri_path {}
              }
              text_transformation {
                priority = 0
                type     = "NONE"
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-allow-webhooks"
      sampled_requests_enabled   = true
    }
  }

  # 1: slow down password guessing and sign-up floods, per client IP.
  # Only meaningful where the source IP is the real visitor (CloudFront scope).
  dynamic "rule" {
    for_each = var.enable_auth_rate_limit ? [1] : []
    content {
      name     = "rate-limit-auth"
      priority = 1
      action {
        block {}
      }
      statement {
        rate_based_statement {
          limit              = var.auth_rate_limit_per_5min
          aggregate_key_type = "IP"
          scope_down_statement {
            or_statement {
              dynamic "statement" {
                for_each = var.auth_path_fragments
                content {
                  byte_match_statement {
                    search_string         = statement.value
                    positional_constraint = "CONTAINS"
                    field_to_match {
                      uri_path {}
                    }
                    text_transformation {
                      priority = 0
                      type     = "LOWERCASE"
                    }
                  }
                }
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.name}-rate-limit-auth"
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "aws-ip-reputation"
    priority = 10
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-common"
    priority = 20
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # Rules set to Count (logged, not blocked) because the app legitimately
        # sends large bodies (logos, 300 KB attendance selfies, CSV and backup
        # imports) and free text that looks like HTML. Edit the list to tighten.
        dynamic "rule_action_override" {
          for_each = var.common_ruleset_count_rules
          content {
            name = rule_action_override.value
            action_to_use {
              count {}
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "aws-known-bad-inputs"
    priority = 30
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-known-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = true
  }
}

# Only the regional ACL is associated here; CloudFront takes the ARN directly.
resource "aws_wafv2_web_acl_association" "alb" {
  count        = var.scope == "REGIONAL" ? 1 : 0
  resource_arn = var.associate_resource_arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

# ── Request logs (audit trail of blocked and counted requests). Cookie and
#    Authorization headers are redacted so sessions never end up in the logs. ──
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "waf" {
  count             = var.enable_logging ? 1 : 0
  name              = "aws-waf-logs-${var.name}" # WAF requires this prefix
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "waf_logs" {
  count = var.enable_logging ? 1 : 0
  statement {
    sid       = "AllowWafLogDelivery"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.waf[0].arn}:*"]
    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:*"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_cloudwatch_log_resource_policy" "waf" {
  count           = var.enable_logging ? 1 : 0
  policy_name     = "${var.name}-waf-logs"
  policy_document = data.aws_iam_policy_document.waf_logs[0].json
}

resource "aws_wafv2_web_acl_logging_configuration" "this" {
  count                   = var.enable_logging ? 1 : 0
  resource_arn            = aws_wafv2_web_acl.this.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf[0].arn]

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  depends_on = [aws_cloudwatch_log_resource_policy.waf]
}
