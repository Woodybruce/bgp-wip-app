import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Search, X, Plus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface EntityPickerProps {
  companyId?: string;
  contactId?: string;
  linkedIds: string[];
  allItems: { id: string; name: string }[];
  entityType: "properties" | "deals" | "requirements";
  icon: React.ReactNode;
  invalidateKey: string;
  searchPlaceholder?: string;
  linkEndpoint?: string;
  unlinkEndpoint?: string;
  idField?: string;
  extraBody?: Record<string, string>;
}

export function EntityPicker({
  companyId,
  contactId,
  linkedIds,
  allItems,
  entityType,
  icon,
  invalidateKey,
  searchPlaceholder,
  linkEndpoint,
  unlinkEndpoint,
  idField,
  extraBody,
}: EntityPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const parentId = companyId || contactId || "";
  const parentType = companyId ? "companies" : "contacts";

  const defaultIdField = entityType === "properties" ? "propertyId" : entityType === "deals" ? "dealId" : "requirementId";
  const resolvedIdField = idField || defaultIdField;

  const baseLinkUrl = linkEndpoint || `/api/crm/${parentType}/${parentId}/${entityType}`;
  const baseUnlinkUrl = unlinkEndpoint || `/api/crm/${parentType}/${parentId}/${entityType}`;

  const linkedItems = allItems.filter(item => linkedIds.includes(item.id));

  const filteredItems = allItems.filter(item => {
    if (search) {
      return item.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const linkMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await apiRequest("POST", baseLinkUrl, { [resolvedIdField]: itemId, ...extraBody });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [invalidateKey] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await apiRequest("DELETE", `${baseUnlinkUrl}/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [invalidateKey] });
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
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const isLinked = (itemId: string) => linkedIds.includes(itemId);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-1 flex-wrap min-h-[24px]">
        {linkedItems.map(item => (
          <span
            key={item.id}
            className="inline-flex items-center gap-1 bg-muted rounded px-1.5 py-0.5 text-[11px] max-w-[120px] group"
            data-testid={`${entityType}-tag-${item.id}`}
          >
            <span className="shrink-0 text-muted-foreground [&>svg]:w-2.5 [&>svg]:h-2.5">{icon}</span>
            <span className="truncate">{item.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                unlinkMutation.mutate(item.id);
              }}
              className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity"
              data-testid={`remove-${entityType}-${item.id}`}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1 py-0.5 rounded hover:bg-muted"
          data-testid={`button-add-${entityType}-${parentId}`}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-[240px] bg-popover border rounded-md shadow-lg" data-testid={`${entityType}-picker-dropdown`}>
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder || `Search ${entityType}...`}
                className="w-full pl-7 pr-2 py-1 text-xs bg-transparent border rounded focus:outline-none focus:ring-1 focus:ring-primary/30"
                data-testid={`input-search-${entityType}`}
              />
            </div>
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {filteredItems.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No {entityType} found</p>
            ) : (
              filteredItems.map(item => {
                const linked = isLinked(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (linked) {
                        unlinkMutation.mutate(item.id);
                      } else {
                        linkMutation.mutate(item.id);
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors text-left ${
                      linked ? "bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                    data-testid={`${entityType}-option-${item.id}`}
                  >
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      linked ? "bg-primary border-primary" : "border-muted-foreground/30"
                    }`}>
                      {linked && <span className="text-primary-foreground text-[8px] font-bold">✓</span>}
                    </div>
                    <span className="truncate">{item.name}</span>
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
