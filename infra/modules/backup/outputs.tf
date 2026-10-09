output "vault_name" {
  description = "Local backup vault."
  value       = aws_backup_vault.this.name
}

output "dr_vault_name" {
  description = "Second-region vault (empty when cross-region copy is off)."
  value       = var.enable_cross_region_copy ? aws_backup_vault.dr[0].name : ""
}

output "plan_id" {
  description = "Backup plan id."
  value       = aws_backup_plan.this.id
}
