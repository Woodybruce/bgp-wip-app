// A brand on the joint agent's tracker forms: typed, or picked by name. The
// suggestions are names only (id and name), either a short list handed in
// (the brands already named on a unit) or a search of the Landsec brand list
// (GET /api/landsec/tracker/brands). There is no link to a brand page.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getAuthHeaders } from "@/lib/queryClient";

export interface BrandValue { id: string | null; name: string }
interface BrandOption { id: string; name: string }

export function BrandInput({ value, onChange, options, placeholder, disabled, testId }: {
  value: BrandValue;
  onChange: (v: BrandValue) => void;
  options?: BrandOption[];          // when given, suggestions come from this list and nothing is searched
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  // Search a moment after the typing stops.
  useEffect(() => {
    const t = setTimeout(() => setTerm(value.name.trim()), 250);
    return () => clearTimeout(t);
  }, [value.name]);

  const { data: found = [] } = useQuery<BrandOption[]>({
    queryKey: ["/api/landsec/tracker/brands", term],
    queryFn: async () => {
      const r = await fetch(`/api/landsec/tracker/brands?q=${encodeURIComponent(term)}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json) ? json : [];
    },
    enabled: !options && open && term.length >= 2,
    staleTime: 60_000,
  });
  const typed = value.name.trim().toLowerCase();
  const list = options
    ? options.filter(o => !typed || o.name.toLowerCase().includes(typed)).slice(0, 8)
    : found.slice(0, 8);
  const show = open && !disabled && list.length > 0 && !(list.length === 1 && list[0].id === value.id);

  return (
    <div className="relative min-w-0">
      <Input
        value={value.name}
        onChange={e => { onChange({ id: null, name: e.target.value }); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder || "Brand"}
        disabled={disabled}
        autoComplete="off"
        data-testid={testId}
      />
      {value.id && <Check className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-600" aria-label="Matched to a brand on the list" />}
      {show && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 text-sm shadow-md" role="listbox">
          {list.map(o => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={o.id === value.id}
                className="block w-full truncate px-2.5 py-1.5 text-left hover:bg-muted"
                // mousedown, so the pick lands before the input's blur closes the list
                onMouseDown={e => { e.preventDefault(); onChange({ id: o.id, name: o.name }); setOpen(false); }}
                data-testid={testId ? `${testId}-option-${o.id}` : undefined}
              >
                {o.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
