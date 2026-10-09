variable "name" {
  description = "Name prefix, for example fintranzact-prod."
  type        = string
}

variable "vpc_id" {
  description = "VPC the database lives in."
  type        = string
}

variable "subnet_ids" {
  description = "Isolated subnet ids (at least two, in different AZs)."
  type        = list(string)
}

variable "engine_version" {
  description = "PostgreSQL version. A major number such as 16 lets RDS pick the current minor."
  type        = string
  default     = "16"
}

variable "instance_class" {
  description = "RDS instance class. db.t4g.micro for the lean profile, db.t4g.medium for launch."
  type        = string
  default     = "db.t4g.micro"

  validation {
    condition     = can(regex("^db\\.[a-z0-9]+\\.[a-z0-9]+$", var.instance_class))
    error_message = "instance_class must look like db.t4g.micro."
  }
}

variable "allocated_storage" {
  description = "Starting storage in GiB (gp3)."
  type        = number
  default     = 20

  validation {
    condition     = var.allocated_storage >= 20 && var.allocated_storage <= 65536
    error_message = "allocated_storage must be between 20 and 65536 GiB."
  }
}

variable "max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB. Set equal to allocated_storage to disable autoscaling."
  type        = number
  default     = 100
}

variable "multi_az" {
  description = "Standby copy in a second AZ (roughly doubles the instance cost). Off in the lean profile."
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "Days of automated backups (point-in-time restore window). AWS allows 1 to 35."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 1 && var.backup_retention_days <= 35
    error_message = "backup_retention_days must be between 1 and 35."
  }
}

variable "backup_window" {
  description = "Daily backup window in UTC. 20:00-21:00 UTC is 01:30-02:30 IST."
  type        = string
  default     = "20:00-21:00"
}

variable "maintenance_window" {
  description = "Weekly maintenance window in UTC. Sunday 21:30 UTC is Monday 03:00 IST."
  type        = string
  default     = "sun:21:30-sun:22:30"
}

variable "deletion_protection" {
  description = "Refuse to delete the database until this is set to false and applied."
  type        = bool
  default     = true
}

variable "auto_minor_version_upgrade" {
  description = "Let RDS apply minor PostgreSQL upgrades in the maintenance window."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply changes now instead of in the next maintenance window (can cause a short outage)."
  type        = bool
  default     = false
}

variable "db_name" {
  description = "Name of the first database. The application connects to this one."
  type        = string
  default     = "fintranzact"
}

variable "master_username" {
  description = "RDS master (admin) user. The application uses its own, less powerful user."
  type        = string
  default     = "fintranzact_admin"
}

variable "log_min_duration_statement_ms" {
  description = "Log statements slower than this many milliseconds. -1 disables, 0 logs everything."
  type        = number
  default     = 1000
}

variable "performance_insights_enabled" {
  description = "Performance Insights (7 days free). Off by default."
  type        = bool
  default     = false
}

variable "monitoring_interval" {
  description = "Enhanced monitoring interval in seconds: 0 (off, default), 1, 5, 10, 15, 30 or 60."
  type        = number
  default     = 0

  validation {
    condition     = contains([0, 1, 5, 10, 15, 30, 60], var.monitoring_interval)
    error_message = "monitoring_interval must be 0, 1, 5, 10, 15, 30 or 60."
  }
}

variable "log_retention_days" {
  description = "Days to keep the PostgreSQL logs in CloudWatch. CERT-In asks for 180."
  type        = number
  default     = 180
}
