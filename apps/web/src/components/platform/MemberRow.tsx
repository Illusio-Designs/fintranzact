import { cn } from "@/lib/utils";

export interface PlatformMember {
  userId: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

/** One member in the organisation panel: who, 2FA state, role, and Reset 2FA (never for yourself). */
export function MemberRow({
  member: m,
  roleLabel,
  isSelf,
  onReset,
}: {
  member: PlatformMember;
  roleLabel: string;
  isSelf: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{m.name ?? "—"}</p>
        <p className="truncate text-xs text-text-tertiary">
          {m.email}
          {!m.emailVerified ? " · email not verified" : ""}
        </p>
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs font-semibold",
          m.twoFactorEnabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-surface-2 text-text-tertiary",
        )}
      >
        {m.twoFactorEnabled ? "2FA on" : "2FA off"}
      </span>
      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-secondary">{roleLabel}</span>
      {m.twoFactorEnabled && !isSelf ? (
        <button type="button" className="btn-secondary btn-sm" aria-label={`Reset 2FA for ${m.email}`} onClick={onReset}>
          Reset 2FA
        </button>
      ) : null}
    </div>
  );
}
