import { describe, it, expect, vi } from "vitest";
import { registerTenantTools } from "../tools/tenant.js";

function capture() {
  const tools = new Map<string, { description: string; schema: any; handler: (i: any) => Promise<any> }>();
  const server = { tool: (name: string, description: string, schema: any, handler: any) => tools.set(name, { description, schema, handler }) };
  const inviteMember = vi.fn().mockResolvedValue({ token: "t", inviteUrl: "https://x/invite/t", role: "auditor", expiresAt: "2026-10-09" });
  registerTenantTools(server as any, { tenant: { inviteMember } } as any);
  return { tools, inviteMember };
}

describe("tenant_invite_member", () => {
  it("accepts the CA roles and explains them", () => {
    const { tools } = capture();
    const t = tools.get("tenant_invite_member")!;
    expect(t.schema.role.safeParse("auditor").success).toBe(true);
    expect(t.schema.role.safeParse("ca_filing").success).toBe(true);
    expect(t.schema.role.safeParse("owner").success).toBe(false);
    for (const needle of ["requires the owner", "at most 3", "team-member limit", "logged", "auditor", "ca_filing"]) {
      expect(t.description).toContain(needle);
    }
  });

  it("passes the CA role to the API", async () => {
    const { tools, inviteMember } = capture();
    await tools.get("tenant_invite_member")!.handler({ email: "ca@firm.in", role: "ca_filing" });
    expect(inviteMember).toHaveBeenCalledWith("ca@firm.in", "ca_filing");
  });
});
