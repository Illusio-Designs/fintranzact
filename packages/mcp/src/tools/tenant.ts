/**
 * Tenant (organization) tools — manage the current tenant membership and team.
 *
 * Tools registered:
 *   tenant_list               — list all tenants the current user belongs to
 *   tenant_members            — list all members of the current tenant
 *   tenant_invite_member      — send an invitation to join the tenant
 *   tenant_remove_member      — remove a member from the tenant
 *   tenant_update_member_role — change a member's role
 *   tenant_access_log         — who was invited/accepted/changed/removed, CA openings and downloads
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FintranzactClient } from "../client.js";
import { wrapTool } from "../lib/errors.js";

// Mirrors the Team tab filters (packages/shared access-log.ts); the MCP server does not depend on the shared package.
const ACCESS_LOG_FILTERS: Record<string, string[] | null> = {
  all: null,
  invites: ["access.invited", "access.invite_revoked", "access.accepted", "access.partner_attributed"],
  roles: ["access.role_changed"],
  removals: ["access.removed", "access.left"],
  opened: ["access.org_opened"],
  downloads: ["access.export"],
};

const MEMBER_ROLES = ["admin", "seller_manager", "seller", "accountant", "auditor", "ca_filing"] as const;

export function registerTenantTools(server: McpServer, client: FintranzactClient) {

  server.tool(
    "tenant_list",
    [
      "List all organizations (tenants) that the current user is a member of.",
      "Each entry includes the tenant UUID, name, slug, plan, and the user's role.",
      "Use this to discover which organizations are available before switching context.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const result = await client.tenant.list();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_members",
    [
      "List all members of the current tenant/organization.",
      "Returns each member's user ID, name, email, role, and when they joined.",
      "Requires the caller to be a member of the current tenant.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const result = await client.tenant.members();
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_invite_member",
    [
      "Invite a user to join the current tenant by email address.",
      "Requires admin or owner role in the current tenant. Inviting a CA ('auditor' or 'ca_filing') requires the owner: admins are refused.",
      "The invitation link is valid for 7 days; the invitee is also emailed (accountant roles get an accountant-specific email). The raw token is returned exactly once.",
      "CA roles are for the business's accountant: at most 3 per organisation, not counted towards the plan's team-member limit, removable at any time, and their activity is logged.",
      "Available roles: 'admin' (full access), 'seller_manager' (manage sales team), 'seller' (create invoices), 'accountant' (bookkeeping: payments, expenses, bank), 'auditor' (accountant, read-only: views everything and downloads reports), 'ca_filing' (accountant, filing: as auditor plus prepares and files GST returns).",
    ].join(" "),
    {
      email: z.string().email()
        .describe("Email address of the person to invite."),
      role: z.enum(MEMBER_ROLES).default("seller")
        .describe("Role to assign: 'admin', 'seller_manager', 'seller', 'accountant', 'auditor', or 'ca_filing'."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.inviteMember(input.email, input.role);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            email: input.email,
            role: input.role,
            expiresAt: result.expiresAt,
            note: "Invitation sent. Deliver the invitation link to the recipient through a secure channel (not this conversation).",
          }, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_remove_member",
    [
      "Remove a member from the current tenant. Requires admin or owner role.",
      "Cannot remove yourself or a superadmin/owner.",
      "The removed user loses access to all businesses within this tenant immediately.",
    ].join(" "),
    {
      user_id: z.string().uuid()
        .describe("UUID of the user to remove from the tenant. Use tenant_members to find user UUIDs."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.removeMember(input.user_id);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_update_member_role",
    [
      "Change the role of an existing tenant member. Requires admin or owner role; moving someone to or from a CA role ('auditor', 'ca_filing') requires the owner.",
      "Cannot change the role of a superadmin or owner.",
      "Available roles: 'admin' (full access), 'seller_manager', 'seller', 'accountant' (bookkeeping), 'auditor' (read-only), 'ca_filing' (read-only plus GST filing).",
    ].join(" "),
    {
      user_id: z.string().uuid()
        .describe("UUID of the member whose role you want to change."),
      role: z.enum(MEMBER_ROLES)
        .describe("New role: 'admin', 'seller_manager', 'seller', 'accountant', 'auditor', or 'ca_filing'."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.updateMemberRole(input.user_id, input.role);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_pending_invitations",
    [
      "List pending (unaccepted) invitations for the current tenant.",
      "Shows email, role, inviter name, and expiry date.",
      "Only owners and admins can view pending invitations.",
    ].join(" "),
    {},
    wrapTool(async (_input) => {
      const invitations = await client.tenant.pendingInvitations();
      return {
        content: [{
          type: "text" as const,
          text: invitations.length === 0
            ? "No pending invitations."
            : JSON.stringify(invitations, null, 2),
        }],
      };
    })
  );

  server.tool(
    "list_clients",
    [
      "The organisations you belong to: your own firm and the clients you have accountant access to,",
      "pinned first, then most recently opened. Search by name; scope is all, mine (own firm) or clients.",
      "Pass the returned next_cursor for the next page.",
    ].join(" "),
    {
      search: z.string().max(100).optional().describe("Part of the organisation's name."),
      scope: z.enum(["all", "mine", "clients"]).optional().describe("Default all."),
      limit: z.number().int().min(1).max(100).optional().describe("How many (default 30)."),
      cursor: z.string().optional().describe("next_cursor from the previous page."),
    },
    wrapTool(async (input) => {
      const result = await client.tenant.listClients(input);
      return {
        content: [{
          type: "text" as const,
          text: result.items.length === 0
            ? "No organisations found."
            : JSON.stringify({
                total: result.total,
                organisations: result.items.map((o) => ({
                  id: o.tenantId, name: o.name, role: o.roleLabel, own_firm: o.isOwnFirm, pinned: o.pinned, last_opened: o.lastOpenedAt,
                })),
                next_cursor: result.nextCursor,
              }, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_access_log",
    [
      "The organisation's access log, newest first: who was invited, who accepted, role changes, removals,",
      "when an accountant (CA) opened the books and which reports they downloaded.",
      "Only owners and admins can view it. What a CA changed or filed is in the audit trail (business_audit_trail).",
      "Pass the returned next_cursor to get older events.",
    ].join(" "),
    {
      filter: z.enum(["all", "invites", "roles", "removals", "opened", "downloads"]).optional()
        .describe("Which kind of events (default all)."),
      limit: z.number().int().min(1).max(100).optional().describe("How many events (default 25)."),
      cursor: z.string().optional().describe("next_cursor from the previous page."),
    },
    wrapTool(async (input) => {
      const types = input.filter ? ACCESS_LOG_FILTERS[input.filter] : null;
      const result = await client.tenant.accessLog({
        limit: input.limit,
        cursor: input.cursor,
        ...(types ? { type: types } : {}),
      });
      const items = result.items;
      return {
        content: [{
          type: "text" as const,
          text: items.length === 0
            ? "No access events."
            : JSON.stringify({
                events: items.map((e) => ({ at: e.createdAt, type: e.type, label: e.label, actor: e.actor, subject: e.subject, details: e.metadata })),
                next_cursor: result.nextCursor,
              }, null, 2),
        }],
      };
    })
  );

  server.tool(
    "tenant_revoke_invitation",
    [
      "Revoke a pending invitation by its ID.",
      "Only owners and admins can revoke invitations.",
      "Use tenant_pending_invitations to find invitation IDs.",
    ].join(" "),
    {
      invitation_id: z.string().uuid()
        .describe("The UUID of the invitation to revoke. Use tenant_pending_invitations to find IDs."),
    },
    wrapTool(async (input) => {
      await client.tenant.revokeInvitation(input.invitation_id);
      return {
        content: [{
          type: "text" as const,
          text: "Invitation revoked successfully.",
        }],
      };
    })
  );
}
