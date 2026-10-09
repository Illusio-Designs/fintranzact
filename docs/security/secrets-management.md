# Secrets management

Owner: [security owner]. Last reviewed: 2026-10-09. Next review: 2027-04-09.

**STATUS.** Secrets live in environment variables on the host (Railway, Vercel) and in GitHub Actions secrets. Secret scanning of every pull request and of full history weekly is configured ([vulnerability-management.md](vulnerability-management.md)). Encryption-key rotation is built ([key-rotation.md](key-rotation.md)). **Not done:** a secrets manager, a recorded rotation history, and the rotation of any secret other than the encryption key is manual.

## Inventory

| Secret | Where it is set | What it protects | Rotation |
|---|---|---|---|
| `ENCRYPTION_KEY` (and `ENCRYPTION_KEYS_PREVIOUS`) | API host | Stored credentials, 2FA secrets, share tokens, tenant DB passwords | Yearly, or at once after a leak: tool + runbook in key-rotation.md |
| `DATABASE_URL`, `CONTROL_DATABASE_URL`, tenant DB passwords | API host; tenant ones encrypted in `tenants.db_password` | The databases | Yearly; change the password in Postgres, then the variable, then redeploy |
| `PLATFORM_ADMIN_PASSWORD` / `PLATFORM_ADMIN_EMAILS` | API host | Platform admin access | Change the password in the app after first start; review the list quarterly |
| `RAZORPAY_KEY_ID/SECRET`, `RAZORPAY_WEBHOOK_SECRET` (Fintranzact's own account) | API host | Subscription billing | Yearly, and when someone with access leaves; regenerate in the Razorpay dashboard |
| Businesses' own Razorpay keys | Encrypted in the database | Their payments | The business rotates them; we re-encrypt only with the encryption key |
| `SANDBOX_API_KEY`, `SANDBOX_API_SECRET` | API host | Government API gateway and wallet spending | Yearly; immediately on a leak (the wallet can be drained) |
| `ANTHROPIC_API_KEY` | API host | AI assistant spend | Yearly; set a spend limit in the console |
| `RESEND_API_KEY`, `MSG91_AUTH_KEY` | API host | Sending email/SMS as us | Yearly |
| `BACKUP_ENCRYPTION_KEY`, `R2_*` / AWS keys | Backup service | Backups | Yearly; keep old key for old backups ([backup-and-recovery.md](backup-and-recovery.md)) |
| `TRIAL_CLAIM_SALT` | API host | Trial abuse hashing | **Never rotate** (see key-rotation.md) |
| `TURNSTILE_SECRET_KEY` | API host | Bot protection | When leaked |
| GitHub tokens, Vercel/Railway tokens, deploy keys | GitHub secrets, consoles | Deploys | Yearly; remove unused |
| Personal passwords, MFA recovery codes | Password manager | Staff accounts | On compromise |

## Rules

1. Never in git, chat, tickets, screenshots or logs. The secret scanner is a safety net, not permission. A leaked secret is rotated first, then removed.
2. One secret per purpose and per environment; test environments use test keys (`rzp_test_`, `key_test_`).
3. Access by named people only; the list is reviewed quarterly and when someone leaves ([access-control-and-offboarding.md](access-control-and-offboarding.md)).
4. Keys are generated with a CSPRNG (`openssl rand -hex 32`), never typed.
5. Rotation dates and results are recorded on the calendar sheet ([calendar.md](calendar.md)).
6. `.env` and `.env.prod` are git-ignored; `.env.example` and `.env.prod.example` hold names and empty values only.

## Move to a secrets manager (on AWS)

Planned with the move to AWS. Suggested design: AWS Secrets Manager (or SSM Parameter Store SecureString, cheaper) in ap-south-1, one secret per name above, encrypted with a customer-managed KMS key; the API's task/instance role may read only its own secrets; values injected as environment variables at start (so the application code does not change); CloudTrail records every read; rotation Lambda for the database password; `ENCRYPTION_KEYS_PREVIOUS` kept as a versioned secret. Until then, restrict who can open the Railway variables screen to the two people who deploy.

Steps: create the KMS key and secrets, grant the role, change the deploy to inject them, remove the old plain variables, rotate every secret once as part of the cutover (because the old store saw them).
