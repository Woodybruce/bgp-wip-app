// The company on the lease (a crm_trading_entities row under the brand), for
// one tenancy schedule row. BGP staff only: client logins are never shown it
// and never ask for a brand's companies. It lists the brand's companies, the
// one whose name is the lease name first, and offers to add the lease name as
// a new company of the brand. Nothing is linked on open: a person presses
// every link, and the schedule sends it through the tenant route.
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getAuthHeaders } from "@/lib/queryClient";

export interface LeaseCompany {
  id: string;
  name: string;
  companiesHouseNumber: string | null;
}

export const leaseCompaniesKey = (brandId: string) => ["/api/crm/companies", brandId, "trading-entities"];

// A Companies House number is eight letters and digits (01234567, SC123456).
// Leading zeros are often dropped, so a short all-digit number is padded.
// Empty is no number (null); anything else that is not a number is undefined.
export function cleanCompanyNumber(raw: string): string | null | undefined {
  let text = raw.replace(/\s+/g, "").toUpperCase();
  if (!text) return null;
  if (/^\d{1,8}$/.test(text)) text = text.padStart(8, "0");
  return /^[A-Z]{0,2}\d{6,8}$/.test(text) && text.length === 8 ? text : undefined;
}

export const COMPANY_NUMBER_HELP = "A Companies House number is eight letters and digits, like 01234567 or SC123456.";

// Only an ordering hint for the list: the server's matchesLease answer wins
// when the schedule has one for this row.
const plainKey = (name: string | null | undefined) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function LeaseCompanyPicker({ brandId, brandName, leaseName, currentEntityId, matchesLease, open, onOpenChange, onLink, onCreate, testId, children }: {
  brandId: string;
  brandName: string;
  leaseName: string;
  currentEntityId?: string | null;
  matchesLease?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (entityId: string) => void;
  onCreate: (entity: { name: string; companiesHouseNumber: string | null }) => void;
  testId: string;
  /** The control the picker opens from. */
  children: ReactNode;
}) {
  const [name, setName] = useState(leaseName);
  const [number, setNumber] = useState("");
  const [numberError, setNumberError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(leaseName);
    setNumber("");
    setNumberError(null);
  }, [open, leaseName]);

  const { data: companies = [], isLoading, isError } = useQuery<LeaseCompany[]>({
    queryKey: leaseCompaniesKey(brandId),
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies/${encodeURIComponent(brandId)}/trading-entities`, { headers: getAuthHeaders(), credentials: "include" });
      if (!r.ok) throw new Error("LOAD_FAILED");
      return r.json();
    },
    enabled: open && !!brandId,
    staleTime: 60_000,
  });

  const leaseKey = plainKey(leaseName);
  const byName = leaseKey ? companies.filter(c => plainKey(c.name) === leaseKey) : [];
  const matchId = matchesLease !== undefined && matchesLease !== null ? matchesLease : byName.length === 1 ? byName[0].id : null;
  const ordered = [...companies].sort((a, b) => Number(b.id === matchId) - Number(a.id === matchId));

  const link = (id: string) => {
    onOpenChange(false);
    onLink(id);
  };
  const create = () => {
    const companyName = name.trim();
    if (!companyName) return;
    const companiesHouseNumber = cleanCompanyNumber(number);
    if (companiesHouseNumber === undefined) {
      setNumberError(COMPANY_NUMBER_HELP);
      return;
    }
    onOpenChange(false);
    onCreate({ name: companyName, companiesHouseNumber });
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent className="w-[320px] p-3 space-y-3" align="start" side="bottom" collisionPadding={8} data-testid={testId}>
        <div className="space-y-1">
          <p className="text-xs font-semibold">Company on the lease</p>
          <p className="text-[11px] text-muted-foreground">Companies of {brandName}</p>
          {isLoading ? (
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Loading</p>
          ) : isError ? (
            <p className="text-[11px] text-muted-foreground">The companies could not be loaded.</p>
          ) : ordered.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">None recorded yet.</p>
          ) : (
            <ul className="max-h-[200px] overflow-y-auto -mx-1">
              {ordered.map(c => {
                const current = c.id === currentEntityId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={current}
                      onClick={() => link(c.id)}
                      className="w-full rounded px-1 py-1 text-left text-xs hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      data-testid={`${testId}-option-${c.id}`}
                    >
                      <span className="block truncate">{c.name}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {[c.companiesHouseNumber ? `CH ${c.companiesHouseNumber}` : "No CH number", c.id === matchId ? "Matches the lease" : null, current ? "On this row" : null].filter(Boolean).join(" · ")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="space-y-1.5 border-t pt-2">
          <p className="text-[11px] font-medium">
            {leaseName.trim() ? `Add "${leaseName.trim()}" as a company of ${brandName}` : `Add a company of ${brandName}`}
          </p>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Company name" className="h-7 text-xs" aria-label="Company name" data-testid={`${testId}-name`} />
          <Input
            value={number}
            onChange={e => { setNumber(e.target.value); setNumberError(null); }}
            onKeyDown={e => { if (e.key === "Enter") create(); }}
            placeholder="Companies House number (optional)"
            className="h-7 text-xs"
            aria-label="Companies House number"
            data-testid={`${testId}-number`}
          />
          {numberError && <p className="text-[11px] text-destructive">{numberError}</p>}
          <div className="flex justify-end">
            <Button size="sm" className="h-7 text-xs" onClick={create} disabled={!name.trim()} data-testid={`${testId}-add`}>Add and link</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
