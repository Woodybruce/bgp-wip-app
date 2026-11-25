// One AML board for a transaction (Woody, 25 November 2026: "we need the AML
// boards to be exactly the same in the AML pages and the Transaction pages ...
// all amls are being done in the AML pages so ... lets do all the work there
// and just show it in parties and Aml on the transaction page with ability to
// open the AML board and amend"). The working board, with the party pickers and
// who BGP acts for, is drawn on the AML page (a party's window, and the window
// a transaction opens); the transaction page draws the same board read only
// (`mirror`), each button opening the AML board at that party.
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import type { ReactNode } from "react";
import type { CrmCompany, CrmDeal } from "@shared/schema";
import { dealClientRole } from "@shared/deal-parties";
import { apiRequest, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Pill } from "@/components/ui/pill";
import { InlineLinkSelect } from "@/components/inline-edit";
import { DealAmlStatusCard, type PartySlot } from "@/components/deal-aml-status";

export type PartyField = "landlordId" | "tenantId" | "vendorId" | "purchaserId";
type Side = "landlord" | "tenant" | "vendor" | "purchaser";

// A party or BGP's side changed: the AML box reads the parties, their checks and the board's stage.
export function refreshDealAml(dealId: string) {
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId] });
}

/** Where the AML board for a transaction opens: the AML page, at one party when given. */
export function amlBoardHref(dealId: string, role?: string | null) {
  const q = new URLSearchParams({ deal: dealId });
  if (role) q.set("role", role);
  return `/deals/aml?${q}`;
}

// The deal's party slots: leasing deals have Landlord/Tenant; investment
// (Sale/Purchase) deals have Vendor/Purchaser — the unused pair is clutter
// that invites mis-linking (UX #19). Already-linked slots stay either way so
// existing data is never hidden.
function partySlotDefs(deal: CrmDeal) {
  const partiesInvestment = deal.dealType === "Sale" || deal.dealType === "Purchase";
  const slots: Array<{
    role: Side; label: string; field: PartyField;
    value: string | null | undefined; keep: (c: CrmCompany) => boolean; createType: string;
  }> = [
    ...(!partiesInvestment || deal.landlordId ? [{ role: "landlord" as const, label: "Landlord", field: "landlordId" as const, value: deal.landlordId, createType: "Landlord",
      keep: (c: CrmCompany) => c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" }] : []),
    ...(!partiesInvestment || deal.tenantId ? [{ role: "tenant" as const, label: "Tenant", field: "tenantId" as const, value: deal.tenantId, createType: "Tenant",
      keep: (c: CrmCompany) => !!c.companyType?.startsWith("Tenant") || c.companyType === "Purchaser" }] : []),
    ...(partiesInvestment || deal.vendorId ? [{ role: "vendor" as const, label: "Vendor", field: "vendorId" as const, value: deal.vendorId, createType: "Vendor",
      keep: (c: CrmCompany) => c.companyType === "Vendor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" }] : []),
    ...(partiesInvestment || deal.purchaserId ? [{ role: "purchaser" as const, label: "Purchaser", field: "purchaserId" as const, value: deal.purchaserId, createType: "Purchaser",
      keep: (c: CrmCompany) => c.companyType === "Purchaser" || c.companyType === "Investor" || c.companyType === "Landlord" || c.companyType === "Landlord / Client" || c.companyType === "Client" || c.companyType === "Vendor" }] : []),
  ];
  return { partiesInvestment, slots };
}

const SIDE_WORDS: Record<Side, string> = { landlord: "the landlord", tenant: "the tenant", vendor: "the seller", purchaser: "the buyer" };

export function DealAmlBoard({ dealId, focusCompanyId, mirror }: {
  dealId: string; focusCompanyId?: string | null;
  /** The transaction page's read-only copy. */
  mirror?: boolean;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: deal } = useQuery<CrmDeal>({ queryKey: ["/api/crm/deals", dealId] });
  // The pickers' list, only where the board is worked.
  const { data: companies = [] } = useQuery<CrmCompany[]>({ queryKey: ["/api/crm/companies"], enabled: !mirror });
  // The parties' names until the list arrives, from the transaction page's own read.
  const { data: page } = useQuery<any>({ queryKey: ["/api/crm/deals", dealId, "page"], enabled: !mirror, staleTime: 30_000, retry: false });

  if (!deal) return <DealAmlStatusCard dealId={dealId} focusCompanyId={focusCompanyId} mirror={mirror ? (role) => navigate(amlBoardHref(dealId, role)) : undefined} />;

  const { partiesInvestment, slots: defs } = partySlotDefs(deal);
  const storedSide = ((deal as any).bgpActingFor || "landlord") as Side;
  const clientRole = dealClientRole({ dealType: deal.dealType, bgpActingFor: storedSide, team: (deal as any).team });

  const saveParty = async (field: PartyField, value: string | null) => {
    await apiRequest("PUT", `/api/crm/deals/${dealId}`, { [field]: value });
    invalidateDealCaches(dealId);
    refreshDealAml(dealId);
  };
  const saveSide = async (side: Side) => {
    if (storedSide === side) return;
    try {
      await apiRequest("PUT", `/api/crm/deals/${dealId}`, { bgpActingFor: side });
      invalidateDealCaches(dealId);
      refreshDealAml(dealId);
    } catch (e: any) {
      toast({
        title: "Couldn't change who BGP acts for",
        description: /unique|duplicate/i.test(e?.message || "") ? "This unit already has a live transaction where BGP acts for the landlord." : e?.message,
        variant: "destructive",
      });
    }
  };
  // A "No matches" search can make the company and link it at once.
  const createParty = async (field: PartyField, companyType: string, name: string) => {
    try {
      const r = await apiRequest("POST", "/api/crm/companies", { name: name.trim(), companyType });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      await saveParty(field, String(created.id));
      toast({ title: `${companyType} created`, description: `${created.name} added to CRM and linked.` });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try again from the Companies page", variant: "destructive" });
    }
  };
  const companyOptions = (keep: (c: CrmCompany) => boolean, current: string | null | undefined) => {
    const list = companies.filter(c => keep(c) || c.id === current).map(c => ({ id: c.id, name: c.name }));
    if (current && !list.some(c => c.id === current)) {
      const known = (["landlord", "tenant", "vendor", "purchaser"] as const).map(r => page?.names?.parties?.[r]).find((p: any) => p?.id === current);
      if (known) list.push({ id: current, name: known.name });
    }
    return list;
  };
  const slots: PartySlot[] = defs.map(slot => {
    const select = (nameless: boolean) => (
      <InlineLinkSelect
        value={slot.value}
        options={companyOptions(slot.keep, slot.value)}
        href={slot.value ? `/companies/${slot.value}` : undefined}
        onSave={(v) => saveParty(slot.field, v || null)}
        onCreate={(name) => createParty(slot.field, slot.createType, name)}
        placeholder={`Link ${slot.label.toLowerCase()}`}
        nameless={nameless}
        triggerLabel={nameless ? `Change the ${slot.label.toLowerCase()}` : undefined}
        triggerTestId={nameless ? `aml-party-relink-${slot.role}` : undefined}
      />
    );
    return {
      role: slot.role, label: slot.label, companyId: slot.value || null, client: clientRole === slot.role,
      picker: mirror ? null : <div data-testid={`deal-party-${slot.role}`}>{select(false)}</div>,
      change: mirror ? undefined : select(true),
    };
  });

  // Which side BGP acts for: a lease's landlord or tenant (Woody, 2026-09-26),
  // a sale's seller or buyer (25 November 2026). Read only on the transaction page.
  const sides: Side[] | null = !partiesInvestment ? ["landlord", "tenant"]
    : deal.dealType === "Sale" || deal.dealType === "Purchase" || deal.dealType === "Investment" ? ["vendor", "purchaser"] : null;
  const activeSide: Side = !partiesInvestment ? (storedSide === "tenant" ? "tenant" : "landlord") : (clientRole as Side);
  const actingFor: ReactNode = !sides ? null : mirror ? (
    <span className="text-xs text-muted-foreground" data-testid="deal-bgp-acting-for">BGP acts for <span className="font-medium text-foreground">{SIDE_WORDS[activeSide]}</span></span>
  ) : (
    <span className="flex items-center gap-1.5" data-testid="deal-bgp-acting-for">
      <span className="text-[11px] text-muted-foreground">BGP acts for</span>
      {sides.map(side => (
        <Pill key={side} active={activeSide === side} onClick={() => saveSide(side)} data-testid={`deal-acting-for-${side}`}>
          {side === "landlord" ? "Landlord" : side === "tenant" ? "Tenant" : side === "vendor" ? "Seller" : "Buyer"}
        </Pill>
      ))}
    </span>
  );
  // The deal's own invoice contact in Xero, from before each party had its own billing contact.
  const footer = (deal as any).xeroContactName ? (
    <p className="text-xs text-muted-foreground" data-testid="deal-xero-contact">
      Invoice contact (Xero): <span className="font-medium text-foreground">{(deal as any).xeroContactName}</span>
      {(deal as any).xeroAccountNumber && <> · A/C <span className="font-mono tabular-nums">{(deal as any).xeroAccountNumber}</span></>}
    </p>
  ) : null;

  return (
    <DealAmlStatusCard
      dealId={dealId} dealStatus={deal.status} focusCompanyId={focusCompanyId}
      slots={slots} actingFor={actingFor} footer={footer}
      mirror={mirror ? (role) => navigate(amlBoardHref(dealId, role)) : undefined}
    />
  );
}
