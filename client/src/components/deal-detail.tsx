import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { ActivitySummary } from "@/components/activity-summary";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Users,
  Building2,
  ArrowLeft,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  Image as ImageIcon,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Calendar as CalendarIcon,
  FileText,
  MoreHorizontal,
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { Pill } from "@/components/ui/pill";
import { trackRecentItem } from "@/hooks/use-recent-items";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PropertyCombobox } from "@/components/property-combobox";
import { apiRequest, queryClient, invalidateDealCaches, getAuthHeaders } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useGoBack } from "@/lib/go-back";
import type { CrmDeal, CrmProperty, CrmCompany, CrmContact } from "@shared/schema";
import { buildUserColorMap } from "@/lib/agent-colors";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { dealDisplayTitle } from "@/components/app-sidebar";
import { BrandProfilePanel } from "@/components/brand-profile-panel";
import { MobileBrandView } from "@/components/mobile-brand-view";
import { DEAL_STATUS_COLORS as STATUS_CHIP_COLORS, legacyToCode } from "@shared/deal-status";
import { dealStatusLabel } from "@shared/letting-rules";
import { readLastContact } from "@shared/last-contact";
import { InlineLinkSelect } from "@/components/inline-edit";
import {
  DEAL_TEAM_COLORS,
  DEAL_FEE_AGREEMENT_COLORS,
  formatCurrency,
  formatNumber,
  formatDate,
  DealFormDialog,
  FeeAllocationCard,
  XeroInvoiceSection,
  DealAuditLog,
} from "@/pages/deals";
import { PropertyFoldersPanel } from "@/pages/properties";
import { areaBasisFromAssetClass, isRetailAssetClass } from "@/lib/crm-options";
import { AIActivityCard, pickTouchDates } from "@/components/ai-activity-card";
import { DealAmlStatusCard } from "@/components/deal-aml-status";
import { DealPartyLines } from "@/components/deal-parties";
import { JointAgencyNoteCard } from "@/components/joint-agency-aml";
import { useIsLandsecView, DaysAtStage, NerFigure, BriefCheck } from "@/components/landsec/deal-clock";
import { CompanyChip } from "@/components/company-chip";
import { BgpTeamGroup, type BgpTeamPerson } from "@/components/bgp-team-group";
import { CompanyKindPage, type CompanySection } from "@/components/company-page/company-kind-page";
import { trackerUnitHref } from "@/lib/unit-links";
import { dealPageSections, owedItems, type DealEventOpen, type DealPageData, type DealPageNames, type DealPartyRole } from "@shared/deal-page";
import { useDealPage, type LettingDialog } from "@/components/deal-page/use-deal-page";
import { StageStrip } from "@/components/deal-page/stage-strip";
import { DealTimelinePanel } from "@/components/deal-page/deal-timeline";
import { DealNegotiation, sectionCard } from "@/components/deal-page/deal-negotiation";
import { DealChecklistTasks, DealWaitingOn } from "@/components/deal-page/deal-checklist-tasks";
import { DealConversation } from "@/components/deal-page/deal-conversation";
import { LettingDialogs } from "@/components/deal-page/letting-dialogs";

// Collapsible card pattern reused across the deal page for heavy panels.
function CollapsibleCard({
  open,
  onToggle,
  icon: Icon,
  title,
  children,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  icon: any;
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors text-left"
        data-testid={testId}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </Card>
  );
}

// The deal page (Woody, 2026-11-18; docs/deal-page-review-2026-11-18.md):
// the landlord and brand pages' frame, one section at a time in ?section=,
// the same page for every login and cut on the server (a client never sees
// the fee or BGP's AML working, a joint agent sees its own schemes and no
// brand pages). The header line carries the stage, days at stage and what
// the deal is waiting on; the stage strip is its spine; the conversation is
// the property's, cut to the deal. Its reads are server/deal-page.ts.
export function DealDetail({ id, isComps = false }: { id: string; isComps?: boolean }) {
  const { toast } = useToast();
  const landsecView = useIsLandsecView();
  const [, navigate] = useLocation();
  const goBack = useGoBack(isComps ? "/comps" : "/deals");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [unitEditOpen, setUnitEditOpen] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [dialog, setDialog] = useState<LettingDialog | null>(null);

  const { data: deal, isLoading } = useQuery<CrmDeal>({
    queryKey: ["/api/crm/deals", id],
  });
  // The page's own read: stage, strip, clock, letting, checklist, tasks and
  // the names it draws with (server/deal-page.ts).
  const pageQuery = useDealPage(id);
  const page = pageQuery.data;

  const { data: ddUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  // Treat the user as a client until auth/me resolves — on a hard page load
  // the panels otherwise mount for a beat and fire their (403) queries
  // before the role is known. Staff just see the panels pop in a tick later.
  const isClientDeal = !ddUser || ddUser.role === "Client" || !!ddUser.companyScopeId;
  // A client LOGIN never deletes; staff keep Delete even while viewing as a
  // client (Woody, 2026-10-19: Lizzie had no Delete button).
  const isClientLogin = !ddUser || ddUser.role === "Client";
  // A joint agent (Woody, 2026-11-14) has the deal page a Landsec login has,
  // less the brand pages and BGP's own records: no Brand profiles, no Edit
  // (it does not change deals here), no Image Studio, no change log.
  const jointAgent = ddUser?.landsecRole === "joint_agent";
  const viewerKind: DealPageData["viewer"]["kind"] = page?.viewer.kind || (jointAgent ? "joint_agent" : isClientDeal ? "client" : "staff");
  const staffView = viewerKind === "staff";

  // Older activity caches stamped the deal's last_interaction with the
  // latest cited date, upcoming meetings included — "Last Interaction 30 Dec"
  // on South Molton. When the stored date is in the future, re-derive from
  // the cached hits (read-only: cachedOnly never starts a curation)
  // (Woody, 2026-09-27).
  // One rule with the Deals table's Last contact column: shared/last-contact.ts.
  const storedLastTouch = readLastContact(deal?.lastInteraction);
  const { data: ddActivity } = useQuery<{ emailHits?: any[]; meetingHits?: any[] }>({
    queryKey: [`/api/activity/deal/${encodeURIComponent(id)}?cachedOnly=1`],
    enabled: !isClientDeal && storedLastTouch.kind === "next",
    refetchInterval: false,
    retry: false,
  });

  const { data: users = [] } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/users"],
  });

  // Clients chasing a deal need a BGP owner in sight (UX #44): prefer the
  // deal's own internalAgent names, fall back to the account team's lead.
  // The client-teams endpoint is already scope-jailed to the client's own
  // company and carries emails for mailto links.
  const ddClientCompanyId = ddUser?.companyScopeId || null;
  const { data: ddBgpTeam = [] } = useQuery<Array<{ user_id: string; full_name: string | null; username: string | null; email: string | null; is_lead: boolean }>>({
    queryKey: ["/api/client-teams", ddClientCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/client-teams/${ddClientCompanyId}`, { headers: getAuthHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!ddUser && isClientDeal && !!ddClientCompanyId,
  });
  const ddBgpLeads: Array<{ name: string; email: string | null }> = (() => {
    if (!isClientDeal || !deal) return [];
    const raw = (deal as any).internalAgent;
    const agentNames = (Array.isArray(raw) ? raw : String(raw || "").split(","))
      .map((s: string) => String(s).trim()).filter(Boolean);
    const memberByName = (n: string) =>
      ddBgpTeam.find(m => (m.full_name || m.username || "").toLowerCase() === n.toLowerCase());
    if (agentNames.length > 0) {
      const mapped = agentNames.map((n: string) => ({ name: n, email: memberByName(n)?.email || null }));
      // UX #65: an agent who isn't on the account-team board renders with
      // no email, leaving the client an inert name and nobody to chase.
      // Guarantee at least one clickable contact by appending the account
      // lead when none of the named agents resolved to an email.
      if (!mapped.some((m: { email: string | null }) => m.email)) {
        const lead = ddBgpTeam.find(m => m.is_lead && m.email) || ddBgpTeam.find(m => m.email);
        const leadName = lead ? (lead.full_name || lead.username || "") : "";
        if (lead && !mapped.some((m: { name: string }) => m.name.toLowerCase() === leadName.toLowerCase())) {
          mapped.push({ name: leadName, email: lead.email });
        }
      }
      return mapped;
    }
    // No agent on the deal — fall back to the account team's flagged lead,
    // or failing that the first team member, so the client is never left
    // with nobody to chase.
    const lead = ddBgpTeam.find(m => m.is_lead) || ddBgpTeam[0];
    return lead ? [{ name: lead.full_name || lead.username || "BGP team", email: lead.email || null }] : [];
  })();

  const dealBgpTeam: BgpTeamPerson[] = (() => {
    if (!deal) return [];
    if (isClientDeal) return ddBgpLeads.map(p => ({ id: `lead:${p.name}`, name: p.name, email: p.email, roles: [] }));
    const raw = (deal as any).internalAgent;
    const names: string[] = (Array.isArray(raw) ? raw : String(raw || "").split(",")).map((n: string) => String(n).trim()).filter(Boolean);
    return names.map(n => {
      const u: any = users.find(x => (x.name || "").toLowerCase() === n.toLowerCase());
      return { id: u ? String(u.id) : `name:${n}`, name: u?.name || n, title: u?.role || null, email: u?.email || null, phone: u?.phone || null, photo: u?.profilePicUrl || null, roles: ["Agent"] };
    });
  })();

  const userColorMap = useMemo(() => buildUserColorMap(users as any), [users]);
  // BGP colleagues a task on the deal may be given to (BGP staff only).
  const taskAssignees = useMemo(() => staffView
    ? users.filter(u => !u.email || /@brucegillinghampollard\.com$/i.test(u.email)).map(u => ({ id: String(u.id), name: u.name })).filter(u => u.name).sort((a, b) => a.name.localeCompare(b.name))
    : [], [users, staffView]);

  const names: DealPageNames | null = page?.names || null;
  const linkedProperty = names?.property || null;
  // The deal's own unit record (BGP staff), for the heading and the unit editor.
  const linkedUnit = names?.unit || null;

  // Investment deals are about the whole property, so the property name can
  // stand in for a missing deal name. A leasing deal with no linked unit must
  // keep its own name — two unit-less deals at the same property would
  // otherwise be indistinguishable everywhere the title shows.
  const isInvestmentDeal = deal?.dealType === "Sale" || deal?.dealType === "Purchase";
  // The deal and its Sales / Purchases board row are one record — edits here
  // flow to the board (server/investment-deal-sync.ts); link across.
  const { data: ddTracker = [] } = useQuery<any[]>({ queryKey: ["/api/investment-tracker"], enabled: isInvestmentDeal && !isClientDeal });
  const trackerRow = (Array.isArray(ddTracker) ? ddTracker : []).find((t: any) => t.dealId === id);
  // Stage "Invoiced"/"Completed" over a Xero invoice still in DRAFT read as a
  // silent contradiction — say it plainly as an attention chip (Woody,
  // 2026-09-27). Same query key as XeroInvoiceSection, so no extra fetch.
  const { data: ddInvoices = [] } = useQuery<any[]>({ queryKey: ["/api/xero/invoices", id], enabled: !isClientDeal });
  const ddStatusCode = deal?.status ? legacyToCode(deal.status) : null;
  const draftInvoiceOnInvoicedDeal = (ddStatusCode === "INV" || ddStatusCode === "COM")
    ? (Array.isArray(ddInvoices) ? ddInvoices : []).find((inv: any) => inv?.status === "DRAFT") || null
    : null;
  // A unit linked from a different property (e.g. heading "55 Regent
  // Street" over a 10 Piccadilly deal) contradicted the breadcrumb and
  // linked property — only headline a unit that sits on the deal's
  // property; otherwise flag the mislink (Woody, 2026-09-27).
  const unitOffProperty = !!linkedUnit && !!deal?.propertyId && linkedUnit.propertyId !== deal.propertyId;
  // The guard above missed the live case: the unit row sits on the
  // 10 Piccadilly property but is NAMED "55 Regent Street" — a
  // street address for another building. A numbered-address unit
  // name only headlines when the deal or property name shares its
  // street; "Unit 3", "T1" etc. still headline (Woody, 2026-09-27).
  const streetOf = (s: string) => s.toLowerCase().replace(/^\d+[a-z]?(?:[-–]\d+[a-z]?)?\s+/, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  const unitNameIsOtherAddress = !!linkedUnit && /^\d+[a-z]?(?:[-–]\d+[a-z]?)?\s+[a-z]/i.test(linkedUnit.unitName || "") && (() => {
    const street = streetOf(linkedUnit.unitName);
    const ctx = `${deal?.name || ""} ${linkedProperty?.name || ""}`.toLowerCase();
    return !!street && !ctx.includes(street) && !ctx.includes((linkedUnit.unitName || "").toLowerCase());
  })();
  const headingIsUnit = !isInvestmentDeal && !!linkedUnit && !unitOffProperty && !unitNameIsOtherAddress;
  // Header "Unit 3" over a breadcrumb / side panel "South Molton - unit 3",
  // and "10 Piccadilly Time Out Market T1" restating the property linked
  // below it: one title everywhere on the page — the unit, else the deal
  // name without its property — with the full name as the tooltip
  // (Woody, 2026-09-28). A bare "Unit 3" didn't say which deal, so the
  // shared helper pairs the unit with its tenant (Woody, 2026-09-28).
  const pageTitle = dealDisplayTitle({
    name: deal?.name,
    propertyName: linkedProperty?.name,
    propertyAddress: linkedProperty?.address || undefined,
    tenantName: names?.parties.tenant?.name || null,
    unitName: headingIsUnit ? linkedUnit!.unitName : null,
    isInvestment: isInvestmentDeal,
  });

  useEffect(() => {
    if (deal) {
      // Deal's own name first: many deals share a property name ("Canary
      // Wharf Estate…"), which made the deal and property entries in Quick
      // Access indistinguishable. The property rides along as the subtitle.
      // Same title as the page header (Woody, 2026-09-28).
      const propName = linkedProperty?.name || (deal as any).propertyName;
      trackRecentItem({ id: deal.id, type: "deal", name: pageTitle, subtitle: (propName && propName !== pageTitle ? propName : deal.status) || undefined, team: Array.isArray(deal.team) ? deal.team[0] : undefined });
    }
  }, [deal?.id, deal?.name, (deal as any)?.propertyName, pageTitle]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/crm/deals/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Deal deleted" });
      invalidateDealCaches();
      navigate(isComps ? "/comps" : "/deals");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleActingForSave = async (side: "landlord" | "tenant") => {
    if (((deal as any)?.bgpActingFor || "landlord") === side) return;
    try {
      await apiRequest("PUT", `/api/crm/deals/${id}`, { bgpActingFor: side });
      invalidateDealCaches(id);
    } catch (e: any) {
      toast({
        title: "Couldn't change who BGP acts for",
        description: /unique|duplicate/i.test(e?.message || "") ? "This unit already has a live deal where BGP acts for the landlord." : e?.message,
        variant: "destructive",
      });
    }
  };
  const handlePartySave = async (field: "tenantId" | "landlordId" | "vendorId" | "purchaserId", value: string | null) => {
    await apiRequest("PUT", `/api/crm/deals/${id}`, { [field]: value });
    invalidateDealCaches(id);
    // No in-app AML run on linking a party any more — KYC4U is BGP's MLRO
    // (2026-10-05); raise the party with Request KYC4U check on the KYC card.
  };

  // Inline create for the party pickers. Mirrors the deal-form's
  // createLandlord/Tenant/Vendor/Purchaser flow — the inline picker
  // already supports onCreate; the deal-detail page just wasn't wiring
  // it, so a "No matches" search had no way out. Returning the new id
  // from this resolver lets the picker auto-select it.
  const createCounterparty = async (
    field: "landlordId" | "tenantId" | "vendorId" | "purchaserId",
    companyType: string,
    name: string,
  ) => {
    try {
      const r = await apiRequest("POST", "/api/crm/companies", {
        name: name.trim(),
        companyType,
      });
      const created = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
      await handlePartySave(field, String(created.id));
      toast({ title: `${companyType} created`, description: `${created.name} added to CRM and linked.` });
    } catch (e: any) {
      toast({ title: "Create failed", description: e?.message || "Try again from the Companies page", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="p-4 sm:p-6 text-center space-y-4">
        <h2 className="text-lg font-semibold">Deal not found</h2>
        <Link href={isComps ? "/comps" : "/deals"}>
          <Button variant="outline" data-testid="button-back-deals-notfound">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {isComps ? "Back to Comps" : "Back to WIP"}
          </Button>
        </Link>
      </div>
    );
  }

  const _areaBasis = deal.areaBasis || areaBasisFromAssetClass(deal.assetClass);
  const _isRetail = isRetailAssetClass(deal.assetClass);
  const letting = page?.letting || null;
  const live = !!ddStatusCode && !["WIT", "COM", "INV", "ARCH"].includes(ddStatusCode);

  const numericFields: { label: string; value: number | string | null | undefined; format?: "currency" | "number" | "percent" }[] = [
    { label: "Pricing", value: deal.pricing, format: "currency" },
    { label: "Headline rent", value: deal.rentPa, format: "currency" },
    { label: "Yield", value: deal.yieldPercent, format: "percent" },
    { label: `${_areaBasis} area (sq ft)`, value: deal.totalAreaSqft, format: "number" },
    { label: "Price psf", value: deal.pricePsf, format: "currency" },
    ...(_isRetail ? [{ label: "Price ITZA", value: deal.priceItza, format: "currency" as const }] : []),
    { label: "Capital contribution", value: deal.capitalContribution, format: "currency" },
    { label: "Rent free (months)", value: deal.rentFree, format: "number" },
    { label: "Lease length (years)", value: deal.leaseLength, format: "number" },
    { label: "Break option (years)", value: deal.breakOption, format: "number" },
    { label: "Rent analysis", value: deal.rentAnalysis, format: "currency" },
  ];

  // Last = latest past date; a future stored date only ever shows as Next.
  let lastTouchValue: string | null = null;
  let nextTouchValue: string | null = null;
  if (storedLastTouch.kind === "text") lastTouchValue = storedLastTouch.text;
  else if (storedLastTouch.kind === "last") lastTouchValue = formatDate(deal.lastInteraction);
  else if (storedLastTouch.kind === "next") {
    const touch = pickTouchDates(ddActivity?.emailHits, ddActivity?.meetingHits);
    if (touch.last) lastTouchValue = formatDate(touch.last);
    if (touch.next || !touch.last) nextTouchValue = formatDate(touch.next || deal.lastInteraction);
  }

  // Deal Type + Status deliberately omitted here — they're already in the
  // header (the "Deal · {type}" eyebrow + the status badge).
  const textFields: { label: string; value: string | null | undefined; colorMap?: Record<string, string>; href?: string }[] = [
    { label: "Team", value: Array.isArray(deal.team) ? deal.team.join(", ") : deal.team, colorMap: DEAL_TEAM_COLORS },
    { label: "Tenure", value: deal.tenureText },
    { label: "Fee agreement", value: deal.feeAgreement, colorMap: DEAL_FEE_AGREEMENT_COLORS },
    { label: "Instructed", value: deal.instructedAt ? formatDate(deal.instructedAt) : null },
    { label: "Exchanged", value: deal.exchangedAt ? formatDate(deal.exchangedAt) : null },
    { label: "Completed", value: deal.completedAt ? formatDate(deal.completedAt) : null },
    { label: "Invoiced", value: deal.invoicedAt ? formatDate(deal.invoicedAt) : null },
    { label: "Last contact", value: lastTouchValue },
    { label: "Next contact", value: nextTouchValue },
  ];

  // Investment: the purchaser or vendor; leasing: the tenant.
  const counterpartyRole: DealPartyRole = isInvestmentDeal ? (deal.dealType === "Sale" ? "purchaser" : "vendor") : "tenant";
  const counterpartyLabel = counterpartyRole === "purchaser" ? "Purchaser" : counterpartyRole === "vendor" ? "Vendor" : "Tenant";
  const counterparty = names?.parties[counterpartyRole] || null;
  const trackerHref = letting ? trackerUnitHref(letting.trackerId, letting.propertyId, { staff: staffView, landsecView, restricted: jointAgent }) : null;
  const waitingWho = page?.clock && (page.clock.waitingOnParty || page.clock.waitingOnName);

  const sectionList = dealPageSections(viewerKind, { letting: !!letting });
  const brandParties = (["tenant", "landlord"] as const)
    .map(role => ({ role, party: names?.parties[role] || null }))
    .filter((x): x is { role: "tenant" | "landlord"; party: { id: string; name: string; domain: string | null } } => !!x.party?.id)
    .filter((x, i, arr) => arr.findIndex(a => a.party.id === x.party.id) === i);

  return (
    <div className="h-[calc(100vh-48px)] flex flex-col" data-testid={`deal-detail-${id}`}>
      <div className="px-4 sm:px-6 pt-4 sm:pt-5">
        <Breadcrumbs
          items={[
            { label: isComps ? "Comps" : "Deals", href: isComps ? "/comps" : "/deals" },
            { label: pageTitle },
          ]}
        />
      </div>

      <div className="flex-1 overflow-y-auto cq-body min-h-0" data-testid="deal-scroll">
        <div className="p-4 sm:p-5">
          <CompanyKindPage key={id} testId="deal-page" sectionTestPrefix="deal-section" scrollOnPhone>
            {(select) => {
              const hasSection = (key: string) => sectionList.some(s => s.key === key);
              const goTo = (key: string) => { if (hasSection(key)) select(key); };
              // What pressing an event or a link on the page opens.
              const openThing = (open: DealEventOpen | LettingDialog) => {
                if ("section" in open) return goTo(open.section);
                if (open.to === "offer") return setDialog(open);
                if (letting?.current) return setDialog(open as LettingDialog);
                goTo(open.to === "checklist" ? "checklist" : "negotiation");
              };
              const top = (
                <div className="space-y-3 min-w-0">
                  <div className="flex items-start gap-2 flex-wrap">
                    <Button variant="ghost" size="icon" className="hidden md:inline-flex shrink-0" data-testid="button-back-deals" onClick={goBack}>
                      <ArrowLeft className="w-4 h-4" />
                    </Button>
                    {/* min-w-[16rem], not min-w-0: with basis 0 the title block "fits" at
                        any width, so the wrap never triggered and a narrow window (chat
                        panel open) crushed the heading to one word per line — the action
                        buttons must wrap below instead. */}
                    <div className="flex-1 min-w-[16rem]">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary mb-1" data-testid="deal-eyebrow">
                        <span className="w-2 h-2 rounded-full bg-primary" /> Deal{deal.dealType ? ` · ${deal.dealType}` : ""}
                        {(deal as any).dealRef ? <span className="font-mono tabular-nums normal-case" data-testid="deal-ref">#{(deal as any).dealRef}</span> : null}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {headingIsUnit && !jointAgent ? (
                          <button
                            onClick={() => setUnitEditOpen(true)}
                            className="text-xl font-bold truncate hover:underline hover:text-primary transition-colors"
                            data-testid="text-deal-name"
                            title={`${deal.name ? `${deal.name} — ` : ""}click to switch unit or edit unit address`}
                          >
                            {pageTitle}
                          </button>
                        ) : (
                          <h1 className="text-xl font-bold truncate" data-testid="text-deal-name" title={deal.name || undefined}>{pageTitle}</h1>
                        )}
                        {deal.status && (
                          <Badge variant="outline" className={`text-[10px] border-transparent ${STATUS_CHIP_COLORS[(legacyToCode(deal.status) || "") as keyof typeof STATUS_CHIP_COLORS] || "bg-muted text-muted-foreground"}`} data-testid="badge-deal-status">{dealStatusLabel(deal.status, deal.dealType)}</Badge>
                        )}
                        {page && page.stage.days != null && live && (
                          <span className="text-xs" data-testid="deal-header-days">
                            <DaysAtStage code={page.stage.code} days={page.stage.days} confirmed={page.stage.confirmed} stageSet={page.stage.set} since={page.stage.since}
                              dealId={id} canSet={page.viewer.canSetStage} testId="deal-days-at-stage" />
                          </span>
                        )}
                        {waitingWho && live && (
                          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => goTo("checklist")} data-testid="deal-header-waiting"
                            title={page?.clock?.waitingNote || page?.clock?.checklistItemLabel || undefined}>
                            Waiting on <span className="font-medium text-foreground">{page!.clock!.waitingOnParty || page!.clock!.waitingOnName}</span>
                            {page!.clock!.waitingOnParty && page!.clock!.waitingOnName ? ` · ${page!.clock!.waitingOnName}` : ""}
                            {page!.waitingDays != null ? <span className="font-mono tabular-nums"> · {page!.waitingDays}d</span> : null}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1 flex-wrap" data-testid="deal-breadcrumb">
                        {linkedProperty && pageTitle !== linkedProperty.name && (
                          <Link href={`/properties/${linkedProperty.id}`} className="inline-flex items-center gap-1 hover:underline hover:text-foreground" title="Open property">
                            <Building2 className="w-3.5 h-3.5" /> {linkedProperty.name}
                          </Link>
                        )}
                        {counterparty ? (
                          <CompanyChip id={jointAgent ? null : counterparty.id} name={counterparty.name} domain={counterparty.domain}
                            role={counterpartyLabel} size={16} className="hover:text-foreground" title={`Open ${counterpartyLabel.toLowerCase()}`} testId="deal-counterparty" />
                        ) : page ? (
                          <span className="text-xs italic">{counterpartyLabel} not set</span>
                        ) : null}
                        {deal.targetDate && (
                          <span className="inline-flex items-center gap-1 text-xs" title="Target date" data-testid="deal-target-date">
                            <CalendarIcon className="w-3.5 h-3.5" /> Target: {formatDate(deal.targetDate)}
                          </span>
                        )}
                        {trackerRow && (
                          <Link href="/deals/investment" className="text-xs hover:underline hover:text-foreground" data-testid="link-investment-board">
                            On the {trackerRow.boardType === "Sales" ? "Sales" : "Purchases"} board →
                          </Link>
                        )}
                        {(unitOffProperty || (!isInvestmentDeal && unitNameIsOtherAddress)) && !isClientDeal && (
                          <button
                            type="button"
                            onClick={() => setUnitEditOpen(true)}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            title="The linked unit looks like it belongs to another building — click to pick the right unit"
                            data-testid="chip-unit-off-property"
                          >
                            {unitOffProperty ? `Unit ${linkedUnit!.unitName} is on another property` : `Linked unit "${linkedUnit!.unitName}" looks like another building`}
                          </button>
                        )}
                        {draftInvoiceOnInvoicedDeal && (
                          <button
                            type="button"
                            onClick={() => { goTo("fees"); setTimeout(() => document.querySelector('[data-testid="xero-invoice-section"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 150); }}
                            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                            title="The deal is marked invoiced/completed but its Xero invoice hasn't been approved yet"
                            data-testid="chip-invoice-still-draft"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Invoice still draft in Xero
                            {draftInvoiceOnInvoicedDeal.totalAmount != null && (
                              <span className="tabular-nums">
                                {" "}· £{Number(draftInvoiceOnInvoicedDeal.totalAmount).toLocaleString("en-GB")}
                                {deal.fee && Number(draftInvoiceOnInvoicedDeal.totalAmount) > Number(deal.fee) * 1.1 ? " inc. VAT" : ""}
                              </span>
                            )}
                          </button>
                        )}
                        {letting && trackerHref && (
                          <Link href={trackerHref} className="text-xs hover:underline hover:text-foreground" data-testid="link-back-to-tracker">
                            {letting.unitName} on the Letting Tracker →
                          </Link>
                        )}
                        {/* Spine state — green chip when the deal is linked
                            to the canonical tenancy unit, amber when it
                            isn't yet (so the property page doesn't see this
                            deal on a specific row). Clicking the green chip
                            jumps to the unit on the property's tenancy
                            schedule. */}
                        {linkedProperty && !isInvestmentDeal && (
                          (deal as any).tenancyUnitId ? (
                            <Link href={`/properties/${linkedProperty.id}#tenancy-unit-${(deal as any).tenancyUnitId}`}>
                              <a
                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                title="Linked to its unit on the property's tenancy schedule"
                                data-testid="chip-on-tenancy-spine"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                On tenancy schedule
                              </a>
                            </Link>
                          ) : !isClientDeal ? (
                            // Internal data-hygiene flag — hidden from client
                            // viewers (the nightly sweep re-links automatically;
                            // staff can still Resolve from the property page).
                            <span
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700"
                              title="This deal isn't yet linked to a tenancy schedule row. It will auto-link on the nightly sweep, or use Resolve on the property page."
                              data-testid="chip-off-tenancy-spine"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              Not on tenancy schedule
                            </span>
                          ) : null
                        )}
                      </div>
                    </div>
                    {/* Edit and one More menu (the landlord page's header shape).
                        A joint agent does not change deals here. */}
                    <div className="flex items-center gap-2 flex-wrap gap-y-1.5">
                      {!jointAgent && (
                        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} data-testid="button-edit-deal">
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit
                        </Button>
                      )}
                      {(!jointAgent || !isClientLogin) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" data-testid="button-deal-more"><MoreHorizontal className="w-4 h-4 mr-1" />More</Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {!jointAgent && (
                              <DropdownMenuItem asChild data-testid="button-deal-image-studio">
                                <Link href={`/image-studio?property=${encodeURIComponent(linkedProperty?.name || (deal as any).propertyName || deal.name || "")}&address=${encodeURIComponent(linkedProperty?.address || linkedProperty?.name || (deal as any).propertyName || deal.name || "")}&propertyId=${encodeURIComponent(deal.propertyId || "")}`}>
                                  <ImageIcon className="w-4 h-4 mr-2" />Image Studio
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {/* Document briefs are staff-only (the API 403s clients and the
                                route guard bounces them home). */}
                            {!isClientDeal && (
                              <DropdownMenuItem asChild data-testid="button-deal-create-document">
                                <Link href={`/document-briefs?propertyId=${encodeURIComponent(deal.propertyId || "")}&propertyName=${encodeURIComponent(linkedProperty?.name || (deal as any).propertyName || deal.name || "")}&postcode=${encodeURIComponent(linkedProperty?.postcode || "")}`}>
                                  <FileText className="w-4 h-4 mr-2" />Document
                                </Link>
                              </DropdownMenuItem>
                            )}
                            {!isClientLogin && (
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteOpen(true)} data-testid="button-delete-deal">
                                <Trash2 className="w-4 h-4 mr-2" />Delete deal
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {page && <StageStrip strip={page.strip} />}

                  <DealConversation
                    dealId={id}
                    dealLabel={pageTitle}
                    dealLive={live}
                    propertyId={deal.propertyId || null}
                    propertyName={linkedProperty?.name || null}
                    unit={letting ? { id: letting.trackerId, name: letting.unitName } : null}
                    earlierNotes={(deal as any).comments}
                    jointAgent={jointAgent}
                  />
                </div>
              );

              const overview = (
                <div className="grid grid-cols-1 gap-3 min-w-0">
                  {page && (
                    <div className={sectionCard} data-testid="deal-clock-card">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deal clock</span>
                        <span className="rounded-full bg-foreground text-background px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">{page.stage.label || "No stage"}</span>
                        {live && <DaysAtStage code={page.stage.code} days={page.stage.days} long confirmed={page.stage.confirmed} stageSet={page.stage.set} since={page.stage.since}
                          dealId={id} canSet={page.viewer.canSetStage} testId="deal-clock-days" />}
                        <NerFigure ner={page.ner} incentivesRecorded={page.incentivesRecorded} prefix="NER " suffix=" pa" dash={false} />
                        {letting && (letting.briefCheck || letting.briefState) && <BriefCheck brief={letting.briefState} check={letting.briefCheck} />}
                        {landsecView && page.viewer.landsec && (deal as any).tenancyUnitId && (
                          <Link href={`/landsec/unit/${(deal as any).tenancyUnitId}`} className="text-primary hover:underline" data-testid="deal-clock-unit-link">Unit page</Link>
                        )}
                      </div>
                      {(page.clock !== null || page.viewer.canSetWaiting) && live && (
                        <div className="mt-1.5"><DealWaitingOn dealId={id} page={page} /></div>
                      )}
                    </div>
                  )}
                  {(() => {
                    const owed = owedItems(page?.checklist || null);
                    if (!owed.length) return null;
                    return (
                      <div className={sectionCard} data-testid="deal-owed">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold">Owed now</h3>
                          <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => goTo("checklist")}>The checklist</button>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {owed.map(i => (
                            <li key={i.id} className="flex items-start gap-2 text-sm">
                              <span className="min-w-0 flex-1">{i.label}</span>
                              <span className={`shrink-0 text-xs ${i.overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                                {[i.assigneeName || "nobody yet", i.dueDate ? `due ${formatDate(i.dueDate)}` : null].filter(Boolean).join(" · ")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })()}
                  {/* The deal's dates and terms in one card, in the page's type
                      scale (Woody, 2026-11-19: "clean up the design ... Similar
                      design issue on this page"). Money and areas in mono;
                      the Net Effective Rent is the clock's. */}
                  {(textFields.some((f) => f.value) || numericFields.some((f) => f.value != null) || [deal.gfAreaSqft, deal.ffAreaSqft, deal.basementAreaSqft, deal.itzaAreaSqft].some((v) => v != null)) && (
                    <div className={sectionCard} data-testid="deal-terms-card">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dates and terms</span>
                      <dl className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-6 gap-y-3">
                        {textFields.filter((f) => f.value).map((field) => {
                          const testId = `text-deal-${field.label.toLowerCase().replace(/\s+/g, "-")}`;
                          return (
                            <div key={field.label} className="min-w-0">
                              <dt className="text-[11px] text-muted-foreground">{field.label}</dt>
                              <dd className="text-sm font-medium truncate" data-testid={testId} title={field.value || undefined}>
                                {field.colorMap && field.value && field.colorMap[field.value] ? (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full shrink-0 ${field.colorMap[field.value]}`} />
                                    {field.value}
                                  </span>
                                ) : field.value}
                              </dd>
                            </div>
                          );
                        })}
                        {numericFields.filter((f) => f.value != null).map((field) => (
                          <div key={field.label} className="min-w-0">
                            <dt className="text-[11px] text-muted-foreground">{field.label}</dt>
                            <dd className="text-sm font-mono tabular-nums font-medium" data-testid={`text-deal-${field.label.toLowerCase().replace(/[\s()\/]+/g, "-")}`}>
                              {field.format === "currency"
                                ? formatCurrency(field.value)
                                : field.format === "percent"
                                ? `${field.value}%`
                                : formatNumber(field.value)}
                            </dd>
                          </div>
                        ))}
                        {[
                          { label: "GF", value: deal.gfAreaSqft },
                          { label: "FF", value: deal.ffAreaSqft },
                          { label: "Bsmt", value: deal.basementAreaSqft },
                          ...(_isRetail ? [{ label: "ITZA", value: deal.itzaAreaSqft }] : []),
                        ].some(f => f.value != null) && (
                          <div className="min-w-0 col-span-2">
                            <dt className="text-[11px] text-muted-foreground">Floor breakdown (sq ft)</dt>
                            <dd className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm">
                              {[
                                { label: "GF", value: deal.gfAreaSqft },
                                { label: "FF", value: deal.ffAreaSqft },
                                { label: "Bsmt", value: deal.basementAreaSqft },
                                ...(_isRetail ? [{ label: "ITZA", value: deal.itzaAreaSqft }] : []),
                              ].filter(f => f.value != null).map(f => (
                                <span key={f.label} className="font-mono tabular-nums">
                                  <span className="text-[11px] text-muted-foreground mr-1">{f.label}</span>
                                  {formatNumber(f.value)}
                                </span>
                              ))}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                  {/* Client-facing fee view: the fee they're paying us. The
                      internal per-agent split stays staff-only (Fees & invoicing). */}
                  {!staffView && (deal.fee != null || deal.feePercentage != null) && (
                    <div className={sectionCard} data-testid="deal-client-fee">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">BGP fee</span>
                      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
                        {deal.fee != null && (
                          <div>
                            <dt className="text-[11px] text-muted-foreground">Total fee</dt>
                            <dd className="text-sm font-mono tabular-nums font-medium" data-testid="text-client-fee-total">{formatCurrency(deal.fee)}</dd>
                          </div>
                        )}
                        {deal.feePercentage != null && (
                          <div>
                            <dt className="text-[11px] text-muted-foreground">Agency fee</dt>
                            <dd className="text-sm font-mono tabular-nums font-medium" data-testid="text-client-fee-pct">{deal.feePercentage}%</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}
                  {/* AI-curated activity — BGP staff's emails and meetings, staff only.
                      Deal moves are on the Timeline, not in this feed. */}
                  {staffView && <AIActivityCard subjectType="deal" subjectId={id} title="Deal Activity (AI curated)" />}
                  <div className={`${sectionCard} space-y-2`} data-testid="deal-activity-feed">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Emails, calls and meetings</span>
                    <ActivitySummary dealId={id} />
                  </div>
                </div>
              );

              const parties = (
                <div className="grid grid-cols-1 gap-3 min-w-0">
                  <DealPartiesCard
                    dealId={id} deal={deal} names={names} isClientDeal={isClientDeal} ddUser={ddUser} dealBgpTeam={dealBgpTeam}
                    onPartySave={handlePartySave} onActingFor={handleActingForSave} onCreate={createCounterparty}
                  />
                  {/* KYC/AML is BGP-internal compliance — never shown to clients.
                      Opening this section reads the AML status, which starts BGP's
                      checks before asking for a party with none in 30 days. */}
                  {staffView && (
                    <div className="space-y-3" data-testid="deal-kyc">
                      <div className="flex items-center gap-2 px-0.5">
                        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">AML and KYC</h3>
                      </div>
                      <DealAmlStatusCard dealId={id} dealStatus={deal.status} />
                      <JointAgencyNoteCard
                        dealId={id}
                        canAdd={!jointAgent}
                        signedBy={ddUser?.name || undefined}
                        defaults={{
                          property: linkedProperty ? [linkedProperty.name, linkedProperty.address && linkedProperty.address !== linkedProperty.name ? linkedProperty.address : null].filter(Boolean).join(", ") : ((deal as any).propertyName || ""),
                          client: names?.parties.landlord?.name || "",
                          tenant: names?.parties.tenant?.name || "",
                          rentPa: deal.rentPa ? String(deal.rentPa) : "",
                        }}
                      />
                    </div>
                  )}
                  {!jointAgent && <LinkedContactsCard deal={deal} />}
                  {!jointAgent && brandParties.length > 0 && (
                    <CollapsibleCard open={brandsOpen} onToggle={() => setBrandsOpen(o => !o)} icon={Building2} title="Brand Profiles" testId="toggle-deal-brands">
                      <div className="space-y-3">
                        {brandParties.map(({ role, party }) => (
                          <div key={party.id} data-testid={`deal-brand-${role}`}>
                            <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">
                              <Building2 className="w-3 h-3" /> {role === "tenant" ? "Tenant" : "Landlord"}: {party.name}
                            </p>
                            <div className="md:hidden"><MobileBrandView companyId={party.id} embedded /></div>
                            <div className="hidden md:block"><BrandProfilePanel companyId={party.id} /></div>
                          </div>
                        ))}
                      </div>
                    </CollapsibleCard>
                  )}
                </div>
              );

              const fees = (
                <div className="grid grid-cols-1 gap-3 min-w-0">
                  <FeeAllocationCard
                    dealId={deal.id}
                    dealFee={deal.fee}
                    headlineRent={deal.rentPa}
                    users={users.map(u => ({ id: String(u.id), name: u.name }))}
                    colorMap={userColorMap}
                  />
                  {((deal as any).poNumber || (deal as any).invoicingEmail || (deal as any).invoicingNotes) && (
                    <div className={sectionCard} data-testid="deal-invoicing-details">
                      <h3 className="text-sm font-semibold mb-1">Invoicing</h3>
                      <div className="grid gap-1 text-sm">
                        {(deal as any).poNumber && <p><span className="text-muted-foreground">PO number </span>{(deal as any).poNumber}</p>}
                        {(deal as any).invoicingEmail && <p><span className="text-muted-foreground">Invoices to </span>{(deal as any).invoicingEmail}</p>}
                        {(deal as any).invoicingNotes && <p className="whitespace-pre-wrap"><span className="text-muted-foreground">Notes </span>{(deal as any).invoicingNotes}</p>}
                      </div>
                    </div>
                  )}
                  <XeroInvoiceSection dealId={deal.id} deal={deal} />
                </div>
              );

              const files = (
                <div className="grid grid-cols-1 gap-3 min-w-0" data-testid="deal-files-section">
                  {letting && <UnitFilesCard trackerId={letting.trackerId} unitName={letting.unitName} />}
                  <div className={sectionCard}>
                    <h3 className="text-sm font-semibold mb-1.5">Property folder</h3>
                    {/* The deal's files live in its property's folder — the same
                        Files panel as the property page (browse / upload / share). */}
                    {linkedProperty && !isClientDeal && (
                      <PropertyFoldersPanel
                        propertyName={linkedProperty.name}
                        propertyId={linkedProperty.id}
                        folderTeams={linkedProperty.folderTeams as any}
                        sharepointFolderUrl={linkedProperty.sharepointFolderUrl as any}
                      />
                    )}
                    {isClientDeal && <p className="text-xs text-muted-foreground italic">Documents are managed by the BGP team.</p>}
                    {!linkedProperty && !isClientDeal && <p className="text-xs text-muted-foreground italic">Link this deal to a property to see its folders.</p>}
                  </div>
                </div>
              );

              const bodies: Record<string, React.ReactNode> = {
                overview,
                timeline: <DealTimelinePanel dealId={id} onOpen={openThing} />,
                negotiation: letting ? <DealNegotiation letting={letting} trackerHref={trackerHref} onOpen={openThing} /> : null,
                checklist: page ? <DealChecklistTasks dealId={id} page={page} onOpen={openThing} assignees={taskAssignees} canAddTask={!!ddUser} /> : <Skeleton className="h-32" />,
                parties,
                fees,
                files,
                history: <DealAuditLog dealId={id} />,
              };
              const sections: CompanySection[] = sectionList.map(s => ({
                key: s.key, label: s.label, body: bodies[s.key],
                count: s.key === "checklist" ? (page?.tasks.filter(t => !t.done).length || 0) + (page?.checklist ? page.checklist.items.filter(i => !i.done).length : 0) || null
                  : s.key === "negotiation" ? letting?.offers.length || null : null,
              }));
              const foot = deal.updatedAt ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1 pt-1">
                  <Clock className="w-3 h-3" />
                  Last updated: {new Date(deal.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }).replace(/\bSept\b/, "Sep")}
                </p>
              ) : null;
              return { top, sections, foot };
            }}
          </CompanyKindPage>
        </div>
      </div>

      <LettingDialogs dealId={id} letting={letting} dialog={dialog} setDialog={setDialog} />

      {editOpen && <DealEditDialog deal={deal} open={editOpen} onOpenChange={setEditOpen} />}

      {unitEditOpen && (
        <UnitEditDialog
          dealId={id}
          deal={deal}
          linkedUnit={linkedUnit}
          onClose={() => setUnitEditOpen(false)}
        />
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Deal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deal.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Parties: the BGP team, who BGP acts for, then each party as its own block:
// the brand, and under it the company that signs, who is billed in Xero and
// who to ask (DealPartyLines). Woody, 2026-11-19: "the landlord and tenant
// have numbers but its not clear if there is a billing company? The brand is
// different normally to the billing or contracting entity which is critical
// for the AML", and "clean up the design the Land lord tenant and xero all
// older text". A client login reads the party names from the page's own
// read; BGP staff pick and create parties, so the company list loads when
// this section is first opened.
function DealPartiesCard({ dealId, deal, names, isClientDeal, ddUser, dealBgpTeam, onPartySave, onActingFor, onCreate }: {
  dealId: string; deal: CrmDeal; names: DealPageNames | null; isClientDeal: boolean; ddUser: any; dealBgpTeam: BgpTeamPerson[];
  onPartySave: (field: "tenantId" | "landlordId" | "vendorId" | "purchaserId", value: string | null) => Promise<void>;
  onActingFor: (side: "landlord" | "tenant") => Promise<void>;
  onCreate: (field: "landlordId" | "tenantId" | "vendorId" | "purchaserId", companyType: string, name: string) => Promise<void>;
}) {
  const { data: companies = [] } = useQuery<CrmCompany[]>({ queryKey: ["/api/crm/companies"], enabled: !isClientDeal });
  const id = dealId;
  const partiesInvestment = deal.dealType === "Sale" || deal.dealType === "Purchase";
  const companyOptions = (keep: (c: CrmCompany) => boolean, current: string | null | undefined) => {
    const list = companies.filter(c => keep(c) || c.id === current).map(c => ({ id: c.id, name: c.name }));
    // Until the list arrives the current party still shows by name.
    if (current && !list.some(c => c.id === current)) {
      const known = (["landlord", "tenant", "vendor", "purchaser"] as const).map(r => names?.parties[r]).find(p => p?.id === current);
      if (known) list.push({ id: current, name: known.name });
    }
    return list;
  };
  const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-muted-foreground";
  const actingFor = ((deal as any).bgpActingFor || "landlord") as "landlord" | "tenant";
  // Leasing deals show Landlord/Tenant; investment (Sale/Purchase) deals show
  // Vendor/Purchaser — the unused pair is clutter that invites mis-linking
  // (UX #19). Already-linked slots stay visible either way so existing data
  // is never hidden.
  const slots: Array<{
    role: "landlord" | "tenant" | "vendor" | "purchaser"; label: string; field: "landlordId" | "tenantId" | "vendorId" | "purchaserId";
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
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Parties</h3>
        </div>
        {/* The BGP team on the deal, the same rows as every People board
            (Woody, 2026-11-14). Clients see who to chase; staff change the
            agents in Fee allocation, where the split lives. */}
        {dealBgpTeam.length > 0 && (
          <div className="pb-3 border-b border-border" data-testid="deal-bgp-team">
            <BgpTeamGroup people={dealBgpTeam} addControl={isClientDeal ? null : <span className="text-[11px] text-muted-foreground">Change in Fees &amp; invoicing</span>} />
          </div>
        )}
        {isClientDeal ? (
          // UX #155 — clients get read-only party slots: staff-worded "+ Link
          // landlord" pickers on their own deal read like the deal is set up
          // wrong. Landlord defaults to their own company.
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(partiesInvestment
              ? [["Vendor", names?.parties.vendor?.name || null], ["Purchaser", names?.parties.purchaser?.name || null]]
              : [["Landlord", names?.parties.landlord?.name || ddUser?.companyScopeName || null], ["Tenant", names?.parties.tenant?.name || null]]
            ).map(([label, name]) => (
              <div key={label as string} className="space-y-1" data-testid={`client-party-${String(label).toLowerCase()}`}>
                <p className={sectionLabel}>{label}</p>
                {name
                  ? <p className="text-sm font-medium">{name}</p>
                  : <p className="text-sm text-muted-foreground">Not set yet: your BGP team will link the parties.</p>}
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Which side BGP acts for on a leasing deal — drives instruction
                vs related activity on the landlord and brand pages (Woody,
                2026-09-26). Investment deals take their side from the
                vendor / purchaser. */}
            {!partiesInvestment && (
              <div className="flex flex-wrap items-center gap-2" data-testid="deal-bgp-acting-for">
                <span className={sectionLabel}>BGP acts for</span>
                {(["landlord", "tenant"] as const).map(side => (
                  <Pill key={side} active={actingFor === side} onClick={() => onActingFor(side)} data-testid={`deal-acting-for-${side}`}>
                    {side === "landlord" ? "Landlord" : "Tenant"}
                  </Pill>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {slots.map(slot => (
                <div key={slot.role} className="rounded-lg border border-border p-3 space-y-2" data-testid={`deal-party-${slot.role}`}>
                  <div className="flex items-center gap-2">
                    <span className={sectionLabel}>{slot.label}</span>
                    {!partiesInvestment && (slot.role === "landlord" || slot.role === "tenant") && actingFor === slot.role && (
                      <span className="text-[11px] text-muted-foreground">· BGP's client</span>
                    )}
                  </div>
                  <InlineLinkSelect
                    value={slot.value}
                    options={companyOptions(slot.keep, slot.value)}
                    href={slot.value ? `/companies/${slot.value}` : undefined}
                    onSave={(v) => onPartySave(slot.field, v || null)}
                    onCreate={(name) => onCreate(slot.field, slot.createType, name)}
                    placeholder={`Link ${slot.label.toLowerCase()}`}
                  />
                  {/* The company that signs, who is billed and who to ask
                      (BGP staff; this branch is never drawn for a client login). */}
                  {slot.value && <DealPartyLines dealId={id} role={slot.role} />}
                </div>
              ))}
            </div>
            {/* The deal's own invoice contact in Xero, from before each party
                had its own billing contact: shown only when one is held. */}
            {(deal as any).xeroContactName && (
              <p className="text-sm" data-testid="deal-xero-contact">
                <span className={sectionLabel}>Invoice contact (Xero)</span>{" "}
                <span className="ml-1 font-medium">{(deal as any).xeroContactName}</span>
                {(deal as any).xeroAccountNumber && <span className="text-muted-foreground"> · A/C <span className="font-mono tabular-nums">{(deal as any).xeroAccountNumber}</span></span>}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// The deal's contacts other than the parties' own: the client contact and
// the agents' people. Read from the CRM list the login already reads, when
// the Parties section is first opened.
function LinkedContactsCard({ deal }: { deal: CrmDeal }) {
  const { data: contacts = [] } = useQuery<CrmContact[]>({ queryKey: ["/api/crm/contacts"] });
  const d: any = deal;
  // Agent PEOPLE live in *_agent_contact_id (the *_agent_id columns are
  // firms); the firm columns stay as a fallback for older rows.
  const ids = [deal.clientContactId, d.vendorAgentContactId, d.acquisitionAgentContactId, d.purchaserAgentContactId, d.leasingAgentContactId,
    deal.vendorAgentId, deal.acquisitionAgentId, deal.purchaserAgentId, deal.leasingAgentId].filter(Boolean);
  const linked = (Array.isArray(contacts) ? contacts : []).filter(c => ids.includes(c.id));
  if (!linked.length) return null;
  return (
    <div className={sectionCard} data-testid="linked-contacts-panel">
      <h3 className="text-sm font-semibold mb-1.5">Linked contacts <span className="font-mono tabular-nums text-muted-foreground">{linked.length}</span></h3>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {linked.map((contact) => (
          <Link key={contact.id} href={`/contacts/${contact.id}`}>
            <div className="p-2 rounded-md border hover-elevate cursor-pointer">
              <p className="text-xs font-medium">{contact.name}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {contact.role && <span className="text-[9px] text-muted-foreground">{contact.role}</span>}
                {(contact as any).companyName && <Badge variant="outline" className="text-[9px]">{(contact as any).companyName}</Badge>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// The Letting Tracker unit's own files: brochures, plans, photos and the
// final agreed Heads of Terms, as the unit's Files list holds them.
function UnitFilesCard({ trackerId, unitName }: { trackerId: string; unitName: string }) {
  const { data: files = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/available-units", trackerId, "files"], retry: false });
  const label: Record<string, string> = { brochure: "Brochures", floorplan: "Floor plans", photo: "Photos", other: "Other" };
  const groups = Object.keys(label).map(k => ({ key: k, rows: (Array.isArray(files) ? files : []).filter(f => (f.category || "other") === k) })).filter(g => g.rows.length);
  return (
    <div className={sectionCard} data-testid="deal-unit-files">
      <h3 className="text-sm font-semibold mb-1.5">{unitName}: the unit's files</h3>
      {isLoading ? <Skeleton className="h-10" />
        : groups.length === 0 ? <p className="text-xs text-muted-foreground">No files on the unit yet.</p>
        : (
          <div className="space-y-2">
            {groups.map(g => (
              <div key={g.key}>
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">{label[g.key]}</p>
                <ul className="space-y-0.5">
                  {g.rows.map(f => (
                    <li key={f.id} className="text-sm truncate">
                      {f.filePath ? <a href={f.filePath} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{f.fileName}</a> : f.fileName}
                      {f.fileType === "hots_final" ? <span className="text-xs text-muted-foreground"> · final agreed Heads of Terms</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// The edit form, with the lists its pickers need loaded when it opens.
function DealEditDialog({ deal, open, onOpenChange }: { deal: CrmDeal; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: properties = [] } = useQuery<CrmProperty[]>({ queryKey: ["/api/crm/properties"], enabled: open });
  const { data: companies = [] } = useQuery<CrmCompany[]>({ queryKey: ["/api/crm/companies"], enabled: open });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"], enabled: open });
  return <DealFormDialog open={open} onOpenChange={onOpenChange} deal={deal} properties={properties} companies={companies} users={users} />;
}

// Unit pick + unit-level address editor — opened from the heading (BGP staff).
// It starts from the unit record's own address, so saving without a change
// keeps it (it used to start empty and blank the address on Save).
function UnitEditDialog({ dealId, deal, linkedUnit, onClose }: {
  dealId: string; deal: CrmDeal; linkedUnit: DealPageNames["unit"]; onClose: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    propertyId: deal.propertyId || "",
    switchToUnitId: linkedUnit?.id || "",
    unitAddress: linkedUnit?.unitAddress || "",
    unitPostcode: linkedUnit?.unitPostcode || "",
    unitUprn: linkedUnit?.unitUprn || "",
    unitAddressFreeText: linkedUnit?.unitAddressFreeText || "",
  });
  const { data: properties = [] } = useQuery<CrmProperty[]>({ queryKey: ["/api/crm/properties"] });
  const pickPropertyId = form.propertyId || deal.propertyId || "";
  const { data: unitsOnProperty = [] } = useQuery<Array<{ id: string; unitName: string; propertyId: string }>>({
    queryKey: [`/api/property-units?propertyId=${encodeURIComponent(pickPropertyId)}`],
    enabled: !!pickPropertyId,
  });
  const save = useMutation({
    mutationFn: async () => {
      if (linkedUnit?.id) {
        await apiRequest("PATCH", `/api/property-units/${linkedUnit.id}`, {
          unitAddress: form.unitAddress || null,
          unitPostcode: form.unitPostcode || null,
          unitUprn: form.unitUprn || null,
          unitAddressFreeText: form.unitAddressFreeText || null,
        });
      }
      // A deal with no property had nowhere to pick a unit from and the
      // save did nothing visible (Woody, 2026-10-06) — the property is
      // set here too.
      const dealPatch: Record<string, string> = {};
      if (form.propertyId && form.propertyId !== deal.propertyId) dealPatch.propertyId = form.propertyId;
      if (form.switchToUnitId && form.switchToUnitId !== linkedUnit?.id) dealPatch.unitId = form.switchToUnitId;
      if (Object.keys(dealPatch).length) await apiRequest("PUT", `/api/crm/deals/${dealId}`, dealPatch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/deals", dealId] });
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith("/api/property-units") });
      invalidateDealCaches(dealId);
      onClose();
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Unit</DialogTitle>
          <DialogDescription>
            Set the property, switch to a different unit on it, or edit this unit's address details. The address feeds business-rates and EPC lookups.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Property</Label>
            <PropertyCombobox
              testId="select-unit-dialog-property"
              placeholder="Select property or paste an address"
              value={form.propertyId}
              items={properties.map((p) => ({ id: p.id, label: p.name, subLabel: p.postcode || undefined, keywords: [p.postcode || ""] }))}
              onChange={(v) => setForm(f => ({ ...f, propertyId: v, switchToUnitId: v === f.propertyId ? f.switchToUnitId : "" }))}
              onCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/crm/properties"] })}
            />
            {!deal.propertyId && <p className="text-xs text-muted-foreground mt-1">This deal isn't linked to a property yet — pick or create one here.</p>}
          </div>
          <div>
            <Label className="text-xs">Switch unit</Label>
            <Select value={form.switchToUnitId || undefined} onValueChange={(v) => setForm(f => ({ ...f, switchToUnitId: v }))}>
              <SelectTrigger><SelectValue placeholder={unitsOnProperty.length ? "Pick a unit on this property" : pickPropertyId ? "No units on this property yet" : "Pick a property first"} /></SelectTrigger>
              <SelectContent>
                {unitsOnProperty.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.unitName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="border-t pt-3 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Unit address — for "{linkedUnit?.unitName || "this unit"}"
            </div>
            <div>
              <Label className="text-xs">Address line</Label>
              <Input value={form.unitAddress} onChange={e => setForm(f => ({ ...f, unitAddress: e.target.value }))} placeholder="e.g. Unit 4A, Grand Central, Birmingham" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Postcode</Label>
                <Input value={form.unitPostcode} onChange={e => setForm(f => ({ ...f, unitPostcode: e.target.value }))} placeholder="B2 4AB" />
              </div>
              <div>
                <Label className="text-xs">UPRN</Label>
                <Input value={form.unitUprn} onChange={e => setForm(f => ({ ...f, unitUprn: e.target.value }))} placeholder="200012345678" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Free-text fallback <span className="text-muted-foreground">(if not on PAF)</span></Label>
              <Input value={form.unitAddressFreeText} onChange={e => setForm(f => ({ ...f, unitAddressFreeText: e.target.value }))} placeholder="Kiosk 12, Market Hall ground floor" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
