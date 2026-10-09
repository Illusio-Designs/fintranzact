# Moving from Railway and Vercel to AWS

A cutover plan that keeps your customers' data safe and lets you go back. Read it fully once
before you start. Do the **rehearsal** (Part B) at least once; the real move (Part C) then
repeats the same commands with the real data.

Today's setup: the API runs on Railway (Postgres there too), the web app and the store run on
Vercel, `apps/web/vercel.json` forwards `/api/*` to Railway. After the move: everything is on AWS in Mumbai,
the Railway and Vercel projects stay untouched until you retire them.

**Golden rules**

1. **`ENCRYPTION_KEY` must be copied exactly** from Railway to Secrets Manager (same 64 characters). A different key
   makes every saved Razorpay and e-invoice credential unreadable. Same for `TRIAL_CLAIM_SALT`.
2. **Only one place may accept writes at any time.** After the final dump, Railway is stopped; otherwise changes would be
   split between two databases and one set would be lost.
3. Keep Railway and Vercel running (but not receiving traffic) for 7 to 14 days after the move so you can go back.

---

## Part A. Before anything (days before)

1. Finish SETUP.md steps 1 to 12, so AWS is up with an **empty** database and a working deploy.
   (Migrations ran, so the schema exists in the empty database.)
2. Collect from Railway (Variables tab) the values you must reuse and store them in Secrets Manager as in SETUP.md
   step 10, **never in chat**: `ENCRYPTION_KEY`, `TRIAL_CLAIM_SALT`, `RAZORPAY_*`, `SANDBOX_*`, `RESEND_API_KEY`,
   `TURNSTILE_SECRET_KEY`, `SHIPPING_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `MSG91_*`, and the plain ones
   (`EMAIL_FROM`, `CONTACT_INBOX`, `FINVERA_*`, `SMS_PROVIDER`...) into `api_extra_environment`. Do **not** copy
   `DATABASE_URL`, `API_URL`, `APP_URL`, `STORE_URL`, `CORS_ORIGINS` (AWS sets its own from your domains).
   Do not copy `PLATFORM_ADMIN_PASSWORD` if the admin already exists in the data.
3. Find your **Railway Postgres public connection URL**: Railway, the Postgres service, *Connect*, *Public Network* (a TCP proxy
   address). Keep it in your password manager as `RAILWAY_DB_URL`. The AWS admin task reaches it over the internet.
4. Lower DNS TTL: **a day before**, set the TTL of the records you will change (`app`, `store`, `api`, or whatever points to
   Vercel and Railway today) to 300 seconds, so the switch takes minutes.
5. Check what the mobile and desktop apps call. The mobile app defaults to `https://api.fintranzact.com` and the web app is
   `app.fintranzact.com`. If those names are what you use for `api_domain` and `web_domain`, then **flipping the DNS records moves every
   app at once**, with no new app release. If any build has the `*.up.railway.app` address baked in, it keeps talking to
   Railway: see "Old clients" below.
6. Announce a maintenance window to customers (suggested: Sunday 02:00 to 04:00 IST, 30 to 90 minutes in practice; the
   time depends on the database size).

## Part B. Rehearsal (copy of the data, no customer impact)

Goal: prove the restore works, time it, and compare numbers. Use a **separate database** so the real one is untouched.

1. Start the admin task (SETUP.md step 11 commands) with a bigger scratch disk if your dump is large: the default is 50 GiB; check the Railway
   size first (`SELECT pg_size_pretty(pg_database_size(current_database()));`). Dumps are smaller than the database. If more space is
   needed set `admin_ephemeral_storage_gib = 100` in `owner.tfvars` (maximum 200) and `terraform apply` before starting the task.
2. In the admin shell:

```bash
# 1. Dump from Railway straight onto the task's disk (custom format, compressed). No data passes through your laptop.
pg_dump "$RAILWAY_DB_URL" --format=custom --no-owner --no-privileges --file=/tmp/fintranzact.dump
ls -lh /tmp/fintranzact.dump
```

   `RAILWAY_DB_URL` is not in the task: paste it into the shell as a variable first
   (`read -rs RAILWAY_DB_URL; export RAILWAY_DB_URL`). The admin shell is logged only as a session record, not the typed
   secret input; still prefer a password-protected Railway user that you rotate afterwards.

```bash
# 2. Create a rehearsal database owned by the app user and restore into it
psql -d postgres -c "CREATE DATABASE fintranzact_rehearsal OWNER fintranzact_app;"
psql -d fintranzact_rehearsal -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
pg_restore --dbname=fintranzact_rehearsal --no-owner --no-privileges --role=fintranzact_app --jobs=2 /tmp/fintranzact.dump
```

   (`--role` needs `fintranzact_app` to be granted to you, which SETUP.md step 11 did with `GRANT fintranzact_app TO CURRENT_USER`.)
3. **Verify row counts** per table in both databases. Save this as `counts.sql` in the shell and run it against each:

```sql
-- counts.sql: exact row count of every table, as "schema.table|count"
SELECT format('%I.%I', table_schema, table_name) || '|' ||
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema') AND table_type = 'BASE TABLE'
ORDER BY 1;
```

```bash
psql "$RAILWAY_DB_URL" -At -f counts.sql > /tmp/counts-railway.txt
psql -d fintranzact_rehearsal -At -f counts.sql > /tmp/counts-aws.txt
diff /tmp/counts-railway.txt /tmp/counts-aws.txt && echo "ROW COUNTS MATCH"
```

   Any difference other than tables written during the dump itself is a stop sign.
4. **Run the repository's data audit** on the restored copy for a deeper check (rules for ledger, stock and payroll consistency):
   `pnpm --filter @fintranzact/api data:audit`. It needs a database connection from your laptop, and the database has no public access, so
   use a tunnel through the admin task (needs `enable-execute-command` and the Session Manager plugin; best effort, it is not
   part of the standard design):

```bash
RUNTIME=$(aws ecs describe-tasks --cluster fintranzact-prod --tasks "$TASK" --query 'tasks[0].containers[0].runtimeId' --output text)
aws ssm start-session --target "ecs:fintranzact-prod_${TASK##*/}_${RUNTIME}" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<rds address>"],"portNumber":["5432"],"localPortNumber":["15432"]}'
# in another terminal, from the repository:
DATABASE_URL="postgresql://fintranzact_app:<password>@localhost:15432/fintranzact_rehearsal?sslmode=require" \
  pnpm --filter @fintranzact/api data:audit
```

   Run the same audit against Railway and compare the reports. If the tunnel does not work in your setup, rely on the row-count comparison and a
   manual walk-through of the app in the rehearsal (below).
5. **Try the app on the copy** (optional but valuable): temporarily store a `DATABASE_URL` pointing at `fintranzact_rehearsal`, deploy, sign in
   with a real account on `https://app...`, open invoices, reports, PDFs. Then point `DATABASE_URL` back at `fintranzact` (this database stays empty).
   Do this before any customer is on AWS.
6. Note the timings (dump, restore) to size the real window. `DROP DATABASE fintranzact_rehearsal;` when finished.

## Part C. The cutover (maintenance window)

1. **Freeze writes.** On Railway, stop the API service (or scale it to 0). Customers see an error or your maintenance page. From here Railway
   accepts no writes. (A Vercel maintenance page is optional.)
2. In the admin shell, take the **final dump** (same command as Part B step 2.1, to a new file), keeping the Railway Postgres service running (read-only
   use).
3. **Prepare the real database.** The real database `fintranzact` has the schema from the first deploy but no data. Empty it, then restore:

```bash
psql -d fintranzact -c "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public AUTHORIZATION fintranzact_app;"
psql -d fintranzact -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
pg_restore --dbname=fintranzact --no-owner --no-privileges --role=fintranzact_app --jobs=2 /tmp/fintranzact-final.dump
```

   The dump carries the migration bookkeeping table, so the next deploy sees which migrations already ran.
4. **Verify**: run the row-count comparison (Part B step 3) with `fintranzact`; they must match exactly. Check `SELECT count(*)` of
   the businesses and users, and the newest invoice date.
5. **Deploy AWS** (target `all`): the migration step applies anything the dump lacked, the API starts on the restored data.
   Open `https://api.fintranzact.com/health?deep=true` once DNS is switched (next step), or test first by the
   load balancer address from `terraform output urls` (`api_alb`), using `curl -H "Host: api.fintranzact.com"`.
6. **Switch DNS** (records with TTL 300): `app`, `store` and `api` to the AWS targets from `terraform output dns_records_to_create`
   (CNAMEs) or, in Route 53, apply with the zone. If these names currently point at Vercel or Railway, replace those records.
   Watch with `dig app.fintranzact.com +short`.
7. **Update everything that holds the old address**:
   - Razorpay dashboard webhook: `https://api.fintranzact.com/webhooks/razorpay` (same secret).
     Each business that has its own Razorpay webhook uses the URL shown in the app; if the API host name did not change, nothing to
     do, otherwise ask those businesses to update the webhook.
   - Shipping carrier webhooks (`/webhooks/shipping/<businessId>`), biometric devices (`/api/attendance/push`) and any
     integration using the Railway URL.
   - Sandbox.co.in (IP allow-list, see SETUP step 13), Resend, MSG91 (no address change unless they have callbacks), Turnstile hostnames.
   - `VITE_SITE_URL` and the docs hosts: `docs.fintranzact.com` and `api-docs.fintranzact.com` currently redirect on Vercel (see
     `apps/web/vercel.json`). The AWS web distribution does not reproduce those host redirects; keep Vercel serving those two hosts for now,
     or ask the developer to add a CloudFront function.
8. **Smoke test** like SETUP step 14. Sign in with a real account, create and download an invoice PDF, check a payment-link
   webhook from Razorpay (send a test event from the dashboard), place a store order.
9. End the maintenance window. Watch the CloudWatch alarms and the API log for the first hours.

## Part D. Rollback plan (keep for 7 to 14 days)

- **Within the first hours, nothing new written on AWS you care about:** set the DNS records back to Vercel and Railway, start the Railway API service.
  Customers are back where they were. Cost: only the changes made on AWS since the cutover are lost.
- **Later:** AWS is the system of record. Going back to Railway then needs a reverse dump (`pg_dump` from RDS with the admin task, restore into Railway).
  Practise the first way only; treat later rollback as an emergency.
- Do not delete the Railway database or the Vercel projects for at least 14 days. When you retire them, take a **last dump** and keep it in a safe place
  for the retention period your accountant asks for, then remove the Vercel deploy hook workflow (`deploy-web.yml`) and the Railway service.
- Remove the old `deploy-web.yml` trigger (or the secret `VERCEL_DEPLOY_HOOK_URL`) only after retiring Vercel, otherwise pushes to `main` keep
  deploying to Vercel.

## Old clients

If an old mobile or desktop build points at `https://fintranzact-production.up.railway.app`, it keeps writing to Railway after the cutover, which is
now stopped (it will show errors, no data loss on AWS). Ship a new build with the AWS address and ask users to update. Do not restart Railway to
"help" them: that creates two diverging databases.

## Checklist

- [ ] Secrets copied (`ENCRYPTION_KEY` exact), never by chat
- [ ] TTL lowered a day ahead
- [ ] Rehearsal done, counts match, timings noted
- [ ] Maintenance window announced
- [ ] Railway API stopped, final dump taken
- [ ] Restore done, counts match
- [ ] Deploy AWS ran, `/health?deep=true` OK
- [ ] DNS switched
- [ ] Razorpay, carriers, devices, Turnstile updated
- [ ] Smoke test passed, alarms quiet
- [ ] Railway/Vercel kept idle 14 days, then retired with a last dump
