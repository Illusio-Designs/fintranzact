import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AI_LANGUAGE_HTML_LANG, AI_MAX_QUESTION_CHARS, AI_SPEECH_LANGUAGE, AI_DEFAULT_USER_PREFS, type AiAnyCard } from "@fintranzact/shared";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { AiRequestError, streamAiAnswer, type AiStreamEvent } from "@/lib/ai-stream";
import { clearAiDraft, closeAiPanel, useAiPanel } from "@/lib/ai-panel";
import { getAiPageContext } from "@/lib/ai-page-context";
import { SPEECH_UNSUPPORTED_HINT, useSpeechInput } from "@/lib/speech-input";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Add01Icon, Cancel01Icon, Clock01Icon, Delete02Icon, Mic01Icon, Settings02Icon, SentIcon, SparklesIcon, StopIcon } from "@hugeicons/core-free-icons";
import { AiCards } from "./AiCards";
import { AiAddonNotice, useAiAccess } from "./AiGate";
import { AiBuyMore } from "./AiBuyMore";
import { AiPreferences } from "./AiPreferences";
import { actionStartersFor, startersFor } from "./starters";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards: AiAnyCard[];
  /** An assistant message still being written. */
  pending?: boolean;
  /** What the assistant is doing right now ("Checking outstanding balances…"). */
  activity?: string | null;
  error?: boolean;
}

type Notice = { kind: "quota" | "not_configured" | "off" | "error"; message: string };

const TOOL_LABELS: Record<string, string> = {
  sales_summary: "sales", profit_and_loss: "profit and loss", outstanding_balances: "outstanding balances", overdue_invoices: "overdue invoices",
  top_customers: "top customers", top_selling_items: "top items", stock_levels: "stock levels", low_stock_reorder: "low stock", batch_expiry: "batch expiry",
  gst_payable: "GST", tax_summary: "tax summary", cash_and_bank: "cash and bank", monthly_comparison: "this month and last", sales_trend: "sales trend",
  expenses_by_category: "expenses", find_invoices: "invoices", get_invoice: "the invoice", find_parties: "parties", find_items: "items", recent_transactions: "recent transactions", search_help: "the help centre",
};

/** What the assistant is doing while a propose tool runs: it only prepares, nothing is saved. */
const PROPOSE_LABELS: Record<string, string> = {
  propose_create_invoice: "Preparing an invoice for you to review…",
  propose_create_quotation: "Preparing a quotation for you to review…",
  propose_record_payment: "Preparing a payment for you to review…",
  propose_create_party: "Preparing a new party for you to review…",
  propose_create_item: "Preparing a new item for you to review…",
  propose_payment_reminder: "Preparing a reminder for you to review…",
};

let counter = 0;
const nextId = () => `m${++counter}`;

/** The streaming chat. Everything the server decides (add-on, switches, quota) is shown, never assumed. */
export function AiAssistantPanel() {
  const { open, draft } = useAiPanel();
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const utils = trpc.useUtils();
  const access = useAiAccess();
  const status = trpc.ai.status.useQuery(undefined, { enabled: open && access.active, staleTime: 15_000, retry: 0 });
  const prefsQuery = trpc.ai.preferences.useQuery(undefined, { enabled: open && access.active, staleTime: 60_000, retry: 0 });
  const prefs = prefsQuery.data ?? AI_DEFAULT_USER_PREFS;
  const language = prefs.language;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<"chat" | "history" | "prefs">("chat");
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  // What screen readers hear: "writing..." while streaming and the finished answer once, never every token.
  const [announcement, setAnnouncement] = useState("");

  const chatAllowed = access.active && status.data?.access === "ok" && status.data.configured;
  // Voice input: the browser's own recognition fills the box; nothing is sent until the person presses Send.
  const speech = useSpeechInput({
    lang: AI_SPEECH_LANGUAGE[language],
    getBase: () => inputRef.current?.value ?? "",
    onText: setInput,
    maxChars: AI_MAX_QUESTION_CHARS,
  });
  const stopSpeech = speech.stop;
  useEffect(() => {
    if (!open) stopSpeech();
  }, [open, stopSpeech]);
  const history = trpc.ai.conversations.useQuery(undefined, { enabled: open && view === "history" && access.active, retry: 0 });
  const deleteConversation = trpc.ai.deleteConversation.useMutation({
    onSuccess: async (_r, vars) => {
      await utils.ai.conversations.invalidate();
      if (vars.id === conversationId) startNewChat();
      setDeleting(null);
    },
    onError: (err) => {
      setDeleting(null);
      setNotice({ kind: "error", message: err.message });
    },
  });

  // Focus handling: into the box on open, back to the opener on close.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      clearTimeout(t);
      opener.current?.focus?.();
    };
  }, [open]);

  // A question handed over by a button (never sent automatically).
  useEffect(() => {
    if (open && draft) {
      setInput(draft);
      clearAiDraft();
      setView("chat");
    }
  }, [open, draft]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages]);

  // Leaving or closing the panel stops anything still being written.
  useEffect(() => () => abortRef.current?.abort(), []);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(undefined);
    setNotice(null);
    setStreaming(false);
    setView("chat");
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streaming) return;
      stopSpeech();
      if (text.length > AI_MAX_QUESTION_CHARS) {
        setNotice({ kind: "error", message: `Please keep the question under ${AI_MAX_QUESTION_CHARS} characters.` });
        return;
      }
      setNotice(null);
      setInput("");
      const userMsg: ChatMessage = { id: nextId(), role: "user", content: text, cards: [] };
      const answerId = nextId();
      setMessages((m) => [...m, userMsg, { id: answerId, role: "assistant", content: "", cards: [], pending: true, activity: "Thinking…" }]);
      setAnnouncement("Fintranzact AI is writing an answer.");
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const patch = (p: Partial<ChatMessage>) => setMessages((m) => m.map((x) => (x.id === answerId ? { ...x, ...p } : x)));

      const onEvent = (ev: AiStreamEvent) => {
        if (ev.event === "meta") setConversationId(ev.data.conversationId);
        else if (ev.event === "tool") {
          if (ev.data.status === "start") patch({ activity: PROPOSE_LABELS[ev.data.name] ?? `Checking ${TOOL_LABELS[ev.data.name] ?? "your books"}…` });
          else patch({ activity: "Thinking…" });
        } else if (ev.event === "text") setMessages((m) => m.map((x) => (x.id === answerId ? { ...x, content: x.content + ev.data.delta, activity: null } : x)));
        else if (ev.event === "done") {
          patch({ content: ev.data.text, cards: ev.data.cards, pending: false, activity: null });
          setConversationId(ev.data.conversationId);
          setAnnouncement(`Fintranzact AI: ${ev.data.text}`);
        } else if (ev.event === "error") {
          if (ev.data.code === "stopped") patch({ pending: false, activity: null });
          else {
            patch({ content: ev.data.message, error: true, pending: false, activity: null, cards: [] });
            setAnnouncement(ev.data.message);
          }
        }
      };

      try {
        // The page the person is on (allowlisted shapes only; the server verifies it before using it).
        await streamAiAnswer({ message: text, conversationId, context: getAiPageContext(), signal: controller.signal, onEvent });
        patch({ pending: false, activity: null });
      } catch (err) {
        if (controller.signal.aborted) {
          patch({ pending: false, activity: null });
        } else if (err instanceof AiRequestError) {
          // Refused before anything was written: take the question back into the box.
          setMessages((m) => m.filter((x) => x.id !== userMsg.id && x.id !== answerId));
          setInput(text);
          const kind: Notice["kind"] = err.code === "quota_exhausted" ? "quota" : err.code === "not_configured" ? "not_configured" : err.code === "switched_off" || err.code === "addon_required" || err.code === "read_only" ? "off" : "error";
          setNotice({ kind, message: err.message });
          if (kind !== "error") void utils.ai.status.invalidate();
        } else {
          patch({ content: "Something went wrong. Please try again.", error: true, pending: false, activity: null });
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        void utils.ai.conversations.invalidate();
        void utils.ai.status.invalidate();
      }
    },
    [streaming, conversationId, utils, stopSpeech],
  );

  const stop = () => abortRef.current?.abort();

  const openConversation = async (id: string) => {
    try {
      const conv = await utils.ai.conversation.fetch({ id });
      setMessages(conv.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, cards: m.cards as AiAnyCard[] })));
      setConversationId(conv.id);
      setNotice(null);
      setView("chat");
    } catch (err) {
      setNotice({ kind: "error", message: err instanceof Error ? err.message : "Could not open that conversation." });
    }
  };

  if (!open) return null;

  const actionStarters = actionStartersFor(chatAllowed ? status.data?.actionKinds : undefined, language);
  const starters = startersFor(language);
  const allowance = status.data?.allowance;
  const remainingLabel = allowance
    ? allowance.exhausted
      ? "No questions left"
      : `${allowance.remaining} question${allowance.remaining === 1 ? "" : "s"} left${allowance.scope === "trial" ? " in your trial" : " this month"}`
    : null;

  return (
    <aside
      ref={panelRef}
      role="complementary"
      aria-labelledby={titleId}
      data-testid="ai-panel"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !deleting) {
          e.stopPropagation();
          // Esc first stops the microphone; a second Esc closes the panel.
          if (speech.listening) speech.stop();
          else closeAiPanel();
        }
      }}
      className="fixed inset-0 z-50 flex flex-col bg-surface-0 md:static md:inset-auto md:z-auto md:h-full md:w-[400px] md:shrink-0 md:border-l md:border-border-light lg:w-[440px]"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border-light px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300" aria-hidden="true">
          <Icon icon={SparklesIcon} size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-sm font-semibold text-text-primary">Ask Fintranzact AI</h2>
          {remainingLabel && <p className="truncate text-2xs text-text-tertiary" data-testid="ai-remaining">{remainingLabel}</p>}
        </div>
        {access.active && (
          <>
            <button type="button" onClick={startNewChat} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-1" aria-label="New chat" title="New chat">
              <Icon icon={Add01Icon} size={16} />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "prefs" ? "chat" : "prefs"))}
              aria-pressed={view === "prefs"}
              className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-1", view === "prefs" && "bg-surface-2")}
              aria-label="Assistant preferences"
              title="Preferences: reply language and tips"
              data-testid="ai-prefs-toggle"
            >
              <Icon icon={Settings02Icon} size={16} />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
              aria-pressed={view === "history"}
              className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-1", view === "history" && "bg-surface-2")}
              aria-label="Past chats"
              title="Past chats"
            >
              <Icon icon={Clock01Icon} size={16} />
            </button>
          </>
        )}
        <button type="button" onClick={closeAiPanel} className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-1" aria-label="Close assistant" title="Close">
          <Icon icon={Cancel01Icon} size={16} />
        </button>
      </header>

      {!access.active ? (
        <div className="flex-1 overflow-y-auto p-4">
          {access.loading ? <Spinner size="sm" /> : <AiAddonNotice />}
        </div>
      ) : status.isLoading ? (
        <div className="flex flex-1 items-center justify-center"><Spinner size="md" /></div>
      ) : status.data && status.data.access !== "ok" ? (
        <div className="flex-1 overflow-y-auto p-4"><OffNotice access={status.data.access} isOwner={status.data.isOwner} /></div>
      ) : status.data && !status.data.configured ? (
        <div className="flex-1 overflow-y-auto p-4">
          <div role="status" data-testid="ai-not-configured" className="rounded-xl border border-border-light bg-surface-1 px-4 py-4 text-sm text-text-secondary">
            <p className="font-semibold text-text-primary">The assistant is not set up yet</p>
            <p className="mt-1">This server has no AI provider key. Please ask your administrator to set it up.</p>
          </div>
        </div>
      ) : view === "prefs" ? (
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">Preferences</h3>
          <AiPreferences prefs={prefs} canEdit={!prefsQuery.isError} />
        </div>
      ) : view === "history" ? (
        <div className="flex-1 overflow-y-auto p-3" data-testid="ai-history">
          {history.isLoading ? (
            <Spinner size="sm" />
          ) : (history.data ?? []).length === 0 ? (
            <p className="px-1 py-2 text-sm text-text-tertiary">No past chats yet.</p>
          ) : (
            <ul className="space-y-1">
              {(history.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-1 rounded-lg hover:bg-surface-1">
                  <button type="button" onClick={() => void openConversation(c.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
                    <span className="block truncate text-sm text-text-primary">{c.title}</span>
                    <span className="block text-2xs text-text-tertiary">{new Date(c.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                  </button>
                  <button type="button" onClick={() => setDeleting({ id: c.id, title: c.title })} className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary hover:bg-surface-2 hover:text-red-600" aria-label={`Delete chat ${c.title}`}>
                    <Icon icon={Delete02Icon} size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="ai-messages">
          {messages.length === 0 ? (
            <div>
              <p className="text-sm text-text-secondary">
                Ask about your sales, dues, stock, expiring batches, GST or cash, or how to do something in Fintranzact. English, Hindi, Gujarati or Hinglish. You can also speak your question.{" "}
                {actionStarters.length > 0
                  ? "I can also prepare invoices, payments and more for you to review: nothing is saved until you tap Confirm."
                  : "I only read your books; I never change them."}
              </p>
              <p className="mt-4 text-xs font-medium text-text-tertiary">Try asking</p>
              <ul className="mt-2 flex flex-wrap gap-2" aria-label="Suggested questions">
                {starters.map((s) => (
                  <li key={s.text}>
                    <button type="button" lang={s.lang} onClick={() => void send(s.text)} className="rounded-full border border-border-light bg-surface-0 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-1">
                      {s.text}
                    </button>
                  </li>
                ))}
              </ul>
              {actionStarters.length > 0 && (
                <>
                  <p className="mt-4 text-xs font-medium text-text-tertiary">Or have me prepare something</p>
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label="Suggested actions" data-testid="ai-action-starters">
                    {actionStarters.map((s) => (
                      <li key={s.text}>
                        <button
                          type="button"
                          lang={s.lang}
                          onClick={() => {
                            setInput(s.fill);
                            setTimeout(() => {
                              const el = inputRef.current;
                              el?.focus();
                              el?.setSelectionRange?.(s.fill.length, s.fill.length);
                            }, 0);
                          }}
                          className="rounded-full border border-dashed border-brand-300 bg-surface-0 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-1"
                        >
                          {s.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <div role="group" aria-label="Conversation" className="space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[92%] rounded-2xl px-3.5 py-2 text-sm",
                      m.role === "user" ? "bg-brand-600 text-white" : m.error ? "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200" : "bg-surface-1 text-text-primary",
                    )}
                    aria-busy={m.pending || undefined}
                    aria-hidden={m.pending && m.content ? true : undefined}
                    data-testid={m.role === "user" ? "ai-user-message" : "ai-assistant-message"}
                  >
                    <span className="sr-only">{m.role === "user" ? "You: " : "Assistant: "}</span>
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                    {m.pending && m.activity && (
                      <p className="flex items-center gap-1.5 text-xs text-text-tertiary" data-testid="ai-activity"><Spinner size="xs" />{m.activity}</p>
                    )}
                    {m.role === "assistant" && <AiCards cards={m.cards} onNavigate={() => window.matchMedia?.("(max-width: 767px)").matches && closeAiPanel()} />}
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}
        </div>
      )}

      <div className="sr-only" role="status" aria-live="polite" data-testid="ai-live">{announcement}</div>

      {notice && (
        <div role="alert" data-testid={`ai-notice-${notice.kind}`} className="mx-3 mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {notice.message}
        </div>
      )}

      {access.active && access.canBuy && (allowance?.exhausted || notice?.kind === "quota") && (
        <AiBuyMore isOwner={!!status.data?.isOwner} onNavigate={() => window.matchMedia?.("(max-width: 767px)").matches && closeAiPanel()} />
      )}

      {access.active && (
        <form
          className="shrink-0 border-t border-border-light p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <div className="flex items-end gap-2">
            <label htmlFor={`${titleId}-q`} className="sr-only">Your question</label>
            <textarea
              id={`${titleId}-q`}
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              maxLength={AI_MAX_QUESTION_CHARS}
              disabled={!chatAllowed && !status.isLoading && status.data !== undefined}
              placeholder={speech.listening ? "Listening…" : "Ask about your business…"}
              lang={AI_LANGUAGE_HTML_LANG[language]}
              className="input min-h-[2.75rem] flex-1 resize-none text-sm"
            />
            {speech.supported && !streaming && (
              <button
                type="button"
                onClick={speech.toggle}
                disabled={!chatAllowed}
                aria-pressed={speech.listening}
                aria-label={speech.listening ? "Stop listening" : "Speak your question"}
                title={speech.listening ? "Stop listening (Esc)" : "Speak your question. Your browser's speech service turns your voice into text; Fintranzact does not receive the audio."}
                data-testid="ai-mic"
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-text-secondary transition-colors",
                  speech.listening ? "animate-pulse border-red-500 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200" : "border-border-light hover:bg-surface-1",
                )}
              >
                <Icon icon={Mic01Icon} size={18} />
              </button>
            )}
            {streaming ? (
              <button type="button" onClick={stop} className="btn-secondary flex h-11 items-center gap-1.5 px-3" aria-label="Stop writing">
                <Icon icon={StopIcon} size={16} />
                <span className="hidden sm:inline">Stop</span>
              </button>
            ) : (
              <button type="submit" disabled={!input.trim() || !chatAllowed} className="btn-primary flex h-11 items-center gap-1.5 px-3" aria-label="Send question">
                <Icon icon={SentIcon} size={16} />
                <span className="hidden sm:inline">Send</span>
              </button>
            )}
          </div>
          {(speech.listening || speech.status) && (
            <p
              role={speech.isError ? "alert" : "status"}
              data-testid="ai-voice-status"
              className={cn("mt-1.5 text-xs", speech.isError ? "text-red-700 dark:text-red-300" : "text-text-secondary")}
            >
              {speech.status}
            </p>
          )}
          {!speech.supported && <p className="mt-1.5 text-2xs text-text-tertiary" data-testid="ai-voice-unsupported">{SPEECH_UNSUPPORTED_HINT}</p>}
          <p className="mt-1.5 text-2xs text-text-tertiary">Answers come from your books and may be wrong. Check important figures, and ask your CA before tax decisions.</p>
        </form>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this chat?"
        description={deleting ? `"${deleting.title}" will be removed from your chat history. Other people's chats are not affected.` : undefined}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteConversation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteConversation.mutate({ id: deleting.id })}
      />
    </aside>
  );
}

function OffNotice({ access, isOwner }: { access: string; isOwner: boolean }) {
  const text =
    access === "org_disabled"
      ? "The AI assistant is switched off for your organisation."
      : access === "role_disabled"
        ? "The AI assistant is switched off for your role."
        : access === "read_only"
          ? "Your account is read-only, so the AI assistant is paused."
          : access === "suspended"
            ? "This organisation is suspended."
            : "The AI assistant is not available right now.";
  return (
    <div role="status" data-testid="ai-off-notice" className="rounded-xl border border-border-light bg-surface-1 px-4 py-4 text-sm text-text-secondary">
      <p className="font-semibold text-text-primary">{text}</p>
      {(access === "org_disabled" || access === "role_disabled") && (
        <p className="mt-1">{isOwner ? "You can switch it on again in Settings, under Team." : "Ask your owner to switch it on in Settings."}</p>
      )}
    </div>
  );
}
