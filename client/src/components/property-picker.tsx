import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, Search, X, Plus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { CrmProperty } from "@shared/schema";

interface PropertyPickerProps {
  companyId: string;
  linkedPropertyIds: string[];
  allProperties: CrmProperty[];
}

export function PropertyPicker({ companyId, linkedPropertyIds, allProperties }: PropertyPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const linkedProperties = allProperties.filter(p => linkedPropertyIds.includes(p.id));

  const filteredProperties = allProperties.filter(p => {
    if (search) {
      return p.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const linkMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      await apiRequest("POST", `/api/crm/companies/${companyId}/properties`, { propertyId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/company-property-links"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (propertyId: string) => {
      await apiRequest("DELETE", `/api/crm/companies/${companyId}/properties/${propertyId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/company-property-links"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const isLinked = (propertyId: string) => linkedPropertyIds.includes(propertyId);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-1 flex-wrap min-h-[24px]">
        {linkedProperties.map(p => (
          <span
            key={p.id}
            className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] max-w-[120px] group"
            data-testid={`property-tag-${p.id}`}
          >
            <Building2 className="w-2.5 h-2.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{p.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                unlinkMutation.mutate(p.id);
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              data-testid={`remove-property-${p.id}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted"
          data-testid={`button-add-property-${companyId}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-[220px] bg-popover border rounded-md shadow-lg" data-testid="property-picker-dropdown">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search properties..."
                className="w-full pl-7 pr-2 py-1 text-xs bg-transparent border rounded focus:outline-none focus:ring-1 focus:ring-primary/30"
                data-testid="input-search-property"
              />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filteredProperties.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No properties found</p>
            ) : (
              filteredProperties.map(p => {
                const linked = isLinked(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      if (linked) {
                        unlinkMutation.mutate(p.id);
                      } else {
                        linkMutation.mutate(p.id);
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors text-left ${
                      linked ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                    data-testid={`property-option-${p.id}`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      linked ? "bg-primary border-primary" : "border-muted-foreground/30"
                    }`}>
                      {linked && <span className="text-primary-foreground text-[8px] font-bold">✓</span>}
                    </div>
                    <span className="truncate">{p.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
