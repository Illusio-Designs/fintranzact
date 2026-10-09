output "backend_config" {
  description = "Paste into infra/stacks/prod/backend.hcl."
  value       = <<-EOT
    bucket         = "${aws_s3_bucket.state.id}"
    key            = "prod/terraform.tfstate"
    region         = "${var.region}"
    dynamodb_table = "${aws_dynamodb_table.lock.name}"
    encrypt        = true
  EOT
}

output "state_bucket" {
  description = "State bucket."
  value       = aws_s3_bucket.state.id
}

output "lock_table" {
  description = "State lock table."
  value       = aws_dynamodb_table.lock.name
}

output "github_deploy_role_arn" {
  description = "Set as repository variable AWS_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}

output "github_plan_role_arn" {
  description = "Set as repository variable AWS_PLAN_ROLE_ARN (only if enable_plan_role is true)."
  value       = var.enable_plan_role ? aws_iam_role.plan[0].arn : ""
}
