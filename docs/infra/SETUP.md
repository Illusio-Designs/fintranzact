# First-time setup (step by step)

Written for a founder who has not used AWS before. Plan for **one focused day**
spread over two or three sittings (some steps wait for AWS or for DNS). Nothing
here costs money until step 8 (the first `apply`). Where something can go wrong,
the "If it fails" line tells you what to do. Never paste secret values into chat,
email or the repository.

Terms: **Terraform** is the tool that reads the files in `infra/` and builds the
AWS resources. **OpenTofu** is a free drop-in replacement and works the same way (use
the command `tofu` instead of `terraform`). **ECS** runs the API container,
**RDS** is the database, **CloudFront** serves the websites, **Secrets Manager**
keeps passwords and keys.

---

## 1. Create the AWS account

1. Go to <https://aws.amazon.com/> and choose *Create an AWS account*.
2. Use a **business email that a team can read** (for example `aws@yourdomain.com`,
   forwarded to you), not a personal one. Account name: your company.
3. Pick *Business* use, give the real company address and a company card. Choose the
   Indian billing entity if offered (invoices with GST).
4. Choose the *Basic (free)* support plan.
5. Region: leave it, we always pick **Asia Pacific (Mumbai) `ap-south-1`**.

**If it fails:** card verification can take a day; retry with a different card.

## 2. Apply for the AWS Activate credits (do this immediately after step 1)

Credits approval takes days, so start now and keep going with steps 3 to 6 while you wait.

1. Open <https://aws.amazon.com/activate/> and choose the founders package that
   matches you (about 1,000 USD for early startups without funding, more with an
   accelerator or investor).
2. The form asks for your AWS **account ID** (12 digits, top right of the console
   under your name), company website, a short description and a LinkedIn profile.
3. When approved, the credits appear under *Billing and Cost Management, Credits*.
   **Do not run step 8 until you see them there.**
4. Write down the **expiry date** and put a calendar reminder 60 and 14 days before it.
   Credits expire (typically 12 months), and the bill then comes to your card.

## 3. Secure the account (30 minutes, do not skip)

1. Sign in as the root user (the email address). Open *Security credentials* and turn on
   **MFA** with an authenticator app (a second MFA device is wise: a hardware key or a
   second phone, stored separately).
2. Do **not** create access keys for the root user. Never use root again after step 4.
3. *Billing, Billing preferences*: turn on *Receive Free Tier alerts* and *PDF invoice by email*.
4. *Billing, Cost allocation tags*: later (after step 8) activate the tags `Project`,
   `Environment` and `CostCenter` so costs can be split.

## 4. Create your own sign-in with IAM Identity Center (SSO)

This gives you a normal login with MFA and no permanent keys.

1. In the console, search *IAM Identity Center*, choose region **Asia Pacific (Mumbai)**
   and click *Enable* (create it with AWS Organizations if asked: it is free).
2. *Users, Add user*: your own name and email. Finish the invitation email and set a
   password and MFA.
3. *Permission sets, Create*: *Predefined, AdministratorAccess*. (Admin is needed for the
   first apply; you can use a narrower set later.)
4. *AWS accounts*: select your account, *Assign users*, pick your user and the permission set.
5. Note the **AWS access portal URL** (like `https://d-xxxxxxxxxx.awsapps.com/start`).

## 5. Install the tools on your computer

You need: Terraform (or OpenTofu), the AWS CLI v2, `jq`, and for ECS Exec the Session
Manager plugin.

- macOS (Homebrew): `brew install terraform awscli jq session-manager-plugin`
- Windows: use WSL (Ubuntu) and follow the Linux steps, or `winget install Hashicorp.Terraform Amazon.AWSCLI jqlang.jq`
- Linux: follow <https://developer.hashicorp.com/terraform/install> and
  <https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html>

Check: `terraform version` shows 1.6 or newer; `aws --version` shows 2.x.

Sign in from the terminal:

```bash
aws configure sso
#  SSO start URL: the portal URL from step 4
#  SSO region:    ap-south-1
#  pick the account and the AdministratorAccess role
#  CLI default region: ap-south-1, profile name: fintranzact
export AWS_PROFILE=fintranzact
aws sso login
aws sts get-caller-identity     # shows your account id: success
```

Repeat `aws sso login` whenever the session expires (about every 8 hours).

## 6. Decide the three domain names

| Variable | Typical value | Used for |
|---|---|---|
| `web_domain` | `app.fintranzact.com` | The web app (the mobile app expects `app.` next to `api.`) |
| `store_domain` | `store.fintranzact.com` | The online store |
| `api_domain` | `api.fintranzact.com` | Mobile app, Razorpay and carrier webhooks, CloudFront to API |

Where is your domain's DNS?

- **Route 53 (AWS):** easiest. Create (or transfer) the hosted zone and note its **Zone ID**
  (`Z0123...`). Terraform then creates every record.
- **Another registrar or DNS host (GoDaddy, Cloudflare, Namecheap...):** also fine.
  Terraform prints the exact records and you add them by hand in two rounds (step 9).
  If you use Cloudflare, add the records as **DNS only (grey cloud)**.

## 7. Bootstrap: state storage and the GitHub sign-in (once)

This creates the encrypted bucket that remembers what Terraform built, the lock table,
the GitHub sign-in provider, and the **deploy role** that GitHub Actions uses (no access
keys anywhere).

```bash
cd infra/bootstrap
terraform init
terraform plan          # read it; about 20 resources
terraform apply         # type yes
terraform output
```

Keep the file `infra/bootstrap/terraform.tfstate` safe (it is git-ignored). Losing it is not
a disaster (it can be imported) but it is easier to keep it: copy it into a password manager
attachment or private storage. Write down the outputs:

- `backend_config` (bucket name and lock table)
- `github_deploy_role_arn` (looks like `arn:aws:iam::123456789012:role/fintranzact-github-deploy`)

Optional: to let pull requests run `terraform plan`, copy `terraform.tfvars.example` to
`terraform.tfvars`, set `enable_plan_role = true`, apply again, and note
`github_plan_role_arn`. (This read-only role can see your whole AWS configuration but
cannot change anything or read secret values; leave it off until you want it.)

**If it fails:** `EntityAlreadyExists` for the OIDC provider means the account already has
one: set `create_github_oidc_provider = false` and the provider ARN in `terraform.tfvars`.

## 8. The production stack (first apply)

```bash
cd ../stacks/prod
cp backend.hcl.example backend.hcl        # paste the values printed in step 7
cp owner.tfvars.example owner.tfvars      # fill in your domains and email
terraform init -backend-config=backend.hcl
```

Edit `owner.tfvars`:

- `web_domain`, `store_domain`, `api_domain`: from step 6.
- `route53_zone_id`: only if the zone is in Route 53.
- `alert_email`: where alarms and budget alerts go.
- `monthly_budget_usd`: lean about 100 to 120, launch about 250 to 300.
- `credits_total_usd`: your Activate amount (budget warns before credits run out).
- **`api_desired_count = 0` for this first apply** (the API cannot start until the secrets and the first
  image exist).

Then:

```bash
terraform plan  -var-file=../../profiles/lean.tfvars -var-file=owner.tfvars
terraform apply -var-file=../../profiles/lean.tfvars -var-file=owner.tfvars
```

Read the plan before typing `yes`: it should only **add** things (a long list, over a hundred items). The apply takes
**15 to 25 minutes** (the database and CloudFront are slow). When it finishes:

```bash
terraform output
```

An email arrives from AWS Notifications asking you to **confirm the subscription**: click
Confirm (otherwise alarms cannot reach you). A second set of emails comes from AWS Budgets.

**If it fails:**

- `GuardDutyDetectorAlreadyExists`: the account already has GuardDuty. Set
  `enable_guardduty = false` in `owner.tfvars` and apply again.
- A certificate step that waits and times out after 30 minutes: DNS validation could
  not complete (Route 53 zone is not the one that serves your domain). Check the NS records of your domain
  point to that zone.
- Run `terraform apply` again: it continues where it stopped.

## 9. DNS and certificates

### If you use Route 53

Nothing to do: records and certificate validation were created in step 8. Skip to step 10.

### If your DNS is elsewhere (two rounds)

1. `terraform output dns_records_to_create` shows `step_1_certificate_validation_cname`:
   a few CNAME records with long names like `_abc123.app.fintranzact.com`. Add them at
   your DNS host exactly (some hosts want the name **without** the domain at the end: `_abc123.app`).
2. Wait 5 to 30 minutes. In *AWS Certificate Manager* (check **both** Mumbai and N. Virginia
   `us-east-1`) the two certificates change from *Pending validation* to **Issued**.
3. In `owner.tfvars` add `certs_ready = true` and apply again:
   ```bash
   terraform apply -var-file=../../profiles/lean.tfvars -var-file=owner.tfvars
   ```
   This turns on HTTPS on the load balancer and the custom domains on CloudFront.
4. `terraform output dns_records_to_create` now also shows `step_2_traffic_cname`: three
   CNAME records pointing `app.`, `store.` and `api.` to CloudFront and the load balancer. Add them.
   Lower TTL (for example 300 seconds) while you are testing.

## 10. Fill in the secrets

Terraform created **empty containers** for every secret; it never sees a value. List them:

```bash
terraform output secrets_to_populate
```

**Needed on day one** (the API will not start without them):

| Secret name (last part) | What to put | How to make it |
|---|---|---|
| `ENCRYPTION_KEY` | 64 hex characters. **Never change it later**; copy the exact old value when moving from Railway. | `openssl rand -hex 32` |
| `TRIAL_CLAIM_SALT` | long random text. Never change it later. | `openssl rand -hex 32` |
| `DATABASE_URL` | connection string of the **application** database user (step 11 explains). | see step 11 |

**Optional** (turn on when you use the feature; each is added to `enabled_optional_secrets` after you stored it):
`PLATFORM_ADMIN_PASSWORD` (the first platform-admin login), `RESEND_API_KEY` (email),
`SANDBOX_API_KEY` and `SANDBOX_API_SECRET` (GST e-invoice, e-way bill), `RAZORPAY_KEY_ID`,
`RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (subscription billing),
`TURNSTILE_SECRET_KEY` (store bot protection), `SHIPPING_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`
(AI assistant), `MSG91_AUTH_KEY` (SMS), `CONTROL_DATABASE_URL` (multi-tenant only, leave
alone), `ENCRYPTION_KEY_PREVIOUS` (only during a key rotation).

Store a value **without it landing in your shell history** (the prompt does not echo what you type):

```bash
read -rs VALUE          # type or paste the value, press Enter
aws secretsmanager put-secret-value \
  --secret-id fintranzact-prod/api/ENCRYPTION_KEY --secret-string "$VALUE"
unset VALUE
```

For a random value, generate and store in one go without ever displaying it:

```bash
aws secretsmanager put-secret-value --secret-id fintranzact-prod/api/TRIAL_CLAIM_SALT \
  --secret-string "$(openssl rand -hex 32)"
```

Then, **save `ENCRYPTION_KEY` in your password manager too**: if you lose it, saved e-invoice and
Razorpay credentials become unreadable.

To switch on an optional secret later, store its value, add its name to
`enabled_optional_secrets = ["RESEND_API_KEY", ...]` in `owner.tfvars`, `terraform apply`, then run the
**Deploy AWS** workflow (target `api`).

Plain (non-secret) settings go in `api_extra_environment`, for example
`EMAIL_FROM`, `CONTACT_INBOX`, `SMS_PROVIDER`, `MSG91_TEMPLATE_ID`, `FINVERA_GSTIN`,
`SANDBOX_MONTHLY_QUOTA`. The code already sets `NODE_ENV`, `PORT`, `APP_URL`, `STORE_URL`,
`API_URL`, `CORS_ORIGINS` and `MULTI_TENANT=false` from your domains.

## 11. Create the application database user and `DATABASE_URL`

RDS created an admin user and keeps its password in Secrets Manager (rotated by AWS). The
application should use **its own** less powerful user. The database has no internet access, so you work
inside the VPC through a small **admin task** that you start on demand and stop afterwards. It
has `psql`, `pg_dump` and `pg_restore`. Port 5432 is never opened to the internet.

```bash
cd infra/stacks/prod
ECS=$(terraform output -json ecs)
CLUSTER=$(echo "$ECS" | jq -r .cluster)
FAMILY=$(echo "$ECS" | jq -r .admin_task_family)
SUBNETS=$(echo "$ECS" | jq -r '.subnets | join(",")')
SG=$(echo "$ECS" | jq -r .admin_security_grp)
PUBIP=$(echo "$ECS" | jq -r .assign_public_ip)

TASK=$(aws ecs run-task --cluster "$CLUSTER" --task-definition "$FAMILY" --launch-type FARGATE \
  --enable-execute-command --started-by owner-admin \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=$PUBIP}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-running --cluster "$CLUSTER" --tasks "$TASK"
sleep 30
aws ecs execute-command --cluster "$CLUSTER" --task "$TASK" --container admin --interactive --command "/bin/sh"
```

(`TargetNotConnectedException`: wait a minute and run the last command again.) Inside the
shell you are already connected as the admin user (`PGUSER`/`PGPASSWORD` come from the secret).
Start `psql` and run:

```sql
CREATE ROLE fintranzact_app LOGIN;
\password fintranzact_app
GRANT fintranzact_app TO CURRENT_USER;
ALTER DATABASE fintranzact OWNER TO fintranzact_app;
\c fintranzact
ALTER SCHEMA public OWNER TO fintranzact_app;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\q
```

`\password` asks twice for a new password and does not display it. **Use 24 or more letters and
digits only** (no `@ : / ? # %`), and keep it in your password manager. Type `exit`, then **stop the
task** (it also stops itself after 4 hours):

```bash
aws ecs stop-task --cluster "$CLUSTER" --task "$TASK" >/dev/null
```

Build the URL on your computer (the host comes from `terraform output database`) and store it:

```bash
HOST=$(terraform output -json database | jq -r .host)
read -rs APPPW        # type the app user's password
aws secretsmanager put-secret-value --secret-id fintranzact-prod/api/DATABASE_URL \
  --secret-string "postgresql://fintranzact_app:${APPPW}@${HOST}:5432/fintranzact?sslmode=require"
unset APPPW
```

`sslmode=require` is needed: the database refuses connections without TLS.

What the app user needs: it owns the `fintranzact` database (so migrations can create tables,
the `drizzle` schema and the `pg_trgm` extension). For the multi-database cloud mode
(`MULTI_TENANT=true`, not used now) it would also need `CREATEDB CREATEROLE`
(`ALTER ROLE fintranzact_app CREATEDB CREATEROLE;`) and a `CONTROL_DATABASE_URL` secret.
Keep `MULTI_TENANT=false`.

## 12. GitHub variables and the first deploy

In GitHub: *Settings, Environments, New environment* named **`production`** (add yourself as
*Required reviewer* if you want a manual approval before each deploy). Then
*Settings, Secrets and variables, Actions, Variables*. All of these are **variables, not secrets**
(none is secret). Print most of them with `terraform output github_actions_variables`.

| Variable | Value |
|---|---|
| `AWS_ROLE_ARN` | `github_deploy_role_arn` from step 7 |
| `AWS_REGION`, `AWS_ECR_REPOSITORY`, `AWS_ECS_CLUSTER`, `AWS_ECS_SERVICE`, `AWS_ECS_TASK_FAMILY`, `AWS_TASK_SUBNETS`, `AWS_TASK_SECURITY_GROUP`, `AWS_TASK_ASSIGN_PUBLIC_IP`, `AWS_LOG_GROUP`, `AWS_API_ARCH`, `AWS_API_URL`, `AWS_API_DESIRED_COUNT_FIRST` | from `terraform output github_actions_variables` |
| `AWS_WEB_BUCKET`, `AWS_WEB_DISTRIBUTION_ID`, `AWS_WEB_URL` | same output |
| `AWS_STORE_BUCKET`, `AWS_STORE_DISTRIBUTION_ID`, `AWS_STORE_URL` | same output |
| `VITE_TURNSTILE_SITE_KEY` | the public Turnstile site key (public by design) |
| `VITE_STORE_DOMAIN` | your store domain, for example `store.fintranzact.com` |

Then *Actions, Deploy AWS, Run workflow*: environment `production`, target `all`. It will:
build the image and push it to ECR, run the migrations as a one-off task and wait, start the API
(first deploy raises the task count from 0 to 1), build the web and store sites, upload them,
clear the CloudFront cache, and finish with smoke tests. The first run takes 15 to 25 minutes.

**Now edit `owner.tfvars`: delete the line `api_desired_count = 0`** (the profile says 1) and run
`terraform apply` again. If you forget, the next apply would scale the API back to zero.

**If it fails:** the log tells which step. Typical: `Missing GitHub variables` (fill them),
`AccessDenied` for AWS (the `production` environment name must exist and match
`github_environments` in bootstrap), migration failed (the log shows the error; the old version keeps running),
rollout failed (the API could not start: look at the log group named in the error; most often a
missing required secret).

## 13. Platform admin, webhooks and services that depend on the API address

1. Store `PLATFORM_ADMIN_PASSWORD` (secret) and set `platform_admin_email` and `platform_admin_name`
   (in `owner.tfvars`), add `PLATFORM_ADMIN_PASSWORD` to `enabled_optional_secrets`, apply, deploy.
   The admin account is created at the first start (the password is only used then; change it in the app).
2. **Razorpay** dashboard, *Webhooks*: set the URL
   `https://api.fintranzact.com/webhooks/razorpay` (shown by `terraform output razorpay_webhook_urls`)
   with the secret equal to your `RAZORPAY_WEBHOOK_SECRET`. A business's own webhook URL
   (`.../webhooks/razorpay/business/<id>.<token>`) is shown inside the app and uses the same host.
3. **Cloudflare Turnstile**: add `app.`, `store.` hostnames to the allowed hostnames of the site key.
4. **Resend**: verify your sending domain (DNS TXT/CNAME records at your DNS host), then store
   `RESEND_API_KEY`, set `EMAIL_FROM` in `api_extra_environment`.
5. **Sandbox.co.in**: store `SANDBOX_API_KEY` and `SANDBOX_API_SECRET` (start with the `key_test_` pair);
   if Sandbox has an IP allow-list, the API's outbound addresses are the task public IPs, which change on every deploy
   without NAT. If Sandbox demands a fixed address, turn on `enable_nat_gateway = true` (one fixed
   address, about 40 USD more).
6. **MSG91**: DLT template and sender ID as before; store `MSG91_AUTH_KEY`, set `SMS_PROVIDER`,
   `MSG91_TEMPLATE_ID` in `api_extra_environment`.

## 14. Smoke tests

```bash
curl -i https://api.fintranzact.com/health          # 200 {"status":"ok"}
curl -i "https://api.fintranzact.com/health?deep=true"   # also checks the database
curl -i https://app.fintranzact.com/                # 200, the web app
curl -i https://app.fintranzact.com/api/plans       # 200 JSON: web domain to API route works
curl -i https://store.fintranzact.com/some-shop/catalog.json   # 404 JSON "Store not found" is correct
```

Then in a browser: sign up a throwaway account, create a business, create an invoice and download
its PDF, open Upcoming, and (if you have a test shop) open
`https://store.fintranzact.com/<slug>` and place a Cash on Delivery order. After a Razorpay test payment, check
that the return page `https://store.fintranzact.com/<slug>/order/<id>` shows the order (this uses the
store order function; if it shows an empty page or JSON, tell the developer).

AI answers: ask the assistant a question; the answer should stream word by word. If it arrives all at once
or is cut after a minute, see OPERATIONS.md, "Streaming problems".

## 15. Final checks

- Confirm the alarm email subscription (step 8) and send a test: *CloudWatch, Alarms* shows 10 alarms.
- *Billing, Budgets*: three emails at 50, 80 and 100 percent are set; confirm the amounts.
- *Billing, Cost allocation tags*: activate `Project`, `Environment`, `CostCenter`.
- Tell the security checklist owner: [SECURITY-NOTES.md](SECURITY-NOTES.md).
- Take a manual database snapshot (*RDS, Snapshots, Take snapshot*) once the real data is in place.
- Calendar items: credits expiry (60 and 14 days before), quarterly backup restore test, monthly look at the bill.

When something breaks later: [OPERATIONS.md](OPERATIONS.md). To move the real data from Railway:
[MIGRATION-FROM-RAILWAY-VERCEL.md](MIGRATION-FROM-RAILWAY-VERCEL.md).
