import { useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AI_WHATSAPP_URL_PATTERN,
  aiActionResultHref,
  effectiveAiActionStatus,
  type AiCardEditField,
  type AiConfirmationCard,
} from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/Spinner";

/**
 * The confirmation card for an action the assistant PREPARED (review, edit,
 * confirm, cancel). Everything on it was computed by the server from a stored
 * pending action; this component only shows it and calls the person's own
 * procedures (ai.confirmAction, ai.updateAction, ai.cancelAction): nothing is
 * saved until Confirm, and Confirm is a plain button tap, never a message the
 * model can send.
 *
 * States: waiting for the person, confirming, done (with a link to the new
 * record through an allowlisted in-app route), failed (with the reason),
 * expired (also shown the moment its time runs out), cancelled.
 */

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for you",
  confirmed: "Done",
  failed: "Failed",
  expired: "Expired",
  cancelled: "Cancelled",
};

const MAX_TIMEOUT_MS = 2_000_000_000;

export function AiConfirmationCardView({ card: initial, onNavigate }: { card: AiConfirmationCard; onNavigate?: () => void }) {
  const titleId = useId();
  const [card, setCard] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<null | "confirm" | "cancel" | "save">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editError, setEditError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // A second tap while the first is still running does nothing.
  const inFlight = useRef(false);

  const confirm = trpc.ai.confirmAction.useMutation();
  const cancel = trpc.ai.cancelAction.useMutation();
  const update = trpc.ai.updateAction.useMutation();

  useEffect(() => {
    setCard(initial);
  }, [initial]);

  const status = effectiveAiActionStatus(card.status, card.expiresAt, new Date(now));

  // The card flips to "expired" by itself when its time runs out.
  useEffect(() => {
    if (card.status !== "pending") return;
    const wait = new Date(card.expiresAt).getTime() - Date.now();
    if (wait <= 0) {
      setNow(Date.now());
      return;
    }
    const t = setTimeout(() => setNow(Date.now()), Math.min(wait + 50, MAX_TIMEOUT_MS));
    return () => clearTimeout(t);
  }, [card.status, card.expiresAt]);

  // Confirmed but the result has not been recorded yet (another tab, a slow save): check again until it is.
  const polling = status === "confirmed" && !card.result;
  const latest = trpc.ai.action.useQuery({ id: card.actionId }, { enabled: polling, refetchInterval: 2000, retry: 0 });
  useEffect(() => {
    if (latest.data && polling) setCard(latest.data);
  }, [latest.data, polling]);

  const run = async (kind: "confirm" | "cancel", fn: () => Promise<{ card: AiConfirmationCard; message?: string | null }>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(kind);
    setMessage(null);
    setAnnouncement(kind === "confirm" ? "Confirming." : "Cancelling.");
    try {
      const res = await fn();
      setCard(res.card);
      setMessage(res.message ?? null);
      setAnnouncement(
        res.card.status === "confirmed" ? `Done. ${res.card.result?.label ?? ""}`.trim()
        : res.card.status === "cancelled" ? "Cancelled. Nothing was saved."
        : (res.message ?? res.card.error ?? "This did not go through."),
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessage(text);
      setAnnouncement(text);
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const startEdit = () => {
    setDraft(Object.fromEntries(card.edits.map((e) => [e.key, e.value])));
    setEditError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (inFlight.current) return;
    const changes = Object.fromEntries(card.edits.filter((e) => (draft[e.key] ?? e.value) !== e.value).map((e) => [e.key, draft[e.key] ?? ""]));
    if (Object.keys(changes).length === 0) {
      setEditing(false);
      return;
    }
    inFlight.current = true;
    setBusy("save");
    setEditError(null);
    try {
      const next = await update.mutateAsync({ id: card.actionId, edits: changes });
      setCard(next);
      setEditing(false);
      setAnnouncement("Changes saved. The totals are updated.");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save the changes.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const pending = status === "pending";
  const confirming = busy === "confirm";
  const href = card.result ? aiActionResultHref(card.result) : null;
  const external = card.result?.externalUrl && AI_WHATSAPP_URL_PATTERN.test(card.result.externalUrl) ? card.result.externalUrl : null;

  return (
    <section
      aria-labelledby={titleId}
      data-testid="ai-card-confirmation"
      data-status={status}
      className={cn(
        "rounded-xl border bg-surface-0 text-xs",
        pending ? "border-brand-300 dark:border-brand-700" : "border-border-light",
      )}
    >
      <header className="flex items-start justify-between gap-2 px-3 pt-2.5">
        <h3 id={titleId} className="text-sm font-semibold text-text-primary">{card.title}</h3>
        <span
          data-testid="ai-card-status"
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium",
            status === "confirmed" ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200"
            : status === "failed" ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
            : pending ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200"
            : "bg-surface-2 text-text-secondary",
          )}
        >
          {STATUS_LABEL[status]}
        </span>
      </header>

      {card.fields.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 px-3">
          {card.fields.map((f, i) => (
            <div key={i} className="contents">
              <dt className="text-text-tertiary">{f.label}</dt>
              <dd className="break-words text-text-primary">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.table && (
        <div className="mt-2 overflow-x-auto px-3">
          <table className="w-full min-w-[18rem] border-collapse text-left">
            <caption className="sr-only">{card.table.title ?? `${card.title}: lines`}</caption>
            <thead>
              <tr className="border-b border-border-light text-text-tertiary">
                {card.table.columns.map((c, i) => (
                  <th key={i} scope="col" className={cn("py-1 pr-2 font-medium", i > 0 && "text-right")}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.table.rows.map((row, r) => (
                <tr key={r} className="border-b border-border-light last:border-0">
                  {card.table!.columns.map((_, c) => (
                    <td key={c} className={cn("py-1 pr-2 align-top text-text-primary", c > 0 && "text-right tabular-nums")}>{row[c] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {card.totals.length > 0 && (
        <dl className="mt-2 space-y-0.5 border-t border-border-light px-3 pt-2" aria-label="Totals">
          {card.totals.map((t, i) => (
            <div key={i} className={cn("flex justify-between gap-3", t.strong ? "text-sm font-semibold text-text-primary" : "text-text-secondary")}>
              <dt>{t.label}</dt>
              <dd className="tabular-nums">{t.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.message && (
        <div className="mt-2 px-3">
          <p className="text-text-tertiary">Message</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words rounded-lg bg-surface-1 px-2.5 py-2 text-text-primary" data-testid="ai-card-message">{card.message}</p>
        </div>
      )}

      {card.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 px-3" aria-label="Please check">
          {card.warnings.map((w, i) => (
            <li key={i} className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">{w}</li>
          ))}
        </ul>
      )}

      {card.note && pending && !editing && <p className="mt-2 px-3 text-text-tertiary">{card.note}</p>}

      {editing && pending && (
        <form
          className="mt-2 space-y-2 border-t border-border-light px-3 pt-2"
          aria-label={`Edit: ${card.title}`}
          onSubmit={(e) => {
            e.preventDefault();
            void saveEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        >
          {card.edits.map((f) => (
            <EditInput key={f.key} field={f} value={draft[f.key] ?? f.value} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} disabled={busy === "save"} />
          ))}
          {editError && <p role="alert" className="text-red-700 dark:text-red-300">{editError}</p>}
          <div className="flex gap-2 pb-1">
            <button type="submit" className="btn-primary h-9 px-3 text-xs" disabled={busy === "save"}>
              {busy === "save" ? "Saving…" : "Save changes"}
            </button>
            <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => setEditing(false)} disabled={busy === "save"}>
              Discard
            </button>
          </div>
        </form>
      )}

      <div className="px-3 pb-3 pt-2">
        {pending && !editing && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary flex h-9 items-center gap-1.5 px-3 text-xs"
              onClick={() => void run("confirm", () => confirm.mutateAsync({ id: card.actionId }))}
              disabled={busy !== null}
              aria-busy={confirming || undefined}
            >
              {confirming && <Spinner size="xs" />}
              {confirming ? "Confirming…" : "Confirm"}
            </button>
            {card.edits.length > 0 && (
              <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={startEdit} disabled={busy !== null}>Edit</button>
            )}
            <button
              type="button"
              className="btn-secondary h-9 px-3 text-xs"
              onClick={() => void run("cancel", () => cancel.mutateAsync({ id: card.actionId }).then((c) => ({ card: c })))}
              disabled={busy !== null}
            >
              {busy === "cancel" ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        )}

        {!pending && (
          <div data-testid="ai-card-outcome">
            {status === "confirmed" && card.result && (
              <p className="text-text-primary">
                <span className="font-medium">{card.result.label}</span>
                {href && (
                  <>
                    {" · "}
                    <Link to={href.to as never} search={href.search as never} onClick={onNavigate} className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                      Open
                    </Link>
                  </>
                )}
                {external && (
                  <>
                    {" · "}
                    <a href={external} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-600 hover:underline dark:text-brand-400">
                      Open WhatsApp to send it
                    </a>
                  </>
                )}
              </p>
            )}
            {status === "confirmed" && !card.result && (
              <p className="flex items-center gap-1.5 text-text-secondary"><Spinner size="xs" /> Saving…</p>
            )}
            {status === "failed" && (
              <p className="text-red-700 dark:text-red-300">Could not be completed. {card.error ?? message ?? ""} Ask me to prepare it again if you still want it.</p>
            )}
            {status === "expired" && <p className="text-text-secondary">This action expired. Ask me to prepare it again.</p>}
            {status === "cancelled" && <p className="text-text-secondary">Cancelled. Nothing was saved.</p>}
          </div>
        )}

        {message && pending && (
          <p role="alert" data-testid="ai-card-error" className="mt-2 text-red-700 dark:text-red-300">{message}</p>
        )}
        {message && !pending && status !== "confirmed" && !card.error && <p className="mt-1 text-text-secondary">{message}</p>}
      </div>

      <div className="sr-only" role="status" aria-live="polite" data-testid="ai-card-live">{announcement}</div>
    </section>
  );
}

function EditInput({ field, value, onChange, disabled }: { field: AiCardEditField; value: string; onChange: (v: string) => void; disabled: boolean }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-text-tertiary">{field.label}</label>
      {field.input === "select" ? (
        <select id={id} className="input mt-0.5 h-9 w-full text-xs" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="input mt-0.5 h-9 w-full text-xs"
          type={field.input === "date" ? "date" : "text"}
          inputMode={field.input === "number" ? "decimal" : undefined}
          value={value}
          maxLength={field.maxLength}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          autoComplete="off"
        />
      )}
    </div>
  );
}
