import { renderHook } from "@testing-library/react";
import { useHotkeys, type HotkeyDef } from "@/hooks/useHotkeys";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fireKey(
  key: string,
  opts: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: HTMLElement } = {}
) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
  });

  // Dispatch on the provided element (which bubbles up to document where the
  // handler lives), or on document.body when no target is given so that
  // e.target is always a proper HTMLElement with a tagName — dispatching
  // directly on `document` sets e.target to the document node whose tagName
  // is undefined, causing isTypingTarget to throw in jsdom.
  const dispatchTarget: HTMLElement | Document = opts.target ?? document.body;
  dispatchTarget.dispatchEvent(event);
  return event;
}

function makeDef(overrides: Partial<HotkeyDef> & { handler: () => void }): HotkeyDef {
  return {
    key: "k",
    description: "Test hotkey",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useHotkeys", () => {
  it("handler fires when the matching key is pressed", () => {
    const handler = vi.fn();
    const hotkeys: HotkeyDef[] = [makeDef({ key: "k", handler })];

    renderHook(() => useHotkeys(hotkeys));

    fireKey("k");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire for a non-matching key", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", handler })]));

    fireKey("j");

    expect(handler).not.toHaveBeenCalled();
  });

  it("Ctrl modifier matching works (ctrlKey)", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", ctrl: true, handler })]));

    // Without modifier — should NOT fire
    fireKey("k");
    expect(handler).not.toHaveBeenCalled();

    // With ctrlKey — should fire
    fireKey("k", { ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("Ctrl modifier matching works (metaKey treated as ctrl)", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", ctrl: true, handler })]));

    fireKey("k", { metaKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire for a plain key while typing inside an input", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", handler })]));

    const input = document.createElement("input");
    document.body.appendChild(input);

    try {
      fireKey("k", { target: input });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(input);
    }
  });

  it("does NOT fire for a plain key while typing inside a textarea", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", handler })]));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);

    try {
      fireKey("k", { target: textarea });
      expect(handler).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(textarea);
    }
  });

  it("DOES fire Escape even inside an input", () => {
    const handler = vi.fn();
    renderHook(() =>
      useHotkeys([makeDef({ key: "Escape", handler })])
    );

    const input = document.createElement("input");
    document.body.appendChild(input);

    try {
      fireKey("Escape", { target: input });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(input);
    }
  });

  it("DOES fire modifier combos (Ctrl+K) inside an input", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", ctrl: true, handler })]));

    const input = document.createElement("input");
    document.body.appendChild(input);

    try {
      fireKey("k", { ctrlKey: true, target: input });
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      document.body.removeChild(input);
    }
  });

  it("calls preventDefault when a hotkey matches", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", handler })]));

    const event = fireKey("k");

    expect(event.defaultPrevented).toBe(true);
  });

  it("does NOT call preventDefault when the key does not match", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", handler })]));

    const event = fireKey("j");

    expect(event.defaultPrevented).toBe(false);
  });

  it("cleanup on unmount removes the keydown listener", () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() =>
      useHotkeys([makeDef({ key: "k", handler })])
    );

    unmount();

    fireKey("k");

    expect(handler).not.toHaveBeenCalled();
  });

  it("only the first matching hotkey def fires (break after first match)", () => {
    const first = vi.fn();
    const second = vi.fn();
    const hotkeys: HotkeyDef[] = [
      makeDef({ key: "k", handler: first, description: "first" }),
      makeDef({ key: "k", handler: second, description: "second" }),
    ];

    renderHook(() => useHotkeys(hotkeys));

    fireKey("k");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it("shift modifier matching works", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "k", shift: true, handler })]));

    // Without shift — should NOT fire
    fireKey("k");
    expect(handler).not.toHaveBeenCalled();

    // With shift — should fire
    fireKey("k", { shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("key matching is case-insensitive", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "K", handler })]));

    // Fire lowercase "k" — should still match since both are lowercased
    fireKey("k");

    expect(handler).toHaveBeenCalledTimes(1);
  });
  // ── Leader sequences ───────────────────────────────────────────────────────
  //
  // These replace Alt+Shift chords for navigation: Alt+Shift is the Windows
  // input-language switcher, so those chords never reach the page on a machine
  // with a second keyboard layout installed.

  it("leader sequence fires when leader then key are pressed", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "d", leader: "g", handler })]));

    fireKey("g");
    expect(handler).not.toHaveBeenCalled(); // leader alone does nothing

    fireKey("d");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("leader key alone does not fire, and a wrong follow-up cancels it", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "d", leader: "g", handler })]));

    fireKey("g");
    fireKey("z"); // not a registered follow-up
    expect(handler).not.toHaveBeenCalled();

    // The sequence must be restarted, not resumed.
    fireKey("d");
    expect(handler).not.toHaveBeenCalled();
  });

  it("the follow-up key does not fire on its own", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "d", leader: "g", handler })]));

    fireKey("d");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a doubled sequence (G then G) resolves to its own target", () => {
    const gst = vi.fn();
    renderHook(() =>
      useHotkeys([makeDef({ key: "g", leader: "g", description: "GST", handler: gst })]),
    );

    fireKey("g");
    fireKey("g");

    expect(gst).toHaveBeenCalledTimes(1);
  });

  it("does not arm the leader while typing in an input", () => {
    const handler = vi.fn();
    renderHook(() => useHotkeys([makeDef({ key: "d", leader: "g", handler })]));

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey("g", { target: input });
    fireKey("d", { target: input });
    document.body.removeChild(input);

    expect(handler).not.toHaveBeenCalled();
  });

  it("a plain single-key shortcut still wins over arming a leader", () => {
    const leaderHandler = vi.fn();
    const plainHandler = vi.fn();
    renderHook(() =>
      useHotkeys([
        makeDef({ key: "d", leader: "g", handler: leaderHandler }),
        makeDef({ key: "g", description: "Plain G", handler: plainHandler }),
      ]),
    );

    fireKey("g");

    expect(plainHandler).toHaveBeenCalledTimes(1);
    expect(leaderHandler).not.toHaveBeenCalled();
  });
});
