// What a CRM company is tied to (Woody, 2026-11-23): a brand's place on BGP's
// leasing instructions, a landlord's or lender's buildings, the brands an
// agent acts for and the buildings it lets, and live deals. BGP staff only
// (GET /api/crm/hub/company/:id/links). Drawn under a CRM list row's people
// and in a Watch list entry's Activity with BGP.
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Building2, Handshake, Store, Users } from "lucide-react";
import type { CrmCompanyLinks } from "@shared/crm-hub";
import { apiRequest } from "@/lib/queryClient";
import { useIsLandsecView } from "@/components/landsec/deal-clock";
import { trackerUnitHref } from "@/lib/unit-links";
// Its own key, not imported from company-row: that file pulls the properties
// page (and the map) into anything that draws these links.
const CRM_HUB_KEY = "/api/crm/hub";

const heading = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1.5";

export function CompanyLinks({ companyId, compact = false }: { companyId: string; compact?: boolean }) {
  const landsecView = useIsLandsecView();
  const links = useQuery<CrmCompanyLinks>({
    queryKey: [CRM_HUB_KEY, "company", companyId, "links"],
    queryFn: async () => (await apiRequest("GET", `${CRM_HUB_KEY}/company/${encodeURIComponent(companyId)}/links`)).json(),
    staleTime: 5 * 60_000, refetchInterval: false, retry: 1,
  });
  if (links.isLoading) return <p className="text-xs text-muted-foreground">Loading what it is linked to…</p>;
  if (links.isError || !links.data) return <p className="text-xs text-muted-foreground">What it is linked to could not be loaded. <button type="button" className="underline" onClick={() => links.refetch()}>Try again</button></p>;
  const l = links.data;
  const cap = compact ? 6 : 12;
  const more = (n: number) => (n > cap ? <li className="text-xs text-muted-foreground">and {n - cap} more on its page</li> : null);
  const sections = [
    l.instructions?.length ? (
      <section key="instructions" data-testid="crm-links-instructions">
        <h4 className={heading}><Store className="h-3.5 w-3.5" />BGP leasing instructions <span className="font-mono tabular-nums">{l.instructions.length}</span></h4>
        <ul className="space-y-0.5 text-sm">{l.instructions.slice(0, cap).map(line => {
          const unitHref = trackerUnitHref(line.unitId, line.propertyId, { staff: true, landsecView, restricted: false });
          const where = [line.propertyName, line.unit].filter(Boolean).join(" · ") || "A unit";
          return <li key={line.key} className={`break-words ${line.live ? "" : "text-muted-foreground"}`}>
            {unitHref ? <Link href={unitHref} className="hover:underline font-medium">{where}</Link> : line.dealId ? <Link href={`/deals/${line.dealId}`} className="hover:underline font-medium">{where}</Link> : line.propertyId ? <Link href={`/properties/${line.propertyId}`} className="hover:underline font-medium">{where}</Link> : <span className="font-medium">{where}</span>}
            <span className="text-muted-foreground"> · {line.how.join(", ")}{line.stage ? ` · ${line.stage}` : ""}</span>
          </li>;
        })}{more(l.instructions.length)}</ul>
      </section>
    ) : null,
    l.buildings?.length ? (
      <section key="buildings" data-testid="crm-links-buildings">
        <h4 className={heading}><Building2 className="h-3.5 w-3.5" />Buildings <span className="font-mono tabular-nums">{l.buildings.length}</span></h4>
        <ul className="space-y-0.5 text-sm">{l.buildings.slice(0, cap).map(b => (
          <li key={b.propertyId} className="break-words"><Link href={`/properties/${b.propertyId}`} className="hover:underline font-medium">{b.name}</Link>{b.roles.length ? <span className="text-muted-foreground"> · {b.roles.join(", ")}</span> : null}</li>
        ))}{more(l.buildings.length)}</ul>
      </section>
    ) : null,
    l.actingFor?.length ? (
      <section key="acting" data-testid="crm-links-acting-for">
        <h4 className={heading}><Users className="h-3.5 w-3.5" />Acts for <span className="font-mono tabular-nums">{l.actingFor.length}</span></h4>
        <ul className="space-y-0.5 text-sm">{l.actingFor.slice(0, cap).map(b => (
          <li key={b.id} className="break-words"><Link href={`/companies/${b.id}`} className="hover:underline font-medium">{b.name}</Link>{b.detail ? <span className="text-muted-foreground"> · {b.detail}</span> : null}</li>
        ))}{more(l.actingFor.length)}</ul>
      </section>
    ) : null,
    l.leasing?.length ? (
      <section key="leasing" data-testid="crm-links-leasing">
        <h4 className={heading}><Building2 className="h-3.5 w-3.5" />Buildings it is leasing <span className="font-mono tabular-nums">{l.leasing.length}</span></h4>
        <ul className="space-y-0.5 text-sm">{l.leasing.slice(0, cap).map(b => (
          <li key={b.propertyId} className="break-words"><Link href={`/properties/${b.propertyId}`} className="hover:underline font-medium">{b.name}</Link><span className="text-muted-foreground"> · {b.how.join("; ")}</span></li>
        ))}{more(l.leasing.length)}</ul>
      </section>
    ) : null,
    l.deals?.length ? (
      <section key="deals" data-testid="crm-links-deals">
        <h4 className={heading}><Handshake className="h-3.5 w-3.5" />Live deals <span className="font-mono tabular-nums">{l.deals.length}</span></h4>
        <ul className="space-y-0.5 text-sm">{l.deals.slice(0, cap).map(d => (
          <li key={d.id} className="break-words"><Link href={`/deals/${d.id}`} className="hover:underline font-medium">{d.name}</Link><span className="text-muted-foreground"> · {[d.side, d.status, d.propertyName].filter(Boolean).join(" · ")}</span></li>
        ))}{more(l.deals.length)}</ul>
      </section>
    ) : null,
  ].filter(Boolean);
  if (!sections.length) return <p className="text-sm text-muted-foreground" data-testid="crm-links-none">Not linked to any building, BGP letting, brand or live deal yet.</p>;
  return <div className={compact ? "grid gap-3 sm:grid-cols-2" : "space-y-3"} data-testid="crm-links">{sections}</div>;
}
