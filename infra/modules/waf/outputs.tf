output "arn" {
  description = "Web ACL ARN."
  value       = aws_wafv2_web_acl.this.arn
}
