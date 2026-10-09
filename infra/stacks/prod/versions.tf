terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }

  # Remote state in the bucket created by infra/bootstrap. The values are
  # supplied at init time:  terraform init -backend-config=backend.hcl
  # (copy backend.hcl.example to backend.hcl and fill in the bucket name).
  backend "s3" {}
}
