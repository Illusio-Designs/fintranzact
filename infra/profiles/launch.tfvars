# LAUNCH profile: for paying customers and a real launch (estimate in docs/infra/COST.md).
# Use:  terraform apply -var-file=../../profiles/launch.tfvars -var-file=owner.tfvars
# Contains no secrets and no owner-specific values.
# Moving from lean to launch is only a change of this file; the database is
# resized in the maintenance window (set db_multi_az and apply during a quiet hour).

# Database: db.t4g.medium (2 vCPU, 4 GB). Set db_multi_az = true for automatic
# failover (about 1 to 2 minutes) at roughly double the database price.
db_instance_class        = "db.t4g.medium"
db_allocated_storage     = 50
db_max_allocated_storage = 200
db_multi_az              = false
db_backup_retention_days = 35
db_performance_insights  = true
db_monitoring_interval   = 60

# API: two tasks of 0.5 vCPU and 1 GB across two AZs, scaling to four on CPU.
# Scale-up knob: api_cpu = 1024 and api_memory = 2048 (about 38 USD more for two tasks).
api_cpu                 = 512
api_memory              = 1024
api_desired_count       = 2
api_autoscaling_enabled = true
api_autoscaling_min     = 2
api_autoscaling_max     = 4
api_cpu_architecture    = "X86_64"
enable_ecs_exec         = false

enable_nat_gateway         = false
enable_interface_endpoints = false

# Security: WAF on CloudFront AND on the API load balancer (mobile app, webhooks).
enable_waf_cloudfront = true
enable_waf_alb        = true
enable_cloudtrail     = true
enable_guardduty      = true

# Backup: AWS Backup with a copy in Singapore. NOTE: this copies customer data
# outside India; confirm with your lawyer/CA that this is acceptable, or set to false.
enable_aws_backup          = true
aws_backup_retention_days  = 35
enable_cross_region_backup = true
backup_dr_region           = "ap-southeast-1"

log_retention_days     = 180
enable_alb_access_logs = true
