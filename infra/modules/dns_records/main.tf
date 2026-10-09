terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}

# Alias records for the three public names. Created only when the domain is in
# Route 53; otherwise the stack prints the records to add by hand.

locals {
  ipv6 = { for k, v in var.aliases : k => v if v.ipv6 }
}

resource "aws_route53_record" "a" {
  for_each = var.aliases
  zone_id  = var.zone_id
  name     = each.key
  type     = "A"

  alias {
    name                   = each.value.target_dns_name
    zone_id                = each.value.target_zone_id
    evaluate_target_health = each.value.evaluate_target_health
  }
}

resource "aws_route53_record" "aaaa" {
  for_each = local.ipv6
  zone_id  = var.zone_id
  name     = each.key
  type     = "AAAA"

  alias {
    name                   = each.value.target_dns_name
    zone_id                = each.value.target_zone_id
    evaluate_target_health = each.value.evaluate_target_health
  }
}
