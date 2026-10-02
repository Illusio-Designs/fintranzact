import { describe, it, expect } from "vitest";
import { CA_ROLE_DESCRIPTIONS } from "@fintranzact/shared";
import { buildInvitationEmail } from "../lib/email.js";

const base = { inviteUrl: "https://app.fintranzact.com/invite/tok123", businessName: "Sharma Traders", inviterName: "Rohit Sharma" };

describe("buildInvitationEmail", () => {
  it("keeps the standard team invitation for normal roles", () => {
    for (const role of [undefined, "seller", "admin", "accountant"]) {
      const m = buildInvitationEmail({ ...base, role });
      expect(m.subject).toBe("You've been invited to join Sharma Traders on Fintranzact");
      expect(m.text).toContain("Rohit Sharma invited you to join Sharma Traders");
      expect(m.text).toContain(base.inviteUrl);
      expect(m.html).toContain("You've been invited to join a team");
      expect(m.html).not.toContain("their accountant");
    }
  });

  it("uses accountant wording, the access level, removal and logging notes for the read-only CA", () => {
    const m = buildInvitationEmail({ ...base, role: "auditor" });
    expect(m.subject).toBe("Rohit Sharma has invited you as their accountant on Fintranzact");
    for (const body of [m.text, m.html]) {
      expect(body).toContain("Accountant (read-only)");
      expect(body).toContain(CA_ROLE_DESCRIPTIONS.auditor);
      expect(body).toContain("remove your access at any time");
      expect(body).toContain("activity in their books is logged");
      expect(body).toContain(base.inviteUrl);
    }
    expect(m.html).toContain("Sharma Traders");
  });

  it("describes the filing CA", () => {
    const m = buildInvitationEmail({ ...base, role: "ca_filing" });
    expect(m.subject).toContain("has invited you as their accountant");
    expect(m.text).toContain("Accountant (filing)");
    expect(m.text).toContain(CA_ROLE_DESCRIPTIONS.ca_filing);
    expect(m.html).toContain("Accountant (filing)");
  });

  it("falls back to 'Someone' when the inviter has no name", () => {
    expect(buildInvitationEmail({ ...base, inviterName: null, role: "auditor" }).subject).toBe("Someone has invited you as their accountant on Fintranzact");
  });

  it("escapes HTML in names and the link, for CA and normal invites", () => {
    const evil = { inviteUrl: 'https://x.test/i/"><script>1</script>', businessName: '<img src=x onerror=alert(1)>', inviterName: "<b>Eve</b> & Co" };
    for (const role of ["auditor", "ca_filing", "seller"]) {
      const { html } = buildInvitationEmail({ ...evil, role });
      expect(html, role).not.toContain("<script>1</script>");
      expect(html, role).not.toContain("<img src=x");
      expect(html, role).not.toContain("<b>Eve</b>");
      expect(html, role).toContain("&lt;b&gt;Eve&lt;/b&gt; &amp; Co");
    }
  });
});
