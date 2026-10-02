import { useCallback, useState } from "react";
import { PAGE_SIZE_OPTIONS } from "@/components/ui/Pagination";

const storageKey = (list: string) => `fintranzact_page_size_${list}`;

/**
 * Rows per page for one list, remembered on this device so the choice
 * survives a reload. Falls back to `fallback` when storage is unavailable or
 * holds something unexpected.
 */
export function usePageSize(list: string, fallback = 25): [number, (size: number) => void] {
  const [size, setSize] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey(list)));
      return PAGE_SIZE_OPTIONS.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });
  const update = useCallback(
    (next: number) => {
      setSize(next);
      try {
        localStorage.setItem(storageKey(list), String(next));
      } catch {
        /* private window or blocked storage: the choice lasts for this visit */
      }
    },
    [list],
  );
  return [size, update];
}
