import { isCaRole } from "@fintranzact/shared";
import { cn } from "@/lib/utils";
import { formatRole } from "@/lib/roles";

/** A member's role as a pill; accountant (CA) roles carry a small "CA" tag. */
export function RoleBadge({ role }: { role: string }) {
  return (
    <span
      data-testid="role-badge"
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs font-medium",
        role === "owner" || role === "superadmin"
          ? "bg-brand-600/[0.08] text-brand-700 dark:text-brand-400"
          : role === "admin"
            ? "bg-emerald-600/[0.08] text-emerald-700 dark:text-emerald-400"
            : isCaRole(role)
              ? "bg-violet-600/[0.08] text-violet-700 dark:text-violet-400"
              : "bg-surface-2 text-text-secondary",
      )}
    >
      {formatRole(role)}
      {isCaRole(role) && (
        <span data-testid="ca-badge" className="rounded bg-violet-600/15 px-1 text-[10px] font-semibold leading-4 tracking-wide">
          CA
        </span>
      )}
    </span>
  );
}
