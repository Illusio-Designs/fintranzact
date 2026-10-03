import { useState } from "react";
import {
  ACCESS_LOG_FILTERS,
  accessEventSentence,
  relativeTime,
  type AccessEventType,
  type AccessLogItem,
} from "@fintranzact/shared";
import {
  Cancel01Icon,
  Download04Icon,
  Login01Icon,
  Mail01Icon,
  UserAdd01Icon,
  UserCheck01Icon,
  UserEdit01Icon,
  UserRemove01Icon,
} from "@hugeicons/core-free-icons";
import { trpc } from "@/lib/trpc";
import { Icon, type IconSvgElement } from "@/components/ui/Icon";
import { PillTabs } from "@/components/ui/Tabs";
import { cn } from "@/lib/utils";

const ICONS: Record<string, { icon: IconSvgElement; tone: string }> = {
  "access.invited": { icon: Mail01Icon, tone: "text-brand-600" },
  "access.invite_revoked": { icon: Cancel01Icon, tone: "text-text-tertiary" },
  "access.accepted": { icon: UserCheck01Icon, tone: "text-emerald-600" },
  "access.role_changed": { icon: UserEdit01Icon, tone: "text-amber-600" },
  "access.removed": { icon: UserRemove01Icon, tone: "text-red-600" },
  "access.left": { icon: UserRemove01Icon, tone: "text-amber-600" },
  "access.org_opened": { icon: Login01Icon, tone: "text-violet-600" },
  "access.export": { icon: Download04Icon, tone: "text-violet-600" },
  "access.partner_attributed": { icon: UserCheck01Icon, tone: "text-emerald-600" },
};

function Row({ item, viewerId }: { item: AccessLogItem; viewerId?: string | null }) {
  const meta = ICONS[item.type] ?? { icon: UserAdd01Icon, tone: "text-text-tertiary" };
  return (
    <li className="flex items-start justify-between gap-4 py-2.5" data-testid="access-log-row">
      <div className="flex min-w-0 items-start gap-3">
        <Icon icon={meta.icon} size={16} className={cn("mt-0.5", meta.tone)} />
        <p className="min-w-0 text-sm text-text-primary [overflow-wrap:anywhere]">{accessEventSentence(item, viewerId)}</p>
      </div>
      <time
        dateTime={item.createdAt}
        title={new Date(item.createdAt).toLocaleString()}
        className="shrink-0 whitespace-nowrap text-xs text-text-tertiary"
      >
        {relativeTime(item.createdAt)} · {new Date(item.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
      </time>
    </li>
  );
}

/** One page of the log (its own query), so "Load more" just mounts the next page with the previous page's cursor. */
function LogPage({
  types,
  cursor,
  viewerId,
  isFirst,
  isLast,
  onMore,
}: {
  types: readonly AccessEventType[] | null;
  cursor: string | undefined;
  viewerId?: string | null;
  isFirst: boolean;
  isLast: boolean;
  onMore: (cursor: string) => void;
}) {
  const { data, isLoading, isError, isFetching } = trpc.tenant.accessLog.useQuery({
    cursor,
    limit: 25,
    ...(types ? { type: [...types] } : {}),
  });
  if (isLoading) return <li className="py-3 text-sm text-text-tertiary">Loading…</li>;
  if (isError) return <li className="py-3 text-sm text-red-600">Could not load the access log.</li>;
  const items = (data?.items ?? []) as AccessLogItem[];
  return (
    <>
      {isFirst && items.length === 0 && <li className="py-3 text-sm text-text-tertiary">Nothing here yet.</li>}
      {items.map((item) => (
        <Row key={item.id} item={item} viewerId={viewerId} />
      ))}
      {isLast && data?.nextCursor && (
        <li className="py-3">
          <button type="button" className="btn-secondary btn-sm" disabled={isFetching} onClick={() => onMore(data.nextCursor!)}>
            Load more
          </button>
        </li>
      )}
    </>
  );
}

/**
 * Who was invited, who accepted, role changes, removals, when a CA opened the
 * books and what they downloaded. For owners and admins (the API refuses
 * everyone else, so the card is only mounted for them).
 */
export function AccessLogCard({ viewerId }: { viewerId?: string | null }) {
  const [filter, setFilter] = useState("all");
  const [cursors, setCursors] = useState<string[]>([]);
  const types = ACCESS_LOG_FILTERS.find((f) => f.key === filter)?.types ?? null;
  const pages: Array<string | undefined> = [undefined, ...cursors];

  return (
    <div className="card mt-4 px-6 py-5" data-testid="access-log">
      <h3 className="text-sm font-semibold text-text-primary">Access log</h3>
      <p className="mt-1 text-sm text-text-tertiary">
        Who was invited, who accepted, changes to access, when your CA opened your books and what they downloaded. What they change or file is in the activity log under Account.
      </p>
      <div className="mt-3 overflow-x-auto">
        <PillTabs
          size="sm"
          tabs={ACCESS_LOG_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setCursors([]);
          }}
        />
      </div>
      <ul className="mt-3 divide-y divide-border-light">
        {pages.map((c, i) => (
          <LogPage
            key={`${filter}:${c ?? "first"}`}
            types={types}
            cursor={c}
            viewerId={viewerId}
            isFirst={i === 0}
            isLast={i === pages.length - 1}
            onMore={(next) => setCursors((prev) => [...prev, next])}
          />
        ))}
      </ul>
    </div>
  );
}
