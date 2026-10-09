terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
  # Local state on purpose: this stack creates the bucket that holds the state of
  # everything else. After the first apply you may move its state into that bucket
  # (see docs/infra/SETUP.md). Keep terraform.tfstate safe until then.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project    = var.project
      ManagedBy  = "terraform"
      CostCenter = var.cost_center
      Stack      = "bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  state_bucket = var.state_bucket_name != "" ? var.state_bucket_name : "${var.project}-tfstate-${local.account_id}"
  lock_table   = "${var.project}-tfstate-lock"

  oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : var.existing_github_oidc_provider_arn

  # GitHub tokens this repository may present. Branch deploys and named GitHub environments.
  deploy_subjects = concat(
    ["repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"],
    [for e in var.github_environments : "repo:${var.github_repository}:environment:${e}"],
  )
  plan_subjects = concat(
    ["repo:${var.github_repository}:pull_request", "repo:${var.github_repository}:ref:refs/heads/${var.github_branch}"],
  )

  # Resource names created by infra/stacks/prod for each environment (name = project-environment).
  names = [for e in var.environments : "${var.project}-${e}"]
}

# ───────────────────────── Remote state ─────────────────────────

resource "aws_kms_key" "state" {
  description             = "Terraform state encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "state" {
  name          = "alias/${var.project}-tfstate"
  target_key_id = aws_kms_key.state.key_id
}

resource "aws_s3_bucket" "state" {
  bucket = local.state_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "state_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
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

resource "aws_s3_bucket_policy" "state" {
  bucket     = aws_s3_bucket.state.id
  policy     = data.aws_iam_policy_document.state_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.state]
}

# State locking: stops two applies from running at the same time.
# (A DynamoDB table works on every Terraform and OpenTofu version >= 1.6.)
resource "aws_dynamodb_table" "lock" {
  name         = local.lock_table
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.state.arn
  }
}

# ───────────────────────── GitHub Actions: sign-in without access keys ─────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.deploy_subjects
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.project}-github-deploy"
  description          = "GitHub Actions deploy role for ${var.github_repository}: push image, run migration, update service, sync sites. No secrets access."
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "EcrPushPullApiImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [for n in local.names : "arn:${local.partition}:ecr:${var.region}:${local.account_id}:repository/${n}-api"]
  }

  statement {
    sid       = "EcsTaskDefinitions"
    actions   = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:ListTasks"]
    resources = ["*"] # these actions do not support resource-level permissions
  }

  statement {
    sid     = "EcsUpdateService"
    actions = ["ecs:DescribeServices", "ecs:UpdateService"]
    resources = [
      for n in local.names : "arn:${local.partition}:ecs:${var.region}:${local.account_id}:service/${n}/${n}-api"
    ]
  }

  statement {
    sid       = "EcsRunMigrationTask"
    actions   = ["ecs:RunTask"]
    resources = [for n in local.names : "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task-definition/${n}-api:*"]
    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [for n in local.names : "arn:${local.partition}:ecs:${var.region}:${local.account_id}:cluster/${n}"]
    }
  }

  statement {
    sid     = "EcsWatchTasks"
    actions = ["ecs:DescribeTasks", "ecs:StopTask"]
    resources = [
      for n in local.names : "arn:${local.partition}:ecs:${var.region}:${local.account_id}:task/${n}/*"
    ]
  }

  statement {
    sid     = "PassOnlyTheApiRoles"
    actions = ["iam:PassRole"]
    resources = flatten([
      for n in local.names : [
        "arn:${local.partition}:iam::${local.account_id}:role/${n}-api-execution",
        "arn:${local.partition}:iam::${local.account_id}:role/${n}-api-task",
      ]
    ])
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid     = "ReadMigrationLogs"
    actions = ["logs:GetLogEvents", "logs:DescribeLogStreams"]
    resources = [
      for n in local.names : "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/ecs/${n}-api:*"
    ]
  }

  statement {
    sid     = "SyncSiteBucketsList"
    actions = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = flatten([
      for n in local.names : [
        "arn:${local.partition}:s3:::${n}-web-${local.account_id}",
        "arn:${local.partition}:s3:::${n}-store-${local.account_id}",
      ]
    ])
  }

  statement {
    sid     = "SyncSiteBucketsObjects"
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = flatten([
      for n in local.names : [
        "arn:${local.partition}:s3:::${n}-web-${local.account_id}/*",
        "arn:${local.partition}:s3:::${n}-store-${local.account_id}/*",
      ]
    ])
  }

  statement {
    sid       = "InvalidateCloudFront"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = ["arn:${local.partition}:cloudfront::${local.account_id}:distribution/*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# ───────────────────────── Optional: read-only role for `terraform plan` in CI ─────────────────────────

data "aws_iam_policy_document" "plan_trust" {
  count = var.enable_plan_role ? 1 : 0
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.plan_subjects
    }
  }
}

resource "aws_iam_role" "plan" {
  count                = var.enable_plan_role ? 1 : 0
  name                 = "${var.project}-github-terraform-plan"
  description          = "Read-only role so GitHub Actions can run terraform plan. Cannot change anything; cannot read secret values."
  assume_role_policy   = data.aws_iam_policy_document.plan_trust[0].json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "plan_read_only" {
  count      = var.enable_plan_role ? 1 : 0
  role       = aws_iam_role.plan[0].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "plan_state" {
  count = var.enable_plan_role ? 1 : 0

  statement {
    sid       = "ReadState"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
  }
  statement {
    sid       = "StateLock"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
    resources = [aws_dynamodb_table.lock.arn]
  }
  statement {
    sid       = "StateKey"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
    resources = [aws_kms_key.state.arn]
  }
}

resource "aws_iam_role_policy" "plan_state" {
  count  = var.enable_plan_role ? 1 : 0
  name   = "state-access"
  role   = aws_iam_role.plan[0].id
  policy = data.aws_iam_policy_document.plan_state[0].json
}
