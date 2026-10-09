terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
}


locals {
  # AWS managed CloudFront policies (ids are fixed and documented by AWS).
  managed_caching_disabled              = "4135ea2d-6df8-45a2-b2e5-4ed3d7b7b8d5"
  managed_all_viewer_except_host_header = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  has_api_origin                        = var.api_origin_domain != ""
  has_aliases                           = var.enable_custom_domain && length(var.aliases) > 0
  use_store_functions                   = var.enable_store_functions
}

# ── Private bucket (public content, but reachable only through CloudFront) ──
resource "aws_s3_bucket" "site" {
  bucket        = var.bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Enabled" # lets you roll back a bad deploy by restoring the previous object versions
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # the bucket holds only public website files
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "site" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.this.arn]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.site.arn, "${aws_s3_bucket.site.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket     = aws_s3_bucket.site.id
  policy     = data.aws_iam_policy_document.site.json
  depends_on = [aws_s3_bucket_public_access_block.site]
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = var.name
  description                       = "Signed access from CloudFront to ${var.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── Cache policy for static files: obey the Cache-Control set at upload ──
resource "aws_cloudfront_cache_policy" "static" {
  name        = "${var.name}-static"
  comment     = "Static site: honour origin Cache-Control (hashed assets immutable, index.html no-cache)"
  min_ttl     = 0
  default_ttl = 3600
  max_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

# ── Security headers added by CloudFront to every static response ──
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.name}-security-headers"
  comment = "HSTS, nosniff, frame protection, referrer policy, permissions policy (CSP optional)"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = var.hsts_max_age_seconds
      include_subdomains         = var.hsts_include_subdomains
      preload                    = var.hsts_preload
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    dynamic "content_security_policy" {
      for_each = var.content_security_policy != "" && !var.content_security_policy_report_only ? [1] : []
      content {
        content_security_policy = var.content_security_policy
        override                = true
      }
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = var.permissions_policy
      override = true
    }

    dynamic "items" {
      for_each = var.content_security_policy != "" && var.content_security_policy_report_only ? [1] : []
      content {
        header   = "Content-Security-Policy-Report-Only"
        value    = var.content_security_policy
        override = true
      }
    }
  }
}

# ── CloudFront Functions ──
resource "aws_cloudfront_function" "spa" {
  name    = "${var.name}-spa-fallback"
  runtime = "cloudfront-js-2.0"
  comment = "Serve /index.html for single-page-app routes (paths without a file extension)"
  publish = true
  code    = file("${path.module}/functions/spa.js")
}

resource "aws_cloudfront_function" "store_prefix" {
  count   = local.use_store_functions ? 1 : 0
  name    = "${var.name}-store-prefix"
  runtime = "cloudfront-js-2.0"
  comment = "Store API: /<slug>/catalog.json -> /store/<slug>/catalog.json"
  publish = true
  code    = file("${path.module}/functions/store_prefix.js")
}

resource "aws_cloudfront_function" "store_order" {
  count   = local.use_store_functions ? 1 : 0
  name    = "${var.name}-store-order"
  runtime = "cloudfront-js-2.0"
  comment = "Store order page: HTML navigation is served from S3, JSON/POST goes to the API under /store"
  publish = true
  code    = file("${path.module}/functions/store_order.js")
}

# ── The distribution ──
resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = var.name
  default_root_object = "index.html"
  price_class         = var.price_class
  aliases             = local.has_aliases ? var.aliases : []
  web_acl_id          = var.web_acl_arn == "" ? null : var.web_acl_arn

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  dynamic "origin" {
    for_each = local.has_api_origin ? { alb = var.api_origin_read_timeout, "alb-sse" = var.sse_origin_read_timeout } : {}
    content {
      origin_id   = origin.key
      domain_name = var.api_origin_domain

      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = var.api_origin_protocol
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = origin.value
        origin_keepalive_timeout = 60
      }
    }
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = aws_cloudfront_cache_policy.static.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  # API-bound paths, in order (first match wins): the streaming path first.
  dynamic "ordered_cache_behavior" {
    for_each = local.has_api_origin ? var.alb_behaviors : []
    content {
      path_pattern             = ordered_cache_behavior.value.path_pattern
      target_origin_id         = ordered_cache_behavior.value.origin == "sse" ? "alb-sse" : "alb"
      viewer_protocol_policy   = "redirect-to-https"
      allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods           = ["GET", "HEAD"]
      compress                 = false # never compress or buffer API and streaming responses at the edge
      cache_policy_id          = local.managed_caching_disabled
      origin_request_policy_id = local.managed_all_viewer_except_host_header

      dynamic "function_association" {
        for_each = compact([
          ordered_cache_behavior.value.function == "store_prefix" ? try(aws_cloudfront_function.store_prefix[0].arn, "") : "",
          ordered_cache_behavior.value.function == "store_order" ? try(aws_cloudfront_function.store_order[0].arn, "") : "",
        ])
        content {
          event_type   = "viewer-request"
          function_arn = function_association.value
        }
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = local.has_aliases ? null : true
    acm_certificate_arn            = local.has_aliases ? var.certificate_arn : null
    ssl_support_method             = local.has_aliases ? "sni-only" : null
    minimum_protocol_version       = local.has_aliases ? "TLSv1.2_2021" : null
  }
}
