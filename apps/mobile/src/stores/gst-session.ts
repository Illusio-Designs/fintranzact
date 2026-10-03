import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

/**
 * The GST portal session the user opened with an OTP (valid 6 hours, kept in the API's
 * memory). The phone remembers only WHEN it was opened and the GST portal username, so the
 * filing screens can show the time left and know when to ask for a new OTP.
 * Never the OTP, never the token.
 */
const KEY = "fintranzact_gst_portal_sessions";

interface Entry {
  verifiedAt: number | null;
  username: string;
}

interface GstSessionState {
  entries: Record<string, Entry>;
  isHydrated: boolean;
  hydrate: () => Promise<void>;
  markVerified: (businessId: string, username: string) => void;
  clear: (businessId: string) => void;
}

async function persist(entries: Record<string, Entry>) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(entries));
  } catch {
    // non-fatal: the in-memory session still works while the app is open
  }
}

export const useGstSessionStore = create<GstSessionState>((set, get) => ({
  entries: {},
  isHydrated: false,
  hydrate: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
      set({ entries: { ...parsed, ...get().entries }, isHydrated: true });
    } catch {
      set({ isHydrated: true });
    }
  },
  markVerified: (businessId, username) => {
    const entries = { ...get().entries, [businessId]: { verifiedAt: Date.now(), username } };
    set({ entries });
    void persist(entries);
  },
  clear: (businessId) => {
    const prev = get().entries[businessId];
    const entries = { ...get().entries, [businessId]: { verifiedAt: null, username: prev?.username ?? "" } };
    set({ entries });
    void persist(entries);
  },
}));
