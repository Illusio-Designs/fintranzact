/**
 * Voice input and reply language in the AI panel. SpeechRecognition is a mock that
 * the test drives by hand: no microphone and no speech service is ever used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  billing: { current: undefined as unknown },
  aiStatus: { current: undefined as unknown },
  prefs: { current: { language: "auto", tipsEnabled: true } as { language: string; tipsEnabled: boolean } },
  stream: vi.fn(),
  invalidate: vi.fn(),
  updatePrefs: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ ai: { conversations: { invalidate: h.invalidate }, status: { invalidate: h.invalidate }, preferences: { invalidate: h.invalidate }, tips: { invalidate: h.invalidate }, conversation: { fetch: vi.fn() } } }),
    billing: { status: { useQuery: () => ({ data: h.billing.current, isLoading: h.billing.current === undefined }) } },
    ai: {
      status: { useQuery: () => ({ data: h.aiStatus.current, isLoading: h.aiStatus.current === undefined }) },
      preferences: { useQuery: () => ({ data: h.prefs.current, isLoading: false, isError: false }) },
      updatePreferences: { useMutation: () => ({ mutate: (v: unknown) => h.updatePrefs(v), isPending: false, error: null }) },
      conversations: { useQuery: () => ({ data: [], isLoading: false }) },
      confirmAction: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      cancelAction: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      updateAction: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      action: { useQuery: () => ({ data: undefined }) },
      deleteConversation: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
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
  return { ...actual, isAddonAvailable: () => false };
});

import { AiAssistantPanel } from "../AiAssistantPanel";
import { openAiPanel, resetAiPanel, useAiPanel } from "@/lib/ai-panel";
import { SPEECH_LISTENING, SPEECH_STOPPED, SPEECH_UNSUPPORTED_HINT } from "@/lib/speech-input";
import { axe } from "vitest-axe";

// ── A hand-driven SpeechRecognition ──────────────────────────────────────────

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onresult: ((e: { results: Array<Array<{ transcript: string }>> }) => void) | null = null;
  start = vi.fn(() => { FakeRecognition.instances.push(this); });
  stop = vi.fn(() => { this.onend?.(); });
  abort = vi.fn();
  /** Test helpers */
  begin() { this.onstart?.(); }
  say(...parts: string[]) { this.onresult?.({ results: parts.map((t) => [{ transcript: t }]) }); }
  fail(code: string) { this.onerror?.({ error: code }); this.onend?.(); }
  finish() { this.onend?.(); }
}

const billing = () => ({
  state: "active", readOnly: false, reason: null, canManageBilling: true,
  addons: { ai_assistant: true, ai_plus: false, payroll: false, store_pro: false },
  trial: { active: false, caps: null },
});
const okStatus = () => ({
  configured: true, access: "ok", isOwner: true, tier: "assistant",
  allowance: { scope: "month", limit: 150, used: 10, includedRemaining: 140, creditsRemaining: 0, remaining: 140, exhausted: false },
  actionKinds: [],
});

function Harness() {
  const { open } = useAiPanel();
  return <><span data-testid="panel-state">{open ? "open" : "closed"}</span><AiAssistantPanel /></>;
}

const current = () => FakeRecognition.instances.at(-1)!;
const mic = () => screen.getByTestId("ai-mic");
const box = () => screen.getByLabelText("Your question") as HTMLTextAreaElement;

beforeEach(() => {
  vi.clearAllMocks();
  resetAiPanel();
  FakeRecognition.instances = [];
  h.billing.current = billing();
  h.aiStatus.current = okStatus();
  h.prefs.current = { language: "auto", tipsEnabled: true };
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("voice input: support", () => {
  it("hides the microphone and shows a friendly hint when the browser has no speech recognition", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(screen.queryByTestId("ai-mic")).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-voice-unsupported")).toHaveTextContent(SPEECH_UNSUPPORTED_HINT);
    // Typing still works.
    expect(box()).toBeEnabled();
  });

  it("uses the prefixed webkitSpeechRecognition when that is all there is", () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(mic()).toBeInTheDocument();
    expect(screen.queryByTestId("ai-voice-unsupported")).not.toBeInTheDocument();
  });
});

describe("voice input: listening and the transcript", () => {
  it("starts on tap with interim results, shows the listening state and fills the box, and never sends by itself", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    expect(mic()).toHaveAccessibleName("Speak your question");

    await user.click(mic());
    const rec = current();
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(rec).toMatchObject({ lang: "en-IN", continuous: false, interimResults: true });

    act(() => rec.begin());
    expect(mic()).toHaveAttribute("aria-pressed", "true");
    expect(mic()).toHaveAccessibleName("Stop listening");
    expect(screen.getByTestId("ai-voice-status")).toHaveTextContent(SPEECH_LISTENING);
    expect(screen.getByTestId("ai-voice-status")).toHaveAttribute("role", "status");

    // Interim text appears in the box as it is heard.
    act(() => rec.say("how much"));
    expect(box()).toHaveValue("how much");
    act(() => rec.say("how much do customers", " owe me"));
    expect(box()).toHaveValue("how much do customers owe me");

    act(() => rec.finish());
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("ai-voice-status")).toHaveTextContent(SPEECH_STOPPED);
    // Nothing was sent: the person reviews the transcript and presses Send.
    expect(h.stream).not.toHaveBeenCalled();
    expect(box()).toHaveValue("how much do customers owe me");

    h.stream.mockImplementation(async () => undefined);
    await user.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() => expect(h.stream).toHaveBeenCalledTimes(1));
    expect(h.stream.mock.calls[0]![0]).toMatchObject({ message: "how much do customers owe me" });
  });

  it("adds what is heard after the text already in the box", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.type(box(), "For October:");
    await user.click(mic());
    act(() => current().begin());
    act(() => current().say("sales please"));
    expect(box()).toHaveValue("For October: sales please");
  });

  it("a second tap stops listening", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    act(() => current().begin());
    await user.click(mic());
    expect(current().stop).toHaveBeenCalledTimes(1);
    expect(mic()).toHaveAttribute("aria-pressed", "false");
  });

  it("Esc stops listening first and leaves the panel open; a second Esc closes it", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<Harness />);
    await user.click(mic());
    act(() => current().begin());
    await user.keyboard("{Escape}");
    expect(current().stop).toHaveBeenCalled();
    expect(screen.getByTestId("panel-state")).toHaveTextContent("open");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("panel-state")).toHaveTextContent("closed");
  });

  it("is keyboard operable: Space or Enter on the focused microphone toggles it", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    mic().focus();
    await user.keyboard(" ");
    expect(current().start).toHaveBeenCalled();
  });

  it("closing the panel while listening stops the microphone", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<Harness />);
    await user.click(mic());
    act(() => current().begin());
    await user.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(current().stop).toHaveBeenCalled();
  });

  it("caps the transcript at the question limit", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    act(() => current().begin());
    act(() => current().say("a".repeat(1500)));
    expect(box().value.length).toBe(1000);
  });
});

describe("voice input: errors", () => {
  it.each([
    ["not-allowed", /microphone is blocked/i],
    ["service-not-allowed", /microphone is blocked/i],
    ["no-speech", /did not hear anything/i],
    ["audio-capture", /no microphone was found/i],
    ["network", /internet connection/i],
    ["language-not-supported", /cannot recognise this language/i],
    ["something-new", /try again or type/i],
  ])("%s gives a clear message in an alert and leaves the box usable", async (code, message) => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    act(() => current().begin());
    act(() => current().fail(code));
    const alert = screen.getByTestId("ai-voice-status");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert).toHaveTextContent(message);
    expect(mic()).toHaveAttribute("aria-pressed", "false");
    await user.type(box(), "typed instead");
    expect(box()).toHaveValue("typed instead");
    expect(h.stream).not.toHaveBeenCalled();
  });

  it("an abort (the person stopped it) is not an error", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    act(() => current().begin());
    act(() => current().fail("aborted"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a start that throws (already running) shows the generic message instead of crashing", async () => {
    const user = userEvent.setup();
    class Throwing extends FakeRecognition {
      start = vi.fn(() => { throw new Error("InvalidStateError"); });
    }
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = Throwing;
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    expect(screen.getByTestId("ai-voice-status")).toHaveTextContent(/try again or type/i);
  });

  it("the microphone can be tapped again after an error", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    act(() => current().begin());
    act(() => current().fail("no-speech"));
    await user.click(mic());
    expect(FakeRecognition.instances).toHaveLength(2);
    act(() => current().begin());
    expect(screen.getByTestId("ai-voice-status")).toHaveTextContent(SPEECH_LISTENING);
  });
});

describe("reply language", () => {
  it.each([
    ["auto", "en-IN"],
    ["en", "en-IN"],
    ["hi", "hi-IN"],
    ["gu", "gu-IN"],
    ["hinglish", "en-IN"],
  ])("%s listens for %s", async (language, speech) => {
    const user = userEvent.setup();
    h.prefs.current = { language, tipsEnabled: true };
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(mic());
    expect(current().lang).toBe(speech);
  });

  it("marks the question box with the language so screen readers and keyboards pick the right script", () => {
    h.prefs.current = { language: "gu", tipsEnabled: true };
    openAiPanel();
    render(<AiAssistantPanel />);
    expect(box()).toHaveAttribute("lang", "gu");
  });

  it.each([
    ["hi", "hi", /^[^A-Za-z]*[ऀ-ॿ]/],
    ["gu", "gu", /[઀-૿]/],
    ["hinglish", "hi-Latn", /^[\x20-\x7E]+$/],
    ["en", "en", /^[\x20-\x7E]+$/],
  ])("%s shows starter questions in that language only", (language, lang, pattern) => {
    h.prefs.current = { language, tipsEnabled: true };
    openAiPanel();
    render(<AiAssistantPanel />);
    const buttons = within(screen.getByRole("list", { name: "Suggested questions" })).getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const b of buttons) {
      expect(b, b.textContent ?? "").toHaveAttribute("lang", lang);
      expect(b.textContent).toMatch(pattern);
    }
  });

  it("auto mixes English, Hinglish, Hindi and Gujarati starters", () => {
    openAiPanel();
    render(<AiAssistantPanel />);
    const langs = new Set(within(screen.getByRole("list", { name: "Suggested questions" })).getAllByRole("button").map((b) => b.getAttribute("lang")));
    expect([...langs].sort()).toEqual(["en", "gu", "hi", "hi-Latn"]);
  });

  it("sends a tapped Gujarati starter as the question", async () => {
    const user = userEvent.setup();
    h.prefs.current = { language: "gu", tipsEnabled: true };
    h.stream.mockImplementation(async () => undefined);
    openAiPanel();
    render(<AiAssistantPanel />);
    const first = within(screen.getByRole("list", { name: "Suggested questions" })).getAllByRole("button")[0]!;
    await user.click(first);
    await waitFor(() => expect(h.stream).toHaveBeenCalled());
    expect(h.stream.mock.calls[0]![0].message).toBe(first.textContent);
  });
});

describe("preferences view", () => {
  it("opens from the gear button with the language picker and the tips switch for this person", async () => {
    const user = userEvent.setup();
    h.prefs.current = { language: "hi", tipsEnabled: false };
    openAiPanel();
    render(<AiAssistantPanel />);
    const gear = screen.getByRole("button", { name: "Assistant preferences" });
    expect(gear).toHaveAttribute("aria-pressed", "false");
    await user.click(gear);
    expect(gear).toHaveAttribute("aria-pressed", "true");
    const select = screen.getByLabelText("Reply language") as HTMLSelectElement;
    expect(select.value).toBe("hi");
    expect([...select.options].map((o) => o.value)).toEqual(["auto", "en", "hi", "gu", "hinglish"]);
    expect(screen.getByRole("checkbox", { name: /Show tips on my dashboard/ })).not.toBeChecked();
  });

  it("saving a language sends only that field; the tips switch sends only its own", async () => {
    const user = userEvent.setup();
    openAiPanel();
    render(<AiAssistantPanel />);
    await user.click(screen.getByRole("button", { name: "Assistant preferences" }));
    await user.selectOptions(screen.getByLabelText("Reply language"), "gu");
    expect(h.updatePrefs).toHaveBeenLastCalledWith({ language: "gu" });
    await user.click(screen.getByRole("checkbox", { name: /Show tips on my dashboard/ }));
    expect(h.updatePrefs).toHaveBeenLastCalledWith({ tipsEnabled: false });
    // Back to the chat.
    await user.click(screen.getByRole("button", { name: "Assistant preferences" }));
    expect(screen.getByTestId("ai-messages")).toBeInTheDocument();
  });

  it("has no accessibility violations with the microphone and the preferences open", async () => {
    const user = userEvent.setup();
    openAiPanel();
    const { container } = render(<AiAssistantPanel />);
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Assistant preferences" }));
    expect(await axe(container)).toHaveNoViolations();
  }, 30_000);
});
