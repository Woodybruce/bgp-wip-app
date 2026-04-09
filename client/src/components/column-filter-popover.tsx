import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Search, ChevronDown, X } from "lucide-react";

export function ColumnFilterPopover({
  label,
  options,
  activeFilters,
  onToggleFilter,
}: {
  label: string;
  options: string[];
  activeFilters: string[];
  onToggleFilter: (value: string) => void;
}) {
  const [filterSearch, setFilterSearch] = useState("");
  const filteredOptions = options.filter((v) =>
    v.toLowerCase().includes(filterSearch.toLowerCase())
  );
  const hasActive = activeFilters.length > 0;

  if (options.length === 0) {
    return <span>{label}</span>;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
            hasActive ? "text-primary font-semibold" : ""
          }`}
          data-testid={`filter-trigger-${label.toLowerCase().replace(/\s/g, "-")}`}
        >
          {label}
          {hasActive ? (
            <Badge variant="default" className="ml-1 h-4 w-4 p-0 text-[9px] flex items-center justify-center rounded-full">
              {activeFilters.length}
            </Badge>
          ) : (
            <ChevronDown className="w-3 h-3 opacity-50" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder={`Search ${label.toLowerCase()}...`}
              className="h-8 pl-7 text-xs"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              data-testid={`filter-search-${label.toLowerCase().replace(/\s/g, "-")}`}
            />
          </div>
        </div>
        <ScrollArea className="max-h-[250px]">
          <div className="p-1">
            {filteredOptions.map((val) => {
              const isSelected = activeFilters.includes(val);
              return (
                <button
                  key={val}
                  className={`w-full text-left px-2 py-1.5 rounded-sm text-xs flex items-center gap-2 hover-elevate transition-colors ${
                    isSelected ? "bg-primary/10 text-primary" : ""
                  }`}
                  onClick={() => onToggleFilter(val)}
                  data-testid={`filter-option-${label.toLowerCase().replace(/\s/g, "-")}-${val}`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      isSelected ? "bg-primary border-primary" : "border-muted-foreground/30"
                    }`}
                  >
                    {isSelected && (
                      <svg className="w-2.5 h-2.5 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span className="truncate">{val}</span>
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">No matches</p>
            )}
          </div>
        </ScrollArea>
        {hasActive && (
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => activeFilters.forEach((v) => onToggleFilter(v))}
              data-testid={`filter-clear-${label.toLowerCase().replace(/\s/g, "-")}`}
            >
              <X className="w-3 h-3 mr-1" />
              Clear filter
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
