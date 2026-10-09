locals {
  default_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
    CostCenter  = var.cost_center
  }
}

# Main region: Mumbai (CERT-In: data stays in India).
provider "aws" {
  region = var.region

  default_tags {
    tags = local.default_tags
  }
}

# CloudFront certificates and CloudFront-scope WAF must live in us-east-1.
# No customer data is stored there.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.default_tags
  }
}

# Second region for cross-region backup copies (only used when enabled).
provider "aws" {
  alias  = "dr"
  region = var.backup_dr_region

  default_tags {
    tags = local.default_tags
  }
}
