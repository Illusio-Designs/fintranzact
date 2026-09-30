import {
  Children,
  isValidElement,
  useId,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import {
  Alert02Icon,
  AlertDiamondIcon,
  ArrowRight01Icon,
  BulbIcon,
  Copy01Icon,
  InformationCircleIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/**
 * React versions of the components the help articles use (they were written
 * for Starlight), plus the element overrides every article renders with.
 * Articles import what they need from "@/components/help/mdx".
 */

// ── Device and persona blocks ──────────────────────────────────
// Both versions stay in the page; help.css hides the one that does not match
// the reader's choice in the help header (see HelpLayout).

/** Shown when the reader views the desktop (web app) instructions. */
export function ForDesktop({ children }: { children?: ReactNode }) {
  return <div className="help-platform-desktop">{children}</div>;
}

/** Shown when the reader views the mobile app instructions. */
export function ForMobile({ children }: { children?: ReactNode }) {
  return <div className="help-platform-mobile">{children}</div>;
}

/** Shown to business owners, and to everyone until a persona is picked. */
export function ForBusiness({ children }: { children?: ReactNode }) {
  return <div className="help-persona-business">{children}</div>;
}

/** Shown to CAs and accountants, and to everyone until a persona is picked. */
export function ForCA({ children }: { children?: ReactNode }) {
  return <div className="help-persona-ca">{children}</div>;
}

// ── Asides (:::note, :::tip, :::caution, :::danger) ────────────

type AsideType = "note" | "tip" | "caution" | "danger";

const ASIDES: Record<AsideType, { label: string; icon: IconSvgElement; box: string; accent: string }> = {
  note: {
    label: "Note",
    icon: InformationCircleIcon,
    box: "border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/40",
    accent: "text-blue-700 dark:text-blue-300",
  },
  tip: {
    label: "Tip",
    icon: BulbIcon,
    box: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/40",
    accent: "text-emerald-700 dark:text-emerald-300",
  },
  caution: {
    label: "Caution",
    icon: Alert02Icon,
    box: "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/40",
    accent: "text-amber-800 dark:text-amber-300",
  },
  danger: {
    label: "Danger",
    icon: AlertDiamondIcon,
    box: "border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40",
    accent: "text-red-700 dark:text-red-300",
  },
};

export function Aside({ type = "note", title, children }: { type?: AsideType; title?: string; children?: ReactNode }) {
  const style = ASIDES[type] ?? ASIDES.note;
  return (
    <aside className={cn("help-aside my-6 rounded-xl border px-4 py-3.5 sm:px-5", style.box)} aria-label={title ?? style.label}>
      <p className={cn("flex items-center gap-2 text-[15px] font-bold", style.accent)}>
        <Icon icon={style.icon} size={18} />
        {title ?? style.label}
      </p>
      <div className="help-aside-body mt-1.5 text-[15px] leading-relaxed text-text-secondary">{children}</div>
    </aside>
  );
}

// ── Tabs ───────────────────────────────────────────────────────

type TabItemProps = { label: string; children?: ReactNode };

/** One tab's content; the label is shown by <Tabs>. */
export function TabItem({ children }: TabItemProps) {
  return <>{children}</>;
}

export function Tabs({ children }: { children?: ReactNode; syncKey?: string }) {
  const items = Children.toArray(children).filter(
    (child): child is ReactElement<TabItemProps> => isValidElement(child) && typeof (child.props as TabItemProps).label === "string",
  );
  const [active, setActive] = useState(0);
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (i: number) => {
    const next = (i + items.length) % items.length;
    setActive(next);
    buttons.current[next]?.focus();
  };
  return (
    <div className="my-6">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border-light">
        {items.map((item, i) => (
          <button
            key={item.props.label}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === active}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") select(i + 1);
              if (e.key === "ArrowLeft") select(i - 1);
            }}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2 text-sm font-semibold",
              i === active
                ? "border-brand-600 text-brand-700 dark:border-brand-300 dark:text-brand-200"
                : "border-transparent text-text-tertiary hover:text-text-primary",
            )}
          >
            {item.props.label}
          </button>
        ))}
      </div>
      {items.map((item, i) => (
        <div
          key={item.props.label}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== active}
          className="pt-2"
        >
          {item.props.children}
        </div>
      ))}
    </div>
  );
}

// ── Cards and steps ────────────────────────────────────────────

export function CardGrid({ children }: { children?: ReactNode; stagger?: boolean }) {
  return <div className="my-6 grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Card({ title, children }: { title: string; icon?: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border-light bg-surface-0 p-5 [&>*:first-child]:mt-0">
      <p className="text-base font-bold text-text-primary">{title}</p>
      <div className="mt-2 text-[15px] text-text-secondary">{children}</div>
    </div>
  );
}

export function LinkCard({ title, description, href }: { title: string; description?: string; href: string }) {
  return (
    <HelpLink
      href={href}
      className="group my-3 flex items-center justify-between gap-4 rounded-xl border border-border-light p-4 no-underline transition hover:border-brand-300"
    >
      <span>
        <span className="block font-bold text-text-primary">{title}</span>
        {description && <span className="mt-1 block text-sm text-text-tertiary">{description}</span>}
      </span>
      <Icon icon={ArrowRight01Icon} size={18} className="text-brand-600 transition group-hover:translate-x-0.5 dark:text-brand-300" />
    </HelpLink>
  );
}

/** Numbered steps: wraps an ordered list. */
export function Steps({ children }: { children?: ReactNode }) {
  return <div className="help-steps">{children}</div>;
}

export function Badge({ text, variant = "note" }: { text: string; variant?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 align-middle text-xs font-bold",
        variant === "caution" || variant === "danger"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
          : "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200",
      )}
    >
      {text}
    </span>
  );
}

// ── Element overrides ──────────────────────────────────────────

/** Site links stay in the app (no reload); outside links open in a new tab. */
function HelpLink({ href = "", children, ...rest }: ComponentPropsWithoutRef<"a">) {
  if (href.startsWith("/")) {
    return (
      <Link to={href} {...rest}>
        {children}
      </Link>
    );
  }
  const external = /^https?:/.test(href);
  return (
    <a href={href} {...rest} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {children}
    </a>
  );
}

/** Tables scroll sideways inside their own box, never the page. */
function Table(props: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="help-table my-6 max-w-full overflow-x-auto rounded-xl border border-border-light">
      <table {...props} />
    </div>
  );
}

/** Code blocks scroll inside their box and have a copy button. */
function Pre({ children, ...rest }: ComponentPropsWithoutRef<"pre">) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ref.current?.innerText ?? "");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the reader can still select the text.
    }
  };
  return (
    <div className="group relative my-6">
      <pre ref={ref} {...rest}>
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy code"}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-white/5 text-slate-300 opacity-80 hover:bg-white/10 hover:text-white group-hover:opacity-100"
      >
        <Icon icon={copied ? Tick02Icon : Copy01Icon} size={16} />
      </button>
    </div>
  );
}

/** Components every article is rendered with (element overrides plus <Aside>, which the build inserts). */
export const HELP_MDX_COMPONENTS = {
  a: HelpLink,
  table: Table,
  pre: Pre,
  Aside,
};
