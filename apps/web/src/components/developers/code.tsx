import { useCallback, useEffect, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import { ArrowDown01Icon, CheckmarkCircle02Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import type { CodeExamples } from "@/content/developers/types";
import "./code.css";

/**
 * Code blocks for the API reference. Always dark (like a terminal), in both
 * light and dark mode, with Prism highlighting and a copy button.
 */

type Language = "javascript" | "curl" | "python";

const LANG_LABELS: Record<Language, string> = {
  javascript: "JavaScript",
  curl: "cURL",
  python: "Python",
};

const PRISM_LANGS: Record<Language, string> = {
  javascript: "javascript",
  curl: "bash",
  python: "python",
};

function escapeHtml(code: string) {
  return code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Highlighted HTML for a code sample. */
export function highlight(code: string, lang: string): string {
  const grammar = Prism.languages[lang];
  return grammar ? Prism.highlight(code, grammar, lang) : escapeHtml(code);
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available (insecure context or blocked).
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : `${label} to clipboard`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition",
        copied ? "text-emerald-300" : "text-slate-400 hover:bg-white/5 hover:text-white",
        className,
      )}
    >
      <Icon icon={copied ? Tick02Icon : Copy01Icon} size={15} />
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * A highlighted block with line numbers. SECURITY: code comes from the
 * static, developer-written files in content/developers, never from user
 * input, so Prism's HTML output is safe to inject.
 */
export function HighlightedCode({ code, lang, className }: { code: string; lang: string; className?: string }) {
  const lines = code.split("\n").length;
  return (
    <div className={cn("dev-code flex text-xs leading-[1.75]", className)}>
      <div aria-hidden="true" className="select-none pr-3 text-right font-mono text-slate-600">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="m-0 min-w-0 flex-1 overflow-x-auto font-mono text-slate-200">
        <code dangerouslySetInnerHTML={{ __html: highlight(code, lang) }} />
      </pre>
    </div>
  );
}

/** A titled, dark code block with a copy button. */
export function CodeBlock({ code, lang = "bash", title }: { code: string; lang?: string; title?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1f2c4f] bg-[#0b1530]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 py-1 pl-4 pr-1.5">
        <span className="truncate text-xs font-semibold text-slate-400">{title ?? LANG_LABELS[lang as Language] ?? lang}</span>
        <CopyButton text={code} />
      </div>
      <div className="max-h-[520px] overflow-auto p-4">
        <HighlightedCode code={code} lang={lang} />
      </div>
    </div>
  );
}

/**
 * Tabbed code samples (JavaScript / cURL / Python) with the example response
 * underneath, opened on demand. The chosen language is shared across every
 * panel on the page.
 */
export function CodePanel({ examples, outputExample }: { examples: CodeExamples; outputExample: unknown }) {
  const available = (["javascript", "curl", "python"] as Language[]).filter((l) => examples[l]);
  const [preferred, setPreferred] = usePreferredLanguage();
  const active = available.includes(preferred) ? preferred : (available[0] ?? "javascript");
  const [showResponse, setShowResponse] = useState(false);
  const code = examples[active] ?? "";
  const responseJson = outputExample === undefined ? "" : JSON.stringify(outputExample, null, 2);

  return (
    <div className="overflow-hidden rounded-xl border border-[#1f2c4f] bg-[#0b1530] shadow-[0_24px_48px_-28px_rgba(15,27,61,.55)]">
      <div className="flex items-center gap-2 border-b border-white/10 pl-2 pr-1.5">
        <div role="tablist" aria-label="Code language" className="flex min-w-0 flex-1 overflow-x-auto">
          {available.map((lang) => {
            const isActive = lang === active;
            return (
              <button
                key={lang}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setPreferred(lang)}
                className={cn(
                  "relative shrink-0 px-3 py-3 text-xs font-semibold transition",
                  isActive ? "text-white" : "text-slate-400 hover:text-slate-200",
                )}
              >
                {LANG_LABELS[lang]}
                {isActive && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand-300" />}
              </button>
            );
          })}
        </div>
        <CopyButton text={code} />
      </div>

      <div className="max-h-[460px] overflow-auto p-4">
        <HighlightedCode code={code} lang={PRISM_LANGS[active]} />
      </div>

      {responseJson && (
        <div className="border-t border-white/10">
          <button
            type="button"
            aria-expanded={showResponse}
            onClick={() => setShowResponse((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-slate-300 transition hover:bg-white/[0.03]"
          >
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Icon icon={CheckmarkCircle02Icon} size={15} className="text-emerald-400" />
              Response
              <span className="rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 text-2xs text-emerald-300">
                200 OK
              </span>
            </span>
            <Icon icon={ArrowDown01Icon} size={15} className={cn("text-slate-500 transition", showResponse && "rotate-180")} />
          </button>
          {showResponse && (
            <div className="relative border-t border-white/10 bg-black/20">
              <div className="absolute right-1.5 top-1.5 z-10">
                <CopyButton text={responseJson} />
              </div>
              <div className="max-h-[380px] overflow-auto p-4 pr-20">
                <HighlightedCode code={responseJson} lang="json" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared language choice ────────────────────────────────────────────────

const LANG_KEY = "fintranzact_docs_lang";
const langListeners = new Set<(lang: Language) => void>();
let preferredLang: Language | undefined;

function readLang(): Language {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "javascript" || v === "curl" || v === "python") return v;
  } catch {
    // Storage blocked: fall back to JavaScript.
  }
  return "javascript";
}

function usePreferredLanguage(): [Language, (lang: Language) => void] {
  const [lang, setLang] = useState<Language>(() => (preferredLang ??= readLang()));
  useEffect(() => {
    langListeners.add(setLang);
    return () => {
      langListeners.delete(setLang);
    };
  }, []);
  const set = useCallback((next: Language) => {
    preferredLang = next;
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
    langListeners.forEach((l) => l(next));
  }, []);
  return [lang, set];
}
