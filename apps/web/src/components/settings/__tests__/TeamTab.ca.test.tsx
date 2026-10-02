/** Team tab: "Invite my CA" (owner only), CA badges, pending access level, role editing rules, the dialog. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  role: { current: "owner" as string },
  members: { current: [] as any[] },
  pending: { current: [] as any[] },
  invite: vi.fn(),
  inviteResult: { current: null as null | { token: string } },
  updateRole: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const inv = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({ tenant: { current: inv, members: inv, pendingInvitations: inv } }),
      auth: { me: { useQuery: () => ({ data: { tenantId: "t1", role: h.role.current, user: { email: "me@firm.in" }, twoFactor: { enabled: true } } }) } },
      tenant: {
        members: { useQuery: () => ({ data: h.members.current, isLoading: false }) },
        pendingInvitations: { useQuery: () => ({ data: h.pending.current }) },
        accessLog: { useQuery: () => ({ data: { items: [], nextCursor: null }, isLoading: false, isError: false, isFetching: false }) },
        current: { useQuery: () => ({ data: { twoFactorPolicy: "off", twoFactorGraceDays: 7 } }) },
        removeMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        updateMemberRole: { useMutation: () => ({ mutate: (i: any) => h.updateRole(i), isPending: false }) },
        revokeInvitation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        inviteMember: {
          useMutation: (opts: any) => ({
            mutate: (i: any) => { h.invite(i); if (h.inviteResult.current) opts.onSuccess(h.inviteResult.current); },
            isPending: false,
          }),
        },
        setSecurityPolicy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  };
});
vi.mock("@/hooks/useToast", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TeamTab } from "../TeamTab";

const member = (over: object) => ({ id: Math.random().toString(), userId: Math.random().toString(), role: "seller", acceptedAt: new Date(), createdAt: new Date(), userName: "N", userEmail: "x@firm.in", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.role.current = "owner";
  h.inviteResult.current = { token: "tok123" };
  h.pending.current = [];
  h.members.current = [
    member({ userEmail: "me@firm.in", role: "owner" }),
    member({ userEmail: "s@firm.in", role: "seller", userName: "Sam" }),
    member({ userEmail: "ca@firm.in", role: "auditor", userName: "Anita" }),
    member({ userEmail: "cf@firm.in", role: "ca_filing", userName: "Vikram" }),
  ];
});

describe("Invite my CA button", () => {
  it("shows next to Invite member for the owner", () => {
    render(<TeamTab />);
    expect(screen.getByRole("button", { name: "Invite my CA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Invite member" })).toBeInTheDocument();
  });

  it("is hidden from an admin, who can still invite staff", () => {
    h.role.current = "admin";
    h.members.current[0] = member({ userEmail: "me@firm.in", role: "admin" });
    render(<TeamTab />);
    expect(screen.queryByRole("button", { name: "Invite my CA" })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Invite member" })).toBeInTheDocument();
  });

  it("is hidden from a seller", () => {
    h.members.current[0] = member({ userEmail: "me@firm.in", role: "seller" });
    render(<TeamTab />);
    expect(screen.queryByRole("button", { name: "Invite my CA" })).toBeNull();
  });
});

describe("Invite your CA dialog", () => {
  it("offers the two access levels with their plain-language descriptions and the removal note", async () => {
    const user = userEvent.setup();
    render(<TeamTab />);
    await user.click(screen.getByRole("button", { name: "Invite my CA" }));
    const dialog = await screen.findByRole("dialog");
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(within(dialog).getByText("View only")).toBeInTheDocument();
    expect(within(dialog).getByText("View and file returns")).toBeInTheDocument();
    expect(within(dialog).getByText("Can view everything and download reports. Cannot change anything.")).toBeInTheDocument();
    expect(within(dialog).getByText(/Can view everything, prepare and file GST returns/)).toBeInTheDocument();
    expect(within(dialog).getByText("You can remove their access at any time. Their activity is logged.")).toBeInTheDocument();
    expect(radios[0]).toBeChecked();
  });

  it("sends the chosen role and email, then shows the link and the 'We emailed them' line", async () => {
    const user = userEvent.setup();
    render(<TeamTab />);
    await user.click(screen.getByRole("button", { name: "Invite my CA" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/email address/i), "Anita.Shah@Firm.IN");
    await user.click(within(dialog).getByRole("radio", { name: /View and file returns/ }));
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(h.invite).toHaveBeenCalledWith({ email: "Anita.Shah@Firm.IN", role: "ca_filing" });
    expect(await within(dialog).findByTestId("ca-emailed")).toHaveTextContent("We emailed them at anita.shah@firm.in");
    expect((within(dialog).getByLabelText("Invite Link") as HTMLInputElement).value).toBe(`${window.location.origin}/invite/tok123`);
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("defaults to view only", async () => {
    const user = userEvent.setup();
    render(<TeamTab />);
    await user.click(screen.getByRole("button", { name: "Invite my CA" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/email address/i), "ca@firm.in");
    await user.click(within(dialog).getByRole("button", { name: "Send invite" }));
    expect(h.invite).toHaveBeenCalledWith({ email: "ca@firm.in", role: "auditor" });
  });
});

describe("normal invite dialog", () => {
  it("has no CA roles in its role list", async () => {
    const user = userEvent.setup();
    render(<TeamTab />);
    await user.click(screen.getByRole("button", { name: "+ Invite member" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));
    expect(screen.queryByRole("option", { name: "Accountant (read-only)" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Accountant (filing)" })).toBeNull();
    expect(screen.getByRole("option", { name: "Accountant (bookkeeping)" })).toBeInTheDocument();
  });
});

describe("badges and pending invitations", () => {
  it("tags CA members with a small CA badge and not staff", () => {
    render(<TeamTab />);
    const badges = screen.getAllByTestId("role-badge");
    const withCa = badges.filter((b) => within(b).queryByTestId("ca-badge"));
    expect(withCa.map((b) => b.textContent)).toEqual(["Accountant (read-only)CA", "Accountant (filing)CA"]);
    expect(badges).toHaveLength(4);
  });

  it("shows the access level of a pending CA invitation, and none for staff", () => {
    h.pending.current = [
      { id: "i1", email: "ca@firm.in", role: "ca_filing", createdAt: new Date(), expiresAt: new Date() },
      { id: "i2", email: "st@firm.in", role: "seller", createdAt: new Date(), expiresAt: new Date() },
    ];
    render(<TeamTab />);
    const access = screen.getAllByTestId("pending-access");
    expect(access).toHaveLength(1);
    expect(access[0]).toHaveTextContent(/file GST returns/);
  });
});

describe("editing a member's role", () => {
  it("an admin gets no role dropdown for a CA member", () => {
    h.role.current = "admin";
    h.members.current[0] = member({ userEmail: "me@firm.in", role: "admin" });
    render(<TeamTab />);
    const rows = screen.getAllByRole("row");
    const caRow = rows.find((r) => within(r).queryByText("Anita"))!;
    const sellerRow = rows.find((r) => within(r).queryByText("Sam"))!;
    expect(within(caRow).queryByRole("combobox")).toBeNull();
    expect(within(caRow).getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(sellerRow).getByRole("combobox")).toBeInTheDocument();
  });

  it("the owner can move a member to a CA role and sees CA options", async () => {
    const user = userEvent.setup();
    render(<TeamTab />);
    const sellerRow = screen.getAllByRole("row").find((r) => within(r).queryByText("Sam"))!;
    await user.click(within(sellerRow).getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Accountant (filing)" }));
    expect(h.updateRole).toHaveBeenCalledWith(expect.objectContaining({ role: "ca_filing" }));
  });
});
