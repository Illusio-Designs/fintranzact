/**
 * Platform admin 2FA: member badge and Reset 2FA button, the reset dialog's
 * validation and submit, and the security activity section.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  reset: vi.fn(),
  invalidate: vi.fn(),
  events: { current: { items: [] as any[], nextCursor: null as string | null } },
  toastSuccess: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ platform: { tenant: { invalidate: h.invalidate }, securityEvents: { invalidate: h.invalidate } } }),
    platform: {
      resetTwoFactor: {
        useMutation: (opts: any = {}) => ({
          isPending: false,
          mutate: (input: any) => {
            h.reset(input);
            Promise.resolve(h.reset.mock.results.at(-1)?.value).then((r) => opts.onSuccess?.(r ?? { reset: true, message: "done" }, input));
          },
        }),
      },
      securityEvents: { useQuery: () => ({ data: h.events.current, isLoading: false, isError: false }) },
    },
  },
}));
vi.mock("@/hooks/useToast", () => ({
  toast: Object.assign(vi.fn(), { success: h.toastSuccess, info: h.toastInfo, error: h.toastError }),
}));

import { MemberRow } from "../MemberRow";
import { ResetTwoFactorDialog } from "../ResetTwoFactorDialog";
import { SecurityActivitySection } from "../SecurityActivitySection";

const member = { userId: "u2", name: "Asha", email: "asha@firm.in", emailVerified: true, twoFactorEnabled: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.events.current = { items: [], nextCursor: null };
});

describe("MemberRow", () => {
  it("shows 2FA on with a Reset button that fires", async () => {
    const onReset = vi.fn();
    render(<MemberRow member={member} roleLabel="Owner" isSelf={false} onReset={onReset} />);
    expect(screen.getByText("2FA on")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset 2FA for asha@firm.in" }));
    expect(onReset).toHaveBeenCalled();
  });
  it("shows 2FA off with no button", () => {
    render(<MemberRow member={{ ...member, twoFactorEnabled: false }} roleLabel="Owner" isSelf={false} onReset={() => {}} />);
    expect(screen.getByText("2FA off")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("never offers a reset for yourself", () => {
    render(<MemberRow member={member} roleLabel="Owner" isSelf onReset={() => {}} />);
    expect(screen.queryByRole("button", { name: /Reset 2FA/ })).toBeNull();
  });
});

describe("ResetTwoFactorDialog", () => {
  const target = { userId: "u2", name: "Asha", email: "asha@firm.in" };
  const open = () => render(<ResetTwoFactorDialog target={target} tenantId="t1" onClose={vi.fn()} />);
  const submit = () => screen.getByRole("button", { name: "Reset two-factor" });

  it("warns what will happen", () => {
    open();
    expect(screen.getByText(/signed out/)).toBeInTheDocument();
    expect(screen.getByText(/trusted/)).toBeInTheDocument();
    expect(screen.getByText(/emailed/)).toBeInTheDocument();
  });

  it("stays disabled until method, two checks, a 20 char reason and the typed email are all valid", async () => {
    const user = userEvent.setup();
    open();
    expect(submit()).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "How was the user verified?" }));
    await user.click(screen.getByRole("option", { name: "Video call with the user" }));
    expect(submit()).toBeDisabled();

    await user.click(screen.getByLabelText("Full name matches the account"));
    expect(submit()).toBeDisabled(); // one check is not enough
    await user.click(screen.getByLabelText("Ownership of the account email confirmed"));

    await user.type(screen.getByLabelText(/Reason/), "too short");
    await user.type(screen.getByLabelText(/Type asha@firm.in to confirm/), "asha@firm.in");
    expect(submit()).toBeDisabled(); // reason too short
    expect(screen.getByText(/At least 20 characters/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Reason/), " and more words to be long enough");
    expect(submit()).toBeEnabled();

    await user.clear(screen.getByLabelText(/Type asha@firm.in to confirm/));
    await user.type(screen.getByLabelText(/Type asha@firm.in to confirm/), "other@firm.in");
    expect(submit()).toBeDisabled(); // wrong email
  });

  it("submits the verification (email match is case-insensitive) and toasts success", async () => {
    h.reset.mockResolvedValue({ reset: true, message: "Two-factor authentication was reset." });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("combobox", { name: "How was the user verified?" }));
    await user.click(screen.getByRole("option", { name: "Verified through a support ticket" }));
    await user.click(screen.getByLabelText("Full name matches the account"));
    await user.click(screen.getByLabelText("A recent sign-in detail confirmed (time, device or place)"));
    await user.type(screen.getByLabelText(/Ticket or reference/), "TCK-9");
    await user.type(screen.getByLabelText(/Reason/), "Lost phone and backup codes; verified by ticket.");
    await user.type(screen.getByLabelText(/Type asha@firm.in to confirm/), "ASHA@firm.in");
    await user.click(submit());
    await waitFor(() =>
      expect(h.reset).toHaveBeenCalledWith({
        userId: "u2",
        tenantId: "t1",
        confirmEmail: "ASHA@firm.in",
        verification: {
          method: "support_ticket",
          checks: ["name_matches_account", "last_login_detail_confirmed"],
          reference: "TCK-9",
          reason: "Lost phone and backup codes; verified by ticket.",
        },
      }),
    );
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Two-factor reset", "Two-factor authentication was reset."));
    expect(h.invalidate).toHaveBeenCalled();
  });
});

describe("SecurityActivitySection", () => {
  it("empty state", () => {
    render(<SecurityActivitySection tenantId="t1" />);
    expect(screen.getByText("No security events yet.")).toBeInTheDocument();
  });

  it("lists events and highlights admin resets with their verification", () => {
    h.events.current = {
      nextCursor: null,
      items: [
        {
          id: "e1", type: "2fa.reset_by_admin", label: "Two-factor reset by a platform administrator",
          createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), ip: "203.0.113.9", userAgent: null, tenantId: "t1",
          metadata: { method: "video_call", reference: "TCK-1", reason: "Lost phone and codes" },
          user: { id: "u2", name: "Asha", email: "asha@firm.in" }, actor: { id: "a1", name: "Ops", email: "ops@fintranzact.com" },
        },
        {
          id: "e2", type: "2fa.failed", label: "Wrong verification code", createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
          ip: null, userAgent: null, tenantId: null, metadata: null, user: { id: "u2", name: "Asha", email: "asha@firm.in" }, actor: null,
        },
      ],
    };
    const { container } = render(<SecurityActivitySection tenantId="t1" />);
    const reset = container.querySelector('[data-reset="true"]') as HTMLElement;
    expect(reset).toBeTruthy();
    expect(within(reset).getByText(/by ops@fintranzact.com/)).toBeInTheDocument();
    expect(within(reset).getByText(/Video call with the user · ref TCK-1 · Lost phone and codes/)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-reset="true"]')).toHaveLength(1);
    expect(screen.getByText("Wrong verification code")).toBeInTheDocument();
  });
});
