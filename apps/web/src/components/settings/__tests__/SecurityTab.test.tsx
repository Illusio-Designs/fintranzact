/**
 * SecurityTab: status, enable flow (QR, confirm, backup codes shown once),
 * disable (incl. org-enforced refusal), regenerate, trusted devices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  status: { current: null as any },
  devices: { current: [] as any[] },
  begin: vi.fn(),
  confirm: vi.fn(),
  disable: vi.fn(),
  regenerate: vi.fn(),
  revoke: vi.fn(),
  revokeAll: vi.fn(),
  invalidate: vi.fn(),
  clearTrusted: vi.fn(async () => {}),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

function mutation(fn: (i?: any) => Promise<any>) {
  return (opts: any = {}) => ({
    isPending: false,
    isError: false,
    data: undefined as any,
    mutate: (input?: any) => {
      fn(input).then((r) => opts.onSuccess?.(r, input), (e) => opts.onError?.(e, input));
    },
  });
}

// beginSetup keeps its result in `data`, so it needs state-like behaviour.
vi.mock("@/lib/trpc", async () => {
  const React = await import("react");
  return {
    trpc: {
      useUtils: () => {
        const inv = { invalidate: h.invalidate };
        return { auth: { me: inv, twoFactorStatus: inv, listTrustedDevices: inv, listSessions: inv } };
      },
      auth: {
        me: { useQuery: () => ({ data: { user: { email: "me@firm.in" }, twoFactor: { enabled: !!h.status.current?.enabled } } }) },
        twoFactorStatus: { useQuery: () => ({ data: h.status.current, isLoading: false, isError: false }) },
        listTrustedDevices: { useQuery: () => ({ data: h.devices.current, isLoading: false, isError: false }) },
        twoFactorBeginSetup: {
          useMutation: (opts: any = {}) => {
            const [data, setData] = React.useState<any>(undefined);
            return {
              data,
              isPending: false,
              isError: false,
              mutate: () => {
                h.begin().then((r: any) => setData(r), (e: any) => opts.onError?.(e));
              },
            };
          },
        },
        twoFactorConfirmSetup: { useMutation: mutation((i) => h.confirm(i)) },
        twoFactorDisable: { useMutation: mutation((i) => h.disable(i)) },
        regenerateBackupCodes: { useMutation: mutation((i) => h.regenerate(i)) },
        revokeTrustedDevice: { useMutation: mutation((i) => h.revoke(i)) },
        revokeAllTrustedDevices: { useMutation: mutation(() => h.revokeAll()) },
      },
    },
  };
});
vi.mock("@/lib/isDesktop", () => ({ isDesktop: () => false }));
vi.mock("@/lib/desktop-session", () => ({
  clearTrustedDeviceToken: h.clearTrusted,
  getTrustedDeviceToken: async () => null,
}));
vi.mock("@/hooks/useToast", () => ({ toast: { error: h.toastError, success: h.toastSuccess, warning: vi.fn(), info: vi.fn() } }));

import { SecurityTab } from "../SecurityTab";

const CODES = ["AAAAAA-111111", "BBBBBB-222222", "CCCCCC-333333"];
const STATUS_OFF = { enabled: false, pendingSetup: false, backupCodesRemaining: 0, lockedUntil: null, trustedDeviceCount: 0, createdAt: null };
const STATUS_ON = { enabled: true, pendingSetup: false, backupCodesRemaining: 8, lockedUntil: null, trustedDeviceCount: 2, createdAt: "2026-02-01T00:00:00Z" };
const trpcError = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });

beforeEach(() => {
  vi.clearAllMocks();
  h.status.current = STATUS_OFF;
  h.devices.current = [];
  h.begin.mockResolvedValue({
    otpauthUri: "otpauth://totp/x",
    qrDataUrl: "data:image/png;base64,AAAA",
    manualKey: "ABCD EFGH IJKL MNOP",
    accountName: "me@firm.in",
    issuer: "Fintranzact",
  });
  h.confirm.mockResolvedValue({ backupCodes: CODES });
  h.disable.mockResolvedValue({ success: true });
  h.regenerate.mockResolvedValue({ backupCodes: CODES });
  h.revoke.mockResolvedValue({});
  h.revokeAll.mockResolvedValue({});
});

describe("status card", () => {
  it("shows Off with a Turn on button", () => {
    render(<SecurityTab />);
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeInTheDocument();
  });

  it("shows On, backup codes left, trusted devices, and a lock time", () => {
    h.status.current = { ...STATUS_ON, backupCodesRemaining: 1, lockedUntil: new Date(Date.now() + 3600_000).toISOString() };
    render(<SecurityTab />);
    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.getByText(/Backup codes left/)).toBeInTheDocument();
    expect(screen.getByText(/generate new ones soon/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Code checks are paused until/);
  });
});

describe("enable flow", () => {
  it("shows the QR and manual key, then confirms and shows the codes once behind a required checkbox", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    render(<SecurityTab />);
    await user.click(screen.getByRole("button", { name: "Turn on" }));

    const qr = await screen.findByAltText(/QR code to add me@firm.in/);
    expect(qr).toHaveAttribute("src", "data:image/png;base64,AAAA");
    expect(screen.getByLabelText("Setup key")).toHaveTextContent("ABCD EFGH IJKL MNOP");
    expect(screen.getByText(/Google Authenticator, Microsoft Authenticator or Authy/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("ABCDEFGHIJKLMNOP");

    await user.click(screen.getByRole("button", { name: "Next" }));
    const verifyBtn = screen.getByRole("button", { name: "Verify and turn on" });
    expect(verifyBtn).toBeDisabled();
    await user.type(screen.getByLabelText("6-digit code from your app"), "123456");
    await user.click(verifyBtn);
    expect(h.confirm).toHaveBeenCalledWith({ code: "123456" });

    const list = await screen.findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(CODES);
    expect(screen.getByText(/other signed-in devices were signed out/)).toBeInTheDocument();

    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    // Escape cannot dismiss the codes before they are saved.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("list", { name: "Backup codes" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("I have saved these codes"));
    expect(done).toBeEnabled();
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("shows a wrong confirmation code inline and stays on the step", async () => {
    h.confirm.mockRejectedValue(trpcError("That code is not right. Check the code and try again.", "BAD_REQUEST"));
    const user = userEvent.setup();
    render(<SecurityTab />);
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await screen.findByAltText(/QR code/);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByLabelText("6-digit code from your app"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify and turn on" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right");
  });

  it("downloads a text file with the account, date, warning and codes", async () => {
    const blobs: Blob[] = [];
    const createUrl = vi.fn((b: Blob) => (blobs.push(b), "blob:x"));
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    const clicks: string[] = [];
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    };
    try {
      const user = userEvent.setup();
      render(<SecurityTab />);
      await user.click(screen.getByRole("button", { name: "Turn on" }));
      await screen.findByAltText(/QR code/);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.type(screen.getByLabelText("6-digit code from your app"), "123456");
      await user.click(screen.getByRole("button", { name: "Verify and turn on" }));
      await user.click(await screen.findByRole("button", { name: "Download (.txt)" }));
      expect(clicks).toEqual(["fintranzact-backup-codes.txt"]);
      expect(blobs[0].type).toContain("text/plain");
      const text = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsText(blobs[0]);
      });
      expect(text).toContain("Account: me@firm.in");
      expect(text).toMatch(/Generated: \d{4}-\d{2}-\d{2}/);
      expect(text).toContain("AAAAAA-111111");
      expect(text).toMatch(/Keep this file somewhere safe/);
    } finally {
      HTMLAnchorElement.prototype.click = origClick;
    }
  });
});

describe("turn off", () => {
  beforeEach(() => {
    h.status.current = STATUS_ON;
  });

  it("asks for password and code, then turns off and forgets the local trusted token", async () => {
    const user = userEvent.setup();
    render(<SecurityTab />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await user.type(screen.getByLabelText("Your password"), "hunter2hunter2");
    await user.type(screen.getByLabelText(/Code from your app, or a backup code/), "k7p2mq9xd4hw");
    expect(screen.getByLabelText(/Code from your app, or a backup code/)).toHaveValue("K7P2MQ-9XD4HW");
    await user.click(document.querySelector("form button[type=submit]") as HTMLElement);
    await waitFor(() => expect(h.disable).toHaveBeenCalledWith({ password: "hunter2hunter2", code: "K7P2MQ-9XD4HW" }));
    await waitFor(() => expect(h.clearTrusted).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("shows the organisation-enforced refusal in the dialog", async () => {
    h.disable.mockRejectedValue(trpcError("Your organisation requires two-factor authentication.", "FORBIDDEN"));
    const user = userEvent.setup();
    render(<SecurityTab />);
    await user.click(screen.getByRole("button", { name: "Turn off" }));
    await user.type(screen.getByLabelText("Your password"), "pw");
    await user.type(screen.getByLabelText(/Code from your app, or a backup code/), "123456");
    await user.click(document.querySelector("form button[type=submit]") as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your organisation requires two-factor authentication");
    expect(h.clearTrusted).not.toHaveBeenCalled();
  });
});

describe("regenerate backup codes", () => {
  it("warns, takes password and an app code, then shows the new codes once", async () => {
    h.status.current = STATUS_ON;
    const user = userEvent.setup();
    render(<SecurityTab />);
    await user.click(screen.getByRole("button", { name: "New backup codes" }));
    expect(screen.getByText(/old codes, used or not, stop working/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your password"), "pw");
    await user.type(screen.getByLabelText("Current code from your app"), "654321");
    await user.click(screen.getByRole("button", { name: "Generate new codes" }));
    expect(h.regenerate).toHaveBeenCalledWith({ password: "pw", code: "654321" });
    const list = await screen.findByRole("list", { name: "Backup codes" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/old backup codes no longer work/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  });
});

describe("trusted devices", () => {
  const devices = [
    { id: "d1", label: "Chrome 126 on macOS", ip: "1.2.3.4", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, expiresAt: "2026-01-31T00:00:00Z", current: true },
    { id: "d2", label: "Firefox on Windows", ip: null, createdAt: "2026-01-02T00:00:00Z", lastUsedAt: "2026-01-05T00:00:00Z", expiresAt: "2026-02-01T00:00:00Z", current: false },
  ];

  it("lists devices with a This device badge and revokes one", async () => {
    h.status.current = STATUS_ON;
    h.devices.current = devices;
    const user = userEvent.setup();
    render(<SecurityTab />);
    expect(screen.getByText("Chrome 126 on macOS")).toBeInTheDocument();
    expect(screen.getAllByText("This device")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Revoke Firefox on Windows" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(h.revoke).toHaveBeenCalledWith({ id: "d2" }));
    // not this device: the local token stays
    expect(h.clearTrusted).not.toHaveBeenCalled();
  });

  it("revoke all clears the local trusted-device token", async () => {
    h.status.current = STATUS_ON;
    h.devices.current = devices;
    const user = userEvent.setup();
    render(<SecurityTab />);
    await user.click(screen.getByRole("button", { name: "Revoke all" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke all" }));
    await waitFor(() => expect(h.revokeAll).toHaveBeenCalled());
    await waitFor(() => expect(h.clearTrusted).toHaveBeenCalled());
  });
});
