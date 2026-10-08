/**
 * Payroll Phase 4: the relieving letter. The wording is a per-business template with placeholders; the letter is drawn as a
 * PDF for an employee who has left. HR, accountants, owners and admins (Payroll update). Each letter generated is audited.
 * No digital signature is claimed.
 */

import { z } from "zod";
import { LETTER_PLACEHOLDERS, letterGenerateSchema, letterTemplateSchema } from "@fintranzact/shared";
import { router, viewerProcedure, memberProcedure } from "../trpc.js";
import { withAudit } from "../lib/audit.js";
import { assertPayroll } from "../lib/payroll/access.js";
import { generateRelievingLetter, getLetterTemplate, saveLetterTemplate } from "../lib/payroll/letters.js";

export const payrollLetterRouter = router({
  /** The wording in use (the shipped default until the business saves its own) and the placeholders it may use. */
  template: viewerProcedure.input(z.object({ kind: z.enum(["relieving"]).default("relieving") })).query(async ({ ctx, input }) => {
    await assertPayroll(ctx, "read");
    return { ...(await getLetterTemplate(ctx.db, ctx.businessId, input.kind)), placeholders: [...LETTER_PLACEHOLDERS] };
  }),

  saveTemplate: memberProcedure.input(letterTemplateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      return saveLetterTemplate(ctx.db, { businessId: ctx.businessId, userId: ctx.user.id, kind: input.kind, title: input.title, body: input.body, signatoryName: input.signatoryName, signatoryTitle: input.signatoryTitle, place: input.place });
    }, (r) => ({ action: "payroll.letter.saveTemplate", entityType: "letterTemplate", entityId: null, metadata: { kind: r.kind } })),
  ),

  /**
   * The relieving letter of an employee who has left, as a PDF (base64). It is a mutation-free read in effect, but it is
   * audited because it is a document about a person, so it is a mutation here.
   */
  relievingPdf: memberProcedure.input(letterGenerateSchema).mutation(
    withAudit(async ({ ctx, input }) => {
      await assertPayroll(ctx, "update");
      const l = await generateRelievingLetter(ctx.db, ctx.businessId, input.employeeId);
      return { filename: l.filename, contentType: "application/pdf" as const, base64: l.pdf.toString("base64"), employeeId: input.employeeId, employeeCode: l.employeeCode };
    }, (r) => ({ action: "payroll.letter.generate", entityType: "employee", entityId: r.employeeId, metadata: { kind: "relieving", employeeCode: r.employeeCode } })),
  ),
});
