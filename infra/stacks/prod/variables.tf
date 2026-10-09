# ───────────────────────── Identity ─────────────────────────

variable "project" {
  description = "Project name used as the prefix of every resource."
  type        = string
  default     = "fintranzact"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}$", var.project))
    error_message = "project must be 2-19 lower-case letters, digits or dashes, starting with a letter."
  }
}

variable "environment" {
  description = "prod or staging. Staging must NEVER hold real customer data."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be prod or staging."
  }
}

variable "region" {
  description = "AWS region. Keep ap-south-1 (Mumbai) so data stays in India (CERT-In)."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = contains(["ap-south-1", "ap-south-2"], var.region)
    error_message = "region must be ap-south-1 (Mumbai) or ap-south-2 (Hyderabad) to keep data in India."
  }
}

variable "cost_center" {
  description = "Value of the CostCenter tag (activate it as a cost allocation tag in Billing)."
  type        = string
  default     = "engineering"
}

# ───────────────────────── Domains and DNS ─────────────────────────

variable "web_domain" {
  description = "Domain of the web app, for example app.fintranzact.com."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.web_domain))
    error_message = "web_domain must be a lower-case host name such as app.example.com."
  }
}

variable "store_domain" {
  description = "Domain of the online store, for example store.fintranzact.com."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.store_domain))
    error_message = "store_domain must be a lower-case host name such as store.example.com."
  }
}

variable "api_domain" {
  description = "Domain of the API (mobile app, webhooks, CloudFront origin), for example api.fintranzact.com."
  type        = string

  validation {
    condition     = can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.api_domain))
    error_message = "api_domain must be a lower-case host name such as api.example.com."
  }
}

variable "route53_zone_id" {
  description = "Route 53 hosted zone id of your domain. Leave empty if DNS is elsewhere; the outputs then list the records to add by hand."
  type        = string
  default     = ""
}

variable "certs_ready" {
  description = "Manual DNS only: set to true on the second apply, after you added the certificate validation records."
  type        = bool
  default     = false
}

# ───────────────────────── Alerts and budget ─────────────────────────

variable "alert_email" {
  description = "Email for alarms and budget alerts."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly gross spend budget in USD. Alerts at 50, 80 and 100 percent."
  type        = number
  default     = 100
}

variable "credits_total_usd" {
  description = "Total AWS Activate credits in USD (adds a budget that warns as you use them up). 0 disables."
  type        = number
  default     = 0
}

# ───────────────────────── Network ─────────────────────────

variable "vpc_cidr" {
  description = "VPC range."
  type        = string
  default     = "10.20.0.0/16"
}

variable "enable_nat_gateway" {
  description = "NAT gateway (about 35 USD a month): tasks move to private subnets without public IPs."
  type        = bool
  default     = false
}

variable "enable_interface_endpoints" {
  description = "Interface VPC endpoints for ECR, logs and Secrets Manager (about 7 USD each per AZ per month)."
  type        = bool
  default     = false
}

variable "enable_flow_logs" {
  description = "VPC flow logs to CloudWatch."
  type        = bool
  default     = true
}

variable "flow_log_traffic_type" {
  description = "ACCEPT, REJECT or ALL."
  type        = string
  default     = "ALL"
}

# ───────────────────────── Database ─────────────────────────

variable "db_instance_class" {
  description = "RDS instance class: db.t4g.micro (lean), db.t4g.medium (launch)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Starting database storage in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Second copy of the database in another AZ for failover (about double the instance cost)."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Days of automated database backups (1 to 35)."
  type        = number
  default     = 14
}

variable "db_deletion_protection" {
  description = "Refuse to delete the database."
  type        = bool
  default     = true
}

variable "db_performance_insights" {
  description = "Performance Insights (off by default)."
  type        = bool
  default     = false
}

variable "db_monitoring_interval" {
  description = "Enhanced monitoring seconds (0 = off)."
  type        = number
  default     = 0
}

variable "db_engine_version" {
  description = "PostgreSQL version (major number lets RDS choose the minor)."
  type        = string
  default     = "16"
}

# ───────────────────────── API ─────────────────────────

variable "api_cpu" {
  description = "Fargate CPU units for the API: 512 (0.5 vCPU, lean) or 1024 (1 vCPU, launch)."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "Fargate memory in MiB: 1024 (lean) or 2048 (launch)."
  type        = number
  default     = 1024
}

variable "api_desired_count" {
  description = "Number of API tasks. Use 0 for the very first apply (before secrets and the first image exist), then 1 (lean) or 2 (launch)."
  type        = number
  default     = 1
}

variable "api_cpu_architecture" {
  description = "X86_64 (default, builds fast on GitHub runners) or ARM64 (Graviton, about 20 percent cheaper)."
  type        = string
  default     = "X86_64"
}

variable "api_autoscaling_enabled" {
  description = "Scale API tasks on CPU 60 percent."
  type        = bool
  default     = false
}

variable "api_autoscaling_min" {
  description = "Minimum tasks with autoscaling."
  type        = number
  default     = 1
}

variable "api_autoscaling_max" {
  description = "Maximum tasks with autoscaling."
  type        = number
  default     = 4
}

variable "enable_ecs_exec" {
  description = "Allow a shell inside running API tasks (ECS Exec). The admin task always allows it."
  type        = bool
  default     = false
}

variable "alb_idle_timeout" {
  description = "Load balancer idle timeout in seconds (at least 120 for AI streaming)."
  type        = number
  default     = 300
}

variable "enable_alb_access_logs" {
  description = "Write load balancer access logs to S3."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "Days to keep application, database and network logs. CERT-In asks for 180."
  type        = number
  default     = 180
}

variable "enabled_optional_secrets" {
  description = "Optional API secrets to inject (names such as RESEND_API_KEY). Add one only after its value is stored in Secrets Manager."
  type        = list(string)
  default     = []

  validation {
    condition = alltrue([for s in var.enabled_optional_secrets : contains([
      "PLATFORM_ADMIN_PASSWORD", "RESEND_API_KEY", "SANDBOX_API_KEY", "SANDBOX_API_SECRET", "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY", "SHIPPING_WEBHOOK_SECRET",
      "ANTHROPIC_API_KEY", "MSG91_AUTH_KEY", "CONTROL_DATABASE_URL", "ENCRYPTION_KEY_PREVIOUS",
    ], s)])
    error_message = "enabled_optional_secrets contains a name that is not an optional secret of this stack (see docs/infra/SETUP.md)."
  }
}

variable "platform_admin_email" {
  description = "PLATFORM_ADMIN_EMAIL: the platform admin account created at first start. Empty skips it."
  type        = string
  default     = ""
}

variable "platform_admin_name" {
  description = "PLATFORM_ADMIN_NAME."
  type        = string
  default     = ""
}

variable "admin_ephemeral_storage_gib" {
  description = "Scratch disk (GiB, 21 to 200) of the on-demand admin task. Raise it before dumping and restoring a large database."
  type        = number
  default     = 50
}

variable "api_extra_environment" {
  description = "Extra NON-SECRET environment variables for the API (EMAIL_FROM, CONTACT_INBOX, SMS_PROVIDER, MSG91_TEMPLATE_ID, FINVERA_GSTIN, SANDBOX_MONTHLY_QUOTA ...). Secrets go in Secrets Manager."
  type        = map(string)
  default     = {}
}

# ───────────────────────── Web and store ─────────────────────────

variable "cloudfront_price_class" {
  description = "PriceClass_200 (default; includes India) or PriceClass_All / PriceClass_100."
  type        = string
  default     = "PriceClass_200"
}

variable "sse_origin_read_timeout" {
  description = "Seconds of silence tolerated on streaming responses (AI answers). 60 is the default AWS quota; ask AWS support for up to 180."
  type        = number
  default     = 60
}

variable "content_security_policy" {
  description = "Content-Security-Policy added by CloudFront to the web and store sites. Empty = none (the web app sets its own in index.html)."
  type        = string
  default     = ""
}

variable "content_security_policy_report_only" {
  description = "Send the policy above as Report-Only."
  type        = bool
  default     = true
}

variable "hsts_preload" {
  description = "Add the HSTS preload flag (only if you will submit the domain to browser preload lists)."
  type        = bool
  default     = false
}

# ───────────────────────── Security ─────────────────────────

variable "enable_waf_cloudfront" {
  description = "WAF in front of CloudFront (web, store and /api through the web domain). About 9 USD a month plus 0.60 USD per million requests."
  type        = bool
  default     = true
}

variable "enable_waf_alb" {
  description = "WAF on the API load balancer (protects api_domain used directly by the mobile app and webhooks). About the same cost again."
  type        = bool
  default     = false
}

variable "waf_auth_rate_limit_per_5min" {
  description = "Login-type requests per IP per 5 minutes before blocking."
  type        = number
  default     = 100
}

variable "enable_cloudtrail" {
  description = "Multi-region CloudTrail."
  type        = bool
  default     = true
}

variable "audit_log_retention_days" {
  description = "Days to keep CloudTrail logs (at least 180)."
  type        = number
  default     = 365
}

variable "enable_guardduty" {
  description = "GuardDuty threat detection. If the account already has a detector, set false (or import it)."
  type        = bool
  default     = true
}

variable "enable_config" {
  description = "AWS Config recorder (off by default, per-item charge)."
  type        = bool
  default     = false
}

variable "enable_security_hub" {
  description = "Security Hub (off by default, charged)."
  type        = bool
  default     = false
}

# ───────────────────────── Backup ─────────────────────────

variable "enable_aws_backup" {
  description = "AWS Backup daily plan on top of the automated database backups."
  type        = bool
  default     = true
}

variable "aws_backup_retention_days" {
  description = "Days to keep AWS Backup recovery points (7 to 365)."
  type        = number
  default     = 35
}

variable "enable_cross_region_backup" {
  description = "Copy backups to backup_dr_region. Off in the lean profile. NOTE: data leaves India."
  type        = bool
  default     = false
}

variable "backup_dr_region" {
  description = "Region for cross-region backup copies."
  type        = string
  default     = "ap-southeast-1"
}
