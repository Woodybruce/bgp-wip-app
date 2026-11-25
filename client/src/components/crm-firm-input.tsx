// A firm's name box that looks in the CRM as it is typed (Woody, 25 November
// 2026: "for agents we need the filter function so can bring up company and we
// can add agent company to our CRM", then "same for brands"). Typing lists the
// CRM's companies that match; picking one keeps its id. A name the CRM does not
// hold offers "Add <name> to the CRM", made with the type given (Agent, or a
// brand's Tenant), and picked.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Hit = { id: string; name: string; companyType: string | null; website: string | null };

export function CrmFirmInput({ value, companyId, onChange, companyType = "Agent", placeholder, testId }: {
  value: string;
  companyId: string | null;
  /** The name typed, and the CRM company when one is picked or added (null while typing). */
  onChange: (name: string, companyId: string | null) => void;
  /** The type a firm added here is given. */
  companyType?: string;
  placeholder?: string;
  testId?: string;
}) {
  const { toast } = useToast();
  const [focused, setFocused] = useState(false);
  const [term, setTerm] = useState("");
  const [adding, setAdding] = useState(false);
  const typed = value.trim();
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(typed), 250);
    return () => window.clearTimeout(t);
  }, [typed]);
  const { data } = useQuery<{ results: Hit[] }>({
    queryKey: ["/api/aml-dashboard/companies/search", "firm", term],
    queryFn: async () => {
      const r = await fetch(`/api/aml-dashboard/companies/search?${new URLSearchParams({ q: term })}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { results: [] };
      return r.json();
    },
    enabled: term.length >= 2 && !companyId,
    staleTime: 30_000,
  });
  const hits = data?.results || [];
  const exact = hits.find(h => h.name.toLowerCase() === typed.toLowerCase()) || null;
  const add = async () => {
    if (typed.length < 2 || adding) return;
    setAdding(true);
    try {
      const created = await (await apiRequest("POST", "/api/crm/companies", { name: typed, companyType })).json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      onChange(String(created.name || typed), String(created.id));
      toast({ title: "Added to the CRM", description: `${created.name || typed} (${companyType}).` });
      setFocused(false);
    } catch (e: any) {
      toast({ title: "Not added", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };
  const showList = focused && !companyId && typed.length >= 2 && !!data;
  return (
    <div className="relative space-y-1" data-testid={testId ? `${testId}-crm` : undefined}>
      <Input value={value} onChange={e => onChange(e.target.value, null)} placeholder={placeholder}
        onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} autoComplete="off" maxLength={160} data-testid={testId} />
      {showList && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md" data-testid="crm-firm-hits">
          {hits.length > 0 && <li className="px-2 py-1 text-[11px] text-muted-foreground">In the CRM</li>}
          {hits.map(h => (
            <li key={h.id}>
              <button type="button" className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={e => e.preventDefault()} onClick={() => { onChange(h.name, h.id); setFocused(false); }} data-testid={`crm-firm-hit-${h.id}`}>
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-muted-foreground">{[h.companyType, h.website].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
          {!exact && (
            <li>
              <button type="button" className="w-full rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-muted"
                onMouseDown={e => e.preventDefault()} onClick={add} disabled={adding} data-testid="crm-firm-add">
                {adding ? "Adding…" : `Add “${typed}” to the CRM as ${companyType === "Agent" ? "an agent" : `a ${companyType.toLowerCase()}`}`}
              </button>
            </li>
          )}
        </ul>
      )}
      {companyId && <p className="text-[11px] text-emerald-700 dark:text-emerald-400" data-testid="crm-firm-found">In the CRM: {value}</p>}
    </div>
  );
}
