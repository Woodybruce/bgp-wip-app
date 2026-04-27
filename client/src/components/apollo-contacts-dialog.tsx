// Contact discovery dialog supporting both Apollo and RocketReach as providers.
// Opens from a brand profile page. Lets user cherry-pick contacts to import.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, Search, Linkedin, Mail, Building2, Phone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DiscoveredPerson {
  // apollo uses apollo_id, rocketreach uses rocketreach_id — normalised to person_id
  person_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone?: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  location: string | null;
  source: "direct" | "name_search" | "parent_group";
  source_company_name?: string;
  // keep original payload for import endpoint
  _raw: Record<string, unknown>;
}

interface DiscoverDiagnostic {
  step: string;
  matched: number;
  details?: string;
}

interface DiscoverResult {
  people: Record<string, unknown>[];
  parentCompany: { id: string; name: string } | null;
  company?: { triedDomains?: string[] };
  diagnostics?: DiscoverDiagnostic[];
}

function normalisePeople(raw: Record<string, unknown>[], provider: "apollo" | "rocketreach"): DiscoveredPerson[] {
  return raw.map(p => ({
    person_id: String((p[provider === "apollo" ? "apollo_id" : "rocketreach_id"] ?? p.name ?? Math.random())),
    name: String(p.name ?? ""),
    role: (p.role as string | null) ?? null,
    email: (p.email as string | null) ?? null,
    phone: (p.phone as string | null) ?? null,
    linkedin_url: (p.linkedin_url as string | null) ?? null,
    avatar_url: (p.avatar_url as string | null) ?? null,
    location: (p.location as string | null) ?? null,
    source: (p.source as DiscoveredPerson["source"]) ?? "direct",
    source_company_name: p.source_company_name as string | undefined,
    _raw: p,
  }));
}

type Provider = "apollo" | "rocketreach";

function ProviderTab({ active, provider, onClick }: { active: boolean; provider: Provider; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        active ? "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {provider === "apollo" ? "Apollo" : "RocketReach"}
    </button>
  );
}

function PersonRow({ p, selected, onToggle }: { p: DiscoveredPerson; selected: boolean; onToggle: () => void }) {
  const isParent = p.source === "parent_group";
  return (
    <label className={`flex items-center gap-3 p-2 rounded cursor-pointer ${
      isParent
        ? "hover:bg-amber-50/50 dark:hover:bg-amber-950/20 border-l-2 border-amber-200 ml-2"
        : "hover:bg-muted/50"
    }`}>
      <Checkbox checked={selected} onCheckedChange={onToggle} />
      <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
        {p.avatar_url && <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{p.name}</span>
          {p.role && <Badge variant="outline" className="text-[10px]">{p.role}</Badge>}
          {isParent && <Badge className="text-[9px] bg-amber-100 text-amber-700 border-amber-200">group</Badge>}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {p.email && <span className="flex items-center gap-0.5"><Mail className="w-3 h-3" />{p.email}</span>}
          {p.phone && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{p.phone}</span>}
          {p.linkedin_url && (
            <a href={p.linkedin_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-0.5 hover:underline"
              onClick={(e) => e.stopPropagation()}>
              <Linkedin className="w-3 h-3" />LinkedIn
            </a>
          )}
          {p.location && <span>· {p.location}</span>}
        </div>
      </div>
    </label>
  );
}

function ProviderPanel({ companyId, provider }: { companyId: string; provider: Provider; }) {
  const { toast } = useToast();
  const [people, setPeople] = useState<DiscoveredPerson[]>([]);
  const [parentCompany, setParentCompany] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ran, setRan] = useState(false);
  const [triedDomains, setTriedDomains] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiscoverDiagnostic[]>([]);

  const providerLabel = provider === "apollo" ? "Apollo" : "RocketReach";

  const discover = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/brand/${companyId}/${provider}/discover`, {});
      return res.json() as Promise<DiscoverResult>;
    },
    onSuccess: (out) => {
      const normalised = normalisePeople(out.people || [], provider);
      setPeople(normalised);
      setParentCompany(out.parentCompany || null);
      setTriedDomains(out.company?.triedDomains || []);
      setDiagnostics(out.diagnostics || []);
      setSelected(new Set(normalised.map(p => p.person_id)));
      setRan(true);
      if (!normalised.length) toast({ title: `No new contacts found via ${providerLabel}` });
    },
    onError: (e: any) => toast({ title: `${providerLabel} error`, description: e.message, variant: "destructive" }),
  });

  const importM = useMutation({
    mutationFn: async () => {
      const chosen = people.filter(p => selected.has(p.person_id)).map(p => p._raw);
      const res = await apiRequest("POST", `/api/brand/${companyId}/${provider}/import`, { people: chosen });
      return res.json() as Promise<{ inserted: number; requested: number }>;
    },
    onSuccess: (out) => {
      toast({ title: `Imported ${out.inserted} contact${out.inserted === 1 ? "" : "s"} via ${providerLabel}` });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      setPeople([]); setParentCompany(null); setSelected(new Set()); setRan(false);
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const directPeople = people.filter(p => p.source !== "parent_group");
  const parentPeople = people.filter(p => p.source === "parent_group");

  return (
    <div className="space-y-3">
      {!ran && !discover.isPending && (
        <div className="py-8 flex flex-col items-center gap-3">
          <Button onClick={() => discover.mutate()} disabled={discover.isPending}>
            <Search className="w-4 h-4 mr-2" /> Search {providerLabel}
          </Button>
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            Searches directly, then by brand name, then by parent group when available.
          </p>
        </div>
      )}

      {discover.isPending && (
        <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Searching {providerLabel}…
        </div>
      )}

      {ran && !discover.isPending && (
        <div className="max-h-[420px] overflow-y-auto space-y-1">
          {people.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6 space-y-2">
              <div>No new contacts — {providerLabel} returned nobody we don't already have.</div>
              {(triedDomains.length > 0 || diagnostics.length > 0) && (
                <div className="text-[11px] text-left bg-muted/40 rounded p-2 max-w-md mx-auto space-y-1">
                  {triedDomains.length > 0 && (
                    <div><span className="font-medium">Domains tried:</span> {triedDomains.join(", ")}</div>
                  )}
                  {diagnostics.map((d, i) => (
                    <div key={i}>
                      <span className="font-medium">{d.step}:</span> {d.matched} match{d.matched === 1 ? "" : "es"}
                      {d.details ? ` — ${d.details}` : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {directPeople.length > 0 && parentPeople.length > 0 && (
            <div className="text-[11px] text-muted-foreground font-medium px-2 pt-1 pb-0.5">
              Direct matches ({directPeople.length})
            </div>
          )}
          {directPeople.map(p => (
            <PersonRow key={p.person_id} p={p} selected={selected.has(p.person_id)} onToggle={() => toggle(p.person_id)} />
          ))}
          {parentPeople.length > 0 && (
            <>
              <div className="text-[11px] text-amber-600 font-medium px-2 pt-2 pb-0.5 flex items-center gap-1">
                <Building2 className="w-3 h-3" /> Via {parentCompany?.name} (parent group)
              </div>
              {parentPeople.map(p => (
                <PersonRow key={p.person_id} p={p} selected={selected.has(p.person_id)} onToggle={() => toggle(p.person_id)} />
              ))}
            </>
          )}
        </div>
      )}

      {ran && people.length > 0 && (
        <div className="flex justify-end gap-2 pt-1 border-t">
          <Button onClick={() => importM.mutate()} disabled={importM.isPending || selected.size === 0}>
            {importM.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Import {selected.size} contact{selected.size === 1 ? "" : "s"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function ApolloContactsDialog({ companyId, companyName, open, onOpenChange }: {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [provider, setProvider] = useState<Provider>("apollo");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            Find contacts at {companyName}
          </DialogTitle>
          <DialogDescription>
            Pulls likely key people (founders, property directors, heads of retail).
            Nothing is saved until you click Import.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1 border-b pb-2">
          <ProviderTab active={provider === "apollo"} provider="apollo" onClick={() => setProvider("apollo")} />
          <ProviderTab active={provider === "rocketreach"} provider="rocketreach" onClick={() => setProvider("rocketreach")} />
        </div>

        <ProviderPanel key={provider} companyId={companyId} provider={provider} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
