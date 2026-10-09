variable "project" {
  description = "Project prefix; must match the project variable of infra/stacks/prod."
  type        = string
  default     = "fintranzact"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}$", var.project))
    error_message = "project must be 2-19 lower-case letters, digits or dashes, starting with a letter."
  }
}

variable "region" {
  description = "AWS region for state and roles."
  type        = string
  default     = "ap-south-1"
}

variable "cost_center" {
  description = "Value of the CostCenter tag."
  type        = string
  default     = "engineering"
}

variable "environments" {
  description = "Environments the deploy role may deploy to (the environment variable of infra/stacks/prod). Add staging later."
  type        = list(string)
  default     = ["prod"]

  validation {
    condition     = length(var.environments) > 0 && alltrue([for e in var.environments : contains(["prod", "staging"], e)])
    error_message = "environments may contain only prod and staging."
  }
}

variable "state_bucket_name" {
  description = "Name of the state bucket. Empty uses <project>-tfstate-<account id>."
  type        = string
  default     = ""
}

variable "github_repository" {
  description = "GitHub repository allowed to assume the roles, in owner/name form."
  type        = string
  default     = "illusio-designs/fintranzact"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must look like owner/name."
  }
}

variable "github_branch" {
  description = "Branch allowed to deploy."
  type        = string
  default     = "main"
}

variable "github_environments" {
  description = "GitHub Environment names (Settings, Environments) allowed to deploy. Use them to require a manual approval."
  type        = list(string)
  default     = ["production"]
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC identity provider. Set false if the account already has one (an account can have only one) and give its ARN below."
  type        = bool
  default     = true
}

variable "existing_github_oidc_provider_arn" {
  description = "ARN of an existing GitHub OIDC provider when create_github_oidc_provider is false."
  type        = string
  default     = ""
}

variable "enable_plan_role" {
  description = "Create a read-only role so GitHub Actions can run terraform plan on pull requests. Off by default: it can read your whole AWS configuration."
  type        = bool
  default     = false
}
