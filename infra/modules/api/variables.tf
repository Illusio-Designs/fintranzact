variable "name" {
  description = "Name prefix, for example fintranzact-prod."
  type        = string
}

variable "vpc_id" {
  description = "VPC id."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the load balancer."
  type        = list(string)
}

variable "task_subnet_ids" {
  description = "Subnets for the Fargate tasks."
  type        = list(string)
}

variable "assign_public_ip" {
  description = "Give tasks a public IP (needed to reach the internet and ECR when there is no NAT gateway). Inbound stays closed by the security group."
  type        = bool
}

variable "database_security_group_id" {
  description = "Security group of the database; this module adds the allowed sources."
  type        = string
}

variable "db_master_secret_arn" {
  description = "RDS-managed master secret (admin task only)."
  type        = string
}

variable "db_kms_key_arn" {
  description = "KMS key that encrypts the RDS master secret."
  type        = string
}

variable "db_host" {
  description = "Database host name."
  type        = string
}

variable "db_name" {
  description = "Database name."
  type        = string
}

variable "enable_https" {
  description = "Create the HTTPS listener and redirect HTTP to it. Must be a value known at plan time (false until the certificate is validated)."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "Validated ACM certificate (ap-south-1) for the API domain. Used when enable_https is true."
  type        = string
  default     = ""
}

variable "cpu_architecture" {
  description = "X86_64 or ARM64 (Graviton, about 20 percent cheaper, but the image must be built for arm64)."
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "cpu_architecture must be X86_64 or ARM64."
  }
}

variable "cpu" {
  description = "Fargate CPU units: 256, 512, 1024, 2048 or 4096."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096], var.cpu)
    error_message = "cpu must be 256, 512, 1024, 2048 or 4096."
  }
}

variable "memory" {
  description = "Fargate memory in MiB (must be a valid pair with cpu, for example 512/1024, 1024/2048)."
  type        = number
  default     = 1024
}

variable "node_max_old_space_mb" {
  description = "Node heap limit in MiB. 0 means 75 percent of the container memory."
  type        = number
  default     = 0
}

variable "container_port" {
  description = "Port the API listens on (PORT)."
  type        = number
  default     = 3000
}

variable "container_environment" {
  description = "Plain (non-secret) environment variables for the API container. Never put secrets here."
  type        = map(string)
  default     = {}
}

variable "enabled_optional_secrets" {
  description = "Optional secret names to inject into the task. Add a name only AFTER you stored its value in Secrets Manager."
  type        = list(string)
  default     = []
}

variable "secret_recovery_window_days" {
  description = "Days a deleted secret can be recovered (7 to 30; 0 deletes at once)."
  type        = number
  default     = 7
}

variable "image_tag" {
  description = "Image tag written into the Terraform-managed task definition. The deploy workflow replaces it with the git sha on every deploy."
  type        = string
  default     = "bootstrap"
}

variable "ecr_keep_images" {
  description = "How many tagged images the registry keeps."
  type        = number
  default     = 30
}

variable "desired_count" {
  description = "Number of API tasks. 0 is valid before the first deploy."
  type        = number
  default     = 1
}

variable "deployment_minimum_healthy_percent" {
  description = "Rolling deploy: percent of tasks that must stay healthy. 100 keeps full capacity during a deploy."
  type        = number
  default     = 100
}

variable "deployment_maximum_percent" {
  description = "Rolling deploy: maximum percent of tasks during a deploy."
  type        = number
  default     = 200
}

variable "autoscaling_enabled" {
  description = "Scale the number of tasks on CPU."
  type        = bool
  default     = false
}

variable "autoscaling_min" {
  description = "Minimum tasks when autoscaling is on."
  type        = number
  default     = 1
}

variable "autoscaling_max" {
  description = "Maximum tasks when autoscaling is on."
  type        = number
  default     = 4
}

variable "autoscaling_cpu_target" {
  description = "Target average CPU percent for autoscaling."
  type        = number
  default     = 60
}

variable "enable_ecs_exec" {
  description = "Allow ECS Exec (a shell in a running API task). The admin task always has it."
  type        = bool
  default     = false
}

variable "container_insights" {
  description = "ECS Container Insights metrics (extra CloudWatch cost)."
  type        = bool
  default     = false
}

variable "alb_idle_timeout" {
  description = "Load balancer idle timeout in seconds. At least 120 so AI answers streamed as server-sent events are not cut."
  type        = number
  default     = 300

  validation {
    condition     = var.alb_idle_timeout >= 120 && var.alb_idle_timeout <= 4000
    error_message = "alb_idle_timeout must be between 120 and 4000 seconds."
  }
}

variable "alb_deletion_protection" {
  description = "Refuse to delete the load balancer."
  type        = bool
  default     = true
}

variable "enable_alb_access_logs" {
  description = "Write load balancer access logs to S3."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Days to keep logs. CERT-In asks for 180."
  type        = number
  default     = 180

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a value CloudWatch Logs accepts (for example 90, 180, 365)."
  }
}

variable "admin_image" {
  description = "Image of the on-demand admin task. Must contain the PostgreSQL 16 client tools."
  type        = string
  default     = "public.ecr.aws/docker/library/postgres:16-alpine"
}

variable "admin_ephemeral_storage_gib" {
  description = "Scratch disk of the admin task in GiB (21 to 200). Size it above your database dump."
  type        = number
  default     = 50

  validation {
    condition     = var.admin_ephemeral_storage_gib >= 21 && var.admin_ephemeral_storage_gib <= 200
    error_message = "admin_ephemeral_storage_gib must be between 21 and 200."
  }
}

variable "admin_task_max_seconds" {
  description = "The admin task stops itself after this many seconds so it is never left running."
  type        = number
  default     = 14400
}
