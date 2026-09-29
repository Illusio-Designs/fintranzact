import { useState, useEffect, useCallback } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "hisaabo-theme";

function getSystemPreference(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * When set on <html data-theme-lock="light|dark">, this wins over the user's
 * saved preference. The public marketing pages use it to follow the time of
 * day in India (see useIndiaTimeTheme); the app itself never sets it.
 */
function lockedTheme(): "light" | "dark" | null {
  const lock = typeof document !== "undefined" ? document.documentElement.dataset.themeLock : undefined;
  return lock === "light" || lock === "dark" ? lock : null;
}

function applyTheme(theme: Theme) {
  const resolved = lockedTheme() ?? (theme === "system" ? getSystemPreference() : theme);
  if (resolved === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem(STORAGE_KEY) as Theme) || "system";
  });

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
  }, []);

  return { theme, setTheme };
}

/** Light from 06:00 to 18:59 India Standard Time (UTC+5:30), dark otherwise. */
export function indiaTimeTheme(now: Date = new Date()): "light" | "dark" {
  const istMinutes = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
  return istMinutes >= 6 * 60 && istMinutes < 19 * 60 ? "light" : "dark";
}

/**
 * Public pages: pick light or dark from the current time in India instead of
 * a toggle, re-checking every minute. On unmount the lock is released and the
 * visitor's own saved preference applies again.
 */
export function useIndiaTimeTheme(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const update = () => {
      const t = indiaTimeTheme();
      root.dataset.themeLock = t;
      root.classList.toggle("dark", t === "dark");
    };
    update();
    const id = window.setInterval(update, 60_000);
    return () => {
      window.clearInterval(id);
      delete root.dataset.themeLock;
      applyTheme((localStorage.getItem(STORAGE_KEY) as Theme) || "system");
    };
  }, [enabled]);
}
