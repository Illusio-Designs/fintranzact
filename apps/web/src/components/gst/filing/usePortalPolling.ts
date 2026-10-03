import { useCallback, useEffect, useRef, useState } from "react";
import { startPortalPolling } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";

export interface PollInput {
  kind: "gstr1" | "gstr3b";
  year: number;
  month: number;
}

/**
 * Client-driven check of the GST Return Status ("Checking with the GST portal...").
 * One check every 12 s at the earliest (the server enforces the same and answers "wait"
 * if asked sooner), for about 3 minutes; then it stops and offers a retry.
 * `onSettled` runs when the portal has finished (processed or with errors).
 * The loop itself is `startPortalPolling` in @fintranzact/shared (shared with mobile).
 */
export function usePortalPolling(opts: {
  enabled: boolean;
  input: PollInput;
  onSettled: (outcome: "done" | "errors", errors: string[]) => void;
  onSessionLost: () => void;
}) {
  const poll = trpc.gstReturns.pollReturnStatus.useMutation();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const restartNext = useRef(false);
  // Latest callbacks without re-arming the timer on every render.
  const cb = useRef(opts);
  cb.current = opts;
  const mutate = useRef(poll.mutateAsync);
  mutate.current = poll.mutateAsync;

  const { enabled } = opts;
  const { kind, year, month } = opts.input;

  useEffect(() => {
    if (!enabled) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    setTimedOut(false);
    setError(null);
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    const restart = restartNext.current;
    restartNext.current = false;
    const stop = startPortalPolling({
      restart,
      poll: (r) => mutate.current({ kind, year, month, restart: r }),
      onSettled: (outcome, errors) => cb.current.onSettled(outcome, errors),
      onTimeout: () => setTimedOut(true),
      onSessionLost: () => cb.current.onSessionLost(),
      onError: setError,
    });
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [enabled, kind, year, month, round]);

  /** "Check again" after a time-out or a failed check. */
  const retry = useCallback(() => {
    restartNext.current = true;
    setRound((n) => n + 1);
  }, []);

  return { elapsedMs, timedOut, error, retry, checking: enabled && !timedOut && !error };
}
