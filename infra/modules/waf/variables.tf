variable "name" {
  description = "Web ACL name, for example fintranzact-prod-cloudfront."
  type        = string
}

variable "scope" {
  description = "CLOUDFRONT (create with a us-east-1 provider) or REGIONAL (load balancer)."
  type        = string

  validation {
    condition     = contains(["CLOUDFRONT", "REGIONAL"], var.scope)
    error_message = "scope must be CLOUDFRONT or REGIONAL."
  }
}

variable "associate_resource_arn" {
  description = "REGIONAL scope only (required there): ARN of the load balancer to protect."
  type        = string
  default     = ""
}

variable "enable_auth_rate_limit" {
  description = "Rate-limit login and sign-up requests per IP. Turn off for the REGIONAL ACL when traffic arrives through CloudFront (the source IP is then CloudFront's)."
  type        = bool
  default     = true
}

variable "auth_rate_limit_per_5min" {
  description = "Requests to the login paths allowed per IP in 5 minutes before blocking (minimum 10)."
  type        = number
  default     = 100

  validation {
    condition     = var.auth_rate_limit_per_5min >= 10
    error_message = "auth_rate_limit_per_5min must be at least 10."
  }
}

variable "auth_path_fragments" {
  description = "Lower-case fragments of the URL path that count as login-type requests (tRPC procedures)."
  type        = list(string)
  default     = ["auth.login", "auth.register", "auth.verifytwofactor"]

  validation {
    condition     = length(var.auth_path_fragments) >= 2
    error_message = "Give at least two fragments (a WAF OR rule needs two statements)."
  }
}

variable "common_ruleset_count_rules" {
  description = "Rules of AWSManagedRulesCommonRuleSet that only count instead of block. Defaults protect large uploads and free text."
  type        = list(string)
  default     = ["SizeRestrictions_BODY", "CrossSiteScripting_BODY"]
}

variable "enable_logging" {
  description = "Write WAF request logs (cookies and Authorization redacted) to CloudWatch."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "Days to keep WAF logs. CERT-In asks for 180."
  type        = number
  default     = 180
}
