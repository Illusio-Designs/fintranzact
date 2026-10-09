output "alb_certificate_arn" {
  description = "Validated ap-south-1 certificate ARN for the load balancer; empty until validated."
  value       = local.validate ? aws_acm_certificate_validation.alb[0].certificate_arn : ""
}

output "cloudfront_certificate_arn" {
  description = "Validated us-east-1 certificate ARN for CloudFront; empty until validated."
  value       = local.validate ? aws_acm_certificate_validation.cloudfront[0].certificate_arn : ""
}

output "validation_records" {
  description = "DNS records that prove you own the domains (CNAME). Add these at your DNS provider when not using Route 53."
  value = distinct(concat(
    [for d, o in local.alb_dvo : { name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value }],
    [for d, o in local.cf_dvo : { name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value }],
  ))
}
