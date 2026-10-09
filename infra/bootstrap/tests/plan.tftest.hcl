# Offline plan-time test (mocked provider, no credentials). Run: terraform init -backend=false && terraform test

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }
  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

run "defaults" {
  command = plan
  assert {
    condition     = aws_s3_bucket.state.bucket == "fintranzact-tfstate-123456789012"
    error_message = "unexpected default state bucket name"
  }
}

run "staging_and_plan_role_and_existing_oidc" {
  command = plan
  variables {
    environments                      = ["prod", "staging"]
    enable_plan_role                  = true
    create_github_oidc_provider       = false
    existing_github_oidc_provider_arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
  }
}
