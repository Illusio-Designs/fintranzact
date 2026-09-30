/**
 * Upcoming features ("roadmap"): the platform admin's own board of what is
 * being planned and built. Shared by the API and the admin console.
 */

import { z } from "zod";

export const roadmapStatuses = ["idea", "planned", "in_progress", "done", "dropped"] as const;
export type RoadmapStatus = (typeof roadmapStatuses)[number];

export const roadmapStatusLabels: Record<RoadmapStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
  dropped: "Dropped",
};

export const roadmapPriorities = ["high", "medium", "low"] as const;
export type RoadmapPriority = (typeof roadmapPriorities)[number];

export const roadmapLaunchStages = ["before_launch", "after_launch"] as const;
export type RoadmapLaunchStage = (typeof roadmapLaunchStages)[number];

export const roadmapLaunchStageLabels: Record<RoadmapLaunchStage, string> = {
  before_launch: "Before launch",
  after_launch: "After launch",
};

export const roadmapBillings = ["included", "paid_add_on"] as const;
export type RoadmapBilling = (typeof roadmapBillings)[number];

/** Offered in the category box; any other text is allowed too. */
export const roadmapCategorySuggestions = [
  "Payroll",
  "Inventory",
  "GST",
  "Accounting",
  "Payments",
  "Sales",
  "Mobile",
  "Online store",
  "Website",
  "AI",
  "Integrations",
  "Security",
  "Platform",
  "Other",
] as const;

export const roadmapChecklistItemSchema = z.object({
  text: z.string().trim().min(1, "Checklist lines cannot be empty").max(300),
  done: z.boolean().default(false),
});
export type RoadmapChecklistItem = z.infer<typeof roadmapChecklistItemSchema>;

/** "2026-11" — the month a feature is aimed at. */
export const roadmapTargetSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM");

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const roadmapItemSchema = z.object({
  title: z.string().trim().min(2, "Enter a title").max(200),
  description: z.string().trim().max(20000).default(""),
  category: z.string().trim().min(1, "Enter a category").max(60),
  status: z.enum(roadmapStatuses).default("idea"),
  priority: z.enum(roadmapPriorities).default("medium"),
  launchStage: z.enum(roadmapLaunchStages).default("after_launch"),
  /** Phase number within its category (Payroll phase 1, 2…). */
  phase: z.number().int().min(1).max(99).nullable().optional().transform((v) => v ?? null),
  target: roadmapTargetSchema.nullable().optional().transform((v) => v ?? null),
  billing: z.enum(roadmapBillings).default("included"),
  priceNote: nullableText(200),
  checklist: z.array(roadmapChecklistItemSchema).max(100).default([]),
});
export type RoadmapItemInput = z.input<typeof roadmapItemSchema>;

export const roadmapCreateSchema = roadmapItemSchema;

/** Any subset of the fields; used for edits, status moves and ticking checklist lines. */
export const roadmapUpdateSchema = z.object({
  id: z.string().uuid(),
  title: roadmapItemSchema.shape.title.optional(),
  description: z.string().trim().max(20000).optional(),
  category: roadmapItemSchema.shape.category.optional(),
  status: z.enum(roadmapStatuses).optional(),
  priority: z.enum(roadmapPriorities).optional(),
  launchStage: z.enum(roadmapLaunchStages).optional(),
  phase: z.number().int().min(1).max(99).nullable().optional(),
  target: roadmapTargetSchema.nullable().optional(),
  billing: z.enum(roadmapBillings).optional(),
  priceNote: z.string().trim().max(200).nullable().optional(),
  checklist: z.array(roadmapChecklistItemSchema).max(100).optional(),
});
export type RoadmapUpdateInput = z.input<typeof roadmapUpdateSchema>;

export const roadmapListSchema = z
  .object({
    status: z.enum(roadmapStatuses).optional(),
    launchStage: z.enum(roadmapLaunchStages).optional(),
    category: z.string().trim().max(60).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .default({});

/** The items in the order they should be shown; each gets its position as its sort order. */
export const roadmapReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

export const roadmapDeleteSchema = z.object({ id: z.string().uuid() });

/**
 * Board order: before-launch work first, then high priority before medium
 * and low. Within the same rank the admins' own order (sortOrder) applies.
 */
export function roadmapRank(item: { launchStage: string; priority: string }): number {
  const stage = item.launchStage === "before_launch" ? 0 : 1;
  const priority = roadmapPriorities.indexOf(item.priority as RoadmapPriority);
  return stage * 10 + (priority < 0 ? 1 : priority);
}

/** "3/8" style progress for a checklist. */
export function roadmapProgress(checklist: readonly { done: boolean }[]): { done: number; total: number } {
  return { done: checklist.filter((c) => c.done).length, total: checklist.length };
}
