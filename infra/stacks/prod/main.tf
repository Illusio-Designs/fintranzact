data "aws_caller_identity" "current" {}

# AWS's list of the addresses CloudFront uses to reach an origin (the load balancer sees one
# of these as the connecting address for web and store traffic). Global, so the region is irrelevant.
data "aws_ec2_managed_prefix_list" "cloudfront_origin_facing" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

locals {
  name       = "${var.project}-${var.environment}"
  account_id = data.aws_caller_identity.current.account_id

  # Phase flag: HTTPS, custom domains and the CloudFront-to-API TLS hop are only
  # switched on once the certificates are validated (immediately with Route 53;
  # after the second apply with certs_ready = true for DNS elsewhere).
  certs_ready = var.route53_zone_id != "" || var.certs_ready

  web_url   = "https://${var.web_domain}"
  store_url = "https://${var.store_domain}"
  api_url   = "https://${var.api_domain}"

  api_environment = merge(
    {
      APP_URL      = local.web_url
      STORE_URL    = local.store_url
      API_URL      = local.api_url
      CORS_ORIGINS = "${local.web_url},${local.store_url}"
    },
    {
      # The app finds the visitor behind CloudFront and the load balancer (see
      # packages/api/src/lib/client-ip.ts). CloudFront's origin-facing addresses are skipped
      # in X-Forwarded-For, and a cf-connecting-ip header is NOT trusted: nothing here strips
      # it, so a client could send any value and dodge every per-IP rate limit.
      TRUSTED_PROXY_CIDRS    = join(",", [for e in data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.entries : e.cidr])
      TRUST_CF_CONNECTING_IP = "false"
    },
    var.platform_admin_email != "" ? { PLATFORM_ADMIN_EMAIL = var.platform_admin_email } : {},
    var.platform_admin_name != "" ? { PLATFORM_ADMIN_NAME = var.platform_admin_name } : {},
    var.api_extra_environment,
  )

  # What CloudFront sends to the API, in priority order (first match wins).
  # The streaming path comes first so it gets the streaming origin settings.
  web_api_behaviors = [
    { path_pattern = "/api/ai/stream", origin = "sse", function = "none" },
    { path_pattern = "/api/*", origin = "api", function = "none" },
    { path_pattern = "/webhooks/*", origin = "api", function = "none" },
  ]

  # The store site lives at the root of its own domain (/<slug>/catalog.json) while
  # the API serves it under /store, so some paths are rewritten at the edge.
  store_api_behaviors = [
    { path_pattern = "/store/*", origin = "api", function = "none" }, # logos and policy pages are already /store/...
    { path_pattern = "*/catalog.json", origin = "api", function = "store_prefix" },
    { path_pattern = "*/policies.json", origin = "api", function = "store_prefix" },
    { path_pattern = "*/identify", origin = "api", function = "store_prefix" },
    { path_pattern = "*/order", origin = "api", function = "store_prefix" },
    { path_pattern = "*/order/*", origin = "api", function = "store_order" },
  ]
}

# ───────────────────────── Network ─────────────────────────

module "network" {
  source = "../../modules/network"

  name                       = local.name
  vpc_cidr                   = var.vpc_cidr
  enable_nat_gateway         = var.enable_nat_gateway
  enable_interface_endpoints = var.enable_interface_endpoints
  enable_flow_logs           = var.enable_flow_logs
  flow_log_traffic_type      = var.flow_log_traffic_type
  flow_log_retention_days    = var.log_retention_days
}

# ───────────────────────── Database ─────────────────────────

module "database" {
  source = "../../modules/database"

  name                  = local.name
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.database_subnet_ids
  engine_version        = var.db_engine_version
  instance_class        = var.db_instance_class
  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  multi_az              = var.db_multi_az
  backup_retention_days = var.db_backup_retention_days
  deletion_protection   = var.db_deletion_protection

  performance_insights_enabled = var.db_performance_insights
  monitoring_interval          = var.db_monitoring_interval
  log_retention_days           = var.log_retention_days
}

# ───────────────────────── Certificates and validation ─────────────────────────

module "dns" {
  source = "../../modules/dns"
  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  route53_zone_id    = var.route53_zone_id
  alb_domain         = var.api_domain
  cloudfront_domains = [var.web_domain, var.store_domain]
  certs_ready        = var.certs_ready
}

# ───────────────────────── API (ECS Fargate behind an ALB) ─────────────────────────

module "api" {
  source = "../../modules/api"

  name                       = local.name
  vpc_id                     = module.network.vpc_id
  public_subnet_ids          = module.network.public_subnet_ids
  task_subnet_ids            = module.network.app_subnet_ids
  assign_public_ip           = module.network.assign_public_ip
  database_security_group_id = module.database.security_group_id
  db_master_secret_arn       = module.database.master_secret_arn
  db_kms_key_arn             = module.database.kms_key_arn
  db_host                    = module.database.address
  db_name                    = module.database.db_name

  enable_https    = local.certs_ready
  certificate_arn = module.dns.alb_certificate_arn

  cpu_architecture         = var.api_cpu_architecture
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  desired_count            = var.api_desired_count
  autoscaling_enabled      = var.api_autoscaling_enabled
  autoscaling_min          = var.api_autoscaling_min
  autoscaling_max          = var.api_autoscaling_max
  enable_ecs_exec          = var.enable_ecs_exec
  alb_idle_timeout         = var.alb_idle_timeout
  enable_alb_access_logs   = var.enable_alb_access_logs
  log_retention_days       = var.log_retention_days
  container_environment    = local.api_environment
  enabled_optional_secrets = var.enabled_optional_secrets

  admin_ephemeral_storage_gib = var.admin_ephemeral_storage_gib
}

# ───────────────────────── WAF ─────────────────────────

module "waf_cloudfront" {
  source = "../../modules/waf"
  count  = var.enable_waf_cloudfront ? 1 : 0
  providers = {
    aws = aws.us_east_1
  }

  name                     = "${local.name}-cloudfront"
  scope                    = "CLOUDFRONT"
  auth_rate_limit_per_5min = var.waf_auth_rate_limit_per_5min
  log_retention_days       = var.log_retention_days
}

module "waf_alb" {
  source = "../../modules/waf"
  count  = var.enable_waf_alb ? 1 : 0

  name                   = "${local.name}-alb"
  scope                  = "REGIONAL"
  associate_resource_arn = module.api.alb_arn
  # Traffic from the web domain reaches the load balancer through CloudFront, so
  # the source IP here is CloudFront's: per-IP rate limiting only makes sense at the edge.
  enable_auth_rate_limit = false
  log_retention_days     = var.log_retention_days
}

# ───────────────────────── Static sites (web app and store) ─────────────────────────

locals {
  # Before the API certificate exists CloudFront talks plain HTTP to the load
  # balancer's own address; afterwards it uses HTTPS to api_domain.
  api_origin_domain   = local.certs_ready ? var.api_domain : module.api.alb_dns_name
  api_origin_protocol = local.certs_ready ? "https-only" : "http-only"
  waf_cloudfront_arn  = var.enable_waf_cloudfront ? module.waf_cloudfront[0].arn : ""
}

module "web" {
  source = "../../modules/web"

  name                 = "${local.name}-web"
  bucket_name          = "${local.name}-web-${local.account_id}"
  aliases              = [var.web_domain]
  enable_custom_domain = local.certs_ready
  certificate_arn      = module.dns.cloudfront_certificate_arn
  price_class          = var.cloudfront_price_class
  web_acl_arn          = local.waf_cloudfront_arn

  api_origin_domain       = local.api_origin_domain
  api_origin_protocol     = local.api_origin_protocol
  sse_origin_read_timeout = var.sse_origin_read_timeout
  alb_behaviors           = local.web_api_behaviors

  content_security_policy             = var.content_security_policy
  content_security_policy_report_only = var.content_security_policy_report_only
  hsts_preload                        = var.hsts_preload
}

module "store" {
  source = "../../modules/web"

  name                 = "${local.name}-store"
  bucket_name          = "${local.name}-store-${local.account_id}"
  aliases              = [var.store_domain]
  enable_custom_domain = local.certs_ready
  certificate_arn      = module.dns.cloudfront_certificate_arn
  price_class          = var.cloudfront_price_class
  web_acl_arn          = local.waf_cloudfront_arn

  api_origin_domain       = local.api_origin_domain
  api_origin_protocol     = local.api_origin_protocol
  sse_origin_read_timeout = var.sse_origin_read_timeout
  alb_behaviors           = local.store_api_behaviors
  enable_store_functions  = true

  content_security_policy             = var.content_security_policy
  content_security_policy_report_only = var.content_security_policy_report_only
  hsts_preload                        = var.hsts_preload
}

# ───────────────────────── DNS records (Route 53 only) ─────────────────────────

module "dns_records" {
  source = "../../modules/dns_records"
  count  = var.route53_zone_id != "" ? 1 : 0

  zone_id = var.route53_zone_id
  aliases = {
    (var.web_domain) = {
      target_dns_name        = module.web.domain_name
      target_zone_id         = module.web.hosted_zone_id
      ipv6                   = true
      evaluate_target_health = false
    }
    (var.store_domain) = {
      target_dns_name        = module.store.domain_name
      target_zone_id         = module.store.hosted_zone_id
      ipv6                   = true
      evaluate_target_health = false
    }
    (var.api_domain) = {
      target_dns_name        = module.api.alb_dns_name
      target_zone_id         = module.api.alb_zone_id
      ipv6                   = false
      evaluate_target_health = true
    }
  }
}

# ───────────────────────── Security baseline, alarms, budgets ─────────────────────────

module "security" {
  source = "../../modules/security"

  name                     = local.name
  alert_email              = var.alert_email
  enable_cloudtrail        = var.enable_cloudtrail
  audit_log_retention_days = var.audit_log_retention_days
  enable_guardduty         = var.enable_guardduty
  enable_config            = var.enable_config
  enable_security_hub      = var.enable_security_hub
  monthly_budget_usd       = var.monthly_budget_usd
  credits_total_usd        = var.credits_total_usd

  alb_arn_suffix          = module.api.alb_arn_suffix
  target_group_arn_suffix = module.api.target_group_arn_suffix
  ecs_cluster_name        = module.api.cluster_name
  ecs_service_name        = module.api.service_name
  db_instance_id          = module.database.instance_id
  db_instance_class       = var.db_instance_class
}

# ───────────────────────── Backup ─────────────────────────

module "backup" {
  source = "../../modules/backup"
  count  = var.enable_aws_backup ? 1 : 0
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }

  name                     = local.name
  resource_arns            = [module.database.instance_arn]
  source_kms_key_arns      = [module.database.kms_key_arn]
  retention_days           = var.aws_backup_retention_days
  enable_cross_region_copy = var.enable_cross_region_backup
  dr_retention_days        = var.aws_backup_retention_days
}
