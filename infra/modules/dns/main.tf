terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.80"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# Certificates. The load balancer needs one in the app region (ap-south-1);
# CloudFront needs one in us-east-1. Both are validated by DNS.
#
# Two ways to validate:
#   * route53_zone_id set: Terraform creates the validation records itself.
#   * route53_zone_id empty (domain at another registrar): Terraform creates the
#     certificates and prints the CNAME records to add by hand; set
#     certs_ready = true on the next apply, after the records exist.

locals {
  use_route53     = var.route53_zone_id != ""
  validate        = local.use_route53 || var.certs_ready
  cloudfront_list = distinct(var.cloudfront_domains)
}

resource "aws_acm_certificate" "alb" {
  domain_name       = var.alb_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "cloudfront" {
  provider                  = aws.us_east_1
  domain_name               = local.cloudfront_list[0]
  subject_alternative_names = slice(local.cloudfront_list, 1, length(local.cloudfront_list))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  alb_dvo = { for d in toset([var.alb_domain]) : d => [for o in aws_acm_certificate.alb.domain_validation_options : o if o.domain_name == d][0] }
  cf_dvo  = { for d in toset(local.cloudfront_list) : d => [for o in aws_acm_certificate.cloudfront.domain_validation_options : o if o.domain_name == d][0] }
}

resource "aws_route53_record" "alb_validation" {
  for_each        = local.use_route53 ? local.alb_dvo : {}
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_route53_record" "cloudfront_validation" {
  for_each        = local.use_route53 ? local.cf_dvo : {}
  zone_id         = var.route53_zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "alb" {
  count                   = local.validate ? 1 : 0
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = local.use_route53 ? [for r in aws_route53_record.alb_validation : r.fqdn] : null

  timeouts {
    create = "30m"
  }
}

resource "aws_acm_certificate_validation" "cloudfront" {
  count                   = local.validate ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = local.use_route53 ? [for r in aws_route53_record.cloudfront_validation : r.fqdn] : null

  timeouts {
    create = "30m"
  }
}
