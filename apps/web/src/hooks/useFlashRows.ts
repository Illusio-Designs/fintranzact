import { useEffect, useRef, useState } from "react";

type Row = { id: string; updatedAt?: string | Date | null };

const stamp = (r: Row) => `${r.id}@${r.updatedAt ? new Date(r.updatedAt).getTime() : ""}`;

/**
 * Rows that were just added or saved while you were looking at the list, so
 * the list can glow them green for a moment. `scope` is everything that picks
 * the rows (page, filters, search, sort): when it changes the list is simply
 * a different view, and nothing flashes.
 */
export function useFlashRows(rows: Row[] | undefined, scope: string): Set<string> {
  const seen = useRef<Map<string, string> | null>(null);
  const lastScope = useRef(scope);
  const [flash, setFlash] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!rows) return;
    const now = new Map(rows.map((r) => [r.id, stamp(r)]));
    const prev = seen.current;
    const sameView = lastScope.current === scope;
    seen.current = now;
    lastScope.current = scope;
    if (!prev || !sameView) return;
    const fresh = rows.filter((r) => prev.get(r.id) !== stamp(r)).map((r) => r.id);
    if (!fresh.length || fresh.length === rows.length) return;
    setFlash(new Set(fresh));
    const t = setTimeout(() => setFlash(new Set()), 1700);
    return () => clearTimeout(t);
  }, [rows, scope]);

  return flash;
}
