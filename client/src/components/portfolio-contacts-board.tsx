import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Building2, ChevronLeft, ChevronRight, Mail, Phone, RefreshCw, Search, Users, X } from "lucide-react";
import type { PortfolioContactEntry, PortfolioContactGroup, PortfolioContactRelationship, PortfolioContactsResponse } from "@shared/portfolio-contacts";
import { getQueryFn } from "@/lib/queryClient";
import { filterPortfolioContacts, portfolioContactsPage, portfolioRelationships, type PortfolioContactsFilter } from "@/lib/portfolio-contacts";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Pill, pillMetrics, pillInactive } from "@/components/ui/pill";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

const GROUPS: Array<{ id: "all" | PortfolioContactGroup; name: string }> = [
  { id: "all", name: "All" },
  { id: "internal", name: "Team" },
  { id: "deals", name: "Deals & tracker" },
  { id: "tenants", name: "In occupation" },
  { id: "consultants", name: "Consultants" },
];
const EMPTY_FILTER: PortfolioContactsFilter = { group: "all", propertyId: "all", search: "" };
const PAGE_SIZE = 12;

function RecordName({ entry, onNavigate }: { entry: PortfolioContactEntry; onNavigate?: () => void }) {
  const href = entry.canOpenContact && entry.contactId ? `/contacts/${entry.contactId}`
    : entry.kind === "company" && entry.canOpenCompany && entry.company ? `/companies/${entry.company.id}` : null;
  return href
    ? <Link href={href} onClick={onNavigate} className="inline-flex min-h-11 items-center text-sm font-semibold hover:underline break-words [overflow-wrap:anywhere]">{entry.name}</Link>
    : <span className="block text-sm font-semibold break-words [overflow-wrap:anywhere]">{entry.name}</span>;
}

function Relationship({ relationship, onNavigate }: { relationship: PortfolioContactRelationship; onNavigate?: () => void }) {
  const unitName = relationship.unit?.name || relationship.unitName;
  return (
    <div className="min-w-0 border-l-2 border-border pl-3" data-testid="portfolio-contact-relationship">
      <div className="text-[11px] text-muted-foreground break-words">
        {relationship.source}{!relationship.confirmed && <span> · unconfirmed</span>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-sm">
        {relationship.property && <Link href={`/properties/${relationship.property.id}`} onClick={onNavigate} className="inline-flex min-h-11 items-center font-medium hover:underline break-words [overflow-wrap:anywhere]" data-testid="portfolio-contact-property-link">{relationship.property.name}</Link>}
        {unitName && <span className="text-muted-foreground break-words [overflow-wrap:anywhere]">{unitName}</span>}
      </div>
      {relationship.deal && <Link href={`/deals/${relationship.deal.id}`} onClick={onNavigate} className="inline-flex min-h-11 items-center gap-1 text-sm hover:underline break-words [overflow-wrap:anywhere]" data-testid="portfolio-contact-deal-link"><span>{relationship.deal.name}</span><ArrowRight className="h-3 w-3 shrink-0" /></Link>}
      {relationship.status && <div className="text-[11px] text-muted-foreground break-words">{relationship.status}</div>}
    </div>
  );
}

function ContactCard({ entry, filter, onNavigate }: { entry: PortfolioContactEntry; filter: PortfolioContactsFilter; onNavigate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const relationshipsId = useId();
  const relationships = portfolioRelationships(entry, filter);
  useEffect(() => setExpanded(false), [entry.id, filter.group, filter.propertyId, filter.search]);
  const visibleRelationships = expanded ? relationships : relationships.slice(0, 2);
  return (
    <article className="min-w-0 rounded-2xl md:rounded-lg border border-border bg-card p-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" data-testid={`portfolio-contact-${entry.id}`}>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{entry.side === "bgp" ? "BGP team" : entry.side === "client" ? "Client team" : entry.kind === "person" ? "Contact" : entry.kind === "company" ? "Company" : "Unit"}</div>
        <RecordName entry={entry} onNavigate={onNavigate} />
        {entry.role && <p className="text-sm text-muted-foreground break-words">{entry.role}</p>}
        {entry.company && (entry.kind === "person" || entry.company.name !== entry.name) && (
          <div className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
            <span className="text-[11px]">CRM company: </span>
            {entry.canOpenCompany
              ? <Link href={`/companies/${entry.company.id}`} onClick={onNavigate} className="inline-flex min-h-11 items-center hover:underline" data-testid="portfolio-contact-company-link">{entry.company.name}</Link>
              : entry.company.name}
          </div>
        )}
        {(entry.email || entry.phone) && <div className="mt-2 flex flex-wrap gap-x-4">
          {entry.email && <a href={`mailto:${entry.email}`} className="inline-flex min-h-11 max-w-full items-center gap-2 text-sm hover:underline" aria-label={`Email ${entry.name}`}><Mail className="h-4 w-4 shrink-0" /><span className="min-w-0 break-all">{entry.email}</span></a>}
          {entry.phone && <a href={`tel:${entry.phone.replace(/[^\d+]/g, "")}`} className="inline-flex min-h-11 max-w-full items-center gap-2 text-sm hover:underline" aria-label={`Call ${entry.name}`}><Phone className="h-4 w-4 shrink-0" /><span className="min-w-0 break-all">{entry.phone}</span></a>}
        </div>}
      </div>
      <div className="min-w-0">
        <div id={relationshipsId} className="space-y-3">
          {visibleRelationships.map((relationship, index) => <Relationship key={`${relationship.group}-${relationship.property?.id}-${relationship.deal?.id}-${relationship.unit?.id}-${index}`} relationship={relationship} onNavigate={onNavigate} />)}
        </div>
        {relationships.length > 2 && <Button variant="ghost" size="sm" className="mt-2 min-h-11 h-auto whitespace-normal text-left justify-start" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={relationshipsId} data-testid={`portfolio-contact-links-${entry.id}`}>
          {expanded ? "Show fewer links" : <>Show all <span className="mx-1 font-mono tabular-nums">{relationships.length}</span> links</>}
        </Button>}
      </div>
    </article>
  );
}

function LoadingContacts() {
  return <div className="space-y-3" role="status" aria-label="Loading portfolio contacts">{[0, 1, 2].map(index => <Skeleton key={index} className="h-24 w-full rounded-lg" />)}</div>;
}

export function PortfolioContactsBoard({ companyId }: { companyId: string }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<PortfolioContactsFilter>(EMPTY_FILTER);
  const [requestedPage, setRequestedPage] = useState(1);
  const resultsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const searchId = useId();
  const { data, isLoading, isError, isFetching, refetch } = useQuery<PortfolioContactsResponse>({
    queryKey: ["/api/company-portfolio", companyId, "linked-contacts", "v2"],
    queryFn: context => getQueryFn<PortfolioContactsResponse>({ on401: "throw" })({ ...context, queryKey: ["/api/company-portfolio", companyId, "linked-contacts"] }),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });
  useEffect(() => {
    setFilter(EMPTY_FILTER);
    setRequestedPage(1);
    setOpen(false);
  }, [companyId]);
  const entries = data?.entries || [];
  const filtered = useMemo(() => filterPortfolioContacts(entries, filter), [entries, filter]);
  const previewFilter = { ...EMPTY_FILTER, search: filter.search };
  const previewEntries = useMemo(() => filterPortfolioContacts(entries, { ...EMPTY_FILTER, search: filter.search }), [entries, filter.search]);
  const page = portfolioContactsPage(filtered, requestedPage, PAGE_SIZE);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map(group => [group.id, filterPortfolioContacts(entries, { ...filter, group: group.id }).length])), [entries, filter]);
  const updateFilter = (patch: Partial<PortfolioContactsFilter>) => { setFilter(current => ({ ...current, ...patch })); setRequestedPage(1); };
  const openDirectory = () => { updateFilter(previewFilter); setOpen(true); };
  useEffect(() => { resultsRef.current?.scrollTo({ top: 0 }); }, [page.page, filter.group, filter.propertyId, filter.search, open]);
  const clearFilters = () => { setFilter(EMPTY_FILTER); setRequestedPage(1); };
  const navigateAway = () => setOpen(false);
  const error = <div role="alert" className="rounded-lg border border-border p-4 text-sm"><p>Couldn’t load portfolio contacts. Please try again.</p><Button variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => void refetch()} disabled={isFetching} data-testid="portfolio-contacts-retry"><RefreshCw className="h-4 w-4 mr-2" />Try again</Button></div>;
  const empty = <div className="py-8 px-4 text-center text-sm text-muted-foreground" data-testid="portfolio-contacts-empty"><Users className="mx-auto mb-3 h-6 w-6" />{entries.length ? <><p>No contacts, companies or units match these filters.</p><Button variant="outline" className="mt-4 min-h-11" onClick={clearFilters}>Clear filters</Button></> : <p>No linked contacts yet. People will appear here when they are linked to this company or its properties.</p>}</div>;
  const body = <>
    <div className="shrink-0 space-y-3 border-b border-border px-4 pb-4 sm:px-6">
      <div className="flex flex-wrap gap-1.5" aria-label="Contact groups">{GROUPS.map(group => <Pill key={group.id} active={filter.group === group.id} aria-pressed={filter.group === group.id} onClick={() => updateFilter({ group: group.id })} data-testid={`portfolio-contacts-filter-${group.id}`}>{group.name}<span className="font-mono tabular-nums">{counts[group.id] || 0}</span></Pill>)}</div>
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">Search portfolio contacts and linked records</label>
        <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
        <Input id={searchId} type="search" value={filter.search} onChange={event => updateFilter({ search: event.target.value })} placeholder="Search people, companies, properties or deals…" className="h-11 pl-9" data-testid="portfolio-contacts-search" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={filter.propertyId} onValueChange={propertyId => updateFilter({ propertyId })}>
          <SelectTrigger className={`${pillMetrics} ${pillInactive} h-auto w-auto max-w-full [&>span]:truncate`} aria-label="Filter contacts by property" data-no-min-touch data-testid="portfolio-contacts-property"><Building2 className="mr-1 h-3 w-3 shrink-0" /><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All properties</SelectItem>{data?.properties.map(property => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh portfolio contacts"><RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
    </div>
    <div ref={resultsRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6" data-testid="portfolio-contacts-results">
      {isLoading ? <LoadingContacts /> : isError ? error : filtered.length === 0 ? empty : <div className="space-y-3">{page.entries.map(entry => <ContactCard key={entry.id} entry={entry} filter={filter} onNavigate={navigateAway} />)}</div>}
    </div>
    <div className="shrink-0 border-t border-border px-4 py-3 sm:px-6 flex flex-wrap items-center justify-between gap-2" data-testid="portfolio-contacts-pagination">
      <div className="text-[11px] text-muted-foreground" aria-live="polite"><span className="font-mono tabular-nums">{filtered.length ? page.start + 1 : 0}–{page.end}</span> of <span className="font-mono tabular-nums">{filtered.length}</span> {filtered.length === 1 ? "record" : "records"}</div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Previous page" disabled={page.page <= 1} onClick={() => setRequestedPage(page.page - 1)} data-testid="portfolio-contacts-previous"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="text-[11px] text-muted-foreground" data-testid="portfolio-contacts-page">Page <span className="font-mono tabular-nums">{page.page}</span> of <span className="font-mono tabular-nums">{page.pageCount}</span></span>
        <Button variant="outline" size="icon" className="h-11 w-11" aria-label="Next page" disabled={page.page >= page.pageCount} onClick={() => setRequestedPage(page.page + 1)} data-testid="portfolio-contacts-next"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  </>;
  const description = <>People, companies and units linked across <span className="font-mono tabular-nums">{data?.properties.length || 0}</span> properties.</>;
  return <>
    <Card className="h-full min-w-0 flex flex-col" data-testid="portfolio-contacts-board">
      <CardContent className="p-4 min-h-0 flex-1 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 shrink-0">
          <h3 className="text-sm font-semibold flex items-center gap-2"><Users className="h-4 w-4 shrink-0" />Contacts — whole portfolio</h3>
          <Button ref={openButtonRef} variant="outline" size="sm" className="min-h-11 shrink-0" onClick={openDirectory} data-testid="portfolio-contacts-open">View all<ArrowRight className="ml-2 h-4 w-4" /></Button>
        </div>
        <p className="text-[11px] text-muted-foreground shrink-0">{description}</p>
        <Input type="search" value={filter.search} onChange={event => updateFilter({ search: event.target.value })} onKeyDown={event => { if (event.key === "Enter") openDirectory(); }} placeholder="Find a person, company or property…" aria-label="Search whole portfolio contacts" className="h-11 shrink-0" data-testid="portfolio-contacts-preview-search" />
        <div className="min-h-0 flex-1 overflow-hidden">
          {isLoading ? <LoadingContacts /> : isError ? error : previewEntries.length === 0 ? empty : <div className="divide-y divide-border">{previewEntries.slice(0, isMobile ? 2 : 3).map(entry => {
            const relationship = portfolioRelationships(entry, previewFilter)[0];
            return <div key={entry.id} className="py-2 min-w-0" data-testid="portfolio-contacts-preview-row">
              <div className="flex items-start justify-between gap-2 min-w-0"><div className="min-w-0"><RecordName entry={entry} /><div className="text-[11px] text-muted-foreground truncate">{[entry.role, entry.side === "bgp" ? "BGP" : entry.company?.name !== entry.name ? entry.company?.name : null].filter(Boolean).join(" · ")}</div></div><Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={`Show links for ${entry.name}`} onClick={() => { updateFilter({ ...EMPTY_FILTER, search: entry.name }); setOpen(true); }}><ArrowRight className="h-4 w-4" /></Button></div>
              <p className="text-[11px] text-muted-foreground truncate">{[relationship?.source, relationship?.property?.name, relationship?.deal?.name || relationship?.unit?.name || relationship?.unitName].filter(Boolean).join(" · ")}</p>
            </div>;
          })}</div>}
        </div>
        {!isLoading && !isError && previewEntries.length > 0 && <button className="min-h-11 text-sm text-left hover:underline shrink-0" onClick={openDirectory}>Browse <span className="font-mono tabular-nums">{previewEntries.length}</span> matching {previewEntries.length === 1 ? "record" : "records"} →</button>}
      </CardContent>
    </Card>
    {isMobile ? <Sheet open={open} onOpenChange={setOpen}><SheetContent ref={dialogRef} side="bottom" hideClose className="h-[96dvh] rounded-t-2xl p-0 flex flex-col gap-0 overflow-hidden pb-[env(safe-area-inset-bottom)]" data-testid="portfolio-contacts-dialog" onOpenAutoFocus={event => { event.preventDefault(); dialogRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); openButtonRef.current?.focus(); }}>
      <SheetHeader className="px-4 pt-3 pb-3 text-left shrink-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <SheetTitle className="text-2xl font-bold tracking-tight">Portfolio contacts</SheetTitle>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" onClick={() => setOpen(false)} aria-label="Close portfolio contacts"><X className="h-5 w-5" /></Button>
        </div>
        <SheetDescription className="text-[11px]">People, companies and units · <span className="font-mono tabular-nums">{data?.properties.length || 0}</span> properties</SheetDescription>
      </SheetHeader>{body}
    </SheetContent></Sheet> : <Dialog open={open} onOpenChange={setOpen}><DialogContent ref={dialogRef} className="h-[90dvh] max-w-5xl p-0 gap-0 flex flex-col overflow-hidden" data-testid="portfolio-contacts-dialog" onOpenAutoFocus={event => { event.preventDefault(); dialogRef.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); openButtonRef.current?.focus(); }}><DialogHeader className="px-6 pt-6 pb-4 pr-16 text-left shrink-0"><DialogTitle className="text-2xl font-bold tracking-tight">Portfolio contacts</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{body}</DialogContent></Dialog>}
  </>;
}
