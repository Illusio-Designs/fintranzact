import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { AlertCircleIcon, CheckmarkCircle02Icon, Mail01Icon, Shield01Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { isDesktop } from "@/lib/isDesktop";
import { saveDesktopToken } from "@/lib/desktop-session";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { TurnstileModal } from "@/components/ui/TurnstileModal";
import { cn } from "@/lib/utils";

export type AuthMode = "login" | "register";

/** Search params shared by /login and /register (the invite flow sets them). */
export type AuthSearch = { invite?: string; error?: string };

export function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
  return {
    ...(typeof search.invite === "string" ? { invite: search.invite } : {}),
    ...(typeof search.error === "string" ? { error: search.error } : {}),
  };
}

const PANEL: Record<AuthMode, { title: string; accent: string; points: string[] }> = {
  login: {
    title: "Your business, your books.",
    accent: "Always clear.",
    points: ["Unlimited GST invoices, free forever", "e-Invoicing, e-Way Bills and GSTR returns", "Works on web, desktop and mobile"],
  },
  register: {
    title: "Start billing in minutes.",
    accent: "Free forever.",
    points: ["Unlimited invoices, parties and team members", "GST, e-Invoicing and e-Way Bills built in", "No branding on your documents"],
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
  const [referralCode, setReferralCode] = useState("");
  const [error, setError] = useState("");
  const [linkSentTo, setLinkSentTo] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    document.title = `${mode === "login" ? "Log in" : "Create your account"} — Fintranzact`;
  }, [mode]);

  // Clear errors when switching between /login and /register.
  useEffect(() => setError(""), [mode]);

  // Set when the app sends someone here after their session ended.
  const [sessionExpired] = useState(() => {
    const expired = sessionStorage.getItem("sessionExpired") === "1";
    if (expired) sessionStorage.removeItem("sessionExpired");
    return expired;
  });

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

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async (data) => {
      // Desktop uses Bearer auth; keep the token in the OS keychain (no-op on web).
      if (isDesktop() && data?.sessionToken) await saveDesktopToken(data.sessionToken);
      utils.auth.me.invalidate();
      navigate({ to: "/" });
    },
    onError: (e) => setError(e.message),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (data) => {
      if (isDesktop() && data?.sessionToken) await saveDesktopToken(data.sessionToken);
      await utils.auth.me.invalidate();
      navigate({ to: "/auth/plan-selection" });
    },
    onError: (e) => setError(e.message),
  });

  const magicLinkMutation = trpc.auth.sendMagicLink.useMutation({
    onSuccess: (_data, variables) => {
      setLinkSentTo(variables.email);
      setCooldown(60);
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const isPending = loginMutation.isPending || registerMutation.isPending || magicLinkMutation.isPending;

  function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  }

  function sendSignInLink() {
    setError("");
    if (!email.trim()) {
      setError("Enter your email address first, then we'll send you a sign-in link.");
      return;
    }
    withTurnstile((token) => magicLinkMutation.mutate({ email: email.trim(), turnstileToken: token, source: isDesktop() ? "desktop" : "web" }));
  }

  function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim()) {
      setError("Username is required");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    withTurnstile((token) =>
      registerMutation.mutate({
        username: username.trim(),
        email,
        password,
        confirmPassword,
        referralCode: referralCode.trim() || undefined,
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

            <div role="tablist" aria-label="Account" className="flex rounded-xl border border-border-light bg-surface-1 p-1">
              {tab("/register", "Register", mode === "register")}
              {tab("/login", "Log in", mode === "login")}
            </div>

            <h1 className="mt-7 font-display text-[30px] font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-2 text-[15px] text-text-tertiary">
              {mode === "login" ? "Log in with your email and password." : "Free forever. No credit card needed."}
            </p>

            <div className="mt-6">
              {sessionExpired && (
                <Banner tone="warn">
                  Your session ended, either from another device or because it expired. Please log in again.
                </Banner>
              )}
              {search.invite && !search.error && (
                <Banner tone="info">
                  {mode === "login"
                    ? "Log in to accept your invitation. New here? Register with the email address the invite was sent to."
                    : "Create your account with the email address the invite was sent to, then accept the invitation."}
                </Banner>
              )}
              {search.error === "email_mismatch" && (
                <Banner tone="error">
                  This invitation was sent to a different email address. Log in with that address to accept it.
                </Banner>
              )}
              {error && <Banner tone="error">{error}</Banner>}
              {linkSentTo && mode === "login" && (
                <Banner tone="info">
                  We sent a sign-in link to <strong>{linkSentTo}</strong>. Open it on this device to log in.
                </Banner>
              )}
            </div>

            {mode === "login" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-[18px]">
                <Field label="Email address" htmlFor="auth-email">
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                  aside={
                    <button
                      type="button"
                      onClick={sendSignInLink}
                      disabled={isPending || cooldown > 0}
                      className="text-[13px] font-semibold text-brand-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-300"
                    >
                      {cooldown > 0 ? `Resend link in ${cooldown}s` : "Email me a sign-in link"}
                    </button>
                  }
                >
                  <PasswordInput
                    id="auth-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="current-password"
                    className="input h-[46px]"
                    placeholder="Enter password"
                  />
                </Field>
                <button type="submit" disabled={isPending} className={cn(PRIMARY, "mt-1.5")}>
                  {loginMutation.isPending ? "Logging in…" : "Log in"}
                </button>
                <p className="mt-2 text-center text-sm text-text-tertiary">
                  New to Fintranzact?{" "}
                  <Link to="/register" search={search} className="font-bold text-brand-700 hover:underline dark:text-brand-300">
                    Create a free account
                  </Link>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-3.5">
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="Username" htmlFor="auth-username">
                    <input
                      id="auth-username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
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
                    onChange={(e) => setEmail(e.target.value)}
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
                    onChange={(e) => setPassword(e.target.value)}
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
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="input h-[46px]"
                    placeholder="Retype password"
                  />
                </Field>
                <button type="submit" disabled={isPending} className={cn(PRIMARY, "mt-1.5")}>
                  {registerMutation.isPending ? "Creating your account…" : "Create free account"}
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
