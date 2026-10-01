import { useCallback, useSyncExternalStore } from "react";
import type { DeveloperGroupSlug } from "@/lib/developer-paths";

/**
 * "I am a…" persona for the API reference. It highlights the endpoint groups
 * that matter most to the reader and pre-filters the FAQ. Remembered in this
 * browser only; the reference works the same without it.
 */

export type PersonaId = "developer" | "agent-builder" | "ca-accountant" | "business-owner";

export interface PersonaInfo {
  id: PersonaId;
  title: string;
  subtitle: string;
  /** Endpoint groups to highlight on the overview and in the sidebar. */
  highlightedGroups: DeveloperGroupSlug[];
}

export const PERSONAS: PersonaInfo[] = [
  {
    id: "developer",
    title: "Developer",
    subtitle: "Building an integration or custom client",
    highlightedGroups: ["auth", "businesses", "invoices", "parties", "items", "payments", "api-keys"],
  },
  {
    id: "agent-builder",
    title: "AI agent builder",
    subtitle: "Connecting via MCP or building automated workflows",
    highlightedGroups: ["auth", "api-keys", "invoices", "dashboard", "reports", "gst", "bank-recon"],
  },
  {
    id: "ca-accountant",
    title: "CA / accountant",
    subtitle: "Managing clients, GST and financial statements",
    highlightedGroups: ["tenant", "businesses", "gst", "itc", "reports", "journals", "accounts", "bank-recon", "gstr2b"],
  },
  {
    id: "business-owner",
    title: "Business owner",
    subtitle: "Running invoicing, payments and inventory",
    highlightedGroups: ["invoices", "parties", "items", "payments", "expense", "dashboard", "store", "shipment"],
  },
];

const STORAGE_KEY = "fintranzact_docs_persona";
const listeners = new Set<() => void>();

function read(): PersonaId | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return PERSONAS.some((p) => p.id === value) ? (value as PersonaId) : null;
  } catch {
    return null;
  }
}

let current: PersonaId | null | undefined;

function getSnapshot(): PersonaId | null {
  if (current === undefined) current = read();
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(value: PersonaId | null) {
  current = value;
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: keep the choice for this visit only.
  }
  listeners.forEach((l) => l());
}

export function usePersona() {
  const persona = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const setPersona = useCallback((value: PersonaId | null) => write(value), []);
  const personaInfo = persona ? (PERSONAS.find((p) => p.id === persona) ?? null) : null;
  return { persona, personaInfo, setPersona };
}
