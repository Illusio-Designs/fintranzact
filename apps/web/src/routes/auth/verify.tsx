import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Logo } from "@/components/ui/Logo";
import { Icon } from "@/components/ui/Icon";
import { Cancel01Icon, Loading03Icon } from "@hugeicons/core-free-icons";
import { isDesktop } from "@/lib/isDesktop";
import { saveDesktopToken } from "@/lib/desktop-session";

export const Route = createFileRoute("/auth/verify")({
  component: VerifyPage,
});

function VerifyPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);
  // Capture token + source ONCE from the URL at mount, before the effect
  // strips the query string for Referer safety. Lazy init keeps the values
  // available for the hand-off UI (and its manual retry button) after
  // history.replaceState has cleared window.location.search.
  const [token] = useState(() =>
    new URLSearchParams(window.location.search).get("token")
  );
  const [source] = useState(() =>
    new URLSearchParams(window.location.search).get("source")
  );
  // When the sign-in was initiated from a desktop or mobile client, the
  // verify page hands off to the native app via the `hisaabo://` scheme
  // instead of consuming the token in the browser. Emails ship the HTTPS
  // URL as the clickable CTA because email clients strip custom URL
  // schemes — see the rationale in packages/api/src/routers/auth.ts
  // (sendMagicLink). `handoffMode` drives the "Opening Fintranzact…" UI.
  const [handoffMode, setHandoffMode] = useState<"desktop" | "mobile" | null>(null);
  const calledRef = useRef(false);

  const verifyMutation = trpc.auth.verifyMagicLink.useMutation({
    onSuccess: async (data) => {
      // Desktop uses Bearer auth — persist the session token into the OS
      // keychain so it survives across app restarts. No-op on web.
      if (isDesktop() && data?.sessionToken) {
        await saveDesktopToken(data.sessionToken);
      }
      utils.auth.me.invalidate();
      const pendingToken = sessionStorage.getItem("pendingInviteToken");
      if (data.needsProfile) {
        navigate({
          to: "/auth/complete-profile",
          search: pendingToken ? { invite: "1" } : undefined,
        });
      } else if (pendingToken) {
        navigate({ to: `/invite/${pendingToken}` });
      } else {
        navigate({ to: "/" });
      }
    },
    onError: (e) => setError(e.message),
  });

  useEffect(() => {
    if (calledRef.current) return;
    calledRef.current = true;

    // Strip token AND source from the URL immediately to prevent Referer
    // leakage and to stop a browser reload from re-triggering a spent token.
    window.history.replaceState({}, "", "/auth/verify");

    if (!token) {
      setError("No token found in URL.");
      return;
    }

    // Hand off to the native app when the sign-in originated there. The
    // token is consumed inside the app's own `verifyMagicLink` call — not
    // here in the browser — so the user ends up authenticated inside the
    // Tauri/Expo app, which is what they wanted.
    if (source === "desktop" || source === "mobile") {
      setHandoffMode(source);
      window.location.href = `hisaabo://verify?token=${encodeURIComponent(token)}`;
      return;
    }

    verifyMutation.mutate({ token });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function retryHandoff() {
    if (!token) return;
    window.location.href = `hisaabo://verify?token=${encodeURIComponent(token)}`;
  }

  function verifyInBrowser() {
    if (!token) return;
    setHandoffMode(null);
    verifyMutation.mutate({ token });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-surface-1">
      <div className="w-full max-w-[380px] rounded-2xl p-8 shadow-elevated bg-surface-0 border border-border-light text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <Logo className="w-9 h-9" />
          <span className="font-semibold text-lg tracking-tight text-text-primary">
            Fintranzact
          </span>
        </div>

        {error ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
              <Icon icon={Cancel01Icon} size={24} className="text-red-600 dark:text-red-400" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-2">
              Link expired or invalid
            </h1>
            <p className="text-sm text-text-tertiary mb-6">{error}</p>
            <button
              onClick={() => navigate({ to: "/login" })}
              className="btn-primary w-full py-2.5"
            >
              Back to sign in
            </button>
          </>
        ) : handoffMode ? (
          <>
            <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center">
              <Logo className="w-12 h-12" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">
              Opening Fintranzact{handoffMode === "desktop" ? " Desktop" : ""}…
            </h1>
            <p className="text-sm text-text-tertiary mb-6">
              We&rsquo;re handing your sign-in off to the {handoffMode === "desktop" ? "desktop app" : "mobile app"}. If nothing happens, tap the button below.
            </p>
            <button
              onClick={retryHandoff}
              className="btn-primary w-full py-2.5 mb-3"
            >
              Open Fintranzact {handoffMode === "desktop" ? "Desktop" : "App"}
            </button>
            <button
              onClick={verifyInBrowser}
              className="text-sm text-text-tertiary hover:text-text-primary underline underline-offset-2"
            >
              Sign in here in the browser instead
            </button>
          </>
        ) : (
          <>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-brand-100 dark:bg-brand-600/20 flex items-center justify-center">
              <Icon icon={Loading03Icon} size={24} className="text-brand-600 animate-spin" />
            </div>
            <h1 className="text-lg font-semibold text-text-primary mb-1">
              Verifying your link...
            </h1>
            <p className="text-sm text-text-tertiary">
              Just a moment
            </p>
          </>
        )}
      </div>
    </div>
  );
}
