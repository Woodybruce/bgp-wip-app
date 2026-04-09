import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, Building2, BarChart3, Users, Briefcase, Newspaper, Scale, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

interface SearchResult {
  id: string;
  name: string;
  type: "property" | "deal" | "contact" | "company" | "news" | "comp" | "lead";
  group?: string;
  subtitle?: string;
}

interface SearchResponse {
  results: SearchResult[];
}

const typeConfig: Record<string, { icon: typeof Building2; label: string; href: (id: string) => string }> = {
  property: { icon: Building2, label: "Properties", href: (id) => `/properties/${id}` },
  deal: { icon: BarChart3, label: "WIP", href: (id) => `/deals/${id}` },
  contact: { icon: Users, label: "Contacts", href: () => "/contacts" },
  company: { icon: Briefcase, label: "Companies", href: () => "/companies" },
  comp: { icon: Scale, label: "Comps", href: () => "/comps" },
  lead: { icon: Users, label: "Leads", href: () => "/leads" },
  news: { icon: Newspaper, label: "News", href: () => "/news" },
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
      if (res.ok) {
        const data: SearchResponse = await res.json();
        setResults(data.results);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => doSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query, doSearch]);

  const handleSelect = (result: SearchResult) => {
    const config = typeConfig[result.type];
    if (config) {
      setLocation(config.href(result.id));
    }
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground font-normal w-48 justify-start"
        data-testid="button-global-search"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="text-xs">Search...</span>
        <kbd className="ml-auto pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search properties, deals, contacts, companies..."
          value={query}
          onValueChange={setQuery}
          data-testid="input-global-search"
        />
        <CommandList>
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && query.length >= 2 && results.length === 0 && (
            <CommandEmpty>No results found for "{query}"</CommandEmpty>
          )}
          {!loading && query.length < 2 && (
            <CommandEmpty>Type at least 2 characters to search</CommandEmpty>
          )}
          {Object.entries(grouped).map(([type, items]) => {
            const config = typeConfig[type];
            if (!config) return null;
            const Icon = config.icon;
            return (
              <CommandGroup key={type} heading={config.label}>
                {items.map((item) => (
                  <CommandItem
                    key={`${type}-${item.id}`}
                    value={`${item.name}-${item.id}`}
                    onSelect={() => handleSelect(item)}
                    className="cursor-pointer"
                    data-testid={`search-result-${type}-${item.id}`}
                  >
                    <Icon className="w-4 h-4 mr-2 shrink-0" />
                    <span className="truncate">{item.name}</span>
                    {item.group && (
                      <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">
                        {item.group}
                      </Badge>
                    )}
                    {item.subtitle && !item.group && (
                      <span className="ml-auto text-xs text-muted-foreground truncate max-w-[120px]">
                        {item.subtitle}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
        </CommandList>
      </CommandDialog>
    </>
  );
}
