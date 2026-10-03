import { Command } from "commander";
import { ROLE_HELP } from "../../commands/tenant/roles.js";

export function registerTenantCommands(program: Command): void {
  // ── tenant ────────────────────────────────────────────────────────────────

  const tenant = program.command("tenant").description("Tenant / workspace management");

  tenant
    .command("list")
    .description("List tenants / organizations you belong to")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { tenantListCommand } = await import("../../commands/tenant/list.js");
      await tenantListCommand({ json: opts.json });
    });

  tenant
    .command("members")
    .description("List members of the current tenant")
    .option("--json", "JSON output")
    .option("--format <format>", "Output format: table, tsv, csv")
    .action(async (opts) => {
      const { tenantMembersCommand } = await import("../../commands/tenant/members.js");
      await tenantMembersCommand({ json: opts.json, format: opts.format });
    });

  tenant
    .command("invite <email>")
    .description("Invite a user to the tenant (to invite your CA use --role auditor or ca_filing; owner only)")
    .option("--role <role>", "Role: admin, seller_manager, seller, accountant, auditor, ca_filing (default: seller)")
    .option("--json", "JSON output")
    .addHelpText("after", `\n${ROLE_HELP}\n`)
    .action(async (email, opts) => {
      const { tenantInviteCommand } = await import("../../commands/tenant/invite.js");
      await tenantInviteCommand(email, { role: opts.role, json: opts.json });
    });

  tenant
    .command("remove <userId>")
    .description("Remove a member from the tenant")
    .option("-y, --yes", "Skip confirmation")
    .option("--json", "JSON output")
    .action(async (userId, opts) => {
      const { tenantRemoveCommand } = await import("../../commands/tenant/remove.js");
      await tenantRemoveCommand(userId, { yes: opts.yes, json: opts.json });
    });

  tenant
    .command("update-role <userId> <role>")
    .description("Update a member's role (admin, seller_manager, seller, accountant, auditor, ca_filing)")
    .option("--json", "JSON output")
    .addHelpText("after", `\n${ROLE_HELP}\n`)
    .action(async (userId, role, opts) => {
      const { tenantUpdateRoleCommand } = await import("../../commands/tenant/update-role.js");
      await tenantUpdateRoleCommand(userId, role, { json: opts.json });
    });

  tenant
    .command("invitations")
    .description("List pending invitations")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { listInvitationsCommand } = await import("../../commands/tenant/invitations.js");
      await listInvitationsCommand(opts);
    });

  tenant
    .command("clients")
    .description("Your organisations (own firm and clients), pinned and recent first")
    .option("--search <text>", "Only organisations whose name contains this")
    .option("--scope <scope>", "all, mine (own firm) or clients")
    .option("--limit <n>", "How many (max 100, default 30)")
    .option("--cursor <cursor>", "Continue from a previous page")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { clientsCommand } = await import("../../commands/tenant/clients.js");
      await clientsCommand(opts);
    });

  tenant
    .command("access-log")
    .description("Who was invited, accepted, changed, removed, opened the books or downloaded a file (owners and admins)")
    .option("--filter <name>", "all, invites, roles, removals, opened or downloads")
    .option("--limit <n>", "How many events (max 100, default 25)")
    .option("--cursor <cursor>", "Continue from a previous page")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const { accessLogCommand } = await import("../../commands/tenant/access-log.js");
      await accessLogCommand(opts);
    });

  tenant
    .command("revoke-invitation <invitationId>")
    .description("Revoke a pending invitation")
    .option("--json", "JSON output")
    .action(async (invitationId, opts) => {
      const { revokeInvitationCommand } = await import("../../commands/tenant/revoke-invitation.js");
      await revokeInvitationCommand(invitationId, opts);
    });
}
