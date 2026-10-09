variable "name" {
  description = "Name prefix, for example fintranzact-prod."
  type        = string
}

variable "resource_arns" {
  description = "ARNs to back up (the RDS instance)."
  type        = list(string)
}

variable "source_kms_key_arns" {
  description = "KMS keys that encrypt the resources being backed up (so AWS Backup may copy them)."
  type        = list(string)
  default     = []
}

variable "schedule_cron" {
  description = "AWS Backup cron expression in UTC. The default is 02:30 IST daily."
  type        = string
  default     = "cron(0 21 * * ? *)"
}

variable "retention_days" {
  description = "Days to keep daily backups in the local vault (7 to 365)."
  type        = number
  default     = 35

  validation {
    condition     = var.retention_days >= 7 && var.retention_days <= 365
    error_message = "retention_days must be between 7 and 365."
  }
}

variable "enable_cross_region_copy" {
  description = "Copy each backup to a second region. Off in the lean profile (extra storage and transfer cost; data leaves India)."
  type        = bool
  default     = false
}

variable "dr_retention_days" {
  description = "Days to keep the copy in the second region."
  type        = number
  default     = 35

  validation {
    condition     = var.dr_retention_days >= 7 && var.dr_retention_days <= 365
    error_message = "dr_retention_days must be between 7 and 365."
  }
}
