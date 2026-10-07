/**
 * The per-kind registry contract of the assistant's actions (Phase 2).
 *
 * An action kind knows how to: turn the model's small proposal into the REAL
 * procedure's input (resolving parties and items by id, never by name alone),
 * show exactly what will be saved (using the same calculation as the real
 * procedure), apply a person's edits from the card, and, only when the person
 * confirms, run the real tRPC procedure through a caller built from their own
 * context. The model never reaches `execute`.
 */

import type { z } from "zod";
import type { TenantDatabase } from "@fintranzact/db";
import type { AiActionKind, AiActionPreview, AiActionResult } from "@fintranzact/shared";
import type { appRouter } from "../../../router.js";
import type { AppAbility } from "../../permissions.js";

export type AiCaller = ReturnType<typeof appRouter.createCaller>;

export interface AiActionCtx {
  db: TenantDatabase;
  tenantId: string;
  businessId: string;
  user: { id: string; name?: string | null };
  role: string;
  ability: AppAbility;
  ipAddress?: string | null;
  /** The person's own caller: every read and the final write go through their permissions. */
  caller: AiCaller;
  now?: Date;
}

/** A validated proposal: the real procedure's input, what the card shows, and a one-line summary. */
export interface BuiltAction {
  payload: Record<string, unknown>;
  preview: AiActionPreview;
  summary: string;
}

export interface AiActionDef {
  kind: AiActionKind;
  toolName: string;
  /** Shown to the model. */
  description: string;
  /** JSON schema properties shown to the model. */
  properties: Record<string, unknown>;
  required?: string[];
  inputSchema: z.ZodTypeAny;
  /** Model input to a built action. Throws AiToolInputError with a message for the MODEL (ambiguity, not found, wrong value). */
  propose(ctx: AiActionCtx, input: never): Promise<BuiltAction>;
  /** Rebuild from the stored payload (after an edit, or to refresh the card). */
  build(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<BuiltAction>;
  /** Apply a person's edits (keys from the card's `edits`) to the stored payload. Throws AiActionEditError. */
  applyEdits(payload: Record<string, unknown>, edits: Record<string, string>): Record<string, unknown>;
  /** Run the real procedure as the person. Throws what the procedure throws. */
  execute(ctx: AiActionCtx, payload: Record<string, unknown>): Promise<AiActionResult>;
}
