import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/**
 * Click-to-sort state for table headers. The hook owns the sort key +
 * direction and exposes a `sorted()` helper that applies them to any
 * array using a caller-supplied getter map. en-GB localeCompare for
 * strings; numeric subtract for numbers; null/undefined always sort
 * to the bottom regardless of direction (the "no value" rows pile up
 * at the end where they're less of a distraction).
 *
 *   const sort = useTableSort<Deal>("name", "asc");
 *   const visible = sort.sorted(deals, {
 *     name: (d) => d.name,
 *     fee:  (d) => d.fee,
 *     date: (d) => d.completedAt,
 *   });
 *   <SortableTableHead sortKey="name" sort={sort}>Property</SortableTableHead>
 *
 * Generic K lets TypeScript narrow the getter map keys to the union
 * the caller passes — typos are caught at compile time.
 */
export function useTableSort<T>(initialKey: string | null = null, initialDirection: SortDirection = "asc") {
  const [sortKey, setSortKey] = useState<string | null>(initialKey);
  const [direction, setDirection] = useState<SortDirection>(initialDirection);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setDirection(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDirection("asc");
    }
  };

  function sorted<U extends T>(rows: U[], getters: Record<string, (row: U) => string | number | Date | null | undefined>): U[] {
    if (!sortKey) return rows;
    const get = getters[sortKey];
    if (!get) return rows;
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Nulls always at the bottom — flip the sign so "missing" stays
      // out of the way regardless of asc/desc.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sign;
      if (va instanceof Date && vb instanceof Date) return (va.getTime() - vb.getTime()) * sign;
      return String(va).localeCompare(String(vb), "en-GB", { sensitivity: "base" }) * sign;
    });
  }

  return useMemo(() => ({ sortKey, direction, toggle, sorted }), [sortKey, direction]);
}

export type TableSort = ReturnType<typeof useTableSort>;
