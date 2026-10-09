output "alerts_topic_arn" {
  description = "SNS topic that receives alarms."
  value       = aws_sns_topic.alerts.arn
}

output "audit_log_bucket" {
  description = "S3 bucket holding CloudTrail (and Config) logs."
  value       = aws_s3_bucket.logs.id
}

output "kms_key_arn" {
  description = "KMS key of the audit logs and alert topic."
  value       = aws_kms_key.security.arn
}
