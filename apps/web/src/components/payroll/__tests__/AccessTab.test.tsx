import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

const E1 = "55555555-5555-4555-8555-555555555555";
const E2 = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => ({
  logins: { data: [] as unknown[] },
  years: { data: [] as unknown[] },
  invite: vi.fn(),
  revoke: vi.fn(),
  release: vi.fn(),
  unrelease: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ payrollAccess: { loginList: { invalidate: h.invalidate }, form16List: { invalidate: h.invalidate } } }),
    payrollAccess: {
      loginList: { useQuery: () => ({ data: h.logins.data }) },
      form16List: { useQuery: () => ({ data: h.years.data }) },
      invite: { useMutation: (o: { onSuccess?: (r: unknown) => void }) => ({ mutate: (v: unknown) => { h.invite(v); o.onSuccess?.({ inviteUrl: "https://app.test/invite/abc123", expiresAt: new Date(), replaced: false }); }, isPending: false }) },
      revokeLogin: { useMutation: (o: { onSuccess?: () => void }) => ({ mutate: (v: unknown) => { h.revoke(v); o.onSuccess?.(); }, isPending: false }) },
      form16Release: { useMutation: () => ({ mutate: h.release, isPending: false }) },
      form16Unrelease: { useMutation: () => ({ mutate: h.unrelease, isPending: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({ toast: h.toast }));

import { AccessTab } from "../AccessTab";

describe("AccessTab (the employee app)", () => {
  beforeEach(() => {
    for (const f of [h.invite, h.revoke, h.release, h.unrelease, h.invalidate, h.toast]) f.mockReset();
    h.logins.data = [
      { employeeId: E1, code: "E001", name: "Asha Verma", email: "asha@example.in", state: "none", loginEmail: null, invitationExpiresAt: null, linkedAt: null },
      { employeeId: E2, code: "E002", name: "Ravi Nair", email: null, state: "active", loginEmail: "ravi@example.in", invitationExpiresAt: null, linkedAt: new Date() },
    ];
    h.years.data = [
      { financialYear: 2026, label: "2026-27", released: false, releasedAt: null },
      { financialYear: 2025, label: "2025-26", released: true, releasedAt: new Date("2026-05-02") },
    ];
  });

  it("shows each employee's login state and the seat note", () => {
    render(<AccessTab />);
    expect(screen.getByText(/do not use a team seat/i)).toBeInTheDocument();
    const asha = screen.getByText("Asha Verma").closest("tr")!;
    expect(within(asha).getByText("No login")).toBeInTheDocument();
    expect(within(asha).getByRole("button", { name: "Invite" })).toBeInTheDocument();
    const ravi = screen.getByText("Ravi Nair").closest("tr")!;
    expect(within(ravi).getByText("Signed up")).toBeInTheDocument();
    expect(within(ravi).getByText("ravi@example.in")).toBeInTheDocument();
    expect(within(ravi).queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
  });

  it("invites by email with the address checked first, then shows the one-time link", () => {
    render(<AccessTab />);
    fireEvent.click(within(screen.getByText("Asha Verma").closest("tr")!).getByRole("button", { name: "Invite" }));
    const dialog = screen.getByRole("dialog");
    const email = within(dialog).getByLabelText(/Email address/);
    expect(email).toHaveValue("asha@example.in"); // prefilled from the employee record
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(within(dialog).getByRole("alert")).toBeInTheDocument();
    expect(h.invite).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: "Asha@Example.in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    expect(h.invite).toHaveBeenCalledWith({ employeeId: E1, email: "asha@example.in" }); // lowercased by the schema
    expect(within(dialog).getByLabelText("Invitation link")).toHaveValue("https://app.test/invite/abc123");
  });

  it("removes a login only after confirming", () => {
    render(<AccessTab />);
    fireEvent.click(within(screen.getByText("Ravi Nair").closest("tr")!).getByRole("button", { name: "Remove" }));
    expect(h.revoke).not.toHaveBeenCalled();
    expect(screen.getByText(/no longer be able to sign in/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove login" }));
    expect(h.revoke).toHaveBeenCalledWith({ employeeId: E2 });
  });

  it("releases and withdraws Form 16 per year", () => {
    render(<AccessTab />);
    expect(screen.getByText(/working copy for CA review/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Release to employees" }));
    expect(h.release).toHaveBeenCalledWith({ financialYear: 2026 });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    expect(h.unrelease).toHaveBeenCalledWith({ financialYear: 2025 });
  });
});
