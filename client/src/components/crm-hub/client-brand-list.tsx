// The Brand Directory tab of a client login's CRM page (Woody, 2026-11-15: "Landsec can
// use that for theirs, just move lenders and landlords out"). The same list
// design as BGP's CRM page (company-list.tsx), drawn from what a client login
// is already sent and nothing more:
// - GET /api/client/brand-directory: the brands on the client's list with
//   their contacts, whether each is a tenant of the client's and where it is
//   being targeted;
// - GET /api/landsec/diary (Landsec only): the client's own requests to BGP
//   and the actions BGP chose to show it, which give each brand its next step.
// BGP's owner, last contact and strategies are BGP's own and are not on a
// client's row. A client adds and edits a brand's contacts and, on Landsec,
// adds a request to BGP from the row.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Mail, Pencil, Plus, Search, Target, Users, X } from "lucide-react";
import type { CrmHubRow } from "@shared/crm-hub";
import { nextActionOf } from "@shared/crm-hub";
import type { DiaryData } from "@shared/brand-diary";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill, PillCount, pillInactive, pillMetrics } from "@/components/ui/pill";
import { ViewToggle } from "@/components/mobile-card-view";
import { ClientRequest } from "@/components/brand-crm/diary";
import { CompanyCell, ContactCount, ExpandButton, NextActionCell } from "./company-row";
import { PillSelect } from "./company-list";

export interface DirectoryContact { id: string; name: string; role: string | null; email: string | null; phone: string | null }
export interface DirectoryBrand {
  id: string; name: string; companyType: string | null; domain: string | null;
  contacts: DirectoryContact[];
  isExistingTenant?: boolean;
  targetedAt?: { propertyId: string; propertyName: string; unitName: string | null }[];
}
export type ContactDialogTarget = { companyId: string; companyName: string; contact?: any };

export const CLIENT_BRAND_DIRECTORY_KEY = ["/api/client/brand-directory"] as const;
const CATS: { key: string; label: string; re: RegExp | null }[] = [
  { key: "all", label: "All", re: null },
  { key: "food", label: "Food & Dining", re: /(restaurant|dining|f&b|qsr|fast|food|bakery|patisserie)/i },
  { key: "cafe", label: "Cafés & Coffee", re: /(caf|coffee)/i },
  { key: "bars", label: "Bars", re: /bar/i },
  { key: "leisure", label: "Leisure", re: /(leisure|cinema|entertainment|hospitality|hotel)/i },
  { key: "fitness", label: "Fitness", re: /(fitness|gym|yoga)/i },
];
type Rel = "all" | "tenant" | "targeted" | "contact" | "action";
const RELS: Array<{ key: Rel; label: string }> = [
  { key: "all", label: "All" }, { key: "tenant", label: "Existing tenants" }, { key: "targeted", label: "Being targeted" },
  { key: "contact", label: "With contacts" }, { key: "action", label: "With a next step" },
];
const PAGE = { phone: 30, desktop: 60 };
const INLINE_PEOPLE = 2;
const filterRow = "flex items-center gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0";
const label = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
const typeLabel = (type: string | null) => (type || "").replace(/^Tenant - /, "") || null;
const placeOf = (target: { propertyName: string; unitName: string | null }) => `${target.unitName ? `${target.unitName} · ` : ""}${target.propertyName}`;

interface ClientRow { brand: DirectoryBrand; row: CrmHubRow }

// A directory brand as a row of the shared list. The fields that are BGP's own stay empty.
function toRow(brand: DirectoryBrand, actions: Array<{ id: string; title: string; dueAt: string | null; ownerName: string | null }>): CrmHubRow {
  return {
    id: brand.id, name: brand.name, kind: "brand", companyType: typeLabel(brand.companyType), domain: brand.domain, description: null,
    isClient: false, subType: null, city: null, owners: [], lastContactAt: null, nextContactAt: null,
    openActions: actions.length, nextAction: nextActionOf(actions), strategies: [],
    contactCount: brand.contacts.length, people: brand.contacts, counts: {}, line: null,
  };
}

function StatusChips({ brand, max = 2 }: { brand: DirectoryBrand; max?: number }) {
  const targets = brand.targetedAt || [];
  if (!brand.isExistingTenant && !targets.length) return <span className="text-sm text-muted-foreground">Not a tenant or a target yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-1 min-w-0" data-testid={`client-brand-status-${brand.id}`}>
      {brand.isExistingTenant && <span className={cn(pillMetrics, pillInactive)}>Existing tenant</span>}
      {targets.slice(0, max).map((target, i) => (
        <span key={`${target.propertyId}-${target.unitName || i}`} className={cn(pillMetrics, pillInactive, "max-w-[240px]")} title={`Being targeted at ${placeOf(target)}`}>
          <Target className="w-3 h-3 shrink-0" /><span className="truncate">{placeOf(target)}</span>
        </span>
      ))}
      {targets.length > max && <span className="text-[11px] text-muted-foreground" title={targets.slice(max).map(placeOf).join(", ")}>+<span className="font-mono tabular-nums">{targets.length - max}</span></span>}
    </span>
  );
}

function PersonLine({ brand, person, onContact }: { brand: DirectoryBrand; person: DirectoryContact; onContact: (target: ContactDialogTarget) => void }) {
  return (
    <div className="flex items-start gap-2 min-w-0 py-1" data-testid={`client-brand-person-${person.id}`}>
      <div className="min-w-0 flex-1">
        <Link href={`/contacts/${encodeURIComponent(person.id)}`} className="text-sm font-medium hover:underline break-words" onClick={stop}>{person.name}</Link>
        {person.role && <p className="text-[11px] text-muted-foreground break-words">{person.role}</p>}
      </div>
      {person.email && <a href={`mailto:${person.email}`} className="shrink-0 p-1 text-muted-foreground hover:text-foreground" aria-label={`Email ${person.name}`} title={person.email} onClick={stop}><Mail className="w-3.5 h-3.5" /></a>}
      <button type="button" data-no-min-touch className="shrink-0 p-1 text-muted-foreground hover:text-foreground" aria-label={`Edit ${person.name}`} title="Edit contact"
        data-testid={`client-edit-contact-${person.id}`} onClick={event => { event.stopPropagation(); onContact({ companyId: brand.id, companyName: brand.name, contact: person }); }}>
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function AddContact({ brand, onContact }: { brand: DirectoryBrand; onContact: (target: ContactDialogTarget) => void }) {
  return (
    <button type="button" data-no-min-touch className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline" data-testid={`client-add-contact-${brand.id}`}
      onClick={event => { event.stopPropagation(); onContact({ companyId: brand.id, companyName: brand.name }); }}>
      <Plus className="w-3 h-3" />Add contact
    </button>
  );
}

function RequestButton({ brand, onRequest }: { brand: DirectoryBrand; onRequest: (brand: DirectoryBrand) => void }) {
  return (
    <Button type="button" size="sm" variant="outline" className="min-h-7 h-7 px-2.5 text-xs" data-testid={`client-brand-request-${brand.id}`}
      onClick={event => { event.stopPropagation(); onRequest(brand); }}>
      <Plus className="w-3.5 h-3.5 mr-1" />Request to BGP
    </Button>
  );
}

interface RowProps { item: ClientRow; withActions: boolean; canRequest: boolean; onOpen: (brand: DirectoryBrand) => void; onContact: (target: ContactDialogTarget) => void; onRequest: (brand: DirectoryBrand) => void }
const openOnKey = (item: ClientRow, onOpen: (brand: DirectoryBrand) => void) => (event: React.KeyboardEvent) => {
  if (event.target === event.currentTarget && event.key === "Enter") onOpen(item.brand);
};

function BrandCard({ item, withActions, canRequest, onOpen, onContact, onRequest, phone }: RowProps & { phone: boolean }) {
  const [open, setOpen] = useState(false);
  const { brand, row } = item;
  const people = open ? brand.contacts : brand.contacts.slice(0, INLINE_PEOPLE);
  return (
    <div role="link" tabIndex={0} aria-label={`Open ${brand.name}`} onClick={() => onOpen(brand)} onKeyDown={openOnKey(item, onOpen)}
      className={cn("border border-card-border bg-card shadow-sm p-3 min-w-0 cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col gap-2.5",
        phone ? "rounded-2xl" : "rounded-xl")}
      data-testid={`client-brand-${brand.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><CompanyCell row={row} size={40} /></div>
        {brand.contacts.length > INLINE_PEOPLE && <ExpandButton row={row} open={open} onToggle={() => setOpen(value => !value)} />}
      </div>
      <StatusChips brand={brand} />
      {withActions && <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className={cn(label, "pt-0.5")}>Next action</dt><dd className="min-w-0"><NextActionCell row={row} /></dd>
      </dl>}
      <div className="cursor-default border-t border-border pt-2" onClick={stop}>
        {people.length === 0
          ? <p className="text-sm text-muted-foreground py-1">No contacts on file.</p>
          : people.map(person => <PersonLine key={person.id} brand={brand} person={person} onContact={onContact} />)}
        {!open && brand.contacts.length > INLINE_PEOPLE && (
          <button type="button" data-no-min-touch className="text-xs text-primary hover:underline" onClick={() => setOpen(true)}>
            Show all <span className="font-mono tabular-nums">{brand.contacts.length}</span>
          </button>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">{canRequest && <RequestButton brand={brand} onRequest={onRequest} />}<AddContact brand={brand} onContact={onContact} /></div>
        <ContactCount row={row} />
      </div>
    </div>
  );
}

function BrandTableRow({ item, withActions, canRequest, onOpen, onContact, onRequest, columns }: RowProps & { columns: number }) {
  const [open, setOpen] = useState(false);
  const { brand, row } = item;
  return (
    <>
      <tr tabIndex={0} title={`Open ${brand.name}`} onClick={() => onOpen(brand)} onKeyDown={openOnKey(item, onOpen)}
        className={cn("align-top cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40", !open && "border-b border-border last:border-b-0")}
        data-testid={`client-brand-${brand.id}`}>
        <td className="py-2 pl-3 pr-3 max-w-[320px]"><CompanyCell row={row} size={32} /></td>
        <td className="py-2 pr-3 max-w-[340px]"><StatusChips brand={brand} /></td>
        {withActions && <td className="py-2 pr-3 max-w-[280px]"><NextActionCell row={row} /></td>}
        <td className="py-2 pr-3">{canRequest ? <RequestButton brand={brand} onRequest={onRequest} /> : <AddContact brand={brand} onContact={onContact} />}</td>
        <td className="py-2 pr-3 text-right"><ContactCount row={row} /></td>
        <td className="py-1.5 pr-2 text-right"><ExpandButton row={row} open={open} onToggle={() => setOpen(value => !value)} /></td>
      </tr>
      {open && (
        <tr className="border-b border-border last:border-b-0 bg-muted/20">
          <td colSpan={columns} className="px-3 pb-3 pt-1 cursor-default" onClick={stop}>
            <p className={label}>People <span className="font-mono tabular-nums">{brand.contacts.length}</span></p>
            {brand.contacts.length === 0
              ? <p className="text-sm text-muted-foreground py-1.5">No contacts on file.</p>
              : <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-3">{brand.contacts.map(person => <PersonLine key={person.id} brand={brand} person={person} onContact={onContact} />)}</div>}
            <div className="mt-1"><AddContact brand={brand} onContact={onContact} /></div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ClientBrandList({ landsec, onContact }: { landsec: boolean; onContact: (target: ContactDialogTarget) => void }) {
  const [, navigate] = useLocation();
  const isMobile = useIsMobile();
  const directory = useQuery<DirectoryBrand[]>({ queryKey: CLIENT_BRAND_DIRECTORY_KEY });
  // The Landsec diary, as the server cut it for this login: the brand's open CRM actions.
  const diary = useQuery<DiaryData | null>({
    queryKey: ["/api/landsec/diary"],
    queryFn: async () => { try { return await (await apiRequest("GET", "/api/landsec/diary")).json(); } catch { return null; } },
    enabled: landsec, staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const withActions = landsec && !!diary.data;
  const canRequest = withActions && diary.data?.canAddRequest === true;

  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [rel, setRel] = useState<Rel>("all");
  const [property, setProperty] = useState("");
  const [view, setView] = useState<"card" | "table">("card");
  const [requestFor, setRequestFor] = useState<DirectoryBrand | null>(null);
  const page = isMobile ? PAGE.phone : PAGE.desktop;
  const [shown, setShown] = useState(page);
  useEffect(() => { setShown(page); }, [page, search, cat, rel, property, view]);

  const brands = directory.data || [];
  const items = useMemo<ClientRow[]>(() => {
    const byBrand = new Map<string, Array<{ id: string; title: string; dueAt: string | null; ownerName: string | null }>>();
    for (const item of diary.data?.items || []) {
      if (item.kind !== "crm_action" || !item.brand?.id) continue;
      byBrand.set(item.brand.id, [...(byBrand.get(item.brand.id) || []), { id: item.id, title: item.title, dueAt: item.date ? `${item.date}T12:00:00Z` : null, ownerName: item.owner }]);
    }
    return brands.map(brand => ({ brand, row: toRow(brand, byBrand.get(brand.id) || []) }));
  }, [brands, diary.data]);
  const properties = useMemo(() => {
    const names = new Map<string, string>();
    for (const brand of brands) for (const target of brand.targetedAt || []) names.set(target.propertyId, target.propertyName);
    return Array.from(names, ([value, name]) => ({ value, label: name })).sort((a, b) => a.label.localeCompare(b.label));
  }, [brands]);

  const matchesRel = (item: ClientRow, key: Rel) => key === "tenant" ? !!item.brand.isExistingTenant : key === "targeted" ? (item.brand.targetedAt || []).length > 0
    : key === "contact" ? item.brand.contacts.length > 0 : key === "action" ? !!item.row.nextAction : true;
  // Everything but the relationship pills narrows first, so each pill's count is what pressing it would show.
  const narrowed = useMemo(() => {
    const type = CATS.find(c => c.key === cat)?.re || null;
    const wanted = search.trim().toLowerCase();
    return items.filter(({ brand }) => (!type || type.test(brand.companyType || ""))
      && (!property || (brand.targetedAt || []).some(target => target.propertyId === property))
      && (!wanted || brand.name.toLowerCase().includes(wanted) || brand.contacts.some(person => person.name?.toLowerCase().includes(wanted))));
  }, [items, cat, property, search]);
  const rels = RELS.filter(option => option.key !== "action" || withActions);
  const list = rel === "all" ? narrowed : narrowed.filter(item => matchesRel(item, rel));
  const filtered = !!search.trim() || cat !== "all" || rel !== "all" || !!property;
  const clear = () => { setSearch(""); setCat("all"); setRel("all"); setProperty(""); };
  const asTable = view === "table" && !isMobile;
  const visible = list.slice(0, shown);
  const columns = withActions ? 6 : 5;
  const rowProps = { withActions, canRequest, onOpen: (brand: DirectoryBrand) => navigate(`/companies/${encodeURIComponent(brand.id)}`), onContact, onRequest: setRequestFor };

  if (directory.isError) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center space-y-3" role="alert" data-testid="client-brand-list">
        <p className="text-sm text-muted-foreground">The brands could not be loaded.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => directory.refetch()} disabled={directory.isFetching}>{directory.isFetching ? "Trying again…" : "Retry"}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 min-w-0" data-testid="client-brand-list">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-full md:w-auto md:flex-1 md:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search brands or people…" className="pl-9 pr-8 h-9" aria-label="Search brands" data-testid="client-brand-search" />
          {search && <button type="button" data-no-min-touch className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear the search" onClick={() => setSearch("")}><X className="w-3.5 h-3.5" /></button>}
        </div>
        {directory.data && (
          <p className="text-sm text-muted-foreground" data-testid="client-brand-count">
            <span className="font-mono tabular-nums">{list.length.toLocaleString("en-GB")}</span>
            {filtered && <> of <span className="font-mono tabular-nums">{items.length.toLocaleString("en-GB")}</span></>} {(filtered ? items.length : list.length) === 1 ? "brand" : "brands"}
          </p>
        )}
        <div className="hidden md:block md:ml-auto"><ViewToggle view={view} onToggle={next => setView(next === "table" ? "table" : "card")} /></div>
      </div>

      <div className={filterRow} data-testid="client-brand-filters">
        {rels.map(option => (
          <Pill key={option.key} active={rel === option.key} aria-pressed={rel === option.key} data-testid={`client-rel-${option.key}`} onClick={() => setRel(rel === option.key ? "all" : option.key)}>
            {option.label}{directory.data && <PillCount n={narrowed.filter(item => matchesRel(item, option.key)).length} active={rel === option.key} />}
          </Pill>
        ))}
        <span className="h-4 w-px bg-border" aria-hidden />
        <PillSelect label="Type" any="Every type" value={cat === "all" ? "" : cat} onChange={value => setCat(value || "all")} testId="client-brand-type"
          options={CATS.filter(c => c.key !== "all").map(c => ({ value: c.key, label: c.label }))} />
        {properties.length > 0 && <PillSelect label="Targeted at" any="Any property" value={property} onChange={setProperty} testId="client-prop-filter" options={properties} />}
      </div>

      {directory.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" role="status" aria-label="Loading brands">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-36 rounded-xl" />)}</div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center space-y-3" data-testid="client-brand-empty">
          <Users className="w-6 h-6 mx-auto text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{filtered ? "No brands match these filters." : "No brands on your list yet."}</p>
          {filtered && <Button type="button" variant="outline" size="sm" onClick={clear}>Clear filters</Button>}
        </div>
      ) : asTable ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="client-brand-table">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-2 pl-3 pr-3 font-semibold">Brand</th>
                <th scope="col" className="py-2 pr-3 font-semibold">With you</th>
                {withActions && <th scope="col" className="py-2 pr-3 font-semibold whitespace-nowrap">Next action</th>}
                <th scope="col" className="py-2 pr-3 font-semibold"><span className="sr-only">Add</span></th>
                <th scope="col" className="py-2 pr-3 font-semibold font-mono text-right">Contacts</th>
                <th scope="col" className="py-2 pr-2 w-10"><span className="sr-only">People</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(item => <BrandTableRow key={item.brand.id} item={item} columns={columns} {...rowProps} />)}
              {list.length > visible.length && (
                <tr><td colSpan={columns} className="p-2 text-center">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShown(count => count + page)}>Show more ({(list.length - visible.length).toLocaleString("en-GB")} left)</Button>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start" data-testid="client-brand-cards">
            {visible.map(item => <BrandCard key={item.brand.id} item={item} phone={isMobile} {...rowProps} />)}
          </div>
          {list.length > visible.length && (
            <Button type="button" variant="outline" className="w-full" onClick={() => setShown(count => count + page)} data-testid="client-brand-more">
              Show more ({(list.length - visible.length).toLocaleString("en-GB")} left)
            </Button>
          )}
        </>
      )}

      {requestFor && <ClientRequest brands={[]} brand={{ id: requestFor.id, name: requestFor.name }} onClose={() => setRequestFor(null)} />}
    </div>
  );
}
