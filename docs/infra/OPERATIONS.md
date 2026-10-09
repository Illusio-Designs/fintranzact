# Operating Fintranzact on AWS

Everyday tasks, with exact commands. Sign in first: `export AWS_PROFILE=fintranzact; aws sso login`.
The names below (`fintranzact-prod`...) are the defaults; `terraform output ecs` and
`terraform output github_actions_variables` (in `infra/stacks/prod`) print the real ones.

## Deploy

*Actions, Deploy AWS, Run workflow*: pick `production` and a target (`all`, `api`, `web`, `store`).
Order inside: API image build and push, migration (one-off task), service update with automatic
rollback, then web and store upload, cache clear, smoke tests. A migration that fails stops everything and
leaves the running version untouched.

Deploy only the websites after a front-end change: target `web` (or `store`). Deploy only the API
after a back-end fix: target `api`.

### Turning on automatic deploys

Off by default. When you trust the pipeline, add this to the top of `.github/workflows/deploy-aws.yml`
(keep `workflow_dispatch`), replacing the `on:` block:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs: { ...as they are now... }
```

and make the jobs read `inputs.environment` with a default: use `${{ inputs.environment || 'production' }}`
and `${{ inputs.target || 'all' }}` in the three places they appear. Keep the `production` GitHub
environment with a *Required reviewer* if you want a human click before each deploy. Remember the Vercel and
Railway deploys also exist until you retire them (MIGRATION doc).

## Roll back

**API.** Every deploy registers a new *task definition revision* whose image is a git commit. To go back to the previous
one:

```bash
aws ecs list-task-definitions --family-prefix fintranzact-prod-api --sort DESC --max-items 5
aws ecs update-service --cluster fintranzact-prod --service fintranzact-prod-api \
  --task-definition fintranzact-prod-api:<previous revision number>
```

Or re-run *Deploy AWS* from the older commit (the image already exists, so the build is skipped; the
migration step runs again and does nothing). If a deploy fails its health checks, ECS **rolls back by
itself** (circuit breaker). **Database migrations are not undone**: see
[`docs/ROLLBACK.md`](../ROLLBACK.md) for the per-migration reverse SQL; prefer restoring a backup only for data loss.
Note that an image built before this infrastructure existed does not know the `migrate` command: if you
roll back that far through the workflow, the migration step would start a full server and hang until its timeout.
Roll back with `update-service` instead.

**Websites.** Both buckets keep old file versions for 30 days. Quickest: re-run *Deploy AWS* from the older
commit with target `web` or `store`.

## Scaling knobs (all in `owner.tfvars` or the profile files, then `terraform apply`)

| Want | Change |
|---|---|
| More API power per task | `api_cpu = 1024`, `api_memory = 2048` (valid pairs: 512/1024-4096, 1024/2048-8192) |
| More API tasks | `api_desired_count = 2` (or `api_autoscaling_enabled = true`, `api_autoscaling_min/max`) |
| Bigger database | `db_instance_class = "db.t4g.medium"` (a few minutes of downtime in the maintenance window; use `terraform apply` at a quiet hour) |
| Failover database | `db_multi_az = true` |
| More database disk | `db_allocated_storage`; it also grows by itself up to `db_max_allocated_storage` |
| Private tasks, fixed outbound IP | `enable_nat_gateway = true` |
| Whole profile | `-var-file=../../profiles/launch.tfvars` |

A change to task settings reaches the running API at the **next deploy** (the workflow starts from the newest task
definition). So after changing CPU, memory or variables: `terraform apply`, then run *Deploy AWS* with target `api`.

## Logs

- API: *CloudWatch, Log groups, `/ecs/fintranzact-prod-api`*. Live tail:
  `aws logs tail /ecs/fintranzact-prod-api --follow --since 15m`
- One request or error: `aws logs filter-log-events --log-group-name /ecs/fintranzact-prod-api --filter-pattern '"ERROR"' --start-time $(($(date +%s)-3600))000`
- Database: `/aws/rds/instance/fintranzact-prod-pg/postgresql` (slow queries over 1 second, connections).
- Firewall decisions: `aws-waf-logs-fintranzact-prod-cloudfront` (log group in **us-east-1**).
- Load balancer errors: the *Target group* and the alarm `fintranzact-prod-alb-5xx`; with `enable_alb_access_logs` the S3 bucket.
- Account activity (who changed what in AWS): *CloudTrail, Event history*; the full trail is in the `*-audit-logs-*` bucket for a year.
- All kept 180 days (CERT-In). Change `log_retention_days` to keep longer.

## Run a command or open a shell

ECS Exec on the admin task (never open port 5432). The exact commands are in SETUP.md step 11. For a shell in a
running **API** task, set `enable_ecs_exec = true`, apply, deploy, then:

```bash
TASK=$(aws ecs list-tasks --cluster fintranzact-prod --service-name fintranzact-prod-api --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster fintranzact-prod --task "$TASK" --container api --interactive --command "/bin/sh"
```

Every session is logged to `/ecs/fintranzact-prod/exec-sessions`. Turn `enable_ecs_exec` back off afterwards.

One-off application commands (for example the data audit) run the same way as the migration task, with a different `command`.
The production image has no TypeScript tooling, so `pnpm data:audit` is run from a laptop with a database tunnel
(see the migration doc).

## Backups and restore

What exists: RDS automated backups (14 days, restore to any second: point-in-time), the daily AWS Backup recovery
points (35 days), optional copy in another region (launch), a final snapshot if the database is ever deleted, and
database deletion protection. Link to the security team's procedure and the quarterly restore test:
[`docs/security/backup-and-recovery.md`](../security/backup-and-recovery.md).

Restore to a **new** database (never over the live one) and test it:

```bash
# Point-in-time restore to a new instance in the same private subnets
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier fintranzact-prod-pg \
  --target-db-instance-identifier fintranzact-prod-pg-restore \
  --restore-time 2026-10-09T05:30:00Z \
  --db-subnet-group-name fintranzact-prod-pg \
  --vpc-security-group-ids <database security group id> \
  --no-publicly-accessible
```

(Use `--use-latest-restorable-time` for "as late as possible". The new instance gets a new address; its admin
password is the old one. Add its security group access like the original, connect with the admin task by setting
`PGHOST` to the new address, check the data.) To go live on the restored copy, change `DATABASE_URL` in Secrets
Manager to the new host and redeploy; afterwards import or replace the instance in Terraform (ask the developer, this
is a rare emergency step). From an AWS Backup recovery point: *AWS Backup, Vaults, `fintranzact-prod-vault`, pick the point,
Restore*. **Do the restore test every quarter** and record it.

## Secrets

- Change a value: `aws secretsmanager put-secret-value --secret-id fintranzact-prod/api/<NAME> --secret-string ...`
  (use `read -rs` as in SETUP.md). The API reads secrets **at start**, so redeploy (*Deploy AWS*, target `api`) or force a
  restart: `aws ecs update-service --cluster fintranzact-prod --service fintranzact-prod-api --force-new-deployment`.
- Rotate third-party keys (Razorpay, Resend, Sandbox, Anthropic): create the new key at the provider, store it, restart,
  revoke the old key. Put a yearly reminder in the calendar.
- **`ENCRYPTION_KEY` and `TRIAL_CLAIM_SALT` are not rotated by replacing the value.** Rotating the encryption key
  needs the app's rotation procedure (`ENCRYPTION_KEY_PREVIOUS`); follow the security team's runbook, add
  `ENCRYPTION_KEY_PREVIOUS` to `enabled_optional_secrets` for the duration.
- The database admin password is rotated by RDS every 7 days on its own. The app user's password is yours: change it with `ALTER ROLE`
  via the admin task, then update `DATABASE_URL`, then restart.
- Where each secret came from is in SETUP.md step 10.

## Upgrade PostgreSQL

Minor versions (16.x) are applied automatically in the Sunday-night maintenance window
(`auto_minor_version_upgrade`). Major upgrade (16 to 17): take a manual snapshot, change the engine version and the parameter
group family in `modules/database` on a **staging** copy first, then plan a maintenance window; AWS does the in-place upgrade
(15 to 30 minutes of downtime). Ask the developer to prepare the change; do not edit `postgres16` strings blindly.

## Watching the cost

- Alerts: 50, 80 and 100 percent of the monthly budget, a forecast alert, and the credit budget.
- Weekly for the first month: *Billing, Cost Explorer*, group by **Service**, then by tag **Project** (after activation).
- The big lines are Fargate, the load balancer, RDS, public IPv4, WAF. COST.md lists the levers.
- **Credit expiry:** the date is in your calendar from SETUP.md step 2. One month before it, decide: continue on card, or move
  to a leaner profile. After credits end, the budget amount in `owner.tfvars` is what you really pay.

## Alarms and what to do

| Alarm (`fintranzact-prod-...`) | Meaning | First action |
|---|---|---|
| `alb-5xx`, `target-5xx` | The API returns server errors | Look at the API log group; was there a deploy? roll back |
| `unhealthy-hosts` | A task fails its health check | `aws ecs describe-services` events; logs; roll back |
| `ecs-cpu-high`, `ecs-memory-high` | Tasks are working too hard | Raise `api_cpu`/`api_memory` or the task count |
| `rds-cpu-high`, `rds-cpu-credits-low` | Database is busy or out of burst credits | Slow query log; move up one instance size |
| `rds-free-storage-low` | Disk almost full | Raise `db_max_allocated_storage`; find what grows |
| `rds-connections-high` | Many connections | Too many API tasks for the instance size, or a leak |
| `rds-freeable-memory-low` | Database memory low | Move up one instance size |

## Streaming problems (AI assistant)

The answer path is `browser -> CloudFront (/api/ai/stream) -> load balancer -> API`. Check, in order: an answer that
arrives all at once means something buffers it (compression or caching): CloudFront behavior `/api/ai/stream` must have
`CachingDisabled`, no compression; an answer cut after about 60 seconds of silence is the CloudFront origin timeout
(`sse_origin_read_timeout`; AWS allows up to 180 only after you request a quota increase for "Response timeout per origin");
an answer cut at 300 s is the load balancer idle timeout (`alb_idle_timeout`).

## Staging copy

Copy `owner.tfvars` to `staging.tfvars`, set `environment = "staging"`, different domains, `enable_guardduty = false`,
`enable_cloudtrail = false` (same account), use the lean profile, and a separate state key in `backend.hcl`
(`key = "staging/terraform.tfstate"`). Add `staging` to `environments` in the bootstrap and apply it, and
create a GitHub environment `staging`. **Never load real customer data into staging.**

## Destroying everything

Not a casual action. The database has deletion protection and takes a final snapshot. Set `db_deletion_protection = false`, apply,
then `terraform destroy`. S3 buckets with content must be emptied first. The state bucket in bootstrap has `prevent_destroy`.
