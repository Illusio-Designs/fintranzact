variable "zone_id" {
  description = "Route 53 hosted zone id."
  type        = string
}

variable "aliases" {
  description = "Map of full domain name to the alias target. ipv6 adds an AAAA record (CloudFront only)."
  type = map(object({
    target_dns_name        = string
    target_zone_id         = string
    ipv6                   = bool
    evaluate_target_health = bool
  }))
}
