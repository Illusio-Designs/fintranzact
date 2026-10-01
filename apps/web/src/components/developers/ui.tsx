import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { EndpointDef } from "@/content/developers/types";

/** Small shared pieces of the API reference pages. */

export const INLINE_CODE =
  "rounded-md border border-border-light bg-surface-1 px-1.5 py-0.5 font-mono text-[0.86em] text-[#0f1b3d] [overflow-wrap:anywhere] dark:text-brand-100";

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className={INLINE_CODE}>{children}</code>;
}

/** Text with `backtick` spans shown as inline code. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? <InlineCode key={i}>{part}</InlineCode> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/** Queries are sent as GET, mutations as POST. */
export function MethodBadge({ method, size = "md" }: { method: EndpointDef["method"]; size?: "sm" | "md" }) {
  const isGet = method === "query";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border font-mono font-bold tracking-wide",
        size === "sm" ? "w-[38px] py-px text-2xs" : "px-2.5 py-[3px] text-2xs",
        isGet
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300"
          : "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/25 dark:bg-orange-400/10 dark:text-orange-300",
      )}
    >
      {isGet ? "GET" : "POST"}
    </span>
  );
}

const AUTH_LABELS: Record<EndpointDef["auth"], { label: string; className: string }> = {
  public: {
    label: "Public",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  protected: {
    label: "Sign-in required",
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-300",
  },
  business: {
    label: "Business required",
    className: "border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-200",
  },
};

export function AuthBadge({ auth }: { auth: EndpointDef["auth"] }) {
  const { label, className } = AUTH_LABELS[auth];
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-[3px] text-2xs font-semibold", className)}>
      {label}
    </span>
  );
}

/** Uppercase label above a block (Parameters, Response, …). */
export function BlockLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-tertiary">{children}</h3>;
}
