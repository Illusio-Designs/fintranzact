/**
 * Free quantities and GRN rejections on document lines.
 *
 * A line's `quantity` is what is billed: price, discount and GST apply to it
 * and nothing else. `freeQuantity` is goods given (or received) on top at no
 * charge — a "10 + 1" scheme — so it moves stock with the billed quantity but
 * adds nothing to the taxable value. On a goods receipt note `quantity` is
 * what was accepted, and `rejectedQuantity` what was received but turned
 * away at inspection: it never enters stock and stays pending on the order.
 */
import { TRPCError } from "@trpc/server";
import { freeQuantityDocumentTypes } from "@fintranzact/shared";

type LineInput = {
  itemName: string;
  freeQuantity?: string | null;
  rejectedQuantity?: string | null;
  rejectionReason?: string | null;
};

const positive = (v: string | null | undefined) => parseFloat(v || "0") > 0;

/** Refuse free or rejected quantities on documents that can't carry them. */
export function assertLineExtras(documentType: string, lines: LineInput[]) {
  for (const li of lines) {
    if (positive(li.freeQuantity) && !(freeQuantityDocumentTypes as readonly string[]).includes(documentType)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `A ${documentType.replace(/_/g, " ")} can't have free quantities (${li.itemName})`,
      });
    }
    if (positive(li.rejectedQuantity) && documentType !== "goods_receipt_note") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Only a goods receipt note can record rejected goods (${li.itemName})`,
      });
    }
    if (positive(li.rejectedQuantity) && !li.rejectionReason?.trim()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Give a reason for rejecting ${li.itemName}` });
    }
  }
}

/** The free/rejection columns of a line as stored. */
export function lineExtras(li: LineInput) {
  const rejected = positive(li.rejectedQuantity) ? li.rejectedQuantity! : "0";
  const reason = li.rejectionReason?.trim();
  return {
    freeQuantity: positive(li.freeQuantity) ? li.freeQuantity! : "0",
    rejectedQuantity: rejected,
    rejectionReason: rejected !== "0" && reason ? reason : null,
  };
}
