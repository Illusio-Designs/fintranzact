import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  billing: { current: undefined as unknown },
  aiStatus: { current: undefined as unknown },
  conversations: { current: [] as Array<{ id: string; title: string; updatedAt: string; createdAt: string }> },
  onSale: { current: false },
  stream: vi.fn(),
  invalidate: vi.fn(),
  fetchConversation: vi.fn(),
  deleteMutate: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ ai: { conversations: { invalidate: h.invalidate }, status: { invalidate: h.invalidate }, conversation: { fetch: h.fetchConversation } } }),
    billing: { status: { useQuery: () => ({ data: h.billing.current, isLoading: h.billing.current === undefined }) } },
    ai: {
      status: { useQuery: () => ({ data: h.aiStatus.current, isLoading: h.aiStatus.current === undefined }) },
      conversations: { useQuery: () => ({ data: h.conversations.current, isLoading: false }) },
      deleteConversation: {
        useMutation: (opts: { onSuccess?: (r: unknown, v: unknown) => void } = {}) => ({
          isPending: false,
          mutate: (v: unknown) => { h.deleteMutate(v); opts.onSuccess?.({}, v); },
        }),
      },
    },
  },
}));
vi.mock("@/lib/ai-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-stream")>();
  return { ...actual, streamAiAnswer: (...a: unknown[]) => h.stream(...a) };
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, search, ...rest }: { children: React.ReactNode; to: string; search?: Record<string, string> }) => (
    <a href={search ? `${to}?${new URLSearchParams(search).toString()}` : to} {...rest}>{children}</a>
  ),
}));
vi.mock("@fintranzact/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@fintranzact/shared")>();
  return { ...actual, isAddonAvailable: () => h.onSale.current };
});

import { AiAssistantPanel } from "../AiAssistantPanel";
import { AskAiButton } from "../AskAiButton";
import { openAiPanel, resetAiPanel, useAiPanel } from "@/lib/ai-panel";
import { AiRequestError, type AiStreamEvent } from "@/lib/ai-stream";
import { axe } from "vitest-axe";

const billing = (over: Record<string, unknown> = {}) => ({
  state: "active", readOnly: false, reason: null, canManageBilling: true,
  addons: { ai_assistant: true, ai_plus: false, payroll: false, store_pro: false },
  trial: { active: false, caps: null },
  ...over,
});
const okStatus = (over: Record<string, unknown> = {}) => ({
  configured: true, access: "ok", isOwner: true, tier: "assistant",
  allowance: { scope: "month", limit: 150, used: 10, includedRemaining: 140, creditsRemaining: 0, remaining: 140, exhausted: false },
  ...over,
});

/** Scripted answer: calls onEvent with each event, one tick apart. */
function answerWith(events: AiStreamEvent[]) {
  h.stream.mockImplementation(async (opts: { onEvent: (e: AiStreamEvent) => void }) => {
    for (const e of events) {
      await Promise.resolve();
      opts.onEvent(e);
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAiPanel();
  h.billing.current = billing();
  h.aiStatus.current = okStatus();
  h.conversations.current = [];
  h.onSale.current = false;
});

describe("without the add-on", () => {
  it("shows the AI add-on notice and no chat, and no purchase button while it is not on sale", () => {
    h.billing.current = billing({ addons: { ai_assistant: false, ai_plus: false, payroll: false, store_pro: false } });
    openAiPanel();
    render(<AiAssistantPanel />);
    const notice = screen.getByTestId("ai-addon-notice");
    expect(notice).toHaveTextContent("AI is an add-on");
    expect(notice).toHaveTextContent("not on sale yet");
    expect(screen.queryByRole("link", { name: /see add-ons/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Your question")).not.toBeInTheDocument();
  });

  it("points an owner at Billing only once it is on sale, and a member at their owner", () => {
    h.billing.current = billing({ addons: { ai_assistant: false, ai_plus: false, payroll: false, store_pro: false } });
    h.onSale.current = true;
    openAiPanel();
    const { unmount } = render(<AiAssistantPanel />);
    expect(screen.getByRole("link", { name: /see add-ons/i })).toHaveAttribute("href", "/settings?tab=billing");
    unmount();
    h.billing.current = billing({ canManageBilling: false, addons: { ai_assistant: false, ai_plus: false, payroll: false, store_pro: false } });
    render(<AiAssistantPanel />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-addon-notice")).toHaveTextContent("Ask an owner");
  });

  it("renders nothing while the panel is closed", () => {
    const { container } = render(<AiAssistantPanel />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("states the server decides", () => {
  it("says so when the assistant is switched off for the organisation or the role", () => {
    h.aiStatus.current = okStatus({ access: "org_disabled", isOwner: false });
    openAiPanel();
    const { unmount } = render(<AiAssistantPanel />);
    expect(screen.getByTestId("ai-off-notice")).toHaveTextContent("switched off for your organisation");
    expect(screen.getByTestId("ai-off-notice")).toHaveTextContent("Ask your owner");
    unmount();
    h.aiStatus.current = okStatus({ access: "role_disabled", isOwner: false });
    render(<AiAssistantPanel />);
    expect(screen.getByTestId("ai-off-notice")).toHaveTextContent("switched off for your role");
  });

  it("says 'not set up' when the server has no provider key", () => {
    h.aiStatus.current = okStatus({ configured: false });
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(screen.getByTestId("ai-not-configured")).toHaveTextContent(/not set up/i);
  });

  it("shows the questions left", () => {
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(screen.getByTestId("ai-remaining")).toHaveTextContent("140 questions left this month");
  });

  it("says the trial cap when in a trial", () => {
    h.aiStatus.current = okStatus({ tier: "trial", allowance: { scope: "trial", limit: 50, used: 49, includedRemaining: 1, creditsRemaining: 0, remaining: 1, exhausted: false } });
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(screen.getByTestId("ai-remaining")).toHaveTextContent("1 question left in your trial");
  });
});

describe("asking", () => {
  it("offers English, Hindi and Hinglish starter questions and sends one on click", async () => {
    answerWith([{ event: "done", data: { conversationId: "c1", messageId: "m1", text: "ok", cards: [], remaining: 139 } }]);
    openAiPanel();
    render(<AiAssistantPanel />);
    const starters = within(screen.getByRole("list", { name: "Suggested questions" })).getAllByRole("button");
    expect(starters.length).toBeGreaterThanOrEqual(8);
    expect(starters.map((b) => b.textContent)).toContain("Is mahine ki sales kitni hui?");
    expect(starters.some((b) => b.getAttribute("lang") === "hi")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Which items are low on stock?" }));
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    expect(h.stream.mock.calls[0]![0]).toMatchObject({ message: "Which items are low on stock?" });
  });

  it("streams the answer in, shows the tool activity, then the cards", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.stream.mockImplementation(async (opts: { onEvent: (e: AiStreamEvent) => void }) => {
      opts.onEvent({ event: "meta", data: { conversationId: "c1", model: "m", tier: "fast" } });
      opts.onEvent({ event: "tool", data: { name: "outstanding_balances", status: "start" } });
      await gate;
      opts.onEvent({ event: "tool", data: { name: "outstanding_balances", status: "ok" } });
      opts.onEvent({ event: "text", data: { delta: "You are " } });
      opts.onEvent({ event: "text", data: { delta: "owed ₹10,500." } });
      opts.onEvent({
        event: "done",
        data: { conversationId: "c1", messageId: "m1", text: "You are owed ₹10,500.", remaining: 139, cards: [{ type: "table", title: "Dues", columns: ["Customer", "Amount"], rows: [["Asha", "₹10,500.00"]] }] },
      });
    });
    openAiPanel();
    render(<AiAssistantPanel />);
    const box = screen.getByLabelText("Your question");
    await userEvent.type(box, "How much do customers owe me?");
    await userEvent.keyboard("{Enter}");

    expect(await screen.findByTestId("ai-activity")).toHaveTextContent("Checking outstanding balances");
    expect(screen.getByTestId("ai-user-message")).toHaveTextContent("How much do customers owe me?");
    // While it is writing there is a Stop button and the box is empty again.
    expect(screen.getByRole("button", { name: "Stop writing" })).toBeInTheDocument();
    expect(box).toHaveValue("");
    await act(async () => release());

    await waitFor(() => expect(screen.getByTestId("ai-assistant-message")).toHaveTextContent("You are owed ₹10,500."));
    expect(screen.getByRole("table", { name: "Dues" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeInTheDocument();
    // Screen readers hear the finished answer once.
    expect(screen.getByTestId("ai-live")).toHaveTextContent("Fintranzact AI: You are owed ₹10,500.");
  });

  it("Shift+Enter makes a new line instead of sending", async () => {
    openAiPanel();
    render(<AiAssistantPanel />);
    const box = screen.getByLabelText("Your question");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box).toHaveValue("line one\nline two");
    expect(h.stream).not.toHaveBeenCalled();
  });

  it("Stop aborts the request and keeps what was written", async () => {
    let signal!: AbortSignal;
    h.stream.mockImplementation(async (opts: { signal: AbortSignal; onEvent: (e: AiStreamEvent) => void }) => {
      signal = opts.signal;
      opts.onEvent({ event: "text", data: { delta: "Partial answer" } });
      await new Promise((_r, reject) => opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.type(screen.getByLabelText("Your question"), "slow one{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: "Stop writing" }));
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send question" })).toBeInTheDocument());
    expect(screen.getByTestId("ai-assistant-message")).toHaveTextContent("Partial answer");
  });

  it("an exhausted quota shows the server's message, keeps the question in the box and refreshes the status", async () => {
    h.stream.mockRejectedValue(new AiRequestError("Your organisation has used all its AI questions for this month. Ask your owner to add more.", 403, "quota_exhausted"));
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.type(screen.getByLabelText("Your question"), "hello there{Enter}");
    expect(await screen.findByTestId("ai-notice-quota")).toHaveTextContent("Ask your owner to add more");
    expect(screen.getByLabelText("Your question")).toHaveValue("hello there");
    expect(screen.queryByTestId("ai-user-message")).not.toBeInTheDocument();
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("shows a provider error inline, in the answer, with the reassurance from the server", async () => {
    answerWith([{ event: "error", data: { code: "provider_error", message: "The AI service had a problem just now. Your question was not counted. Please try again in a moment." } }]);
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.type(screen.getByLabelText("Your question"), "hello{Enter}");
    await waitFor(() => expect(screen.getByTestId("ai-assistant-message")).toHaveTextContent("Your question was not counted"));
  });

  it("a switched-off or not-configured refusal is shown as a notice", async () => {
    h.stream.mockRejectedValue(new AiRequestError("The AI assistant is not set up on this server yet. Please ask your administrator.", 503, "not_configured"));
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.type(screen.getByLabelText("Your question"), "hello{Enter}");
    expect(await screen.findByTestId("ai-notice-not_configured")).toHaveTextContent("not set up");
  });

  it("puts a question handed over by a button in the box without sending it", () => {
    openAiPanel("What is my GST payable?");
    render(<AiAssistantPanel />);
    expect(screen.getByLabelText("Your question")).toHaveValue("What is my GST payable?");
    expect(h.stream).not.toHaveBeenCalled();
  });
});

describe("history", () => {
  const convs = [
    { id: "c1", title: "Dues from Asha", updatedAt: "2026-10-09T10:00:00.000Z", createdAt: "2026-10-09T09:00:00.000Z" },
    { id: "c2", title: "Low stock", updatedAt: "2026-10-08T10:00:00.000Z", createdAt: "2026-10-08T09:00:00.000Z" },
  ];

  it("lists past chats, opens one with its cards, and deletes one after confirming", async () => {
    h.conversations.current = convs;
    h.fetchConversation.mockResolvedValue({
      id: "c1",
      messages: [
        { id: "a", role: "user", content: "Who owes me?" },
        { id: "b", role: "assistant", content: "Asha owes ₹10,500.", cards: [{ type: "table", title: "Dues", columns: ["Customer"], rows: [["Asha"]] }] },
      ],
    });
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Past chats" }));
    const history = screen.getByTestId("ai-history");
    expect(within(history).getByText("Dues from Asha")).toBeInTheDocument();

    await userEvent.click(within(history).getByRole("button", { name: /^Dues from Asha/ }));
    await waitFor(() => expect(screen.getByTestId("ai-messages")).toBeInTheDocument());
    expect(screen.getAllByTestId("ai-user-message")[0]).toHaveTextContent("Who owes me?");
    expect(screen.getByRole("table", { name: "Dues" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Past chats" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete chat Low stock" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Delete this chat?");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(h.deleteMutate).toHaveBeenCalledWith({ id: "c2" });
  });

  it("says there is no history yet", async () => {
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.click(screen.getByRole("button", { name: "Past chats" }));
    expect(screen.getByTestId("ai-history")).toHaveTextContent("No past chats yet.");
  });

  it("New chat clears the conversation", async () => {
    answerWith([{ event: "done", data: { conversationId: "c1", messageId: "m1", text: "hello", cards: [], remaining: 1 } }]);
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.type(screen.getByLabelText("Your question"), "hi{Enter}");
    await screen.findByTestId("ai-assistant-message");
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.queryByTestId("ai-user-message")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Suggested questions" })).toBeInTheDocument();
  });

  it("continues the same conversation for the next question", async () => {
    answerWith([{ event: "done", data: { conversationId: "c9", messageId: "m1", text: "first", cards: [], remaining: 1 } }]);
    openAiPanel();
    render(<AiAssistantPanel />);
    await userEvent.type(screen.getByLabelText("Your question"), "one{Enter}");
    await screen.findByTestId("ai-assistant-message");
    await userEvent.type(screen.getByLabelText("Your question"), "two{Enter}");
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(2));
    expect(h.stream.mock.calls[1]![0]).toMatchObject({ message: "two", conversationId: "c9" });
  });
});

describe("keyboard, focus and accessibility", () => {
  function Harness() {
    const { open } = useAiPanel();
    return (
      <>
        <AskAiButton role="owner" />
        <span data-testid="state">{open ? "open" : "closed"}</span>
        <AiAssistantPanel />
      </>
    );
  }

  it("opens from the header button, moves focus into the box, and Escape closes it and returns focus", async () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "Ask AI" });
    button.focus();
    await userEvent.click(button);
    expect(screen.getByTestId("state")).toHaveTextContent("open");
    await waitFor(() => expect(screen.getByLabelText("Your question")).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("the close button closes it", async () => {
    openAiPanel();
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByTestId("ai-panel")).not.toBeInTheDocument();
  });

  it("is a labelled landmark and has no accessibility violations", async () => {
    openAiPanel();
    const { container } = render(<AiAssistantPanel />);
    expect(screen.getByRole("complementary", { name: "Ask Fintranzact AI" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is full screen on phones and a right-hand column on desktop (responsive classes)", () => {
    openAiPanel();
    render(<AiAssistantPanel />);
    const cls = screen.getByTestId("ai-panel").className;
    expect(cls).toContain("fixed inset-0");
    expect(cls).toContain("md:static");
    expect(cls).toMatch(/md:w-\[400px\]/);
  });
});

describe("AskAiButton", () => {
  it("is hidden for the accountant access roles and shown for the others", () => {
    const { unmount } = render(<AskAiButton role="auditor" />);
    expect(screen.queryByRole("button", { name: "Ask AI" })).not.toBeInTheDocument();
    unmount();
    const r2 = render(<AskAiButton role="ca_filing" />);
    expect(screen.queryByRole("button", { name: "Ask AI" })).not.toBeInTheDocument();
    r2.unmount();
    for (const role of ["owner", "admin", "seller_manager", "seller", "accountant"]) {
      const r = render(<AskAiButton role={role} />);
      expect(screen.getByRole("button", { name: "Ask AI" })).toBeInTheDocument();
      r.unmount();
    }
  });

  it("is shown even without the add-on, so the panel can explain it", () => {
    h.billing.current = billing({ addons: { ai_assistant: false, ai_plus: false, payroll: false, store_pro: false } });
    render(<AskAiButton role="owner" />);
    expect(screen.getByRole("button", { name: "Ask AI" })).toBeInTheDocument();
  });

  it("has a dashboard variant", () => {
    render(<AskAiButton role="owner" variant="dashboard" />);
    expect(screen.getByTestId("ask-ai-dashboard")).toHaveTextContent("Ask AI about your business");
  });
});
