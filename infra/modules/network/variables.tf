variable "name" {
  description = "Name prefix for every resource, for example fintranzact-prod."
  type        = string
}

variable "vpc_cidr" {
  description = "IPv4 range of the VPC. Must be a /16 to /20 private range."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0)) && tonumber(split("/", var.vpc_cidr)[1]) >= 16 && tonumber(split("/", var.vpc_cidr)[1]) <= 20
    error_message = "vpc_cidr must be a valid CIDR with a prefix length between /16 and /20."
  }
}

variable "enable_nat_gateway" {
  description = "Create a NAT gateway (about 35 USD a month) and run tasks in private subnets without public IPs. Off by default to save money."
  type        = bool
  default     = false
}

variable "enable_interface_endpoints" {
  description = "Create interface VPC endpoints (ECR, logs, Secrets Manager). Costs about 7 USD per endpoint per AZ per month. Off by default."
  type        = bool
  default     = false
}

variable "interface_endpoint_services" {
  description = "Services to create interface endpoints for when enabled."
  type        = list(string)
  default     = ["ecr.api", "ecr.dkr", "logs", "secretsmanager"]
}

variable "enable_flow_logs" {
  description = "Write VPC flow logs to CloudWatch (network audit trail)."
  type        = bool
  default     = true
}

variable "flow_log_traffic_type" {
  description = "ACCEPT, REJECT or ALL. REJECT is cheapest; ALL is the fullest audit trail."
  type        = string
  default     = "ALL"

  validation {
    condition     = contains(["ACCEPT", "REJECT", "ALL"], var.flow_log_traffic_type)
    error_message = "flow_log_traffic_type must be ACCEPT, REJECT or ALL."
  }
}

variable "flow_log_retention_days" {
  description = "Days to keep flow logs. CERT-In asks for 180 days."
  type        = number
  default     = 180

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.flow_log_retention_days)
    error_message = "flow_log_retention_days must be a value CloudWatch Logs accepts (for example 90, 180, 365)."
  }
}

variable "log_kms_key_arn" {
  description = "Optional KMS key to encrypt the flow log group. Empty uses the default CloudWatch encryption."
  type        = string
  default     = ""
}
