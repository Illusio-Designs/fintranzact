# infra/

Terraform (also works with OpenTofu) for hosting Fintranzact on AWS Mumbai. Start with
[`docs/infra/README.md`](../docs/infra/README.md) (architecture) and
[`docs/infra/SETUP.md`](../docs/infra/SETUP.md) (first-time setup).

```
bootstrap/        run once: state bucket, lock table, GitHub OIDC sign-in, deploy role
stacks/prod/      the environment (use environment = "staging" for a second copy)
modules/          network, database, api (ECS), web (S3 + CloudFront), dns, dns_records,
                  waf, security, backup
profiles/         lean.tfvars and launch.tfvars: pick one with -var-file
```

Check without any AWS account:

```bash
terraform fmt -check -recursive
cd stacks/prod && terraform init -backend=false && terraform validate && terraform test
```

Never commit `*.tfvars` other than `profiles/*.tfvars`, `backend.hcl`, or state files; the repository
`.gitignore` blocks them. Secret values never go into Terraform.
