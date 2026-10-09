output "instance_id" {
  description = "RDS instance identifier."
  value       = aws_db_instance.this.identifier
}

output "instance_arn" {
  description = "RDS instance ARN (for AWS Backup)."
  value       = aws_db_instance.this.arn
}

output "address" {
  description = "Database host name."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "Database port."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Name of the first database."
  value       = var.db_name
}

output "master_username" {
  description = "Master user name."
  value       = var.master_username
}

output "security_group_id" {
  description = "Security group of the database."
  value       = aws_security_group.db.id
}

output "master_secret_arn" {
  description = "Secrets Manager secret holding the RDS-managed master password (JSON with username and password)."
  value       = aws_db_instance.this.master_user_secret[0].secret_arn
}

output "kms_key_arn" {
  description = "KMS key that encrypts the database and its master secret."
  value       = aws_kms_key.rds.arn
}
