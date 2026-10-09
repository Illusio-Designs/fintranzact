# LEAN profile: cheapest safe start for the first customers (estimate in docs/infra/COST.md).
# Use:  terraform apply -var-file=../../profiles/lean.tfvars -var-file=owner.tfvars
# Contains no secrets and no owner-specific values.

# Database: smallest instance, one AZ (a failure means roughly 15 to 30 minutes of
# downtime and a restore, not data loss: backups every day plus point-in-time recovery).
db_instance_class        = "db.t4g.micro"
db_allocated_storage     = 20
db_max_allocated_storage = 100
db_multi_az              = false
db_backup_retention_days = 14
db_performance_insights  = false
db_monitoring_interval   = 0

# API: one task of half a vCPU and 1 GB. A deploy briefly runs two (zero downtime).
api_cpu                 = 512
api_memory              = 1024
api_desired_count       = 1
api_autoscaling_enabled = false
api_cpu_architecture    = "X86_64"
enable_ecs_exec         = false

# Network: no NAT gateway (saves about 35 USD a month); tasks have public IPs but
# only the load balancer can reach them.
enable_nat_gateway         = false
enable_interface_endpoints = false

# Security: WAF on CloudFront only. Switch it OFF to save about 10 USD a month ONLY
# if you accept no edge filtering (not recommended while handling customer data).
enable_waf_cloudfront = true
enable_waf_alb        = false
enable_cloudtrail     = true
enable_guardduty      = true

# Backup: daily AWS Backup copy kept in Mumbai only. No second region (saves
# storage and keeps all data in India).
enable_aws_backup          = true
aws_backup_retention_days  = 35
enable_cross_region_backup = false

# Logs: 180 days (CERT-In).
log_retention_days     = 180
enable_alb_access_logs = false
