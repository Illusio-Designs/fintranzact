/**
 * Open/closed state of the AI assistant panel, shared by the header button, the
 * dashboard button and the panel itself. A tiny external store so none of them
 * needs a provider.
 */

import { useSyncExternalStore } from "react";

interface PanelState {
  open: boolean;
  /** A question to put in the box when the panel opens (never sent automatically). */
  draft: string;
}

let state: PanelState = { open: false, draft: "" };
const listeners = new Set<() => void>();

function set(next: PanelState) {
  state = next;
  for (const l of listeners) l();
}

export function openAiPanel(draft = ""): void {
  set({ open: true, draft });
}
export function closeAiPanel(): void {
  set({ ...state, open: false });
}
export function toggleAiPanel(): void {
  set({ open: !state.open, draft: "" });
}
export function clearAiDraft(): void {
  if (state.draft) set({ ...state, draft: "" });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAiPanel(): PanelState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** Tests only. */
export function resetAiPanel(): void {
  set({ open: false, draft: "" });
}
