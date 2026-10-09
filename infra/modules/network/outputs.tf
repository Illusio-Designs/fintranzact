output "vpc_id" {
  description = "VPC id."
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR."
  value       = aws_vpc.this.cidr_block
}

output "public_subnet_ids" {
  description = "Public subnets (load balancer)."
  value       = aws_subnet.public[*].id
}

output "app_subnet_ids" {
  description = "Subnets the Fargate tasks run in: private app subnets with NAT, otherwise the public subnets."
  value       = var.enable_nat_gateway ? aws_subnet.app[*].id : aws_subnet.public[*].id
}

output "assign_public_ip" {
  description = "Whether tasks need a public IP (true when there is no NAT gateway)."
  value       = !var.enable_nat_gateway
}

output "database_subnet_ids" {
  description = "Isolated subnets for the database."
  value       = aws_subnet.database[*].id
}
