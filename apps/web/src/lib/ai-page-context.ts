/**
 * What page the person is on, sent with a question so "send this invoice to the
 * customer" knows which invoice. Only allowlisted route patterns produce a
 * context (aiPageContextFromRoute in shared: invoice and quotation by `?id=`, a
 * report by `?report=`, a few list pages); the party and item pages keep their
 * selection in the page, so they publish it here. Ids are UUIDs and are never
 * trusted: the server verifies them through the person's own permissions
 * before anything reaches the model. An unknown route sends nothing.
 */

import { useEffect } from "react";
import { aiPageContextFromRoute, type AiPageContext } from "@fintranzact/shared";

type Entity = { kind: "party" | "item"; id: string } | null;
let entity: Entity = null;

export function setAiPageEntity(next: Entity): void {
  entity = next;
}

/** A page publishes the record the person has open (a party or an item) while it is open. */
export function useAiPageEntity(kind: "party" | "item", id: string | null | undefined): void {
  useEffect(() => {
    if (!id) return;
    const mine = { kind, id };
    setAiPageEntity(mine);
    return () => {
      if (entity === mine) setAiPageEntity(null);
    };
  }, [kind, id]);
}

/** The context for the current location, or null (nothing is sent). Read at the moment a question is sent. */
export function getAiPageContext(loc: { pathname: string; search: string } = window.location): AiPageContext | null {
  try {
    const search: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(loc.search)) if (!(k in search)) search[k] = v;
    return aiPageContextFromRoute(loc.pathname, search, entity);
  } catch {
    return null;
  }
}

/** Tests only. */
export function resetAiPageEntity(): void {
  entity = null;
}
