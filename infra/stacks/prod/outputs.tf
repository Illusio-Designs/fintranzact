output "urls" {
  description = "Public addresses once DNS and certificates are in place."
  value = {
    web   = local.web_url
    store = local.store_url
    api   = local.api_url
    # Reachable before any DNS record exists (first smoke test):
    web_cloudfront   = "https://${module.web.domain_name}"
    store_cloudfront = "https://${module.store.domain_name}"
    api_alb          = "http://${module.api.alb_dns_name}"
  }
}

output "razorpay_webhook_urls" {
  description = "Paste into the Razorpay dashboard (Settings, Webhooks). Per-business webhooks are shown inside the app."
  value = {
    platform_subscription_webhook = "${local.api_url}/webhooks/razorpay"
    shipping_webhook_pattern      = "${local.api_url}/webhooks/shipping/<businessId>"
  }
}

output "dns_records_to_create" {
  description = "Records to add at your DNS provider when route53_zone_id is empty. Add step 1 first, then set certs_ready = true and apply again, then add step 2."
  value = {
    note                                = var.route53_zone_id != "" ? "Not needed: Route 53 records are managed by Terraform." : "Add step 1, apply again with certs_ready = true, then add step 2."
    step_1_certificate_validation_cname = var.route53_zone_id != "" ? [] : module.dns.validation_records
    step_2_traffic_cname = var.route53_zone_id != "" ? [] : [
      { name = var.web_domain, type = "CNAME", value = module.web.domain_name },
      { name = var.store_domain, type = "CNAME", value = module.store.domain_name },
      { name = var.api_domain, type = "CNAME", value = module.api.alb_dns_name },
    ]
  }
}

output "ecr_repository_url" {
  description = "Where the API image is pushed."
  value       = module.api.ecr_repository_url
}

output "ecs" {
  description = "ECS names and the network settings of one-off tasks."
  value = {
    cluster            = module.api.cluster_name
    service            = module.api.service_name
    task_family        = module.api.task_family
    admin_task_family  = module.api.admin_task_family
    subnets            = module.network.app_subnet_ids
    task_security_grp  = module.api.task_security_group_id
    admin_security_grp = module.api.admin_security_group_id
    assign_public_ip   = module.network.assign_public_ip ? "ENABLED" : "DISABLED"
    log_group          = module.api.log_group_name
  }
}

output "buckets" {
  description = "Static site buckets."
  value = {
    web   = module.web.bucket_name
    store = module.store.bucket_name
  }
}

output "cloudfront_distribution_ids" {
  description = "CloudFront distributions (for cache invalidation)."
  value = {
    web   = module.web.distribution_id
    store = module.store.distribution_id
  }
}

output "secrets_to_populate" {
  description = "Secrets Manager names. 'required' must have a value before the first deploy; 'optional' only when you use the feature (then add the variable name to enabled_optional_secrets)."
  value       = module.api.secret_names
}

output "database" {
  description = "Database facts. DATABASE_URL is NOT created here: build it yourself, see docs/infra/SETUP.md."
  value = {
    host                  = module.database.address
    port                  = module.database.port
    name                  = module.database.db_name
    master_secret_arn     = module.database.master_secret_arn
    database_url_template = "postgresql://fintranzact_app:<PASSWORD>@${module.database.address}:${module.database.port}/${module.database.db_name}?sslmode=require"
  }
}

output "github_actions_variables" {
  description = "Repository (or environment) variables for .github/workflows/deploy-aws.yml. None of these are secrets. AWS_ROLE_ARN comes from infra/bootstrap."
  value = {
    AWS_REGION                  = var.region
    AWS_ECR_REPOSITORY          = module.api.ecr_repository_name
    AWS_ECS_CLUSTER             = module.api.cluster_name
    AWS_ECS_SERVICE             = module.api.service_name
    AWS_ECS_TASK_FAMILY         = module.api.task_family
    AWS_TASK_SUBNETS            = join(",", module.network.app_subnet_ids)
    AWS_TASK_SECURITY_GROUP     = module.api.task_security_group_id
    AWS_TASK_ASSIGN_PUBLIC_IP   = module.network.assign_public_ip ? "ENABLED" : "DISABLED"
    AWS_LOG_GROUP               = module.api.log_group_name
    AWS_API_ARCH                = var.api_cpu_architecture
    AWS_WEB_BUCKET              = module.web.bucket_name
    AWS_STORE_BUCKET            = module.store.bucket_name
    AWS_WEB_DISTRIBUTION_ID     = module.web.distribution_id
    AWS_STORE_DISTRIBUTION_ID   = module.store.distribution_id
    AWS_API_URL                 = local.api_url
    AWS_WEB_URL                 = local.web_url
    AWS_STORE_URL               = local.store_url
    AWS_API_DESIRED_COUNT_FIRST = tostring(max(var.api_desired_count, 1))
  }
}

output "alerts_topic_arn" {
  description = "SNS topic of alarms. Confirm the email subscription AWS sends to alert_email."
  value       = module.security.alerts_topic_arn
}

output "audit_log_bucket" {
  description = "CloudTrail log bucket."
  value       = module.security.audit_log_bucket
}
