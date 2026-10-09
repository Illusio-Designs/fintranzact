terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  family       = "${var.name}-api"
  admin_family = "${var.name}-admin"
  https        = var.enable_https
  container    = "api"

  # Secrets the API cannot start without. Terraform creates the empty
  # container only; the owner types the value in (see docs/infra/SETUP.md).
  required_secret_names = ["DATABASE_URL", "ENCRYPTION_KEY", "TRIAL_CLAIM_SALT"]

  # Optional secrets: the container always exists, but the task only receives
  # the ones listed in var.enabled_optional_secrets (ECS cannot start a task
  # whose injected secret has no value yet).
  optional_secret_names = [
    "PLATFORM_ADMIN_PASSWORD",
    "RESEND_API_KEY",
    "SANDBOX_API_KEY",
    "SANDBOX_API_SECRET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "TURNSTILE_SECRET_KEY",
    "SHIPPING_WEBHOOK_SECRET",
    "ANTHROPIC_API_KEY",
    "MSG91_AUTH_KEY",
    "CONTROL_DATABASE_URL",
    "ENCRYPTION_KEY_PREVIOUS",
  ]

  all_secret_names = concat(local.required_secret_names, local.optional_secret_names)
  injected_secret_names = concat(
    local.required_secret_names,
    [for s in local.optional_secret_names : s if contains(var.enabled_optional_secrets, s)],
  )

  # Node's old-space heap: 75% of the container memory unless set explicitly.
  node_heap_mb = var.node_max_old_space_mb > 0 ? var.node_max_old_space_mb : floor(var.memory * 0.75)

  environment = merge(
    {
      NODE_ENV       = "production"
      PORT           = tostring(var.container_port)
      RUN_MIGRATIONS = "false" # migrations run as a one-off task before each deploy
      MULTI_TENANT   = "false"
      NODE_OPTIONS   = "--max-old-space-size=${local.node_heap_mb}"
    },
    var.container_environment,
  )

  container_environment = [for k in sort(keys(local.environment)) : { name = k, value = local.environment[k] }]
  container_secrets     = [for s in local.injected_secret_names : { name = s, valueFrom = aws_secretsmanager_secret.api[s].arn }]
}

# ── KMS key for secrets and the image registry ──
resource "aws_kms_key" "app" {
  description             = "${var.name} application secrets and container images"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "app" {
  name          = "alias/${var.name}-app"
  target_key_id = aws_kms_key.app.key_id
}

# ── Container registry ──
resource "aws_ecr_repository" "api" {
  name                 = "${var.name}-api"
  image_tag_mutability = "IMMUTABLE" # a tag (the git sha) can never be re-pointed

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.app.arn
  }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 7 days"
        selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
        action       = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last ${var.ecr_keep_images} images"
        selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = var.ecr_keep_images }
        action       = { type = "expire" }
      },
    ]
  })
}

# ── Secret containers (values are NEVER set by Terraform) ──
resource "aws_secretsmanager_secret" "api" {
  for_each                = toset(local.all_secret_names)
  name                    = "${var.name}/api/${each.value}"
  description             = "Value for the ${each.value} environment variable of the API. Set it in the console or with the AWS CLI."
  kms_key_id              = aws_kms_key.app.arn
  recovery_window_in_days = var.secret_recovery_window_days
}

# ── Logs ──
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.family}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/ecs/${var.name}/exec-sessions"
  retention_in_days = var.log_retention_days
}

# ── Cluster ──
resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }

  configuration {
    execute_command_configuration {
      logging = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name = aws_cloudwatch_log_group.exec.name
      }
    }
  }
}

# ── Security groups ──
resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Public load balancer for the API"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-alb" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from anywhere (public API, webhooks, CloudFront)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from anywhere (only redirects to HTTPS)"
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 80
  to_port           = 80
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  description                  = "To the API tasks only"
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-api-tasks"
  description = "API Fargate tasks: reachable from the load balancer only"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-api-tasks" }
}

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "App port from the load balancer only"
  referenced_security_group_id = aws_security_group.alb.id
  from_port                    = var.container_port
  to_port                      = var.container_port
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "tasks_all" {
  security_group_id = aws_security_group.tasks.id
  description       = "Outbound to the database and to third-party APIs (Razorpay, Resend, Sandbox, Anthropic)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "admin" {
  name        = "${var.name}-admin-task"
  description = "On-demand admin task (psql, pg_dump, pg_restore). No inbound."
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-admin-task" }
}

resource "aws_vpc_security_group_egress_rule" "admin_all" {
  security_group_id = aws_security_group.admin.id
  description       = "Outbound to the database and to download or upload dumps"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_tasks" {
  security_group_id            = var.database_security_group_id
  description                  = "PostgreSQL from the API tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_admin" {
  security_group_id            = var.database_security_group_id
  description                  = "PostgreSQL from the on-demand admin task"
  referenced_security_group_id = aws_security_group.admin.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
}

# ── Load balancer ──
resource "aws_s3_bucket" "alb_logs" {
  count         = var.enable_alb_access_logs ? 1 : 0
  bucket        = "${var.name}-alb-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  count                   = var.enable_alb_access_logs ? 1 : 0
  bucket                  = aws_s3_bucket.alb_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "alb_logs" {
  count  = var.enable_alb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.alb_logs[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  count  = var.enable_alb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.alb_logs[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # ALB log delivery supports only SSE-S3
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  count  = var.enable_alb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.alb_logs[0].id
  rule {
    id     = "expire"
    status = "Enabled"
    filter {}
    expiration {
      days = var.log_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

data "aws_elb_service_account" "this" {}

data "aws_iam_policy_document" "alb_logs" {
  count = var.enable_alb_access_logs ? 1 : 0
  statement {
    sid       = "AllowElbLogDelivery"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs[0].arn}/*"]
    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.this.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.alb_logs[0].arn, "${aws_s3_bucket.alb_logs[0].arn}/*"]
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

resource "aws_s3_bucket_policy" "alb_logs" {
  count  = var.enable_alb_access_logs ? 1 : 0
  bucket = aws_s3_bucket.alb_logs[0].id
  policy = data.aws_iam_policy_document.alb_logs[0].json
}

resource "aws_lb" "api" {
  name                       = "${var.name}-api"
  load_balancer_type         = "application"
  internal                   = false
  security_groups            = [aws_security_group.alb.id]
  subnets                    = var.public_subnet_ids
  idle_timeout               = var.alb_idle_timeout
  drop_invalid_header_fields = true
  enable_deletion_protection = var.alb_deletion_protection
  enable_http2               = true
  desync_mitigation_mode     = "defensive"

  dynamic "access_logs" {
    for_each = var.enable_alb_access_logs ? [1] : []
    content {
      bucket  = aws_s3_bucket.alb_logs[0].id
      enabled = true
    }
  }

  depends_on = [aws_s3_bucket_policy.alb_logs]
}

resource "aws_lb_target_group" "api" {
  name                 = "${var.name}-api"
  port                 = var.container_port
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = var.vpc_id
  deregistration_delay = 120 # lets in-flight AI streams finish during a deploy

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  # Before the certificate exists the HTTP listener forwards (so the first
  # smoke tests work); once it exists, HTTP only redirects to HTTPS.
  dynamic "default_action" {
    for_each = local.https ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = local.https ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.api.arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https ? 1 : 0
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ── IAM: execution role (pulls the image, reads the secrets at start) ──
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.family}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    sid       = "ReadInjectedSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [for s in local.injected_secret_names : aws_secretsmanager_secret.api[s].arn]
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.app.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-injected-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# ── IAM: task role. The app calls no AWS APIs, so it has no permissions. ──
resource "aws_iam_role" "task" {
  name               = "${local.family}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

data "aws_iam_policy_document" "ecs_exec" {
  statement {
    sid       = "SsmMessagesForEcsExec"
    actions   = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]
    resources = ["*"]
  }
  statement {
    sid       = "LogExecSessions"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
    resources = ["${aws_cloudwatch_log_group.exec.arn}:*"]
  }
  statement {
    sid       = "FindExecLogGroup"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_exec" {
  count  = var.enable_ecs_exec ? 1 : 0
  name   = "ecs-exec"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

# ── Task definition (service) ──
resource "aws_ecs_task_definition" "api" {
  family                   = local.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name                   = local.container
      image                  = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
      essential              = true
      stopTimeout            = 60
      readonlyRootFilesystem = false
      portMappings           = [{ containerPort = var.container_port, protocol = "tcp" }]
      environment            = local.container_environment
      secrets                = local.container_secrets
      healthCheck = {
        command     = ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:${var.container_port}/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
      linuxParameters = { initProcessEnabled = true }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = "${var.name}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  launch_type     = "FARGATE"
  desired_count   = var.autoscaling_enabled ? max(var.desired_count, var.autoscaling_min) : var.desired_count

  deployment_minimum_healthy_percent = var.deployment_minimum_healthy_percent
  deployment_maximum_percent         = var.deployment_maximum_percent
  health_check_grace_period_seconds  = 90
  enable_execute_command             = var.enable_ecs_exec
  propagate_tags                     = "SERVICE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.task_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = local.container
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http, aws_lb_listener.https]

  lifecycle {
    # The deploy workflow registers new task definition revisions (new image)
    # and points the service at them. Terraform must not undo that.
    ignore_changes = [task_definition]
  }
}

# ── Optional autoscaling on CPU ──
resource "aws_appautoscaling_target" "api" {
  count              = var.autoscaling_enabled ? 1 : 0
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  min_capacity       = var.autoscaling_min
  max_capacity       = var.autoscaling_max
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = var.autoscaling_enabled ? 1 : 0
  name               = "${var.name}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.api[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.api[0].resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# ── On-demand admin task: psql, pg_dump, pg_restore, user creation. ──
# Started by hand with `aws ecs run-task`, entered with ECS Exec. It has no
# inbound ports; the database stays closed to the internet.
resource "aws_cloudwatch_log_group" "admin" {
  name              = "/ecs/${local.admin_family}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "admin_execution" {
  name               = "${local.admin_family}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "admin_execution_managed" {
  role       = aws_iam_role.admin_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "admin_execution_secrets" {
  statement {
    sid       = "ReadDatabaseMasterSecret"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.db_master_secret_arn]
  }
  statement {
    sid       = "DecryptDatabaseSecret"
    actions   = ["kms:Decrypt"]
    resources = [var.db_kms_key_arn]
  }
}

resource "aws_iam_role_policy" "admin_execution_secrets" {
  name   = "read-master-secret"
  role   = aws_iam_role.admin_execution.id
  policy = data.aws_iam_policy_document.admin_execution_secrets.json
}

resource "aws_iam_role" "admin_task" {
  name               = "${local.admin_family}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "admin_task_exec" {
  name   = "ecs-exec"
  role   = aws_iam_role.admin_task.id
  policy = data.aws_iam_policy_document.ecs_exec.json
}

resource "aws_ecs_task_definition" "admin" {
  family                   = local.admin_family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.admin_execution.arn
  task_role_arn            = aws_iam_role.admin_task.arn

  ephemeral_storage {
    size_in_gib = var.admin_ephemeral_storage_gib
  }

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name            = "admin"
      image           = var.admin_image
      essential       = true
      command         = ["sleep", tostring(var.admin_task_max_seconds)]
      environment     = [{ name = "PGHOST", value = var.db_host }, { name = "PGPORT", value = "5432" }, { name = "PGDATABASE", value = var.db_name }, { name = "PGSSLMODE", value = "require" }]
      secrets         = [{ name = "PGUSER", valueFrom = "${var.db_master_secret_arn}:username::" }, { name = "PGPASSWORD", valueFrom = "${var.db_master_secret_arn}:password::" }]
      linuxParameters = { initProcessEnabled = true }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.admin.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "admin"
        }
      }
    }
  ])
}
