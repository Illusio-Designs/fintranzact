/**
 * Platform admin → Upcoming features: the operators' own roadmap board.
 * Columns by status on wide screens (drag a card to move it), a stacked list
 * with a status filter on phones. Cards open a detail panel with the full
 * description and a checklist that can be ticked off.
 */

import { Fragment, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Add01Icon, Rocket01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import {
  roadmapCategorySuggestions,
  roadmapLaunchStageLabels,
  roadmapCreateSchema,
  roadmapProgress,
  roadmapStatusLabels,
  roadmapStatuses,
  type RoadmapBilling,
  type RoadmapChecklistItem,
  type RoadmapLaunchStage,
  type RoadmapPriority,
  type RoadmapStatus,
} from "@fintranzact/shared";
import type { RouterOutputs } from "@fintranzact/api";
import { trpc } from "@/lib/trpc";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { SlideOver } from "@/components/ui/SlideOver";
import { SkeletonRows } from "@/components/ui/SkeletonRows";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { InputField, SelectField, TextareaField } from "@/components/ui/FormField";
import { PAGE_TITLE_CLASS } from "@/components/ui/PageHeader";
import { PillTabs } from "@/components/ui/Tabs";
import { descriptionSummary, formatTargetMonth, parseDescription, splitBold } from "./roadmap-format";

type Feature = RouterOutputs["platform"]["roadmapList"]["data"][number];

/** The columns on the board; dropped features are shown only when asked for. */
const BOARD_STATUSES: RoadmapStatus[] = ["idea", "planned", "in_progress", "done"];

const PRIORITY_LABEL: Record<RoadmapPriority, string> = { high: "High", medium: "Medium", low: "Low" };
const PRIORITY_TONE: Record<RoadmapPriority, Tone> = { high: "red", medium: "amber", low: "grey" };
const STATUS_DOT: Record<RoadmapStatus, string> = {
  idea: "bg-slate-400",
  planned: "bg-brand-500",
  in_progress: "bg-amber-500",
  done: "bg-emerald-500",
  dropped: "bg-red-400",
};

type Tone = "green" | "grey" | "blue" | "amber" | "red" | "navy";

function Chip({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    grey: "bg-surface-2 text-text-secondary",
    blue: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    navy: "bg-[#0f1b3d] text-white dark:bg-brand-500 dark:text-white",
  };
  return <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

function StageChip({ stage }: { stage: RoadmapLaunchStage }) {
  return <Chip tone={stage === "before_launch" ? "navy" : "grey"}>{roadmapLaunchStageLabels[stage] ?? stage}</Chip>;
}

// ── Description: light markdown (headings, bullets, numbered lists, **bold**) ──

function Inline({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold text-text-primary">{p.text}</strong>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function Description({ text }: { text: string }) {
  const blocks = useMemo(() => parseDescription(text), [text]);
  if (!blocks.length) return <p className="text-sm text-text-tertiary">No description yet.</p>;
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-text-secondary">
      {blocks.map((b, i) =>
        b.kind === "h" ? (
          <h4 key={i} className="pt-1 text-xs font-bold uppercase tracking-wide text-text-tertiary">{b.text}</h4>
        ) : b.kind === "p" ? (
          <p key={i}><Inline text={b.text} /></p>
        ) : b.kind === "ul" ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-text-tertiary">
            {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
          </ul>
        ) : (
          <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-text-tertiary">
            {b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}
          </ol>
        ),
      )}
    </div>
  );
}

function Progress({ checklist }: { checklist: RoadmapChecklistItem[] }) {
  const { done, total } = roadmapProgress(checklist);
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="flex items-center gap-2" aria-label={`${done} of ${total} tasks done`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full", done === total ? "bg-emerald-500" : "bg-brand-600")} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums text-text-tertiary">{done}/{total}</span>
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────────────

export function RoadmapView() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [stage, setStage] = useState<RoadmapLaunchStage | "all">("all");
  const [mobileStatus, setMobileStatus] = useState<RoadmapStatus | "all">("all");
  const [showDropped, setShowDropped] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Feature | "new" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<RoadmapStatus | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = trpc.platform.roadmapList.useQuery(
    { search: debounced || undefined, category: category || undefined, launchStage: stage === "all" ? undefined : stage },
    { placeholderData: keepPreviousData },
  );
  const items = useMemo(() => data?.data ?? [], [data]);
  const counts = data?.counts;
  const open = items.find((i) => i.id === openId) ?? null;

  const refresh = () => utils.platform.roadmapList.invalidate();
  const update = trpc.platform.roadmapUpdate.useMutation({
    onSuccess: refresh,
    onError: (err) => toast.error("Could not update the feature", err.message),
  });
  const reorder = trpc.platform.roadmapReorder.useMutation({
    onSuccess: refresh,
    onError: (err) => toast.error("Could not reorder", err.message),
  });

  const moveTo = (item: Feature, status: RoadmapStatus) => {
    if (item.status === status) return;
    update.mutate(
      { id: item.id, status },
      { onSuccess: () => toast.success(`Moved to ${roadmapStatusLabels[status]}`, item.title) },
    );
  };

  /** Drop a dragged card into a column, before `beforeId` (or at the end). */
  const dropInto = (status: RoadmapStatus, beforeId: string | null) => {
    const dragged = items.find((i) => i.id === dragId);
    setDragId(null);
    setDropTarget(null);
    if (!dragged || dragged.id === beforeId) return;
    const column = items.filter((i) => i.status === status && i.id !== dragged.id);
    const at = beforeId ? column.findIndex((i) => i.id === beforeId) : -1;
    column.splice(at < 0 ? column.length : at, 0, dragged);
    // Keep every other card where it is; this column's cards take its slots in the new order.
    const others = items.filter((i) => i.status !== status && i.id !== dragged.id);
    const ordered = [...others, ...column].map((i) => i.id);
    if (dragged.status !== status) moveTo(dragged, status);
    reorder.mutate({ ids: ordered });
  };

  const columns = showDropped ? [...BOARD_STATUSES, "dropped" as const] : BOARD_STATUSES;
  const mobileItems = items.filter((i) =>
    mobileStatus === "all" ? showDropped || i.status !== "dropped" : i.status === mobileStatus,
  );
  const categories = [...new Set([...roadmapCategorySuggestions, ...(data?.categories ?? [])])];
  const total = counts ? BOARD_STATUSES.reduce((s, k) => s + counts[k], 0) : 0;

  return (
    <>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className={PAGE_TITLE_CLASS}>Upcoming features</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-tertiary">
            What we are planning and building next. Only platform admins see this board; open a feature for its full notes and
            checklist.
          </p>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setEditing("new")}>
          <Icon icon={Add01Icon} size={16} />
          Add feature
        </button>
      </div>

      <section className="rounded-2xl border border-border-light bg-surface-0">
        <div className="border-b border-border-light px-4 py-3">
          <PillTabs
            value={stage}
            onChange={(v) => setStage(v as typeof stage)}
            className="flex-wrap"
            tabs={[
              { value: "all", label: "All", count: data ? data.stageCounts.before_launch + data.stageCounts.after_launch : undefined },
              { value: "before_launch", label: roadmapLaunchStageLabels.before_launch, count: data?.stageCounts.before_launch },
              { value: "after_launch", label: roadmapLaunchStageLabels.after_launch, count: data?.stageCounts.after_launch },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-border-light bg-surface-0 px-3 sm:w-72">
            <Icon icon={Search01Icon} size={16} className="text-text-tertiary" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search features"
              aria-label="Search features"
              className="w-full min-w-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </label>
          <div className="w-full sm:w-48">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div className="w-full lg:hidden">
            <Select value={mobileStatus} onChange={(e) => setMobileStatus(e.target.value as typeof mobileStatus)} aria-label="Status">
              <option value="all">All statuses · {total}</option>
              {roadmapStatuses.map((s) => (
                <option key={s} value={s}>{roadmapStatusLabels[s]} · {counts?.[s] ?? 0}</option>
              ))}
            </Select>
          </div>
          <div className="hidden flex-1 lg:block" />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={showDropped} onChange={(e) => setShowDropped(e.target.checked)} className="h-4 w-4 accent-brand-600" />
            Show dropped{counts?.dropped ? ` (${counts.dropped})` : ""}
          </label>
        </div>
      </section>

      {isLoading ? (
        <SkeletonRows count={4} height="h-28" />
      ) : (
        <>
          {/* Desktop: one column per status. */}
          <div className={cn("hidden gap-3 lg:grid", showDropped ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
            {columns.map((status) => {
              const cards = items.filter((i) => i.status === status);
              return (
                <section
                  key={status}
                  aria-label={roadmapStatusLabels[status]}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    setDropTarget(status);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropInto(status, null);
                  }}
                  className={cn(
                    "flex min-w-0 flex-col rounded-2xl border bg-surface-0 transition-colors",
                    dropTarget === status ? "border-brand-400 bg-brand-50/40 dark:bg-brand-950/40" : "border-border-light",
                  )}
                >
                  <header className="flex items-center gap-2 border-b border-border-light px-3 py-2.5">
                    <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[status])} />
                    <h2 className="flex-1 text-sm font-bold text-text-primary">{roadmapStatusLabels[status]}</h2>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-text-secondary">
                      {counts?.[status] ?? cards.length}
                    </span>
                  </header>
                  <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                    {cards.length === 0 ? (
                      <p className="px-2 py-6 text-center text-xs text-text-tertiary">
                        {dragId ? "Drop here" : "Nothing here"}
                      </p>
                    ) : (
                      cards.map((item) => (
                        <FeatureCard
                          key={item.id}
                          item={item}
                          compact
                          dragging={dragId === item.id}
                          onOpen={() => setOpenId(item.id)}
                          onMove={(s) => moveTo(item, s)}
                          dragProps={{
                            draggable: true,
                            onDragStart: (e: DragEvent) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", item.id);
                              setDragId(item.id);
                            },
                            onDragEnd: () => {
                              setDragId(null);
                              setDropTarget(null);
                            },
                            onDrop: (e: DragEvent) => {
                              e.preventDefault();
                              e.stopPropagation();
                              dropInto(status, item.id);
                            },
                          }}
                        />
                      ))
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Phones and tablets: one stacked list, filtered by status. */}
          <div className="space-y-2 lg:hidden">
            {mobileItems.length === 0 ? (
              <EmptyBoard filtered={!!debounced || !!category || mobileStatus !== "all"} />
            ) : (
              mobileItems.map((item) => (
                <FeatureCard key={item.id} item={item} showStatus={mobileStatus === "all"} onOpen={() => setOpenId(item.id)} onMove={(s) => moveTo(item, s)} />
              ))
            )}
          </div>

          {items.length === 0 ? (
            <div className="hidden lg:block">
              <EmptyBoard filtered={!!debounced || !!category} />
            </div>
          ) : null}
        </>
      )}

      <FeatureDetail
        item={open}
        onClose={() => setOpenId(null)}
        onEdit={() => {
          setEditing(open);
          setOpenId(null);
        }}
        onChange={(changes) => open && update.mutate({ id: open.id, ...changes })}
      />
      <FeatureForm feature={editing} categories={categories} onClose={() => setEditing(null)} />
    </>
  );
}

function EmptyBoard({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-border-light bg-surface-0 px-4 py-14 text-center">
      <Icon icon={Rocket01Icon} size={26} className="text-text-tertiary" />
      <p className="text-sm font-semibold text-text-primary">{filtered ? "No features match" : "No features yet"}</p>
      <p className="text-sm text-text-tertiary">{filtered ? "Try another search, category or status." : "Add the first one with “Add feature”."}</p>
    </div>
  );
}

function FeatureCard({
  item,
  compact,
  showStatus,
  dragging,
  onOpen,
  onMove,
  dragProps,
}: {
  item: Feature;
  compact?: boolean;
  showStatus?: boolean;
  dragging?: boolean;
  onOpen: () => void;
  onMove: (status: RoadmapStatus) => void;
  dragProps?: Record<string, unknown>;
}) {
  const priority = item.priority;
  const summary = descriptionSummary(item.description);
  const target = formatTargetMonth(item.target);
  return (
    <article
      {...dragProps}
      className={cn(
        "rounded-xl border border-border-light bg-surface-0 p-3 shadow-[0_1px_2px_rgba(15,27,61,.04)] transition",
        compact && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StageChip stage={item.launchStage} />
        <Chip tone="blue">{item.category}</Chip>
        <Chip tone={PRIORITY_TONE[priority] ?? "grey"}>{PRIORITY_LABEL[priority] ?? item.priority}</Chip>
        {item.billing === "paid_add_on" ? <Chip tone="green">Paid add-on</Chip> : null}
        {showStatus ? (
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary">
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[item.status])} />
            {roadmapStatusLabels[item.status]}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 block w-full text-left text-sm font-semibold leading-snug text-text-primary hover:text-brand-600"
      >
        {item.title}
      </button>
      {summary ? <p className={cn("mt-1 text-xs text-text-tertiary", compact ? "line-clamp-2" : "line-clamp-3")}>{summary}</p> : null}
      {item.phase || target ? (
        <p className="mt-1.5 text-xs text-text-tertiary">
          {[item.phase ? `Phase ${item.phase}` : null, target ? `Target ${target}` : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {item.checklist.length ? (
        <div className="mt-2">
          <Progress checklist={item.checklist} />
        </div>
      ) : null}
      <div className="mt-2.5 flex items-center gap-2 border-t border-border-light pt-2.5">
        <div className="min-w-0 flex-1">
          <Select
            value={item.status}
            onChange={(e) => onMove(e.target.value as RoadmapStatus)}
            aria-label={`Status of ${item.title}`}
            className="h-8 text-xs"
          >
            {roadmapStatuses.map((s) => (
              <option key={s} value={s}>{roadmapStatusLabels[s]}</option>
            ))}
          </Select>
        </div>
        <button type="button" className="btn-ghost shrink-0 text-xs" onClick={onOpen}>
          Details
        </button>
      </div>
    </article>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────

function FeatureDetail({
  item,
  onClose,
  onEdit,
  onChange,
}: {
  item: Feature | null;
  onClose: () => void;
  onEdit: () => void;
  onChange: (changes: { status?: RoadmapStatus; checklist?: RoadmapChecklistItem[] }) => void;
}) {
  const utils = trpc.useUtils();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = trpc.platform.roadmapDelete.useMutation({
    onSuccess: async () => {
      toast.success("Feature deleted", item?.title);
      setConfirmDelete(false);
      onClose();
      await utils.platform.roadmapList.invalidate();
    },
    onError: (err) => toast.error("Could not delete the feature", err.message),
  });

  if (!item) return <SlideOver open={false} onClose={onClose} title="" children={null} />;
  const priority = item.priority;
  const target = formatTargetMonth(item.target);
  const toggle = (index: number) =>
    onChange({ checklist: item.checklist.map((c, i) => (i === index ? { ...c, done: !c.done } : c)) });

  return (
    <>
      <SlideOver
        open={!!item}
        onClose={onClose}
        title={item.title}
        description={[item.category, item.phase ? `Phase ${item.phase}` : null, target ? `Target ${target}` : null].filter(Boolean).join(" · ")}
        footer={
          <div className="flex w-full items-center gap-2">
            <button type="button" className="btn-ghost text-red-600" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
            <div className="flex-1" />
            <button type="button" className="btn-secondary" onClick={onEdit}>
              Edit feature
            </button>
          </div>
        }
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StageChip stage={item.launchStage} />
            <Chip tone={PRIORITY_TONE[priority] ?? "grey"}>{PRIORITY_LABEL[priority] ?? item.priority} priority</Chip>
            {item.billing === "paid_add_on" ? <Chip tone="green">Paid add-on</Chip> : <Chip tone="grey">Included in plans</Chip>}
          </div>
          {item.billing === "paid_add_on" && item.priceNote ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              Pricing: {item.priceNote}
            </p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Status</h3>
            <Select value={item.status} onChange={(e) => onChange({ status: e.target.value as RoadmapStatus })} aria-label="Status">
              {roadmapStatuses.map((s) => (
                <option key={s} value={s}>{roadmapStatusLabels[s]}</option>
              ))}
            </Select>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-tertiary">Details</h3>
            <div className="rounded-2xl bg-surface-1 px-4 py-3">
              <Description text={item.description} />
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-center gap-3">
              <h3 className="flex-1 text-xs font-bold uppercase tracking-wide text-text-tertiary">Checklist</h3>
              {item.checklist.length ? (
                <span className="text-xs font-semibold tabular-nums text-text-tertiary">
                  {roadmapProgress(item.checklist).done}/{item.checklist.length} done
                </span>
              ) : null}
            </div>
            {item.checklist.length === 0 ? (
              <p className="text-sm text-text-tertiary">No checklist. Add tasks with “Edit feature”.</p>
            ) : (
              <>
                <Progress checklist={item.checklist} />
                <ul className="divide-y divide-border-light overflow-hidden rounded-2xl border border-border-light">
                  {item.checklist.map((c, i) => (
                    <li key={i}>
                      <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-surface-1">
                        <input
                          type="checkbox"
                          checked={c.done}
                          onChange={() => toggle(i)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                        />
                        <span className={cn("min-w-0 break-words", c.done ? "text-text-tertiary line-through" : "text-text-primary")}>{c.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      </SlideOver>
      <ConfirmDialog
        open={confirmDelete}
        variant="danger"
        title={`Delete “${item.title}”?`}
        description="It is removed from the board with its checklist. This cannot be undone."
        confirmLabel="Delete feature"
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutate({ id: item.id })}
      />
    </>
  );
}

// ── Add / edit form ──────────────────────────────────────────────────────

interface FormState {
  title: string;
  description: string;
  category: string;
  status: RoadmapStatus;
  priority: RoadmapPriority;
  launchStage: RoadmapLaunchStage;
  phase: string;
  target: string;
  billing: RoadmapBilling;
  priceNote: string;
  checklist: string;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  category: "",
  status: "idea",
  priority: "medium",
  launchStage: "after_launch",
  phase: "",
  target: "",
  billing: "included",
  priceNote: "",
  checklist: "",
};

function FeatureForm({ feature, categories, onClose }: { feature: Feature | "new" | null; categories: string[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  // Problems show as a goey toast.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
  const existing = feature && feature !== "new" ? feature : null;

  useEffect(() => {
    if (!feature) return;
    setError(null);
    setForm(
      feature === "new"
        ? EMPTY_FORM
        : {
            title: feature.title,
            description: feature.description,
            category: feature.category,
            status: feature.status,
            priority: feature.priority,
            launchStage: feature.launchStage,
            phase: feature.phase ? String(feature.phase) : "",
            target: feature.target ?? "",
            billing: feature.billing,
            priceNote: feature.priceNote ?? "",
            checklist: feature.checklist.map((c) => c.text).join("\n"),
          },
    );
  }, [feature]);

  const done = async (title: string, verb: string) => {
    toast.success(`Feature ${verb}`, title);
    await utils.platform.roadmapList.invalidate();
    onClose();
  };
  const create = trpc.platform.roadmapCreate.useMutation({
    onSuccess: (row) => done(row.title, "added"),
    onError: (err) => setError(err.message),
  });
  const update = trpc.platform.roadmapUpdate.useMutation({
    onSuccess: (row) => done(row.title, "saved"),
    onError: (err) => setError(err.message),
  });

  if (!feature) return <SlideOver open={false} onClose={onClose} title="" children={null} />;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  function handleSave() {
    // Lines keep their tick when their text is unchanged.
    const ticked = new Set(existing?.checklist.filter((c) => c.done).map((c) => c.text) ?? []);
    const checklist = form.checklist
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*•]|\[[ xX]?\])\s*/, "").trim())
      .filter(Boolean)
      .map((text) => ({ text, done: ticked.has(text) }));
    const payload = {
      title: form.title,
      description: form.description,
      category: form.category,
      status: form.status,
      priority: form.priority,
      launchStage: form.launchStage,
      phase: form.phase.trim() ? Number(form.phase) : null,
      target: form.target || null,
      billing: form.billing,
      priceNote: form.billing === "paid_add_on" ? form.priceNote : null,
      checklist,
    };
    const parsed = roadmapCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue?.path.join(" › ") || "Feature"}: ${issue?.message}`);
      return;
    }
    setError(null);
    if (existing) update.mutate({ id: existing.id, ...parsed.data });
    else create.mutate(parsed.data);
  }

  const saving = create.isPending || update.isPending;

  return (
    <SlideOver
      open={!!feature}
      onClose={onClose}
      title={existing ? "Edit feature" : "Add feature"}
      description={existing ? existing.title : "Put a new feature on the board."}
      footer={
        <div className="flex w-full items-center gap-2">
          <div className="flex-1" />
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : existing ? "Save feature" : "Add feature"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <InputField label="Title" required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Payroll — Phase 1" />
        <TextareaField
          label="Description"
          className="min-h-40"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={"What it is and why.\n\n### Section\n- A bullet\n- **Bold** text"}
        />
        <p className="-mt-2 text-xs text-text-tertiary">Use “- ” for bullets, “### ” for headings and **text** for bold.</p>
        <InputField
          label="Category"
          required
          list="roadmap-categories"
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          placeholder="Payroll, Inventory, GST…"
        />
        <datalist id="roadmap-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Status" value={form.status} onChange={(e) => set("status", e.target.value as RoadmapStatus)}>
            {roadmapStatuses.map((s) => (
              <option key={s} value={s}>{roadmapStatusLabels[s]}</option>
            ))}
          </SelectField>
          <SelectField label="Priority" value={form.priority} onChange={(e) => set("priority", e.target.value as RoadmapPriority)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </SelectField>
          <InputField label="Phase" type="number" min={1} max={99} value={form.phase} onChange={(e) => set("phase", e.target.value)} placeholder="—" />
          <InputField label="Target month" type="month" value={form.target} onChange={(e) => set("target", e.target.value)} />
        </div>
        <SelectField label="Launch stage" value={form.launchStage} onChange={(e) => set("launchStage", e.target.value as RoadmapLaunchStage)}>
          <option value="before_launch">{roadmapLaunchStageLabels.before_launch}</option>
          <option value="after_launch">{roadmapLaunchStageLabels.after_launch}</option>
        </SelectField>
        <SelectField label="Billing" value={form.billing} onChange={(e) => set("billing", e.target.value as RoadmapBilling)}>
          <option value="included">Included in plans</option>
          <option value="paid_add_on">Paid add-on</option>
        </SelectField>
        {form.billing === "paid_add_on" ? (
          <InputField
            label="Price note"
            value={form.priceNote}
            onChange={(e) => set("priceNote", e.target.value)}
            placeholder="Per employee per month; pricing TBD"
          />
        ) : null}
        <TextareaField
          label="Checklist (one task per line)"
          className="min-h-32"
          value={form.checklist}
          onChange={(e) => set("checklist", e.target.value)}
          placeholder={"Employee master\nPayslip PDF\nBank file"}
        />
      </div>
    </SlideOver>
  );
}
