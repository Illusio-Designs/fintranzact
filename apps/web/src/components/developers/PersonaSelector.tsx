import { useEffect, useRef, useState } from "react";
import {
  Calculator01Icon,
  Cancel01Icon,
  CommandLineIcon,
  CpuIcon,
  Store01Icon,
  Tick02Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { PERSONAS, usePersona, type PersonaId, type PersonaInfo } from "./persona";

const PERSONA_ICONS: Record<PersonaId, IconSvgElement> = {
  developer: CommandLineIcon,
  "agent-builder": CpuIcon,
  "ca-accountant": Calculator01Icon,
  "business-owner": Store01Icon,
};

/** "I am a…" cards on the overview page. */
export function PersonaBanner() {
  const { persona, setPersona } = usePersona();
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold tracking-[-0.02em] text-[#0f1b3d] dark:text-white">I am a…</h2>
          <p className="mt-1 text-sm text-text-tertiary">
            Pick one and we will highlight the endpoint groups that matter most to you.
          </p>
        </div>
        {persona && (
          <button
            type="button"
            onClick={() => setPersona(null)}
            className="rounded-lg border border-border-light px-3 py-1.5 text-xs font-semibold text-text-tertiary transition hover:text-text-primary"
          >
            Clear
          </button>
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PERSONAS.map((info) => (
          <PersonaCard key={info.id} info={info} active={persona === info.id} onSelect={() => setPersona(info.id)} />
        ))}
      </div>
    </div>
  );
}

function PersonaCard({ info, active, onSelect }: { info: PersonaInfo; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "relative flex items-start gap-3.5 rounded-2xl border p-4 text-left transition",
        active
          ? "border-brand-300 bg-brand-50 dark:border-brand-400/50 dark:bg-brand-400/10"
          : "border-border-light bg-surface-0 hover:border-brand-200 dark:hover:border-brand-800",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          active ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200",
        )}
      >
        <Icon icon={PERSONA_ICONS[info.id]} size={20} />
      </span>
      <span className="min-w-0 pr-5">
        <span className="block text-[15px] font-bold text-text-primary">{info.title}</span>
        <span className="mt-0.5 block text-sm leading-snug text-text-tertiary">{info.subtitle}</span>
      </span>
      {active && (
        <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white">
          <Icon icon={Tick02Icon} size={12} strokeWidth={2.5} />
        </span>
      )}
    </button>
  );
}

/** Compact persona switch in the sidebar footer. */
export function PersonaPill() {
  const { persona, personaInfo, setPersona } = usePersona();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface-2",
          personaInfo ? "font-semibold text-brand-700 dark:text-brand-200" : "text-text-tertiary",
        )}
      >
        <Icon icon={persona ? PERSONA_ICONS[persona] : UserIcon} size={16} />
        <span className="truncate">{personaInfo ? personaInfo.title : "Set your role"}</span>
      </button>
      {persona && (
        <button
          type="button"
          onClick={() => setPersona(null)}
          aria-label="Clear role"
          className="flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
        >
          <Icon icon={Cancel01Icon} size={13} />
        </button>
      )}
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-60 rounded-xl border border-border-light bg-surface-0 p-1.5 shadow-[0_20px_40px_-20px_rgba(15,27,61,.4)]">
          {PERSONAS.map((info) => {
            const active = persona === info.id;
            return (
              <button
                key={info.id}
                type="button"
                onClick={() => {
                  setPersona(info.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-brand-50 dark:hover:bg-white/5",
                  active ? "font-semibold text-brand-700 dark:text-brand-200" : "text-text-secondary",
                )}
              >
                <Icon icon={PERSONA_ICONS[info.id]} size={16} />
                {info.title}
                {active && <Icon icon={Tick02Icon} size={14} className="ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
