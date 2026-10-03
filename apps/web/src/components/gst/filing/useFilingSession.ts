import { useCallback, useEffect, useState } from "react";
import { sessionRemainingMs } from "@fintranzact/shared";
import { getBusinessId } from "@/lib/trpc";

/**
 * The GST portal session the user opened with an OTP (valid 6 hours, kept in the
 * API's memory). The browser remembers only WHEN it was opened and the GST portal
 * username, so the wizard can show the time left and know when to ask again.
 * Never the OTP, never the token. Reads and writes are guarded: storage can be
 * blocked, and the wizard then just asks to sign in again.
 */
const key = () => `fintranzact_gst_portal_session:${getBusinessId() ?? "default"}`;

interface Stored {
  verifiedAt: number | null;
  username: string;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return { verifiedAt: null, username: "" };
    const v = JSON.parse(raw) as Partial<Stored>;
    return {
      verifiedAt: typeof v.verifiedAt === "number" ? v.verifiedAt : null,
      username: typeof v.username === "string" ? v.username.slice(0, 100) : "",
    };
  } catch {
    return { verifiedAt: null, username: "" };
  }
}

function write(s: Stored) {
  try {
    localStorage.setItem(key(), JSON.stringify(s));
  } catch {
    // storage blocked: the session still works for this tab's lifetime
  }
}

export function useFilingSession() {
  const [stored, setStored] = useState<Stored>(read);
  const [now, setNow] = useState(() => Date.now());

  // The clock only needs minute precision; one tick per 30 s keeps the countdown honest.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const markVerified = useCallback((username: string) => {
    const next = { verifiedAt: Date.now(), username };
    write(next);
    setStored(next);
    setNow(Date.now());
  }, []);

  /** The portal said the session is over (or it timed out): ask for a new OTP, keep the username. */
  const clear = useCallback(() => {
    setStored((prev) => {
      const next = { verifiedAt: null, username: prev.username };
      write(next);
      return next;
    });
  }, []);

  const remainingMs = sessionRemainingMs(stored.verifiedAt, now);
  return { username: stored.username, remainingMs, signedIn: remainingMs > 0, markVerified, clear };
}
