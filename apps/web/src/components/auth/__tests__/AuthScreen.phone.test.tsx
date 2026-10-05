/**
 * AuthScreen sign-up: the mobile number is required, validated as an Indian
 * mobile, explained, and sent to auth.register as normalised digits.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  register: vi.fn(),
  invalidateMe: vi.fn(),
  toastError: vi.fn(),
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
      login: { useMutation: makeMutation(async () => ({})) },
      verifyTwoFactor: { useMutation: makeMutation(async () => ({})) },
      register: { useMutation: makeMutation((i) => h.register(i)) },
    },
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: any) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
}));
// Desktop skips the bot check, so the form submits straight to the mutation.
vi.mock("@/lib/isDesktop", () => ({ isDesktop: () => true }));
vi.mock("@/lib/desktop-session", () => ({
  saveDesktopToken: vi.fn(async () => {}),
  saveTrustedDeviceToken: vi.fn(async () => {}),
  getTrustedDeviceToken: vi.fn(async () => null),
  clearTrustedDeviceToken: vi.fn(async () => {}),
}));
vi.mock("@/hooks/useToast", () => ({
  toast: { error: h.toastError, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { AuthScreen } from "../AuthScreen";
import { PHONE_HELP_TEXT, PHONE_INVALID_MESSAGE, PHONE_REQUIRED_MESSAGE } from "@fintranzact/shared";

async function fillForm(user: ReturnType<typeof userEvent.setup>, phone: string | null) {
  await user.type(screen.getByLabelText("Username"), "anjali");
  await user.type(screen.getByLabelText("Email address"), "anjali@mehtatraders.in");
  if (phone !== null) await user.type(screen.getByLabelText("Mobile number"), phone);
  await user.type(screen.getByLabelText("Password"), "long-enough-pw");
  await user.type(screen.getByLabelText("Retype password"), "long-enough-pw");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.register.mockResolvedValue({ sessionToken: "s" });
});

describe("AuthScreen sign-up: mobile number", () => {
  it("shows the field with the reason it is asked for", () => {
    render(<AuthScreen mode="register" search={{}} />);
    const input = screen.getByLabelText("Mobile number");
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("type", "tel");
    expect(screen.getByText(PHONE_HELP_TEXT)).toBeInTheDocument();
    expect(PHONE_HELP_TEXT).toMatch(/one free trial per business/);
    expect(PHONE_HELP_TEXT).toMatch(/account recovery/);
  });

  it("does not submit an invalid number and says why", async () => {
    const user = userEvent.setup();
    render(<AuthScreen mode="register" search={{}} />);
    await fillForm(user, "12345");
    await user.click(screen.getByRole("button", { name: /Start free trial/ }));
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith(PHONE_INVALID_MESSAGE, PHONE_HELP_TEXT));
    expect(h.register).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
  });

  it("requires a number: an empty field is not submitted", async () => {
    const user = userEvent.setup();
    render(<AuthScreen mode="register" search={{}} />);
    await fillForm(user, null);
    // The input is `required`, so the browser blocks an empty submit; the handler also checks.
    screen.getByLabelText("Mobile number").removeAttribute("required");
    await user.click(screen.getByRole("button", { name: /Start free trial/ }));
    await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith(PHONE_REQUIRED_MESSAGE, PHONE_HELP_TEXT));
    expect(h.register).not.toHaveBeenCalled();
  });

  it("sends the normalised 10 digits to auth.register", async () => {
    const user = userEvent.setup();
    render(<AuthScreen mode="register" search={{}} />);
    await fillForm(user, "+91 98765-43210");
    await user.click(screen.getByRole("button", { name: /Start free trial/ }));
    await vi.waitFor(() => expect(h.register).toHaveBeenCalledTimes(1));
    expect(h.register.mock.calls[0]![0]).toMatchObject({
      email: "anjali@mehtatraders.in",
      phone: "9876543210",
    });
  });

  it("log in has no mobile field", () => {
    render(<AuthScreen mode="login" search={{}} />);
    expect(screen.queryByLabelText("Mobile number")).toBeNull();
  });
});
