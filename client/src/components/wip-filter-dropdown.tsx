import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, Search } from "lucide-react";

function formatFee(value: number): string {
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Multi-select dropdown filter used by the WIP report and dashboard WIP card.
// Empty selection = no filter (everything shows); any tick narrows.
export function FilterDropdown({
  title,
  items,
  selected,
  onToggle,
  onSelectAll,
  onClearAll,
  values,
  getLabel,
}: {
  title: string;
  items: string[];
  selected: Set<string>;
  onToggle: (item: string) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
  values?: Record<string, number>;
  getLabel?: (item: string) => string;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const label = (item: string) => (getLabel ? getLabel(item) : item);
  const filtered = searchTerm
    ? items.filter((i) => {
        const q = searchTerm.toLowerCase();
        return i.toLowerCase().includes(q) || label(i).toLowerCase().includes(q);
      })
    : items;
  const isFiltered = selected.size > 0;
  const slug = title.toLowerCase().replace(/\s/g, "-");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`h-8 gap-1.5 ${isFiltered ? "border-green-600 bg-green-50 text-green-800 hover:bg-green-100" : ""}`}
          data-testid={`wip-filter-${slug}`}
        >
          {title}
          {isFiltered && (
            <Badge variant="secondary" className="text-[10px] h-4 px-1 bg-green-600 text-white hover:bg-green-600">
              {selected.size}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="bg-gray-50 border-b px-3 py-2 flex items-center justify-between rounded-t-md">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
          {(onSelectAll || onClearAll) && (
            <div className="flex gap-2">
              {onSelectAll && (
                <button onClick={onSelectAll} className="text-[10px] text-blue-600 hover:underline" data-testid={`wip-filter-selectall-${slug}`}>
                  Select all
                </button>
              )}
              {onClearAll && (
                <button onClick={onClearAll} className="text-[10px] text-blue-600 hover:underline" data-testid={`wip-filter-clearall-${slug}`}>
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
        {items.length > 6 && (
          <div className="px-2 pt-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <Input
                placeholder="Search..."
                className="h-7 text-xs pl-6"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid={`wip-filter-search-${slug}`}
              />
            </div>
          </div>
        )}
        <div className="max-h-72 overflow-y-auto px-2 py-1.5">
          {filtered.length === 0 ? (
            <div className="px-1 py-2 text-xs text-gray-400">No matches</div>
          ) : (
            filtered.map((item) => (
              <label
                key={item}
                className="flex items-center gap-2 py-1 px-1 text-xs text-gray-700 cursor-pointer rounded hover:bg-gray-50"
              >
                <Checkbox
                  checked={selected.has(item)}
                  onCheckedChange={() => onToggle(item)}
                  className="h-3.5 w-3.5"
                  data-testid={`wip-filter-checkbox-${slug}-${item}`}
                />
                <span className="truncate flex-1">{label(item)}</span>
                {values && (
                  <span className="font-mono text-gray-500 whitespace-nowrap">
                    {formatFee(values[item] || 0)}
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
