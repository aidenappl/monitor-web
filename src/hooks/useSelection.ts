"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * Row selection for a list of ids — the state behind every bulk action bar.
 *
 * Shift-click extends from the last plain click, and the range takes the state
 * the clicked row is moving to (the same rule the issues list uses), so a range
 * can both select and deselect.
 *
 * Selected ids that are no longer in `ids` — deleted, filtered out, paged away —
 * are dropped from what this returns WITHOUT an effect: the set is intersected
 * with the visible ids on every render. A bulk delete can then never act on a
 * row the user can no longer see.
 */
export function useSelection(ids: string[]) {
  const [raw, setRaw] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);

  const selectedIds = useMemo(() => ids.filter((id) => raw.has(id)), [ids, raw]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = useCallback(
    (id: string, opts?: { shiftKey?: boolean }) => {
      setRaw((prev) => {
        const next = new Set(prev);
        const target = !prev.has(id);
        if (opts?.shiftKey && anchor.current && anchor.current !== id) {
          const a = ids.indexOf(anchor.current);
          const b = ids.indexOf(id);
          if (a >= 0 && b >= 0) {
            const [lo, hi] = a < b ? [a, b] : [b, a];
            for (let i = lo; i <= hi; i++) {
              if (target) next.add(ids[i]);
              else next.delete(ids[i]);
            }
            return next;
          }
        }
        if (target) next.add(id);
        else next.delete(id);
        return next;
      });
      if (!opts?.shiftKey) anchor.current = id;
    },
    [ids],
  );

  const allSelected = ids.length > 0 && selectedIds.length === ids.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setRaw(allSelected ? new Set() : new Set(ids));
    anchor.current = null;
  }, [allSelected, ids]);

  const clear = useCallback(() => {
    setRaw(new Set());
    anchor.current = null;
  }, []);

  return {
    selectedIds,
    count: selectedIds.length,
    isSelected: (id: string) => selectedSet.has(id),
    toggle,
    toggleAll,
    clear,
    allSelected,
    someSelected,
  };
}

export type Selection = ReturnType<typeof useSelection>;
