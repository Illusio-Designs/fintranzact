import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { Cancel01Icon, CheckmarkCircle02Icon, Loading03Icon } from "@hugeicons/core-free-icons";

/**
 * Landing page for the link emailed by `auth.requestEmailChange`
 * (/auth/verify-email-change?token=…). Confirms the new address with
 * `auth.confirmEmailChange`; the account to update is bound to the token on
 * the server, so this page works whether or not the visitor is signed in.
 */
export const Route = createFileRoute("/auth/verify-email-change")({
  component: VerifyEmailChangePage,
});

function VerifyEmailChangePage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: session } = trpc.auth.me.useQuery(undefined, { retry: false });
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<string | null>(null);
  // Read the token once at mount, before the effect strips it from the URL.
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const calledRef = useRef(false);

  const confirmMutation = trpc.auth.confirmEmailChange.useMutation({
    onSuccess: (data) => {
      setNewEmail(data.newEmail);
      utils.auth.me.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Drop the token from the address bar so it can't leak via Referer or be
    // replayed by a reload (it is single-use anyway).
    window.history.replaceState({}, "", "/auth/verify-email-change");

    if (!token) {
      setError("No token found in the link.");
      return;
    }
    confirmMutation.mutate({ token });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const signedIn = Boolean(session?.user);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">Fintranzact</span>
        </div>

        {error ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
              <Icon icon={Cancel01Icon} size={24} className="text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-2">Link expired or invalid</h1>
            <p className="text-sm text-text-tertiary mb-2">{error}</p>
            <p className="text-sm text-text-tertiary mb-6">
              Email change links work once and expire after 15 minutes. Request a new one from your account settings.
            </p>
            <button
              onClick={() => navigate({ to: signedIn ? "/settings" : "/login" })}
              className="btn-primary w-full py-2.5"
            >
              {signedIn ? "Go to settings" : "Back to sign in"}
            </button>
          </>
        ) : newEmail ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
              <Icon icon={CheckmarkCircle02Icon} size={24} className="text-green-600 dark:text-green-400" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-2">Email address updated</h1>
            <p className="text-sm text-text-tertiary mb-6">
              Your account now uses <span className="font-medium text-text-primary break-all">{newEmail}</span>. Use it
              the next time you sign in.
            </p>
            <button
              onClick={() => navigate({ to: signedIn ? "/" : "/login" })}
              className="btn-primary w-full py-2.5"
            >
              {signedIn ? "Continue to Fintranzact" : "Sign in"}
            </button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <Icon icon={Loading03Icon} size={24} className="text-brand-600 animate-spin" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">Confirming your new email...</h1>
            <p className="text-sm text-text-tertiary">Just a moment</p>
          </>
        )}
      </div>
    </div>
  );
}
