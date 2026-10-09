variable "name" {
  description = "Name prefix, for example fintranzact-prod."
  type        = string
}

variable "alert_email" {
  description = "Email that receives alarms and budget alerts. AWS sends one confirmation link to click."
  type        = string

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be a valid email address."
  }
}

variable "enable_account_public_access_block" {
  description = "Block public access to every S3 bucket in the account."
  type        = bool
  default     = true
}

variable "enable_cloudtrail" {
  description = "Multi-region CloudTrail with log file validation."
  type        = bool
  default     = true
}

variable "audit_log_retention_days" {
  description = "Days to keep CloudTrail (and Config) logs. CERT-In asks for 180 days of logs; one year is the default."
  type        = number
  default     = 365

  validation {
    condition     = var.audit_log_retention_days >= 180
    error_message = "audit_log_retention_days must be at least 180 (CERT-In)."
  }
}

variable "enable_guardduty" {
  description = "Turn on GuardDuty threat detection. An account can have one detector: import an existing one instead of enabling twice."
  type        = bool
  default     = true
}

variable "enable_config" {
  description = "AWS Config configuration recorder. Off by default (charged per recorded item)."
  type        = bool
  default     = false
}

variable "enable_security_hub" {
  description = "Security Hub with the AWS Foundational standard (also turns on Config). Off by default (charged)."
  type        = bool
  default     = false
}

variable "monthly_budget_usd" {
  description = "Monthly gross spend budget in USD (credits are not subtracted). Alerts at the percentages below."
  type        = number
  default     = 100

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than 0."
  }
}

variable "budget_alert_percentages" {
  description = "Percent of the monthly budget at which to email (actual spend)."
  type        = list(number)
  default     = [50, 80, 100]
}

variable "credits_total_usd" {
  description = "Total AWS Activate credits you received in USD. Adds a yearly budget that warns at 50, 80 and 100 percent of it. 0 disables."
  type        = number
  default     = 0
}

variable "alb_arn_suffix" {
  description = "Load balancer ARN suffix for alarms."
  type        = string
}

variable "target_group_arn_suffix" {
  description = "Target group ARN suffix for the unhealthy hosts alarm."
  type        = string
}

variable "ecs_cluster_name" {
  description = "ECS cluster name for CPU and memory alarms."
  type        = string
}

variable "ecs_service_name" {
  description = "ECS service name for CPU and memory alarms."
  type        = string
}

variable "db_instance_id" {
  description = "RDS instance identifier for database alarms."
  type        = string
}

variable "db_instance_class" {
  description = "RDS instance class (burstable db.t* classes get a CPU credit alarm)."
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_free_storage_bytes_threshold" {
  description = "Alarm when RDS free storage drops below this many bytes (default 3 GiB)."
  type        = number
  default     = 3221225472
}

variable "rds_connections_threshold" {
  description = "Alarm when database connections reach this number (db.t4g.micro allows about 110)."
  type        = number
  default     = 70
}

variable "rds_freeable_memory_bytes_threshold" {
  description = "Alarm when RDS freeable memory drops below this many bytes (default 64 MiB)."
  type        = number
  default     = 67108864
}
