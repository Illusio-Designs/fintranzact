terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

locals {
  identifier = "${var.name}-pg"
}

# ── Encryption key (customer managed, rotated yearly by AWS) ──
resource "aws_kms_key" "rds" {
  description             = "${local.identifier} database storage, snapshots and master secret"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${local.identifier}"
  target_key_id = aws_kms_key.rds.key_id
}

# ── Network: the database only accepts connections from security groups that
#    the api module adds as sources. Nothing is open to the internet. ──
resource "aws_db_subnet_group" "this" {
  name       = local.identifier
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "db" {
  name        = "${local.identifier}-db"
  description = "PostgreSQL. Ingress rules are added by the api module, one per allowed source."
  vpc_id      = var.vpc_id
  tags        = { Name = "${local.identifier}-db" }
}

# ── Parameter group: TLS required, slow-query log ──
resource "aws_db_parameter_group" "this" {
  name        = "${local.identifier}-pg16"
  family      = "postgres16"
  description = "Fintranzact PostgreSQL 16: force SSL, log slow queries"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = tostring(var.log_min_duration_statement_ms)
  }
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "600000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ── Optional enhanced monitoring role ──
data "aws_iam_policy_document" "monitoring_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "monitoring" {
  count              = var.monitoring_interval > 0 ? 1 : 0
  name               = "${local.identifier}-monitoring"
  assume_role_policy = data.aws_iam_policy_document.monitoring_assume.json
}

resource "aws_iam_role_policy_attachment" "monitoring" {
  count      = var.monitoring_interval > 0 ? 1 : 0
  role       = aws_iam_role.monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ── The instance ──
resource "aws_db_instance" "this" {
  identifier     = local.identifier
  engine         = "postgres"
  engine_version = var.engine_version
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.master_username

  # RDS creates the master password, stores it in Secrets Manager and rotates it
  # itself. Terraform never sees it, so it is never in the state file.
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.rds.arn

  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  port                   = 5432
  parameter_group_name   = aws_db_parameter_group.this.name

  iam_database_authentication_enabled = true

  backup_retention_period  = var.backup_retention_days
  backup_window            = var.backup_window
  maintenance_window       = var.maintenance_window
  copy_tags_to_snapshot    = true
  delete_automated_backups = false

  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  apply_immediately          = var.apply_immediately

  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.identifier}-final"

  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? aws_kms_key.rds.arn : null
  performance_insights_retention_period = var.performance_insights_enabled ? 7 : null

  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_interval > 0 ? aws_iam_role.monitoring[0].arn : null

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  # Create the log groups first so Terraform, not RDS, sets their retention.
  depends_on = [aws_cloudwatch_log_group.postgresql, aws_cloudwatch_log_group.upgrade]

  lifecycle {
    # Storage autoscaling changes allocated_storage by itself.
    ignore_changes = [allocated_storage]
  }
}

# Keep the engine log for as long as CERT-In asks. The log group is created by
# RDS on first export; creating it first lets Terraform own the retention.
resource "aws_cloudwatch_log_group" "postgresql" {
  name              = "/aws/rds/instance/${local.identifier}/postgresql"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "upgrade" {
  name              = "/aws/rds/instance/${local.identifier}/upgrade"
  retention_in_days = var.log_retention_days
}
