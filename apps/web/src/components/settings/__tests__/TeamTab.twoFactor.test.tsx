/** Team tab: policy card (owner edits, admin read-only), Two-factor column and summary. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  role: { current: "owner" as string },
  ownTwoFactor: { current: true },
  policy: { current: "off" as string },
  grace: { current: 7 },
  members: { current: [] as any[] },
  save: vi.fn(),
}));

vi.mock("@/lib/trpc", () => {
  const inv = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({ tenant: { current: inv, members: inv, pendingInvitations: inv } }),
      auth: {
        me: { useQuery: () => ({ data: { tenantId: "t1", role: h.role.current, user: { email: "me@firm.in" }, twoFactor: { enabled: h.ownTwoFactor.current } } }) },
      },
      tenant: {
        members: { useQuery: () => ({ data: h.members.current, isLoading: false }) },
        pendingInvitations: { useQuery: () => ({ data: [] }) },
        accessLog: { useQuery: () => ({ data: { items: [], nextCursor: null }, isLoading: false, isError: false, isFetching: false }) },
        current: { useQuery: () => ({ data: { twoFactorPolicy: h.policy.current, twoFactorGraceDays: h.grace.current } }) },
        removeMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        updateMemberRole: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        revokeInvitation: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        inviteMember: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
        setSecurityPolicy: { useMutation: () => ({ mutate: (i: any) => h.save(i), isPending: false }) },
      },
    },
  };
});
vi.mock("@/hooks/useToast", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
// The AI assistant switches have their own tests (AiAssistantSettingsCard.test.tsx).
vi.mock("../AiAssistantSettingsCard", () => ({ AiAssistantSettingsCard: () => null }));

import { TeamTab } from "../TeamTab";

const member = (over: object) => ({ id: Math.random().toString(), userId: Math.random().toString(), role: "seller", acceptedAt: new Date(), createdAt: new Date(), userName: "N", userEmail: "x@firm.in", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.role.current = "owner";
  h.ownTwoFactor.current = true;
  h.policy.current = "off";
  h.grace.current = 7;
  h.members.current = [
    member({ userEmail: "me@firm.in", role: "owner", twoFactorEnabled: true }),
    member({ userEmail: "a@firm.in", role: "admin", twoFactorEnabled: false }),
    member({ userEmail: "s@firm.in", role: "seller", twoFactorEnabled: false }),
  ];
});

describe("Team tab two-factor", () => {
  it("shows a Two-factor column with On / Not set up badges to an owner", () => {
    render(<TeamTab />);
    expect(screen.getByRole("columnheader", { name: "Two-factor" })).toBeInTheDocument();
    const badges = screen.getAllByTestId("two-factor-badge").map((b) => b.textContent);
    expect(badges).toEqual(["On", "Not set up", "Not set up"]);
  });

  it("hides the column when the API did not send the flag (non-admin viewer)", () => {
    h.role.current = "seller";
    h.members.current = h.members.current.map((m) => ({ ...m, twoFactorEnabled: undefined }));
    h.members.current[0].role = "seller";
    render(<TeamTab />);
    expect(screen.queryByRole("columnheader", { name: "Two-factor" })).toBeNull();
    expect(screen.queryByTestId("two-factor-policy-card")).toBeNull();
  });

  it("summarises how many covered members still need to set up", () => {
    h.policy.current = "all";
    render(<TeamTab />);
    expect(screen.getByTestId("two-factor-summary")).toHaveTextContent("2 of 3 members still need to set up two-factor authentication.");
  });

  it("an admin sees the policy read-only", () => {
    h.role.current = "admin";
    h.policy.current = "admins";
    h.members.current[0] = member({ userEmail: "me@firm.in", role: "admin", twoFactorEnabled: true });
    render(<TeamTab />);
    expect(screen.getByTestId("two-factor-policy-readonly")).toHaveTextContent("Owners and admins");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("an owner picks a policy, confirms, and saves it with the grace days", async () => {
    const user = userEvent.setup();
    render(<TeamTab />);
    await user.click(screen.getByRole("radio", { name: /Everyone/ }));
    const grace = screen.getByLabelText("Grace period (days)");
    await user.clear(grace);
    await user.type(grace, "3");
    await user.click(screen.getByRole("button", { name: "Save policy" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Every member must use two-factor authentication");
    expect(dialog).toHaveTextContent("3 days from now");
    await user.click(within(dialog).getByRole("button", { name: "Save policy" }));
    expect(h.save).toHaveBeenCalledWith({ policy: "all", graceDays: 3 });
  });

  it("an owner without 2FA of their own cannot save a policy", async () => {
    h.ownTwoFactor.current = false;
    const user = userEvent.setup();
    render(<TeamTab />);
    await user.click(screen.getByRole("radio", { name: /Everyone/ }));
    expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Turn on two-factor authentication for your own account first");
  });
});
