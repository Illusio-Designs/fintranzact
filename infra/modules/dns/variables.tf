variable "route53_zone_id" {
  description = "Route 53 hosted zone id that holds your domain. Empty if the domain is registered or hosted elsewhere."
  type        = string
  default     = ""
}

variable "alb_domain" {
  description = "API domain served by the load balancer, for example api.fintranzact.com."
  type        = string
}

variable "cloudfront_domains" {
  description = "Domains served by CloudFront (web and store). The first is the certificate's main name."
  type        = list(string)

  validation {
    condition     = length(var.cloudfront_domains) >= 1
    error_message = "Give at least one CloudFront domain."
  }
}

variable "certs_ready" {
  description = "Manual DNS only: set true once the validation CNAME records exist, to finish certificate validation."
  type        = bool
  default     = false
}
