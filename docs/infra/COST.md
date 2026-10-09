# Cost of the AWS setup

All figures are **estimates in US dollars per month**, computed from the resources
the Terraform code really creates. They use AWS Mumbai (`ap-south-1`) list prices as
remembered when this was written, **₹85 per dollar**, and 730 hours in a month.
AWS prices change and some of mine may be off by 10 to 20 percent, so I give
ranges, not exact numbers. **Re-check every line in the
[AWS Pricing Calculator](https://calculator.aws/) before you rely on it**, and watch
the first real bill in *Billing and Cost Management, Cost Explorer*.

## Summary

| | Lean profile | Launch profile |
|---|---|---|
| What it is | 1 API task (0.5 vCPU, 1 GB), DB `db.t4g.micro` single-AZ | 2 API tasks (0.5 vCPU, 1 GB), autoscaling to 4, DB `db.t4g.medium` single-AZ, both WAFs, copy to Singapore |
| **Estimate per month** | **about 90 to 120 USD** (₹7,700 to 10,200) | **about 185 to 275 USD** (₹15,800 to 23,400) |
| Same, DB Multi-AZ | not recommended at this size | add about 60 USD: 245 to 335 USD |
| With 1,000 USD of credits lasts | about 8 to 11 months | about 3.5 to 5.5 months |

These are **higher** than the earlier rough numbers you were given (lean 35 to 65,
launch 145 to 190). The difference is real and comes from things that earlier figure
left out: the load balancer (about 20 USD with its two public IP addresses about
7 USD), a public IPv4 address charge on every task (3.65 USD each, new since 2024),
a customer-managed encryption key for each store of data (1 USD each), Secrets
Manager (0.40 USD for each of 17 secrets), the web firewall (about 10 USD per
firewall), threat detection, and audit logging that the security checklist asks for.
To get nearer to the old numbers see [Ways to spend less](#ways-to-spend-less); the
absolute floor of this design is about 75 USD.

## Lean profile (`infra/profiles/lean.tfvars`)

| Line item | What it is | USD per month |
|---|---|---|
| ECS Fargate, API | 1 task, 0.5 vCPU, 1 GB, always on (x86) | 19 to 20 |
| Application Load Balancer | hourly charge plus about 1 capacity unit | 17 to 22 |
| Public IPv4 addresses | 2 for the load balancer, 1 for the task (3.65 each) | 11 |
| RDS PostgreSQL | `db.t4g.micro`, single-AZ | 13 to 15 |
| RDS storage | 20 GB gp3 (grows by itself up to 100 GB) | 3 |
| RDS backups above free | free up to the size of the database | 0 to 1 |
| KMS keys | RDS, app secrets and registry, audit logs, AWS Backup, Terraform state (5 keys) | 5 |
| Secrets Manager | 16 app secret containers plus the RDS master secret | 7 |
| CloudWatch Logs | API, database, flow logs, WAF logs; 180 days kept | 3 to 8 |
| CloudWatch alarms | 10 alarms | 1 |
| WAF on CloudFront | 1 web ACL, 5 rules, about 1 to 3 million requests | 10 to 12 |
| GuardDuty | free 30 days, then usage based | 2 to 6 |
| CloudTrail and audit bucket | first trail free, storage only | 0 to 1 |
| S3, ECR, DynamoDB lock | sites, container images, state | 1 to 2 |
| AWS Backup | daily copy of a small database, Mumbai only | 0 to 1 |
| CloudFront | inside the always-free 1 TB and 10 million requests; functions | 0 to 1 |
| Route 53 | 1 hosted zone, only if you use it | 0 to 1 |
| NAT gateway | not created | 0 |
| **Total** | | **about 92 to 117** |

## Launch profile (`infra/profiles/launch.tfvars`)

| Line item | What it is | USD per month |
|---|---|---|
| ECS Fargate, API | 2 tasks, 0.5 vCPU, 1 GB (up to 4 when busy: about 78) | 38 to 58 |
| Application Load Balancer | more traffic, more capacity units | 18 to 30 |
| Public IPv4 addresses | 2 for the load balancer, 2 to 4 for tasks | 15 to 22 |
| RDS PostgreSQL | `db.t4g.medium`, single-AZ | 52 to 58 |
| RDS storage | 50 GB gp3 | 6.5 to 7 |
| RDS backups, monitoring | 35-day retention, Performance Insights (free tier), enhanced monitoring 60 s | 1 to 6 |
| KMS keys | 5 plus the key in the second region | 6 |
| Secrets Manager | as above | 7 |
| CloudWatch Logs | more traffic, load balancer logs | 8 to 20 |
| CloudWatch alarms | 10 alarms plus 2 autoscaling alarms | 1.4 |
| WAF | 2 web ACLs (CloudFront and load balancer), about 5 to 15 million requests | 22 to 32 |
| GuardDuty | usage based | 5 to 12 |
| CloudTrail, S3, ECR, ALB logs | | 3 to 5 |
| AWS Backup | daily, with a copy in Singapore (storage plus transfer) | 3 to 8 |
| CloudFront | mostly inside the always-free tier | 0 to 5 |
| Route 53 | | 0 to 1 |
| **Total** | | **about 187 to 273** |

Variations on launch: Multi-AZ database `db_multi_az = true` adds about 60 USD
(second instance plus storage); API tasks of 1 vCPU and 2 GB add about 38 USD for two
tasks; turning on the NAT gateway adds about 40 USD plus data processing; Graviton (ARM64)
tasks subtract about 20 percent of the Fargate lines.

## What the credits do not cover

AWS Activate credits pay most services, including everything above. They normally do
not pay for the Support plans, domain registration, or Marketplace software, and
you should check in *Billing, Credits* what is covered and whether **GST (18 percent)
is charged on top of the credit-covered amount** for an Indian billing entity. Budget
for that cash outflow. Credits also **expire** (usually 12 months from the grant, up
to 24 for some tiers): put the expiry date in your calendar, and set
`credits_total_usd` in your variables so a budget warns you at 50, 80 and 100 percent of
the credits.

## Ways to spend less

| Lever | Saves per month | What you give up |
|---|---|---|
| `enable_waf_cloudfront = false` | 10 to 12 USD | No filtering of bad IPs and attack patterns, no login rate limit at the edge. Not recommended with customer data. |
| `enable_guardduty = false` | 2 to 6 USD | No automatic threat detection |
| `enable_flow_logs = false` | 1 to 3 USD | No network audit trail |
| `flow_log_traffic_type = "REJECT"` | 1 to 2 USD | Only rejected traffic is logged |
| `enable_aws_backup = false` | 0 to 1 USD | Keep only the RDS automated backups (14 days) |
| `api_cpu_architecture = "ARM64"` | about 4 USD (lean) | Slower image build, see README |
| Fewer secret containers | up to 5 USD | Edit `modules/api` (optional list); not worth the effort at first |
| Shorter log retention (90 days) | about 1 USD | CERT-In asks for 180 days |

These levers take the lean profile to roughly 75 to 95 USD. Below that the design
would have to change (for example no load balancer: one small server, which means
downtime on every deploy and no failover).

## What grows with usage

- **Fargate tasks and RDS size** are the two big ones. Change `api_desired_count`,
  `api_cpu`, `api_memory`, `db_instance_class`.
- **Data transfer out** to the internet: the first 100 GB a month across AWS are free;
  then about 0.109 USD per GB. Invoice PDFs and backups downloads are the main users.
- **WAF requests** at about 0.60 USD per million.
- **CloudWatch Logs** ingestion at about 0.50 USD per GB: a busy API can write several
  GB a month.
- **Storage**: the database grows; storage autoscaling raises it up to
  `db_max_allocated_storage` (an alarm warns you earlier).

## How these were computed

Fargate: vCPU 0.0426 USD per hour and GB 0.0047 USD per hour in Mumbai
(0.5 vCPU plus 1 GB is 0.0259 USD per hour, 18.9 USD per month). ALB 0.024 USD per
hour plus 0.008 USD per capacity unit hour. Public IPv4 0.005 USD per hour. RDS
`db.t4g.micro` about 0.018 USD per hour, `db.t4g.medium` about 0.073 USD per hour,
gp3 about 0.13 USD per GB-month. KMS 1 USD per key. Secrets Manager 0.40 USD per secret.
WAF 5 USD per web ACL plus 1 USD per rule plus 0.60 USD per million requests. Alarms
0.10 USD each. These are the numbers to verify in the calculator.
