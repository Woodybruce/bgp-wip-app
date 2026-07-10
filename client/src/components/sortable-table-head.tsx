import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { TableSort } from "@/hooks/use-table-sort";

interface SortableTableHeadProps {
  /** The key passed to `sort.toggle()` + matched against the getters map. */
  sortKey: string;
  /** The hook instance — usually `useTableSort()` higher in the component. */
  sort: TableSort;
  children: React.ReactNode;
  className?: string;
  /** Render the click target right-aligned (for numeric / currency columns). */
  align?: "left" | "right" | "center";
  /** Use a raw <th> wrapper instead of shadcn's <TableHead>. Useful when
   *  the surrounding table doesn't use shadcn (raw html table). */
  raw?: boolean;
  testId?: string;
}

/**
 * Drop-in replacement for plain <TableHead>{label}</TableHead>. Renders
 * a click-to-sort button + a chevron indicator. Active column gets the
 * up/down chevron; inactive columns get the two-headed chevron to hint
 * the affordance. Use only on columns whose header is text — sorting
 * by checkbox / icon columns doesn't make sense.
 */
export function SortableTableHead({
  sortKey,
  sort,
  children,
  className,
  align = "left",
  raw = false,
  testId,
}: SortableTableHeadProps) {
  const active = sort.sortKey === sortKey;
  const Icon = active
    ? (sort.direction === "asc" ? ChevronUp : ChevronDown)
    : ChevronsUpDown;
  const justify = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  const inner = (
    <button
      type="button"
      onClick={() => sort.toggle(sortKey)}
      className={`flex items-center gap-1 ${justify} w-full font-medium hover:text-foreground transition-colors ${active ? "text-primary" : ""}`}
      data-testid={testId || `sort-${sortKey}`}
    >
      {children}
      <Icon className={`w-3 h-3 ${active ? "" : "opacity-50"}`} />
    </button>
  );
  if (raw) return <th className={className}>{inner}</th>;
  return <TableHead className={className}>{inner}</TableHead>;
}
