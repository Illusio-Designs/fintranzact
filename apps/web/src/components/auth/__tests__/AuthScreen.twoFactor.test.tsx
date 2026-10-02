/**
 * AuthScreen: the second sign-in step for two-factor accounts.
 * tRPC, the router, the desktop keychain bridge and toasts are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  login: vi.fn(),
  verify: vi.fn(),
  invalidateMe: vi.fn(),
  toastError: vi.fn(),
  isDesktop: { current: false },
  saveDesktopToken: vi.fn(async () => {}),
  saveTrusted: vi.fn(async () => {}),
  getTrusted: vi.fn(async () => null as string | null),
  clearTrusted: vi.fn(async () => {}),
}));

function makeMutation(fn: (input: any) => Promise<any>) {
  return (opts: any) => ({
    isPending: false,
    mutate: (input: any) => {
      fn(input).then(
        (r) => opts.onSuccess?.(r, input),
        (e) => opts.onError?.(e, input),
      );
    },
  });
}

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ auth: { me: { invalidate: h.invalidateMe } } }),
    auth: {
      login: { useMutation: makeMutation((i) => h.login(i)) },
      verifyTwoFactor: { useMutation: makeMutation((i) => h.verify(i)) },
      register: { useMutation: makeMutation(async () => ({})) },
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@/lib/isDesktop", () => ({ isDesktop: () => h.isDesktop.current }));
vi.mock("@/lib/desktop-session", () => ({
  saveDesktopToken: h.saveDesktopToken,
  saveTrustedDeviceToken: h.saveTrusted,
  getTrustedDeviceToken: h.getTrusted,
  clearTrustedDeviceToken: h.clearTrusted,
}));
vi.mock("@/hooks/useToast", () => ({
  toast: { error: h.toastError, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { AuthScreen } from "../AuthScreen";

const trpcError = (message: string, code: string) => Object.assign(new Error(message), { data: { code } });
const CHALLENGE = { twoFactorRequired: true, challengeToken: "chal-1", expiresAt: new Date().toISOString(), methods: ["totp", "backup_code"] };

async function reachSecondStep(user = userEvent.setup()) {
  render(<AuthScreen mode="login" search={{}} />);
  await user.type(screen.getByLabelText("Email address"), "a@b.in");
  await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  await screen.findByRole("heading", { name: "Two-factor authentication" });
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isDesktop.current = false;
  h.getTrusted.mockResolvedValue(null);
  h.login.mockResolvedValue(CHALLENGE);
  h.verify.mockResolvedValue({ user: { id: "u", email: "a@b.in", name: "A" }, sessionToken: "sess" });
});

describe("AuthScreen second step", () => {
  it("shows the code screen after a correct password and no placeholder text", async () => {
    await reachSecondStep();
    const input = screen.getByLabelText("Authentication code");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("autocomplete", "one-time-code");
    expect(input).toHaveFocus();
    expect(screen.getByLabelText("Trust this device for 30 days")).not.toBeChecked();
    expect(screen.queryByText(/not available in this version/i)).toBeNull();
  });

  it("users without two-factor sign in with no second step", async () => {
    h.login.mockResolvedValue({ twoFactorRequired: false, user: { id: "u" }, sessionToken: "s" });
    const user = userEvent.setup();
    render(<AuthScreen mode="login" search={{}} />);
    await user.type(screen.getByLabelText("Email address"), "a@b.in");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(h.invalidateMe).toHaveBeenCalled());
    expect(screen.queryByText("Two-factor authentication")).toBeNull();
  });

  it("submits automatically at six digits, remembering the device only when ticked", async () => {
    const user = await reachSecondStep();
    await user.click(screen.getByLabelText("Trust this device for 30 days"));
    await user.type(screen.getByLabelText("Authentication code"), "123456");
    await waitFor(() => expect(h.verify).toHaveBeenCalledTimes(1));
    expect(h.verify).toHaveBeenCalledWith({ challengeToken: "chal-1", code: "123456", rememberDevice: true });
    await waitFor(() => expect(h.invalidateMe).toHaveBeenCalled());
  });

  it("sends rememberDevice false by default and accepts a pasted code with spaces", async () => {
    const user = await reachSecondStep();
    await user.click(screen.getByLabelText("Authentication code"));
    await user.paste("123 456");
    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({ challengeToken: "chal-1", code: "123456", rememberDevice: false }));
  });

  it("does not submit before six digits", async () => {
    const user = await reachSecondStep();
    await user.type(screen.getByLabelText("Authentication code"), "12345");
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("switches to a backup code field that formats as XXXXXX-XXXXXX", async () => {
    const user = await reachSecondStep();
    await user.click(screen.getByRole("button", { name: "Use a backup code instead" }));
    const input = screen.getByLabelText("Backup code");
    await user.type(input, "k7p2mq9xd4hw");
    expect(input).toHaveValue("K7P2MQ-9XD4HW");
    expect(h.verify).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(h.verify).toHaveBeenCalledWith({ challengeToken: "chal-1", code: "K7P2MQ-9XD4HW", rememberDevice: false }));
  });

  it("a wrong code shows the message, clears the field and keeps the step", async () => {
    h.verify.mockRejectedValue(trpcError("That code is not right. Check the code and try again.", "BAD_REQUEST"));
    const user = await reachSecondStep();
    const input = screen.getByLabelText("Authentication code");
    await user.type(input, "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right");
    expect(input).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Two-factor authentication" })).toBeInTheDocument();
    // the same code can be tried again
    await user.type(input, "000000");
    await waitFor(() => expect(h.verify).toHaveBeenCalledTimes(2));
  });

  it("an expired sign-in returns to the password step with the message", async () => {
    h.verify.mockRejectedValue(trpcError("This sign-in has expired. Enter your password again.", "BAD_REQUEST"));
    const user = await reachSecondStep();
    await user.type(screen.getByLabelText("Authentication code"), "123456");
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("This sign-in has expired. Enter your password again."));
    expect(await screen.findByLabelText("Password")).toHaveValue("");
    expect(screen.queryByText("Two-factor authentication")).toBeNull();
  });

  it("a locked account shows the unlock time and disables the field", async () => {
    const until = new Date(Date.now() + 15 * 60_000);
    h.verify.mockRejectedValue(trpcError(`Too many wrong codes. Try again in 15 minutes (after ${until.toISOString()}).`, "TOO_MANY_REQUESTS"));
    const user = await reachSecondStep();
    await user.type(screen.getByLabelText("Authentication code"), "123456");
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Too many attempts\. Try again at /);
    expect(screen.getByLabelText("Authentication code")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
  });

  it("Back returns to the password step", async () => {
    const user = await reachSecondStep();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveValue("a@b.in");
  });

  it("desktop: stores the session and the returned trusted-device token", async () => {
    h.isDesktop.current = true;
    h.verify.mockResolvedValue({ user: { id: "u", email: "a@b.in", name: "A" }, sessionToken: "sess", trustedDeviceToken: "td-1" });
    const user = await reachSecondStep();
    await user.click(screen.getByLabelText("Trust this device for 30 days"));
    await user.type(screen.getByLabelText("Authentication code"), "123456");
    await waitFor(() => expect(h.saveTrusted).toHaveBeenCalledWith("td-1"));
    expect(h.saveDesktopToken).toHaveBeenCalledWith("sess");
  });

  it("desktop: sends the stored trusted-device token on login and clears it when the server still asks for a code", async () => {
    h.isDesktop.current = true;
    h.getTrusted.mockResolvedValue("td-old");
    await reachSecondStep();
    expect(h.login).toHaveBeenCalledWith({ email: "a@b.in", password: "hunter2hunter2", trustedDeviceToken: "td-old" });
    expect(h.clearTrusted).toHaveBeenCalled();
  });

  it("web: login input carries no trustedDeviceToken (the cookie travels by itself)", async () => {
    await reachSecondStep();
    expect(h.login).toHaveBeenCalledWith({ email: "a@b.in", password: "hunter2hunter2" });
    expect(h.getTrusted).not.toHaveBeenCalled();
  });
});
