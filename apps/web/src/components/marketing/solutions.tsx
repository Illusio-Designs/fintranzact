import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/Icon";

/** Shared pieces of the /solutions pages. */

/** Hero call-to-action buttons, matching the landing page. */
export function SolutionCtas() {
  return (
    <div className="mt-8 flex flex-wrap gap-3">
      <Link
        to="/register"
        className="inline-flex h-[52px] items-center gap-2 rounded-xl bg-brand-600 px-6 text-base font-bold text-white shadow-[0_12px_28px_-10px_rgba(59,94,170,.7)] transition hover:bg-brand-700"
      >
        Start free — no card needed
        <Icon icon={ArrowRight01Icon} size={18} strokeWidth={2} />
      </Link>
      <Link
        to="/contact"
        className="inline-flex h-[52px] items-center rounded-xl border border-[#cfd8ea] bg-white px-6 text-base font-semibold text-[#0f1b3d] transition hover:border-brand-300 dark:border-white/15 dark:bg-white/5 dark:text-white"
      >
        Talk to us
      </Link>
    </div>
  );
}

/** Set the page's meta description while it is shown, then restore the default. */
export function useMetaDescription(description: string) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) return;
    const previous = meta.content;
    meta.content = description;
    return () => {
      meta.content = previous;
    };
  }, [description]);
}
