# Offline plan-time test: no AWS account or credentials needed (mocked providers).
# Run with:  terraform init -backend=false && terraform test
# It proves the module wiring, conditions and for_each keys resolve at plan time
# for both the Route 53 and the manual-DNS paths and for both profiles.

mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["ap-south-1a", "ap-south-1b", "ap-south-1c"]
    }
  }
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "123456789012"
    }
  }
  mock_data "aws_region" {
    defaults = {
      name = "ap-south-1"
    }
  }
  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }
  mock_data "aws_elb_service_account" {
    defaults = {
      arn = "arn:aws:iam::718504428378:root"
    }
  }
  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
}

mock_provider "aws" {
  alias = "dr"
}

variables {
  web_domain   = "app.example.com"
  store_domain = "store.example.com"
  api_domain   = "api.example.com"
  alert_email  = "owner@example.com"
}

run "lean_manual_dns_phase_1" {
  command = plan
  variables {
    db_instance_class = "db.t4g.micro"
  }
  assert {
    condition     = output.urls.web == "https://app.example.com"
    error_message = "web url wrong"
  }
}

run "lean_manual_dns_phase_2" {
  command = plan
  variables {
    certs_ready = true
  }
}

run "launch_route53" {
  command = plan
  variables {
    route53_zone_id            = "Z0123456789ABCDEFGHIJ"
    db_instance_class          = "db.t4g.medium"
    db_multi_az                = true
    api_desired_count          = 2
    api_autoscaling_enabled    = true
    api_autoscaling_min        = 2
    enable_waf_alb             = true
    enable_cross_region_backup = true
    enable_alb_access_logs     = true
    enable_nat_gateway         = true
    enable_interface_endpoints = true
    enable_security_hub        = true
    enabled_optional_secrets   = ["RESEND_API_KEY", "ANTHROPIC_API_KEY"]
  }
}
