# Security notes for the AWS setup

What the infrastructure code enforces, mapped to the controls on a typical security
checklist, and what it does **not** cover. Where the security team has written the
matching policy or runbook it is linked (those documents live under `docs/security/`
and may arrive in a separate change).

## What the code enforces

| Control | How | Where |
|---|---|---|
| Data stays in India (CERT-In) | All customer data in `ap-south-1` (the `region` variable only accepts Mumbai or Hyderabad). `us-east-1` holds only TLS certificates and the CloudFront firewall rules, no customer data. The optional backup copy to Singapore is **off** in the lean profile and flagged in the launch profile | `stacks/prod/variables.tf`, `profiles/` |
| Encryption in transit | HTTPS only: HTTP redirects to HTTPS on the load balancer and CloudFront; TLS 1.3 policy on the load balancer (TLS 1.2 minimum); CloudFront minimum `TLSv1.2_2021`; HSTS header on both sites; database refuses non-TLS connections (`rds.force_ssl=1`) and the app connects with `sslmode=require`; S3 buckets deny non-TLS requests | `modules/api`, `modules/web`, `modules/database` |
| Encryption at rest | RDS storage, snapshots and its master secret with a customer-managed KMS key (yearly rotation on); Secrets Manager and the container registry with a customer-managed key; audit logs with a customer-managed key; S3 site buckets SSE-S3 (public content only); Terraform state with a customer-managed key | all modules |
| Private database | Isolated subnets with no internet route, `publicly_accessible = false`, security group that accepts only the API task and the admin task. No port is ever opened to the internet; admin work uses ECS Exec | `modules/network`, `modules/database`, `modules/api` |
| Network isolation of the API | Tasks have public IPs only so they can call Resend, Razorpay and others without a NAT gateway; the security group admits the load balancer only. `enable_nat_gateway` removes the public IPs | `modules/api`, `modules/network` |
| No long-lived keys | GitHub Actions signs in with OIDC to a role limited to this repository and the `main` branch or named GitHub environments; no AWS access keys exist anywhere; the owner uses SSO. The deploy role cannot read secrets, change infrastructure, or touch other buckets | `infra/bootstrap` |
| Secrets management | Secret values are never in Terraform, in the repository or in the state file. Containers only; the owner stores values. ECS injects them at start. Task execution role can read only the secrets it injects | `modules/api` |
| Least privilege | Separate roles: deploy (ECR push, ECS update, S3 sync of two buckets, CloudFront invalidation), task execution (read its own secrets), task (none), admin task (master secret only), plan role (read-only, off by default) | `infra/bootstrap`, `modules/api` |
| Logs for 180 days (CERT-In) | API, database, VPC flow logs, WAF logs, exec sessions in CloudWatch with `log_retention_days` default 180; audit logs in S3 for 365 days | all modules |
| Audit trail of AWS changes | Multi-region CloudTrail with log file validation, encrypted, stored in a private versioned bucket | `modules/security` |
| Threat detection | GuardDuty on by default | `modules/security` |
| Web application firewall | AWS managed rule sets (common, known bad inputs, IP reputation) plus a per-IP login rate limit on CloudFront; also on the load balancer in the launch profile. Webhook and device-push paths are exempt; upload-size and HTML-text rules only count | `modules/waf` |
| Backups | RDS automated backups (14 to 35 days, point-in-time), AWS Backup daily plan with its own key, optional cross-region copy, deletion protection plus final snapshot. Quarterly restore test: see [`docs/security/backup-and-recovery.md`](../security/backup-and-recovery.md) and [OPERATIONS.md](OPERATIONS.md) | `modules/database`, `modules/backup` |
| Monitoring and alerting | 10 CloudWatch alarms (5xx, unhealthy tasks, CPU, memory, database CPU, storage, connections, memory, CPU credits) to the owner's email; budgets at 50, 80 and 100 percent plus a credit budget | `modules/security` |
| Public S3 impossible | Account-wide public access block, per-bucket blocks, CloudFront reads via origin access control only | `modules/security`, `modules/web` |
| Container image hygiene | Registry scans on push, immutable tags (git sha), lifecycle keeps the last 30 | `modules/api` |
| Supply chain of the pipeline | Third-party GitHub actions pinned to commit SHAs; infra changes run format, validate, tflint, a policy scan (Checkov, every skip has a written reason) and offline plan tests | `.github/workflows/infra.yml` |
| Security headers on the sites | HSTS, `X-Content-Type-Options`, frame denial, referrer policy, permissions policy (camera and location only for the app itself). CSP optional (see below) | `modules/web` |
| Tags | `Project`, `Environment`, `ManagedBy`, `CostCenter` on everything for cost and ownership | `providers.tf` |

Config and Security Hub are available behind flags (`enable_config`, `enable_security_hub`), off by default because
they bill per item.

### Content-Security-Policy and other headers

Headers are shared work with the security audit of the application. The web app already sets its CSP in
`index.html`. The CloudFront response headers policy lets you add or override: set `content_security_policy` in
`owner.tfvars` and `content_security_policy_report_only = true` (default) to observe first, then `false` to
enforce. API responses keep the headers the API itself sets; CloudFront does not touch them.

## What this does NOT cover

- **Application security**: authentication, authorization (per-tenant checks), input validation, session handling, rate limits in the
  code, two-factor policy, encryption key rotation. These live in the application; see `SECURITY.md` and `docs/security/`.
- **Penetration test and vulnerability management**: the code gives you a scanner for images and tooling, not a test. Book an
  independent pen test before large customers or audits.
- **Account hygiene on SaaS tools**: MFA on GitHub, Razorpay, Sandbox, Resend, Cloudflare, your domain registrar, your email.
  The infrastructure is only as safe as the accounts that can change it. Enable MFA on all of them and protect the root user of AWS.
- **People and process**: access reviews, onboarding and offboarding, incident response plan, breach notification to CERT-In
  within 6 hours (rule of the CERT-In directions) and to the Data Protection Board, vendor contracts, DPA with AWS, policies
  and training. These are documents and habits, not Terraform.
- **Fixed outbound address**: without NAT the API's outgoing IP changes; services that need an allow-list need `enable_nat_gateway`.
- **DDoS beyond the basics**: CloudFront and the load balancer include AWS Shield Standard; Shield Advanced is not enabled.
- **Client IP trust**: the application's per-IP limits see CloudFront's address on web and store traffic (README, "Known limitations").
- **Data loss by mistake inside the app**: a customer deleting data is not an infrastructure failure; backups restore the whole database,
  not one customer's records.
- **Compliance certification**: nothing here makes you SOC 2 or ISO 27001 by itself; it provides evidence for several controls.

## First week after launch

1. Confirm MFA on every account listed above.
2. Read the first week of GuardDuty findings and WAF "counted" requests (log group `aws-waf-logs-...`); tighten or loosen rules.
3. Run the first backup restore test.
4. Turn on the Checkov and plan jobs as required checks if you want infra changes gated.
