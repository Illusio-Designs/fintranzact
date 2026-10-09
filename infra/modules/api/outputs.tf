output "ecr_repository_url" {
  description = "Registry address to push the API image to."
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_repository_name" {
  description = "Registry name."
  value       = aws_ecr_repository.api.name
}

output "ecr_repository_arn" {
  description = "Registry ARN."
  value       = aws_ecr_repository.api.arn
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name of the API."
  value       = aws_ecs_service.api.name
}

output "task_family" {
  description = "Task definition family of the API (the deploy workflow starts from its latest revision)."
  value       = aws_ecs_task_definition.api.family
}

output "admin_task_family" {
  description = "Task definition family of the on-demand admin task."
  value       = aws_ecs_task_definition.admin.family
}

output "task_security_group_id" {
  description = "Security group of the API tasks (also used for the one-off migration task)."
  value       = aws_security_group.tasks.id
}

output "admin_security_group_id" {
  description = "Security group of the admin task."
  value       = aws_security_group.admin.id
}

output "alb_arn" {
  description = "Load balancer ARN."
  value       = aws_lb.api.arn
}

output "alb_arn_suffix" {
  description = "Load balancer ARN suffix (CloudWatch dimension)."
  value       = aws_lb.api.arn_suffix
}

output "alb_dns_name" {
  description = "Load balancer DNS name."
  value       = aws_lb.api.dns_name
}

output "alb_zone_id" {
  description = "Hosted zone id of the load balancer (for alias records)."
  value       = aws_lb.api.zone_id
}

output "target_group_arn_suffix" {
  description = "Target group ARN suffix (CloudWatch dimension)."
  value       = aws_lb_target_group.api.arn_suffix
}

output "secret_names" {
  description = "Secrets Manager names to fill in. required are needed on day one."
  value = {
    required = [for s in local.required_secret_names : aws_secretsmanager_secret.api[s].name]
    optional = [for s in local.optional_secret_names : aws_secretsmanager_secret.api[s].name]
  }
}

output "secret_arns" {
  description = "ARN of every secret container, by environment variable name."
  value       = { for k, v in aws_secretsmanager_secret.api : k => v.arn }
}

output "log_group_name" {
  description = "CloudWatch log group of the API."
  value       = aws_cloudwatch_log_group.api.name
}

output "execution_role_arn" {
  description = "Task execution role ARN."
  value       = aws_iam_role.execution.arn
}

output "task_role_arn" {
  description = "Task role ARN."
  value       = aws_iam_role.task.arn
}
