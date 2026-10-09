variable "name" {
  description = "Name of the site, for example fintranzact-prod-web."
  type        = string
}

variable "bucket_name" {
  description = "Globally unique S3 bucket name."
  type        = string
}

variable "aliases" {
  description = "Custom domain names served by this distribution (needs certificate_arn)."
  type        = list(string)
  default     = []
}

variable "enable_custom_domain" {
  description = "Serve the aliases with certificate_arn. Must be known at plan time (false until the certificate is validated)."
  type        = bool
  default     = false
}

variable "certificate_arn" {
  description = "Validated ACM certificate in us-east-1 covering the aliases. Empty serves on the *.cloudfront.net name only."
  type        = string
  default     = ""
}

variable "price_class" {
  description = "PriceClass_100 (US, Europe), PriceClass_200 (adds Asia incl. India; the cheapest class that covers India) or PriceClass_All."
  type        = string
  default     = "PriceClass_200"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be PriceClass_100, PriceClass_200 or PriceClass_All."
  }
}

variable "web_acl_arn" {
  description = "WAFv2 web ACL (CLOUDFRONT scope, us-east-1) to attach. Empty means none."
  type        = string
  default     = ""
}

variable "api_origin_domain" {
  description = "Host name of the API load balancer origin (the API domain). Empty disables API behaviors."
  type        = string
  default     = ""
}

variable "api_origin_protocol" {
  description = "http-only or https-only towards the load balancer. https-only once the API certificate exists."
  type        = string
  default     = "https-only"

  validation {
    condition     = contains(["http-only", "https-only"], var.api_origin_protocol)
    error_message = "api_origin_protocol must be http-only or https-only."
  }
}

variable "api_origin_read_timeout" {
  description = "Seconds CloudFront waits for the API to answer. 60 is the default quota maximum; request a quota increase to raise it."
  type        = number
  default     = 60
}

variable "sse_origin_read_timeout" {
  description = "Seconds of silence tolerated on the streaming (server-sent events) origin. Same 60 second quota unless you asked AWS for more (up to 180)."
  type        = number
  default     = 60

  validation {
    condition     = var.sse_origin_read_timeout >= 1 && var.sse_origin_read_timeout <= 180
    error_message = "sse_origin_read_timeout must be between 1 and 180 seconds."
  }
}

variable "alb_behaviors" {
  description = "Paths routed to the API, in priority order (first match wins). origin is api or sse; function is none, store_prefix or store_order."
  type = list(object({
    path_pattern = string
    origin       = string
    function     = string
  }))
  default = []

  validation {
    condition     = alltrue([for b in var.alb_behaviors : contains(["api", "sse"], b.origin) && contains(["none", "store_prefix", "store_order"], b.function)])
    error_message = "alb_behaviors origin must be api or sse and function must be none, store_prefix or store_order."
  }
}

variable "enable_store_functions" {
  description = "Create the store URL-rewrite CloudFront Functions (needed by the store site only)."
  type        = bool
  default     = false
}

variable "hsts_max_age_seconds" {
  description = "Strict-Transport-Security max-age."
  type        = number
  default     = 31536000
}

variable "hsts_include_subdomains" {
  description = "Add includeSubDomains to HSTS."
  type        = bool
  default     = true
}

variable "hsts_preload" {
  description = "Add the preload flag to HSTS. Only enable when you want the domain on browser preload lists (hard to undo)."
  type        = bool
  default     = false
}

variable "permissions_policy" {
  description = "Permissions-Policy header. Payroll attendance needs camera and geolocation on the web app origin."
  type        = string
  default     = "camera=(self), geolocation=(self), microphone=(), payment=(self)"
}

variable "content_security_policy" {
  description = "Content-Security-Policy added by CloudFront. Empty (default) adds none: the web app already sets its own CSP in index.html."
  type        = string
  default     = ""
}

variable "content_security_policy_report_only" {
  description = "Send content_security_policy as Content-Security-Policy-Report-Only instead of enforcing it."
  type        = bool
  default     = true
}

variable "noncurrent_version_days" {
  description = "Days to keep replaced file versions (for rolling back a bad deploy)."
  type        = number
  default     = 30
}
