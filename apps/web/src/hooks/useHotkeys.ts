import { useEffect, useRef, useState, useCallback } from "react";

export interface HotkeyDef {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /**
   * Two-key sequence: press this key, then `key` (e.g. leader "g" + "d").
   *
   * WHY SEQUENCES EXIST HERE:
   * Alt+Shift+<key> is unusable as a primary navigation chord. On Windows,
   * Alt+Shift is the OS input-language switcher, so on any machine with more
   * than one keyboard layout installed the combination never reaches the
   * page. On macOS, Option+<key> emits a different character entirely
   * ("d" becomes "∂"), so `event.key` no longer matches the definition.
   * A leader sequence has neither problem and is what most keyboard-driven
   * apps use. The Alt+Shift bindings are kept as aliases.
   */
  leader?: string;
  handler: () => void;
  description: string;
  scope?: string;
}

/** How long a pressed leader key waits for its follow-up. */
const LEADER_TIMEOUT_MS = 1500;

// Module-level registry so CommandPalette (and other consumers) can read all
// currently registered hotkeys.
const hotkeyRegistry: HotkeyDef[] = [];

export function getRegisteredHotkeys(): HotkeyDef[] {
  return [...hotkeyRegistry];
}

// ── Shortcut indicator event system ──────────────────────────────────────────

export interface ShortcutFlash {
  id: number;
  keys: string[];
  description: string;
}

type FlashListener = (flash: ShortcutFlash) => void;
const flashListeners: Set<FlashListener> = new Set();
let flashId = 0;

function emitFlash(def: HotkeyDef) {
  const keys: string[] = [];
  if (def.ctrl) keys.push("⌘");
  if (def.alt) keys.push("Alt");
  if (def.shift) keys.push("⇧");
  keys.push(def.key.length === 1 ? def.key.toUpperCase() : def.key);
  const flash: ShortcutFlash = { id: ++flashId, keys, description: def.description };
  flashListeners.forEach((fn) => fn(flash));
}

export function useShortcutFlash() {
  const [flash, setFlash] = useState<ShortcutFlash | null>(null);

  useEffect(() => {
    const listener: FlashListener = (f) => {
      setFlash(f);
    };
    flashListeners.add(listener);
    return () => { flashListeners.delete(listener); };
  }, []);

  const dismiss = useCallback(() => setFlash(null), []);

  return { flash, dismiss };
}

// ── Leader-sequence state ────────────────────────────────────────────────────
// Module-level so the sequence survives across the several components that
// each register their own hotkeys.
let pendingLeader: string | null = null;
let leaderTimer: number | null = null;

function clearLeader() {
  pendingLeader = null;
  if (leaderTimer !== null) {
    window.clearTimeout(leaderTimer);
    leaderTimer = null;
  }
}

function armLeader(key: string) {
  clearLeader();
  pendingLeader = key;
  leaderTimer = window.setTimeout(clearLeader, LEADER_TIMEOUT_MS);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.contentEditable === "true" || el.contentEditable === "plaintext-only")
    return true;
  return false;
}

export function useHotkeys(hotkeys: HotkeyDef[]): void {
  // Stable ref so the effect closure always sees the latest hotkeys without
  // needing to re-register the listener on every render.
  const hotkeysRef = useRef(hotkeys);
  hotkeysRef.current = hotkeys;

  useEffect(() => {
    const defs = hotkeysRef.current;

    // Register in the module-level registry
    defs.forEach((d) => hotkeyRegistry.push(d));

    const handler = (e: KeyboardEvent) => {
      // Browser autofill fires keydown events with no key.
      if (typeof e.key !== "string") return;
      const bare = !e.ctrlKey && !e.metaKey && !e.altKey;
      const typing = isTypingTarget(e.target);
      const pressed = e.key.toLowerCase();

      // ── Leader sequences ────────────────────────────────────────────
      // Resolve a pending leader first, so "g" then "d" cannot also be read
      // as two independent single-key shortcuts.
      if (pendingLeader && bare && !typing) {
        const armed = pendingLeader;
        clearLeader();
        const match = hotkeysRef.current.find(
          (d) =>
            d.leader &&
            d.leader.toLowerCase() === armed &&
            d.key.toLowerCase() === pressed,
        );
        if (match) {
          e.preventDefault();
          emitFlash(match);
          match.handler();
          return;
        }
        // Unknown follow-up: fall through and treat it as a normal key.
      }

      if (bare && !typing) {
        const isLeader = hotkeysRef.current.some(
          (d) => d.leader && d.leader.toLowerCase() === pressed,
        );
        // Only arm when no plain single-key shortcut claims this key, so
        // existing bindings keep working.
        const claimedOutright = hotkeysRef.current.some(
          (d) => !d.leader && !d.ctrl && !d.alt && !d.shift && d.key.toLowerCase() === pressed,
        );
        if (isLeader && !claimedOutright) {
          e.preventDefault();
          armLeader(pressed);
          return;
        }
      }

      for (const def of hotkeysRef.current) {
        // Sequence definitions are handled above, never as a bare key.
        if (def.leader) continue;

        const keyMatch = e.key.toLowerCase() === def.key.toLowerCase();
        if (!keyMatch) continue;

        const ctrlMatch = def.ctrl
          ? e.ctrlKey || e.metaKey
          : !e.ctrlKey && !e.metaKey;
        const shiftMatch = def.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = def.alt ? e.altKey : !e.altKey;

        if (!ctrlMatch || !shiftMatch || !altMatch) continue;

        // Skip when user is typing — except always handle Escape
        if (e.key !== "Escape" && isTypingTarget(e.target)) {
          // Allow modifier combos (e.g. Ctrl+K) even inside inputs
          const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
          if (!hasModifier) continue;
        }

        e.preventDefault();
        // Flash indicator (skip for Escape and toggle-type shortcuts like ?)
        if (e.key !== "Escape") {
          emitFlash(def);
        }
        def.handler();
        break;
      }
    };

    document.addEventListener("keydown", handler);

    return () => {
      document.removeEventListener("keydown", handler);
      // Remove our definitions from the registry
      defs.forEach((d) => {
        const idx = hotkeyRegistry.indexOf(d);
        if (idx !== -1) hotkeyRegistry.splice(idx, 1);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
