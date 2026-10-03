import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircleIcon, CheckmarkCircle02Icon, Mail01Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { isDesktop } from "@/lib/isDesktop";
import {
  clearTrustedDeviceToken,
  getTrustedDeviceToken,
  saveDesktopToken,
  saveTrustedDeviceToken,
} from "@/lib/desktop-session";
import { TwoFactorStep, type VerifyResult } from "./TwoFactorStep";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { TurnstileModal } from "@/components/ui/TurnstileModal";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { isPlanId, TRIAL_DAYS, type PlanId } from "@fintranzact/shared";

type AuthFieldName = "email" | "password" | "username" | "confirm";
const FIELD_ID: Record<AuthFieldName, string> = {
  email: "auth-email",
  password: "auth-password",
  username: "auth-username",
  confirm: "auth-password-2",
};
/** Same rule the API uses: something@something.tld, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AuthMode = "login" | "register";

/** Search params shared by /login and /register (the invite flow sets them). */
export type AuthSearch = { invite?: string; error?: string; ref?: string; plan?: string };

export function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  return {
    ...(typeof search.invite === "string" ? { invite: search.invite } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
    // Partner referral links: /register?ref=FTZ-7K2M9Q
    ...(typeof search.ref === "string" && search.ref.length <= 50 ? { ref: search.ref } : {}),
    // A plan picked on the pricing page: /register?plan=growth (starter, growth or business only).
    ...(isPlanId(search.plan) ? { plan: search.plan } : {}),
  };
}

const PANEL: Record<AuthMode, { title: string; accent: string; points: string[] }> = {
  login: {
    title: "Your business, your books.",
    accent: "Always clear.",
    points: ["Unlimited GST invoices on every plan", "e-Invoicing, e-Way Bills and GSTR returns", "Works on web, desktop and mobile"],
  },
  register: {
    title: "Start billing in minutes.",
    accent: `${TRIAL_DAYS}-day free trial.`,
    points: ["Unlimited invoices, parties and payments", "GST reports and e-Way Bills built in", "No branding on your documents"],
  },
};

/* ─── Left brand panel (large screens) ──────────────────────────────────── */
function BrandPanel({ mode }: { mode: AuthMode }) {
  const panel = PANEL[mode];
  return (
    <aside className="landing-dots-dark relative hidden w-[46%] max-w-[600px] shrink-0 flex-col overflow-hidden bg-[#0f1b3d] px-14 py-12 text-white lg:flex">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-36 -top-36 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(91,124,196,.45),rgba(91,124,196,0)_70%)]"
      />
      <Link to="/" className="relative flex items-center gap-2.5">
        <Logo variant="light" className="h-[38px] w-[38px]" />
        <span className="font-display text-[21px] font-extrabold">Fintranzact</span>
      </Link>
      <h2 className="relative mt-16 font-display text-[40px] font-extrabold leading-[1.12] tracking-[-0.03em]">
        {panel.title}
        <br />
        <span className="text-[#a9bde6]">{panel.accent}</span>
      </h2>
      <p className="relative mt-4 max-w-[400px] text-base leading-relaxed text-[#b9c6e3]">
        GST invoicing, party ledgers, stock and payments, built for Indian businesses.
      </p>
      <ul className="relative mt-7 space-y-3 text-[15px] text-[#dbe4f5]">
        {panel.points.map((point) => (
          <li key={point} className="flex items-center gap-2.5">
            <Icon icon={CheckmarkCircle02Icon} size={20} className="shrink-0 text-[#a9bde6]" />
            {point}
          </li>
        ))}
      </ul>
      {/* Sample invoice card */}
      <div aria-hidden="true" className="relative mt-auto rounded-2xl border border-white/10 bg-white/[.06] p-[18px]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9fb0d6]">Invoice #INV-0042</span>
          <span className="rounded-full bg-emerald-300/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">Paid</span>
        </div>
        <div className="mt-2.5 flex items-end justify-between">
          <div>
            <p className="text-sm text-[#dbe4f5]">Sharma Traders, Pune</p>
            <p className="mt-1 text-xs text-[#9fb0d6]">CGST 9% · SGST 9% · e-Invoice IRN generated</p>
          </div>
          <span className="font-display text-2xl font-extrabold">₹48,380</span>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, htmlFor, aside, children }: { label: ReactNode; htmlFor: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-text-secondary">
          {label}
        </label>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "info" | "warn"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "mb-5 flex gap-2.5 rounded-xl border px-4 py-3 text-sm",
        tone === "error" && "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300",
        tone === "info" && "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-950/60 dark:text-brand-200",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
      )}
    >
      <Icon icon={tone === "info" ? Mail01Icon : AlertCircleIcon} size={18} className="mt-px shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** 0–4: length, mixed case, digit, symbol. */
function passwordScore(p: string) {
  let score = 0;
  if (p.length >= 8) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  return score;
}

const STRENGTH = [
  { word: "Too weak", bar: "bg-red-500" },
  { word: "Fair", bar: "bg-amber-500" },
  { word: "Good", bar: "bg-blue-500" },
  { word: "Strong", bar: "bg-emerald-500" },
];

function PasswordStrength({ password }: { password: string }) {
  const score = passwordScore(password);
  const level = STRENGTH[Math.max(0, score - 1)];
  return (
    <div className="mt-1">
      <div aria-hidden="true" className="grid grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn("h-1 rounded-sm", password && i < Math.max(1, score) ? level.bar : "bg-border-light")}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-text-tertiary" aria-live="polite">
        {password
          ? `Password strength: ${level.word}`
          : "Use 8 or more characters with a mix of letters, numbers and symbols."}
      </p>
    </div>
  );
}

const PRIMARY =
  "flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-base font-bold text-white shadow-[0_12px_28px_-12px_rgba(59,94,170,.8)] transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60";

/* ─── The screen ────────────────────────────────────────────────────────── */
export function AuthScreen({ mode, search }: { mode: AuthMode; search: AuthSearch }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  // A partner's referral link (?ref=) is remembered for this visit, so it
  // still applies if the visitor moves between log in and register.
  const [referralCode, setReferralCode] = useState(() => {
    try {
      if (search.ref) sessionStorage.setItem("referralCode", search.ref);
      return search.ref ?? sessionStorage.getItem("referralCode") ?? "";
    } catch {
      return search.ref ?? "";
    }
  });
  // The plan picked on the pricing page (?plan=), remembered for this visit and sent with the sign-up.
  const [signupPlan] = useState<PlanId | undefined>(() => {
    try {
      if (isPlanId(search.plan)) sessionStorage.setItem("signupPlan", search.plan);
      const stored = sessionStorage.getItem("signupPlan");
      return isPlanId(search.plan) ? search.plan : isPlanId(stored) ? stored : undefined;
    } catch {
      return isPlanId(search.plan) ? search.plan : undefined;
    }
  });
  // Fields that failed the last check: red outline + aria-invalid. Messages
  // themselves are goey toasts (no browser bubbles, no banners).
  const [invalid, setInvalid] = useState<ReadonlySet<AuthFieldName>>(new Set());
  const markOk = (field: AuthFieldName) =>
    setInvalid((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  /** Show a problem as a toast; with a field, outline it and put the cursor there. */
  function setError(message: string, field?: AuthFieldName, hint?: string) {
    if (!message) {
      setInvalid(new Set());
      return;
    }
    setInvalid(field ? new Set([field]) : new Set());
    toast.error(message, hint);
    if (field) requestAnimationFrame(() => document.getElementById(FIELD_ID[field])?.focus());
  }

  useEffect(() => {
    document.title = `${mode === "login" ? "Log in" : "Create your account"} — Fintranzact`;
  }, [mode]);

  // No top bar here, so toasts can sit near the top edge.
  useEffect(() => {
    document.documentElement.setAttribute("data-no-topbar", "");
    return () => document.documentElement.removeAttribute("data-no-topbar");
  }, []);

  // Clear outlines when switching between /login and /register.
  useEffect(() => setInvalid(new Set()), [mode]);

  // Messages that arrive with the page (session ended, wrong invite address)
  // show once as toasts.
  useEffect(() => {
    if (sessionStorage.getItem("sessionExpired") === "1") {
      sessionStorage.removeItem("sessionExpired");
      toast.warning("Your session ended", "It expired or you logged out on another device. Please log in again.");
    }
  }, []);
  useEffect(() => {
    if (search.error === "email_mismatch") {
      toast.error("This invitation is for a different email address", "Log in with that address to accept it.");
    }
  }, [search.error]);

  // ── Turnstile (bot protection): open the modal, run the action with the token.
  const [showTurnstile, setShowTurnstile] = useState(false);
  const pendingActionRef = useRef<((token: string | undefined) => void) | null>(null);
  const handleTurnstileVerified = useCallback((token: string) => {
    setShowTurnstile(false);
    pendingActionRef.current?.(token);
    pendingActionRef.current = null;
  }, []);
  // Desktop (Tauri) skips the modal; the API trusts its client header instead.
  function withTurnstile(action: (token: string | undefined) => void) {
    if (isDesktop()) {
      action(undefined);
      return;
    }
    pendingActionRef.current = action;
    setShowTurnstile(true);
  }

  // Set once the account is in, until the next page takes over. A fast second
  // click on "Log in" would otherwise land on whatever the next page shows
  // under the pointer.
  const [signedIn, setSignedIn] = useState(false);
  async function leaveAfterSignIn(to: "/" | "/auth/plan-selection") {
    setSignedIn(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // The app may already have taken them on (an admin to /platform, a
    // partner to their portal) and they may have moved on from there.
    if (!["/login", "/register"].includes(window.location.pathname)) return;
    navigate({ to });
  }

  // Set when the password was right but the account needs a second step.
  const [challenge, setChallenge] = useState<{ token: string } | null>(null);
  // Whether this login offered a remembered-device token (desktop), so a
  // challenge anyway means the token is no longer good.
  const sentTrustedTokenRef = useRef(false);

  /** Same work after any successful sign-in: keychain, session cache, leave. */
  async function finishLogin(data: { sessionToken?: string }) {
    setSignedIn(true);
    // Desktop uses Bearer auth; keep the token in the OS keychain (no-op on web).
    if (isDesktop() && data?.sessionToken) await saveDesktopToken(data.sessionToken);
    utils.auth.me.invalidate();
    await leaveAfterSignIn("/");
  }

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      if (data.twoFactorRequired) {
        // The remembered-device token we sent was not accepted (expired,
        // revoked, or for another account): forget it.
        if (sentTrustedTokenRef.current) await clearTrustedDeviceToken();
        setChallenge({ token: data.challengeToken });
        return;
      }
      await finishLogin(data);
    },
    onError: (e) => setError(e.message),
  });

  async function handleVerified(data: VerifyResult, rememberDevice: boolean) {
    if (isDesktop() && rememberDevice && data.trustedDeviceToken) {
      await saveTrustedDeviceToken(data.trustedDeviceToken);
    }
    await finishLogin(data);
  }

  /** Back to the password step; the password is cleared, the email kept. */
  function leaveSecondStep(message?: string) {
    setChallenge(null);
    setPassword("");
    setInvalid(new Set());
    if (message) toast.error(message);
    requestAnimationFrame(() => document.getElementById(FIELD_ID.password)?.focus());
  }

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (data) => {
      if (isDesktop() && data?.sessionToken) await saveDesktopToken(data.sessionToken);
      setSignedIn(true);
      await utils.auth.me.invalidate();
      await leaveAfterSignIn("/auth/plan-selection");
    },
    onError: (e) => setError(e.message),
  });

  const isPending = loginMutation.isPending || registerMutation.isPending || signedIn;

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (isPending) return;
    if (!email.trim()) return setError("Enter your email address", "email");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address", "email", "Example: name@business.in");
    if (!password) return setError("Enter your password", "password");
    setInvalid(new Set());
    // Desktop: offer the remembered-device token from the keychain (no-op on web,
    // where the HttpOnly cookie travels by itself).
    const trustedDeviceToken = isDesktop() ? ((await getTrustedDeviceToken()) ?? undefined) : undefined;
    sentTrustedTokenRef.current = !!trustedDeviceToken;
    loginMutation.mutate({ email: email.trim(), password, ...(trustedDeviceToken ? { trustedDeviceToken } : {}) });
  }

  function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return setError("Enter a username", "username");
    if (!email.trim()) return setError("Enter your email address", "email");
    if (!EMAIL_RE.test(email.trim())) return setError("Enter a valid email address", "email", "Example: name@business.in");
    if (password.length < 8) return setError("Use at least 8 characters for your password", "password");
    if (password !== confirmPassword) return setError("Passwords don't match", "confirm", "Type the same password in both boxes.");
    setInvalid(new Set());
    withTurnstile((token) =>
      registerMutation.mutate({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        referralCode: referralCode.trim() || undefined,
        plan: signupPlan,
        turnstileToken: token,
      }),
    );
  }

  const tab = (to: "/login" | "/register", label: string, active: boolean) => (
    <Link
      to={to}
      search={search}
      role="tab"
      aria-selected={active}
      className={cn(
        "grid h-[42px] flex-1 place-items-center rounded-[9px] text-sm font-semibold transition",
        active
          ? "bg-brand-600 text-white shadow-[0_4px_10px_-4px_rgba(59,94,170,.6)]"
          : "text-text-tertiary hover:text-text-primary",
      )}
    >
      {label}
    </Link>
  );

  return (
    <>
      <div className="flex min-h-screen bg-surface-0">
        <BrandPanel mode={mode} />

        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
          <div className={cn("w-full", mode === "login" ? "max-w-[420px]" : "max-w-[440px]")}>
            {/* Logo for small screens, where the brand panel is hidden */}
            <Link to="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
              <Logo className="h-9 w-9" />
              <span className="font-display text-xl font-extrabold text-[#0f1b3d] dark:text-white">Fintranzact</span>
            </Link>

            {mode === "login" && challenge ? (
              <TwoFactorStep
                challengeToken={challenge.token}
                onVerified={handleVerified}
                onBack={() => leaveSecondStep()}
                onExpired={(message) => leaveSecondStep(message)}
                disabled={signedIn}
              />
            ) : (
              <>
              <div role="tablist" aria-label="Account" className="flex rounded-xl border border-border-light bg-surface-1 p-1">
                {tab("/register", "Register", mode === "register")}
                {tab("/login", "Log in", mode === "login")}
              </div>

              <h1 className="mt-7 font-display text-[30px] font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white">
                {mode === "login" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="mt-2 text-[15px] text-text-tertiary">
                {mode === "login" ? "Log in with your email and password." : `${TRIAL_DAYS}-day free trial. No credit card needed.`}
              </p>

              <div className="mt-6">
                {search.invite && !search.error && (
                  <Banner tone="info">
                    {mode === "login"
                      ? "Log in to accept your invitation. New here? Register with the email address the invite was sent to."
                      : "Create your account with the email address the invite was sent to, then accept the invitation."}
                  </Banner>
                )}
                {search.ref && mode === "register" && (
                  <Banner tone="info">
                    Referral code <strong>{search.ref.toUpperCase()}</strong> will be applied to your new account.
                  </Banner>
                )}
              </div>

              {mode === "login" ? (
                <form onSubmit={handleLogin} noValidate className="flex flex-col gap-[18px]">
                  <Field label="Email address" htmlFor="auth-email">
                    <input
                      id="auth-email"
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); markOk("email"); }}
                      aria-invalid={invalid.has("email") || undefined}
                      required
                      autoFocus
                      autoComplete="email"
                      className="input h-[46px]"
                      placeholder="you@yourcompany.com"
                    />
                  </Field>
                  <Field
                    label="Password"
                    htmlFor="auth-password"
                  >
                    <PasswordInput
                      id="auth-password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); markOk("password"); }}
                      aria-invalid={invalid.has("password") || undefined}
                      required
                      minLength={8}
                      autoComplete="current-password"
                      className="input h-[46px]"
                      placeholder="Enter password"
                    />
                  </Field>
                  <button type="submit" disabled={isPending} className={cn(PRIMARY, "mt-1.5")}>
                    {loginMutation.isPending || signedIn ? "Logging in…" : "Log in"}
                  </button>
                  <p className="mt-2 text-center text-sm text-text-tertiary">
                    New to Fintranzact?{" "}
                    <Link to="/register" search={search} className="font-bold text-brand-700 hover:underline dark:text-brand-300">
                      Start your free trial
                    </Link>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleRegister} noValidate className="flex flex-col gap-3.5">
                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <Field label="Username" htmlFor="auth-username">
                      <input
                        id="auth-username"
                        value={username}
                        onChange={(e) => { setUsername(e.target.value); markOk("username"); }}
                        aria-invalid={invalid.has("username") || undefined}
                        required
                        autoFocus
                        autoComplete="username"
                        className="input h-[46px]"
                        placeholder="Enter username"
                      />
                    </Field>
                    <Field
                      label={
                        <>
                          Referral code <span className="text-text-tertiary">(optional)</span>
                        </>
                      }
                      htmlFor="auth-referral"
                    >
                      <input
                        id="auth-referral"
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value)}
                        className="input h-[46px]"
                        placeholder="Optional"
                      />
                    </Field>
                  </div>
                  <Field label="Email address" htmlFor="auth-email">
                    <input
                      id="auth-email"
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); markOk("email"); }}
                      aria-invalid={invalid.has("email") || undefined}
                      required
                      autoComplete="email"
                      className="input h-[46px]"
                      placeholder="you@yourcompany.com"
                    />
                  </Field>
                  <Field label="Password" htmlFor="auth-password">
                    <PasswordInput
                      id="auth-password"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); markOk("password"); }}
                      aria-invalid={invalid.has("password") || undefined}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="input h-[46px]"
                      placeholder="Min 8 characters"
                    />
                    <PasswordStrength password={password} />
                  </Field>
                  <Field label="Retype password" htmlFor="auth-password-2">
                    <PasswordInput
                      id="auth-password-2"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); markOk("confirm"); }}
                      aria-invalid={invalid.has("confirm") || undefined}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      className="input h-[46px]"
                      placeholder="Retype password"
                    />
                  </Field>
                  <button type="submit" disabled={isPending} className={cn(PRIMARY, "mt-1.5")}>
                    {registerMutation.isPending || signedIn ? "Creating your account…" : "Start free trial"}
                  </button>
                  <p className="text-center text-xs leading-relaxed text-text-tertiary">
                    By creating an account you agree to our{" "}
                    <Link to="/terms" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      Terms
                    </Link>{" "}
                    and{" "}
                    <Link to="/privacy" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
                      Privacy policy
                    </Link>
                    .
                  </p>
                  <p className="mt-1 text-center text-sm text-text-tertiary">
                    Already have an account?{" "}
                    <Link to="/login" search={search} className="font-bold text-brand-700 hover:underline dark:text-brand-300">
                      Log in
                    </Link>
                  </p>
                </form>
              )}
              </>
            )}

            <p className="mt-10 flex items-center justify-center gap-2 text-xs text-text-tertiary">
              <Icon icon={Shield01Icon} size={15} />
              Protected by bot checks and encrypted sign-in
            </p>
          </div>
        </main>
      </div>

      <TurnstileModal
        open={showTurnstile}
        onVerified={handleTurnstileVerified}
        onClose={() => {
          setShowTurnstile(false);
          pendingActionRef.current = null;
        }}
      />
    </>
  );
}
