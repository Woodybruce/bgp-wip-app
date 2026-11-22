// The requirement panel (docs/requirements-board-review-2026-11-19.md,
// section 2; Woody, 19 November 2026: "carry on"). Pressing a row on the
// requirements board opens it beside the list (a sheet on a phone), and its
// address is ?requirementId=, so every link in the app that names a
// requirement lands on it. It reads; its only writes are the ones the board
// already makes (Confirm / Still live, Edit through the form, Add as target,
// Want at this scheme, Delete).
//
// A client login sees what the requirement wants, its own date line, the
// agent, the brand and the units of its own that fit. Never the state, the
// owner, the sources, the evidence, the conversation or the CRM plan.
import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ClipboardList, ExternalLink, Loader2, Mail, MoreVertical, Pencil, Phone, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyChip } from "@/components/company-chip";
import { SuperBrandBadge } from "@/components/brand-page/super-brand-star";
import { EstatePipelineCards } from "@/components/brand-page/estate-pipeline";
import { SchemePlanCard } from "@/components/brand-crm/scheme-plan-card";
import { LandlordEngagementPanel } from "@/components/landlord-engagement-panel";
import { CompanyMiniChat } from "@/components/brand-profile-panel";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { lastContactShort } from "@shared/last-contact";
import type { RequirementLive } from "@shared/requirement-live";
import type { BoardFit, BoardRow } from "@shared/requirements-board";
import type { UnitLinkViewer } from "@/lib/unit-links";
import { RequirementStatePill, fitHref } from "./board-rows";

const capital = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const microLabel = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-2 border-t border-border pt-4" data-testid={testId}>
      <h3 className={microLabel}>{title}</h3>
      {children}
    </section>
  );
}

export interface RequirementPanelProps {
  row: BoardRow | null;
  /** The requirement's full record (comments), when the board has it. */
  comments: string | null;
  open: boolean;
  onClose: () => void;
  /** BGP staff signed in as themselves. */
  staff: boolean;
  /** The centre's tools: Still live / Confirm and the evidence drawer. */
  canUseCentre: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** A Landsec login (its Brand CRM plan comes from the Landsec door). */
  landsecView: boolean;
  live: RequirementLive | null;
  onEdit: () => void;
  onConfirm: () => void;
  onEvidence: () => void;
  onDelete: () => void;
  /** A draft (BGP staff): "Not a requirement" archives it, with Undo. */
  isDraft: boolean;
  onDismissDraft: () => void;
  /** The landlord pack: upload and remove for BGP staff, the link for a client login. */
  packSlot?: React.ReactNode;
  stillLiveBusy: boolean;
  unitViewer: UnitLinkViewer;
  isMobile: boolean;
}

export default function RequirementPanel(props: RequirementPanelProps) {
  const { row, open, onClose, isMobile } = props;
  return (
    <Sheet open={open && !!row} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side={isMobile ? "bottom" : "right"} className={isMobile ? "h-[92vh] overflow-y-auto" : "w-full overflow-y-auto sm:max-w-xl"} data-testid="requirement-panel">
        {row && <PanelBody {...props} row={row} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelBody({ row, comments, staff, canUseCentre, canEdit, canDelete, landsecView, live, onEdit, onConfirm, onEvidence, onDelete, isDraft, onDismissDraft, packSlot, stillLiveBusy, unitViewer }: RequirementPanelProps & { row: BoardRow }) {
  const r = row.requirement;
  return (
    <div className="space-y-4">
      <SheetHeader className="space-y-2 text-left">
        <SheetTitle className="flex flex-wrap items-center gap-2 pr-8 text-lg leading-snug">
          {row.brandId
            ? <CompanyChip id={row.brandId} name={row.brandName} domain={row.domain} size={22} testId="requirement-panel-brand" />
            : <span>{row.brandName}</span>}
          {row.superBrand && <SuperBrandBadge />}
        </SheetTitle>
        {/* The requirement's own name only when it says more than the brand's. */}
        {r.name && r.name.trim().toLowerCase() !== row.brandName.trim().toLowerCase() && <p className="text-sm font-medium" data-testid="requirement-panel-name">{r.name}</p>}
        <SheetDescription asChild>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {staff && live && <RequirementStatePill live={live} testId="requirement-panel-state" />}
            <span className="text-muted-foreground">{capital(r.dateLine)}</span>
          </div>
        </SheetDescription>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {canUseCentre && live && live.state !== "closed" && (
            <Button size="sm" variant="outline" className="gap-1" disabled={stillLiveBusy} onClick={onConfirm} data-testid="requirement-panel-confirm">
              {stillLiveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {live.confirmed ? "Still live" : "Confirm"}
            </Button>
          )}
          {canEdit && <Button size="sm" variant="outline" className="gap-1" onClick={onEdit} data-testid="requirement-panel-edit"><Pencil className="h-3.5 w-3.5" />Edit</Button>}
          {canUseCentre && <Button size="sm" variant="ghost" className="gap-1" onClick={onEvidence} data-testid="requirement-panel-evidence"><ClipboardList className="h-3.5 w-3.5" />Evidence</Button>}
          {(canDelete || (canUseCentre && isDraft)) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More" data-testid="requirement-panel-more"><MoreVertical className="h-4 w-4" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUseCentre && isDraft && <DropdownMenuItem onClick={onDismissDraft} data-testid="requirement-panel-not-a-requirement">Not a requirement</DropdownMenuItem>}
                {canDelete && <DropdownMenuItem onClick={onDelete} className="text-destructive" data-testid="requirement-panel-delete"><Trash2 className="h-4 w-4" />Delete requirement</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </SheetHeader>

      <Section title="What it wants" testId="requirement-panel-wants">
        <p className="text-sm">{r.wants || <span className="text-muted-foreground">No size, use or places given</span>}</p>
        {(r.type || r.group) && <p className="text-xs text-muted-foreground">{[r.type, r.group].filter(Boolean).join(" · ")}</p>}
        {comments && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{comments}</p>}
        {r.deal && (
          <p className="text-sm">
            <span className="text-muted-foreground">Transaction </span>
            <Link href={`/deals/${r.deal.id}`} className="text-primary hover:underline" data-testid="requirement-panel-deal">{r.deal.name}</Link>
            {r.deal.status && <span className="text-xs text-muted-foreground"> · {r.deal.status}</span>}
          </p>
        )}
        {packSlot && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">Landlord pack</span>{packSlot}</div>}
        {staff && r.sources && r.sources.length > 0 && <p className="text-xs text-muted-foreground">Source: {r.sources.join(", ")}</p>}
        {staff && r.listingUrl && (
          <a href={r.listingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" data-testid="requirement-panel-listing">
            Open the PIPnet listing <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {row.others.length > 0 && (
          <div className="space-y-1 pt-1" data-testid="requirement-panel-others">
            <p className="text-xs font-medium">Their other {row.others.length === 1 ? "requirement" : "requirements"}</p>
            {row.others.map(o => (
              <p key={o.id} className="text-xs text-muted-foreground">{o.wants || o.name} · {o.dateLine}</p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Who" testId="requirement-panel-who">
        {row.agent ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground">Agent</span>
            <Link href={`/contacts/${row.agent.contactId}`} className="hover:underline">{row.agent.name}</Link>
            {row.agent.firmName && (row.agent.firmId ? <Link href={`/companies/${row.agent.firmId}`} className="text-muted-foreground hover:underline">{row.agent.firmName}</Link> : <span className="text-muted-foreground">{row.agent.firmName}</span>)}
            {row.agent.phone && <a href={`tel:${row.agent.phone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Phone className="h-3.5 w-3.5" />Call</a>}
            {row.agent.email && <a href={`mailto:${row.agent.email}`} className="inline-flex items-center gap-1 text-primary hover:underline"><Mail className="h-3.5 w-3.5" />Email</a>}
          </div>
        ) : <p className="text-sm text-muted-foreground">No agent recorded.</p>}
        {staff && (
          <p className="text-sm"><span className="text-muted-foreground">BGP owner</span> {row.owners?.length ? row.owners.map(o => o.name).join(", ") : <span className="text-muted-foreground">No owner</span>}</p>
        )}
        {staff && <p className="text-sm"><span className="text-muted-foreground">Last contact</span> {lastContactShort(row.lastContactAt ?? null) || <span className="text-muted-foreground">none read yet</span>}</p>}
      </Section>

      <FitsSection row={row} staff={staff} unitViewer={unitViewer} />

      {row.brandId && (
        <Section title="The brand" testId="requirement-panel-brand-cards">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {row.expansion
              ? <span><span className="text-muted-foreground">Expansion</span> <span className="font-mono tabular-nums">{row.expansion.score}</span> <span className="text-muted-foreground">{row.expansion.band}</span></span>
              : <span className="text-muted-foreground">No Expansion score yet</span>}
            <Link href={`/companies/${row.brandId}`} className="text-primary hover:underline">Open the brand page</Link>
          </div>
          <EstatePipelineCards companyId={row.brandId} staff={staff} plans={null} />
          {(staff || landsecView) && <SchemePlanCard companyId={row.brandId} client={!staff} />}
        </Section>
      )}

      {staff && row.brandId && (
        <Section title="Conversation" testId="requirement-panel-conversation">
          <CompanyMiniChat companyId={row.brandId} companyName={row.brandName} compact stacked title="Brand conversation" />
        </Section>
      )}

      {staff && row.brandId && (
        <Section title="CRM plan" testId="requirement-panel-crm">
          <LandlordEngagementPanel companyId={row.brandId} kind="brand" companyName={row.brandName} />
        </Section>
      )}
    </div>
  );
}

// Every unit the requirement fits by the one fit rule, each opening the unit,
// with Add as target (the unit's Targeting Brief) and, for BGP staff, Want at
// this scheme (the Brand CRM's Wanted line).
function FitsSection({ row, staff, unitViewer }: { row: BoardRow; staff: boolean; unitViewer: UnitLinkViewer }) {
  const { toast } = useToast();
  const id = row.requirement.id;
  const { data, isLoading, isError } = useQuery<{ fits: BoardFit[]; unitPool: number }>({
    queryKey: ["/api/crm/requirements-board", id, "fits"],
    queryFn: async () => (await apiRequest("GET", `/api/crm/requirements-board/${encodeURIComponent(id)}/fits`)).json(),
  });
  const [done, setDone] = useState<Record<string, string>>({});
  const addTarget = useMutation({
    mutationFn: async (fit: BoardFit) => {
      const brief = await (await apiRequest("POST", "/api/unit-briefs", { unitId: fit.unitId })).json();
      if (!brief?.id) throw new Error("Could not open a brief for this unit");
      await apiRequest("POST", `/api/unit-briefs/${brief.id}/targets`, { operatorName: row.brandName, companyId: row.brandId || undefined, priority: "B" });
      return fit;
    },
    onSuccess: fit => { setDone(d => ({ ...d, [`t:${fit.unitId}`]: "On the brief" })); toast({ title: `${row.brandName} added to the brief`, description: `${fit.unitName}${fit.propertyName ? ` at ${fit.propertyName}` : ""}` }); },
    onError: (e: any) => toast({ title: "Couldn't add to the brief", description: e?.message, variant: "destructive" }),
  });
  const want = useMutation({
    mutationFn: async (fit: BoardFit) => { await apiRequest("POST", "/api/brand-crm/targets", { companyId: row.brandId, propertyId: fit.propertyId }); return fit; },
    onSuccess: fit => { setDone(d => ({ ...d, [`w:${fit.propertyId}`]: "Wanted here" })); toast({ title: "Wanted here", description: `${row.brandName} is on the Brand CRM for ${fit.propertyName || "this scheme"}.` }); },
    onError: (e: any) => toast({ title: "Couldn't add it", description: e?.message, variant: "destructive" }),
  });
  return (
    <Section title="Where it fits" testId="requirement-panel-fits">
      <p className="text-xs text-muted-foreground">Units on the market that fit by the one rule: the size and the use or a place it names; with no size to compare, both.</p>
      {isLoading ? <Skeleton className="h-16 w-full" />
        : isError ? <p role="status" className="text-sm text-muted-foreground">The units that fit could not be loaded.</p>
        : !data?.fits.length ? <p className="text-sm text-muted-foreground" data-testid="requirement-panel-no-fits">No unit on the market fits{data ? ` (of ${data.unitPool.toLocaleString("en-GB")} read)` : ""}.</p>
        : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {data.fits.map(fit => (
              <li key={fit.unitId} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2" data-testid={`requirement-panel-fit-${fit.unitId}`}>
                <div className="min-w-0">
                  <Link href={fitHref(fit, unitViewer)} className="block truncate text-sm text-primary hover:underline">{fit.unitName}{fit.propertyName ? ` · ${fit.propertyName}` : ""}</Link>
                  <p className="text-xs text-muted-foreground">{fit.why}{fit.sqft ? ` · ${fit.sqft.toLocaleString("en-GB")} sq ft` : ""}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {done[`t:${fit.unitId}`]
                    ? <span className="text-xs text-muted-foreground">{done[`t:${fit.unitId}`]}</span>
                    : <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={addTarget.isPending} onClick={() => addTarget.mutate(fit)} data-testid={`requirement-panel-add-target-${fit.unitId}`}><Target className="h-3 w-3" />Add as target</Button>}
                  {staff && row.brandId && fit.propertyId && (done[`w:${fit.propertyId}`]
                    ? <span className="text-xs text-muted-foreground">{done[`w:${fit.propertyId}`]}</span>
                    : <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={want.isPending} onClick={() => want.mutate(fit)} data-testid={`requirement-panel-want-${fit.unitId}`}>Want at this scheme</Button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
    </Section>
  );
}
