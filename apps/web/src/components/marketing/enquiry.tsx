import { useCallback, useRef, useState } from "react";
import { Alert02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { Icon } from "@/components/ui/Icon";
import { TurnstileModal } from "@/components/ui/TurnstileModal";

/**
 * Sending the public contact and partner forms: a Turnstile check, then
 * `contact.submit`, which emails the enquiry to our inbox. A mailto link
 * stays available as a fallback on both forms.
 */

type SubmitInput = Parameters<ReturnType<typeof trpc.contact.submit.useMutation>["mutate"]>[0];
/** The form fields for either form (Omit applied to each member of the union). */
export type EnquiryPayload = SubmitInput extends infer T ? (T extends unknown ? Omit<T, "turnstileToken"> : never) : never;

export type EnquiryStatus = "idle" | "verifying" | "sending" | "sent" | "error";

export function useEnquiry() {
  const [status, setStatus] = useState<EnquiryStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<EnquiryPayload | null>(null);

  const mutation = trpc.contact.submit.useMutation({
    onSuccess: () => {
      setStatus("sent");
      setError(null);
    },
    onError: (e) => {
      setStatus("error");
      setError(e.message);
    },
  });

  // react-query keeps mutate stable, so TurnstileModal does not re-mount its widget on every render.
  const { mutate } = mutation;
  const onVerified = useCallback(
    (token: string) => {
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (!payload) return;
      setStatus("sending");
      mutate({ ...payload, turnstileToken: token } as SubmitInput);
    },
    [mutate],
  );

  const onCancel = useCallback(() => {
    pendingRef.current = null;
    setStatus("idle");
  }, []);

  function submit(payload: EnquiryPayload) {
    pendingRef.current = payload;
    setError(null);
    setStatus("verifying");
  }

  function reset() {
    setStatus("idle");
    setError(null);
  }

  const turnstile = <TurnstileModal open={status === "verifying"} onVerified={onVerified} onClose={onCancel} />;

  return { status, error, submit, reset, busy: status === "verifying" || status === "sending", turnstile };
}

/** Error banner with the mailto fallback, shown above the submit button. */
export function EnquiryError({ message, mailto }: { message: string | null; mailto: string }) {
  return (
    <div role="alert" className="mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <Icon icon={Alert02Icon} size={20} className="shrink-0" />
      <p>
        {message || "We couldn't send your message."} You can also{" "}
        <a href={mailto} className="font-semibold underline">
          send it by email
        </a>
        .
      </p>
    </div>
  );
}

/** Replaces the form once the enquiry has been sent. */
export function EnquirySent({
  title,
  body,
  onAgain,
  againLabel,
}: {
  title: string;
  body: string;
  onAgain: () => void;
  againLabel: string;
}) {
  return (
    <div role="status" className="flex flex-col items-start">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-green-100 text-green-600 dark:bg-green-950 dark:text-green-400">
        <Icon icon={CheckmarkCircle02Icon} size={24} />
      </span>
      <h2 className="mt-5 font-display text-2xl font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-text-tertiary">{body}</p>
      <button
        type="button"
        onClick={onAgain}
        className="mt-6 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-300"
      >
        {againLabel}
      </button>
    </div>
  );
}

/** mailto: link with a subject and body filled in. */
export function mailtoLink(to: string, subject: string, body: string) {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Honeypot input: hidden from people and screen readers, so only bots fill it.
 * The API drops any submission where it has a value.
 */
export function HoneypotField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
      <label>
        Website
        <input type="text" tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}
