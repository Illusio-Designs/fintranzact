import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { TurnstileModal } from "@/components/ui/TurnstileModal";
import { isDesktop } from "@/lib/isDesktop";
import { saveDesktopToken } from "@/lib/desktop-session";

/* ─── Turnstile type (declared in TurnstileModal) ──────────────────────── */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          size: "normal" | "flexible" | "compact";
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type AuthMode = "register" | "login";

/* ─── Pure-CSS animation keyframes injected once ─────────────────────────── */
const KEYFRAMES = `
@keyframes mesh-drift-1 {
  0%   { transform: translate(0%, 0%) scale(1); }
  33%  { transform: translate(4%, -3%) scale(1.06); }
  66%  { transform: translate(-3%, 5%) scale(0.97); }
  100% { transform: translate(0%, 0%) scale(1); }
}
@keyframes mesh-drift-2 {
  0%   { transform: translate(0%, 0%) scale(1.05); }
  40%  { transform: translate(-5%, 4%) scale(0.98); }
  70%  { transform: translate(4%, -2%) scale(1.08); }
  100% { transform: translate(0%, 0%) scale(1.05); }
}
@keyframes mesh-drift-3 {
  0%   { transform: translate(0%, 0%) scale(0.95); }
  50%  { transform: translate(6%, 3%) scale(1.02); }
  100% { transform: translate(0%, 0%) scale(0.95); }
}
@keyframes grid-pulse {
  0%, 100% { opacity: 0.06; }
  50%       { opacity: 0.12; }
}
@keyframes float-card-1 {
  0%, 100% { transform: translateY(0px) rotate(-1deg); }
  50%       { transform: translateY(-10px) rotate(-1deg); }
}
@keyframes float-card-2 {
  0%, 100% { transform: translateY(0px) rotate(1.5deg); }
  50%       { transform: translateY(-7px) rotate(1.5deg); }
}
@keyframes float-card-3 {
  0%, 100% { transform: translateY(0px) rotate(-0.5deg); }
  50%       { transform: translateY(-13px) rotate(-0.5deg); }
}
@keyframes shimmer-bar {
  0%   { width: 20%; opacity: 1; }
  50%  { width: 75%; opacity: 0.6; }
  100% { width: 20%; opacity: 1; }
}
@keyframes dot-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-4px); opacity: 1; }
}
@keyframes form-enter {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes checkmark-draw {
  from { stroke-dashoffset: 60; }
  to   { stroke-dashoffset: 0; }
}
@keyframes ring-expand {
  0%   { transform: scale(0.7); opacity: 0; }
  60%  { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes envelope-rise {
  0%   { transform: translateY(16px) scale(0.85); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}
@keyframes tagline-reveal {
  from { opacity: 0; letter-spacing: 0.35em; }
  to   { opacity: 1; letter-spacing: 0.2em; }
}
`;

/* ─── Floating invoice card mock-ups for the left panel ──────────────────── */
function InvoiceCardMock({
  style,
  animName,
  amount,
  label,
  paid,
}: {
  style: React.CSSProperties;
  animName: string;
  amount: string;
  label: string;
  paid: boolean;
}) {
  return (
    <div
      className="absolute rounded-2xl border border-white/10 backdrop-blur-sm"
      style={{
        background: "rgba(255,255,255,0.07)",
        padding: "14px 18px",
        minWidth: 180,
        animation: `${animName} 5s ease-in-out infinite`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.1)",
        ...style,
      }}
    >
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", marginBottom: 6, fontFamily: "DM Sans, sans-serif", textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "#fff", fontFamily: "DM Sans, sans-serif", letterSpacing: "-0.02em" }}>
        {amount}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          background: paid ? "rgba(43,138,62,0.25)" : "rgba(251,191,36,0.2)",
          border: `1px solid ${paid ? "rgba(43,138,62,0.4)" : "rgba(251,191,36,0.35)"}`,
          borderRadius: 6,
          padding: "2px 8px",
          fontSize: 10,
          color: paid ? "#6ee7a0" : "#fcd34d",
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: paid ? "#6ee7a0" : "#fcd34d",
            display: "inline-block",
          }}
        />
        {paid ? "PAID" : "PENDING"}
      </div>
    </div>
  );
}

/* ─── Left branding panel ─────────────────────────────────────────────────── */
function BrandPanel() {
  return (
    <div
      className="hidden lg:flex flex-col relative overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #24245e 0%, #363690 30%, #5b5bd6 65%, #4343a8 100%)",
        minHeight: "100vh",
        flex: "0 0 52%",
      }}
    >
      {/* Animated mesh blobs */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 0 }}
      >
        {/* Blob 1 — amber warm glow */}
        <div
          style={{
            position: "absolute",
            top: "-10%",
            left: "-5%",
            width: "65%",
            height: "65%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(251,191,36,0.22) 0%, transparent 70%)",
            animation: "mesh-drift-1 18s ease-in-out infinite",
            filter: "blur(40px)",
          }}
        />
        {/* Blob 2 — brand lighter */}
        <div
          style={{
            position: "absolute",
            bottom: "5%",
            right: "-10%",
            width: "70%",
            height: "70%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(91,91,214,0.45) 0%, transparent 65%)",
            animation: "mesh-drift-2 22s ease-in-out infinite",
            filter: "blur(60px)",
          }}
        />
        {/* Blob 3 — deep accent */}
        <div
          style={{
            position: "absolute",
            top: "40%",
            left: "20%",
            width: "55%",
            height: "55%",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(177,177,240,0.14) 0%, transparent 70%)",
            animation: "mesh-drift-3 26s ease-in-out infinite",
            filter: "blur(50px)",
          }}
        />

        {/* Subtle grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            animation: "grid-pulse 8s ease-in-out infinite",
          }}
        />

        {/* Diagonal lines top-right corner detail */}
        <svg
          style={{ position: "absolute", top: 0, right: 0, width: 200, height: 200, opacity: 0.08 }}
          viewBox="0 0 200 200"
          fill="none"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <line
              key={i}
              x1={200 - i * 18}
              y1={0}
              x2={200}
              y2={i * 18}
              stroke="white"
              strokeWidth="1"
            />
          ))}
        </svg>
      </div>

      {/* Content layer */}
      <div className="relative flex flex-col justify-between h-full p-12" style={{ zIndex: 1 }}>
        {/* Top: logo lockup */}
        <div>
          <div className="flex items-center gap-3 mb-16">
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "rgba(255,255,255,0.15)",
                border: "1px solid rgba(255,255,255,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(8px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.25)",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="2" width="8" height="8" rx="2" fill="white" opacity="0.9" />
                <rect x="12" y="2" width="8" height="8" rx="2" fill="white" opacity="0.6" />
                <rect x="2" y="12" width="8" height="8" rx="2" fill="white" opacity="0.6" />
                <rect x="12" y="12" width="8" height="8" rx="2" fill="#fbbf24" opacity="0.9" />
              </svg>
            </div>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#ffffff",
                fontFamily: "DM Sans, sans-serif",
                letterSpacing: "-0.03em",
              }}
            >
              Hisaabo
            </span>
          </div>

          {/* Hero copy */}
          <div>
            <h2
              style={{
                fontSize: 40,
                fontWeight: 800,
                lineHeight: 1.12,
                color: "#ffffff",
                fontFamily: "DM Sans, sans-serif",
                letterSpacing: "-0.04em",
                marginBottom: 16,
              }}
            >
              Your business,
              <br />
              your books.
              <br />
              <span style={{ color: "#fbbf24" }}>Always clear.</span>
            </h2>
            <p
              style={{
                fontSize: 15,
                color: "rgba(255,255,255,0.65)",
                fontFamily: "DM Sans, sans-serif",
                lineHeight: 1.65,
                maxWidth: 320,
              }}
            >
              GST-compliant invoicing, party ledgers, and payment tracking — built for Indian businesses that mean business.
            </p>
          </div>
        </div>

        {/* Middle: floating invoice cards */}
        <div
          style={{
            position: "relative",
            height: 260,
            flex: "0 0 260px",
          }}
        >
          <InvoiceCardMock
            style={{ top: "5%", left: "2%" }}
            animName="float-card-1"
            amount="&#8377;1,24,500"
            label="Invoice #INV-0042"
            paid={true}
          />
          <InvoiceCardMock
            style={{ top: "38%", left: "28%" }}
            animName="float-card-2"
            amount="&#8377;38,200"
            label="Invoice #INV-0041"
            paid={false}
          />
          <InvoiceCardMock
            style={{ top: "12%", right: "2%" }}
            animName="float-card-3"
            amount="&#8377;7,650"
            label="Invoice #INV-0040"
            paid={true}
          />
        </div>

        {/* Bottom: tagline + trust dots */}
        <div>
          <p
            style={{
              fontSize: 11,
              fontFamily: "JetBrains Mono, monospace",
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              marginBottom: 20,
              animation: "tagline-reveal 1.2s ease-out forwards",
            }}
          >
            Hisaab, pakka.
          </p>

          <div style={{ display: "flex", gap: 20 }}>
            {[
              { n: "GST Ready", icon: "✓" },
              { n: "100% Free", icon: "✓" },
              { n: "Open Source", icon: "✓" },
            ].map(({ n, icon }) => (
              <div
                key={n}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.6)",
                  fontFamily: "DM Sans, sans-serif",
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(251,191,36,0.2)",
                    border: "1px solid rgba(251,191,36,0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9,
                    color: "#fbbf24",
                    flexShrink: 0,
                  }}
                >
                  {icon}
                </span>
                {n}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Small brand strip shown on mobile (replaces full panel) ─────────────── */
function MobileBrandStrip() {
  return (
    <div
      className="lg:hidden flex items-center gap-3 px-6 py-5"
      style={{
        background: "linear-gradient(135deg, #24245e, #5b5bd6)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 22 22" fill="none">
          <rect x="2" y="2" width="8" height="8" rx="2" fill="white" opacity="0.9" />
          <rect x="12" y="2" width="8" height="8" rx="2" fill="white" opacity="0.6" />
          <rect x="2" y="12" width="8" height="8" rx="2" fill="white" opacity="0.6" />
          <rect x="12" y="12" width="8" height="8" rx="2" fill="#fbbf24" opacity="0.9" />
        </svg>
      </div>
      <div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: "#fff",
            fontFamily: "DM Sans, sans-serif",
            letterSpacing: "-0.03em",
          }}
        >
          Hisaabo
        </div>
        <div
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.5)",
            fontFamily: "JetBrains Mono, monospace",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          Hisaab, pakka.
        </div>
      </div>
    </div>
  );
}

/* ─── Spinner dots ────────────────────────────────────────────────────────── */
function LoadingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 8 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "currentColor",
            display: "inline-block",
            animation: `dot-bounce 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
    </span>
  );
}

/* ─── Field wrapper ───────────────────────────────────────────────────────── */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────────── */
function LoginPage() {
  const [mode, setMode] = useState<AuthMode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // Show session-expired banner if redirected from a revoked session
  const [sessionExpired] = useState(() => {
    const expired = sessionStorage.getItem("sessionExpired") === "1";
    if (expired) sessionStorage.removeItem("sessionExpired");
    return expired;
  });

  // ── Turnstile modal (bot protection) ──────────────────────────
  // Form handlers save a pending action and open the modal.
  // On Turnstile success, the pending action fires with the token.
  const [showTurnstile, setShowTurnstile] = useState(false);
  const pendingActionRef = useRef<((token: string | undefined) => void) | null>(null);

  const handleTurnstileVerified = useCallback((token: string) => {
    setShowTurnstile(false);
    if (pendingActionRef.current) {
      pendingActionRef.current(token);
      pendingActionRef.current = null;
    }
  }, []);

  /**
   * Wraps a form submission: opens the Turnstile modal, then fires the action with the token.
   * On desktop (Tauri), skips the modal and fires immediately with no token — the API has
   * a matching carve-out that trusts the `x-hisaabo-client: desktop` header.
   */
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
      // Desktop uses Bearer auth (cookies can't span tauri.localhost ↔ api.hisaabo.in).
      // The server returns sessionToken in the response body in addition to
      // setting the cookie; we persist it into the OS keychain for reuse.
      // saveDesktopToken is a no-op on web, where the HttpOnly cookie is
      // already in the browser's jar.
      if (isDesktop() && data?.sessionToken) {
        await saveDesktopToken(data.sessionToken);
      }
      utils.auth.me.invalidate();
      navigate({ to: "/" });
    },
    onError: (e) => setError(e.message),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async (data) => {
      if (isDesktop() && data?.sessionToken) {
        await saveDesktopToken(data.sessionToken);
      }
      await utils.auth.me.invalidate();
      navigate({ to: "/auth/plan-selection" });
    },
    onError: (e) => setError(e.message),
  });

  const magicLinkMutation = trpc.auth.sendMagicLink.useMutation({
    onSuccess: () => {
      setCooldown(60);
      setError("");
    },
    onError: (e) => setError(e.message),
  });

  // Cooldown timer for resend
  useEffect(() => {
    if (cooldown <= 0) {
      clearInterval(cooldownRef.current);
      return;
    }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          clearInterval(cooldownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPending =
    loginMutation.isPending || registerMutation.isPending || magicLinkMutation.isPending;

  function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  }

  function handleRegister(e: React.FormEvent) {
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
    withTurnstile((token) => {
      registerMutation.mutate({
        username: username.trim(),
        email,
        password,
        confirmPassword,
        referralCode: referralCode.trim() || undefined,
        turnstileToken: token,
      });
    });
  }

  function switchMode(next: AuthMode) {
    setMode(next);
    setError("");
  }

  return (
    <>
      {/* Inject keyframes once */}
      <style>{KEYFRAMES}</style>

      <div className="min-h-screen flex lg:flex-row flex-col bg-surface-1">
        {/* ── Left: brand panel (desktop) / strip (mobile) ────────── */}
        <BrandPanel />
        <MobileBrandStrip />

        {/* ── Right: form panel ───────────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center px-6 py-12 lg:py-0 bg-surface-0 lg:bg-surface-0">
          <div className="w-full max-w-[420px]">

            {/* Session expired banner */}
            {sessionExpired && (
              <div className="mb-5 px-4 py-3 rounded-xl text-sm bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300" style={{ animation: "form-enter 0.3s ease-out" }}>
                Your session was ended — either by you from another device, or it expired. Please sign in again.
              </div>
            )}

            <div className="mb-6">
              <div className="inline-flex w-full rounded-xl border border-border-light bg-surface-2 p-1">
                <button
                  type="button"
                  onClick={() => switchMode("register")}
                  className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${mode === "register"
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-text-tertiary hover:text-text-primary"
                    }`}
                >
                  Register
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${mode === "login"
                    ? "bg-brand-600 text-white shadow-sm"
                    : "text-text-tertiary hover:text-text-primary"
                    }`}
                >
                  Login
                </button>
              </div>
            </div>

            {mode === "register" && (
              <div style={{ animation: "form-enter 0.35s ease-out" }}>
                <div className="mb-8">
                  <h1
                    className="text-2xl font-bold text-text-primary mb-2"
                    style={{ letterSpacing: "-0.03em" }}
                  >
                    Create your account
                  </h1>
                  <p className="text-sm text-text-tertiary leading-relaxed">
                    Enter your details below and save your account.
                  </p>
                </div>

                {error && <ErrorBanner message={error} />}

                <form onSubmit={handleRegister} className="space-y-4">
                  <Field label="Username">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                      autoFocus
                      className="input"
                      placeholder="Enter username"
                    />
                  </Field>

                  <Field label="Email address">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="input"
                      placeholder="you@yourcompany.com"
                    />
                  </Field>

                  <Field label="Referral code (optional)">
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                      className="input"
                      placeholder="Optional referral code"
                    />
                  </Field>

                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="input"
                      placeholder="Min 8 characters"
                    />
                  </Field>

                  <Field label="Retype password">
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      className="input"
                      placeholder="Retype password"
                    />
                  </Field>

                  <PrimaryButton type="submit" disabled={isPending} fullWidth>
                    {isPending ? (
                      <>
                        Saving account
                        <LoadingDots />
                      </>
                    ) : (
                      "Save"
                    )}
                  </PrimaryButton>
                </form>
              </div>
            )}

            {mode === "login" && (
              <div style={{ animation: "form-enter 0.35s ease-out" }}>
                <div className="mb-8">
                  <h1
                    className="text-2xl font-bold text-text-primary mb-2"
                    style={{ letterSpacing: "-0.03em" }}
                  >
                    Welcome back
                  </h1>
                  <p className="text-sm text-text-tertiary">
                    Sign in with your email and password.
                  </p>
                </div>

                {error && <ErrorBanner message={error} />}

                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <Field label="Email address">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className="input"
                      placeholder="you@yourcompany.com"
                    />
                  </Field>

                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="input"
                      placeholder="Enter password"
                    />
                  </Field>

                  <PrimaryButton type="submit" disabled={isPending} fullWidth>
                    {isPending ? (
                      <>
                        Logging in
                        <LoadingDots />
                      </>
                    ) : (
                      "Login"
                    )}
                  </PrimaryButton>
                </form>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Turnstile bot protection modal */}
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

/* ─── Small shared UI primitives ─────────────────────────────────────────── */

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-5 px-4 py-3 rounded-xl text-sm flex items-start gap-3"
      style={{
        background: "rgba(220,38,38,0.06)",
        border: "1px solid rgba(220,38,38,0.2)",
        color: "var(--danger)",
        animation: "form-enter 0.25s ease-out",
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, marginTop: 1 }}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      {message}
    </div>
  );
}

function PrimaryButton({
  children,
  type = "button",
  disabled,
  fullWidth,
  onClick,
}: {
  children: React.ReactNode;
  type?: "button" | "submit";
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="btn-primary py-2.5"
      style={{
        width: fullWidth ? "100%" : undefined,
        justifyContent: "center",
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: "-0.01em",
      }}
    >
      {children}
    </button>
  );
}

