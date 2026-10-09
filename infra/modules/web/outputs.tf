output "bucket_name" {
  description = "S3 bucket the site files are synced to."
  value       = aws_s3_bucket.site.id
}

output "bucket_arn" {
  description = "S3 bucket ARN."
  value       = aws_s3_bucket.site.arn
}

output "distribution_id" {
  description = "CloudFront distribution id (for invalidations)."
  value       = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  description = "CloudFront distribution ARN."
  value       = aws_cloudfront_distribution.this.arn
}

output "domain_name" {
  description = "The *.cloudfront.net name of the distribution."
  value       = aws_cloudfront_distribution.this.domain_name
}

output "hosted_zone_id" {
  description = "Route 53 zone id to use in alias records pointing at CloudFront."
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}
