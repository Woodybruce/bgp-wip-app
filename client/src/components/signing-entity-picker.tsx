// Who signs for a party BGP does not bill (Woody, 2026-11-20: "need ability to
// create billing entity or contracting entity as a person we will then KYC
// them"). On the deal form, the company or person filed under the party that
// signs for it: the AML checks are about them. No Xero contact is made: BGP
// bills its own client only (shared/deal-billing.ts). A new one is found at
// Companies House, or typed as a person, through the same dialog as a billing
// entity, with `xero` off.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { CreateBillingEntityDialog, type SavedCompany } from "@/components/billing-entity-create";
import { leaseCompaniesKey } from "@/components/lease-company-picker";

type Filed = { id: string; name: string; companiesHouseNumber: string | null; entityKind?: string | null; contactId?: string | null };
const isPerson = (f: Pick<Filed, "entityKind">) => String(f.entityKind || "").toLowerCase() === "individual";

export function SigningEntityPicker({ party, value, onChange, testIdPrefix }: {
  party: { id: string; name: string };
  value: string;
  onChange: (company: SavedCompany | null) => void;
  testIdPrefix: string;
}) {
  const [changing, setChanging] = useState(false);
  const [creating, setCreating] = useState<null | "company" | "person">(null);
  // What was just made, shown until the list is read again.
  const [made, setMade] = useState<SavedCompany | null>(null);
  const { data: filed = [] } = useQuery<Filed[]>({
    queryKey: leaseCompaniesKey(party.id),
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies/${encodeURIComponent(party.id)}/trading-entities`, { credentials: "include", headers: getAuthHeaders() });
      return r.ok ? r.json() : [];
    },
    enabled: !!party.id,
    staleTime: 60_000,
  });
  const listed = filed.find(f => f.id === value);
  const chosen: SavedCompany | null = listed
    ? { id: listed.id, name: listed.name, companiesHouseNumber: listed.companiesHouseNumber, kind: isPerson(listed) ? "individual" : "company", contactId: listed.contactId || null }
    : made && made.id === value ? made : null;
  const pick = (c: SavedCompany) => { onChange(c); setChanging(false); };

  if (chosen && !changing) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2" data-testid={`${testIdPrefix}-selected`}>
        {chosen.kind === "individual" ? <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 break-words text-sm font-medium">{chosen.name}</span>
        <Badge variant="outline" className="text-[10px]">{chosen.kind === "individual" ? "A person" : chosen.companiesHouseNumber || "No number"}</Badge>
        <Button type="button" variant="outline" size="sm" className="h-6 rounded-full px-2 text-[11px]" onClick={() => setChanging(true)} data-testid={`${testIdPrefix}-change`}>Change</Button>
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => onChange(null)} aria-label="Clear who signs" data-testid={`${testIdPrefix}-clear`}><X className="h-3.5 w-3.5" /></Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 rounded-md border bg-background p-2" data-testid={`${testIdPrefix}-choose`}>
      {filed.length > 0 && (
        <ul className="space-y-0.5">
          {filed.slice(0, 6).map(f => (
            <li key={f.id}>
              <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted"
                onClick={() => pick({ id: f.id, name: f.name, companiesHouseNumber: f.companiesHouseNumber, kind: isPerson(f) ? "individual" : "company", contactId: f.contactId || null })}
                data-testid={`${testIdPrefix}-filed-${f.id}`}>
                {isPerson(f) ? <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate font-medium">{f.name}</span>
                <span className="text-muted-foreground">{isPerson(f) ? "a person" : f.companiesHouseNumber || ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreating("company")} data-testid={`${testIdPrefix}-new-company`}>
          <Plus className="mr-1 h-3.5 w-3.5" />A company (Companies House)
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCreating("person")} data-testid={`${testIdPrefix}-new-person`}>
          <UserRound className="mr-1 h-3.5 w-3.5" />A person
        </Button>
        {changing && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setChanging(false)}>Cancel</Button>}
      </div>
      {creating && (
        <CreateBillingEntityDialog
          open
          onOpenChange={v => { if (!v) setCreating(null); }}
          brand={party}
          initialQuery={creating === "company" ? party.name : ""}
          xero={false}
          startAsPerson={creating === "person"}
          onCreated={(_contact, company) => { if (company) { setMade(company); pick(company); } setCreating(null); queryClient.invalidateQueries({ queryKey: leaseCompaniesKey(party.id) }); }}
          onSavedWithoutXero={company => { setMade(company); pick(company); setCreating(null); queryClient.invalidateQueries({ queryKey: leaseCompaniesKey(party.id) }); }}
          testIdPrefix={`${testIdPrefix}-find`}
        />
      )}
    </div>
  );
}
