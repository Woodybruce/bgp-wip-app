// One company on the CRM page's list (shared/crm-hub.ts), as a card or as a
// table row. Both draw the same facts from the same cells: who it is, who at
// BGP owns it, the last contact, the next action, its strategies and its
// people. The whole card or row opens the company; the chevron opens its
// people in place.
import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Crown, Mail, Phone, Star, Target, Users } from "lucide-react";
import type { CrmHubKind, CrmHubPerson, CrmHubRow } from "@shared/crm-hub";
import { lastContactShort } from "@shared/last-contact";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { pillInactive, pillMetrics } from "@/components/ui/pill";
import { CompanyLogoImg } from "@/pages/properties";

export const CRM_HUB_KEY = "/api/crm/hub";
export interface CrmRowActions { onOpen: (row: CrmHubRow) => void; onStartStrategy: (row: CrmHubRow) => void; onOpenStrategy?: (strategyId: string) => void }

const KIND_LABEL: Record<CrmHubKind, string> = { landlord: "Landlord", brand: "Brand", agent: "Agent", lender: "Lender" };
const label = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
const ukDay = (value: string, now = new Date()) => {
  const date = new Date(value);
  const year = date.getUTCFullYear() !== now.getUTCFullYear();
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "Europe/London" });
};
const fullDay = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

// ── The cells ───────────────────────────────────────────────────────────────

/** Logo or initials, the name, the crown for a company BGP acts for, the star for a Super Brand, then what it is and the list's own fact line. */
export function CompanyCell({ row, size, roomy = false }: { row: CrmHubRow; size: number; roomy?: boolean }) {
  const meta = [row.subType && row.subType !== "Other" ? row.subType : row.companyType || KIND_LABEL[row.kind], row.city].filter(Boolean).join(" · ");
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <CompanyLogoImg domain={row.domain} name={row.name} size={size} />
      <div className={cn("min-w-0 flex-1", roomy && "min-h-[54px]")}>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold truncate" title={row.name}>{row.name}</span>
          {row.isClient && <span title="BGP client" className="shrink-0 inline-flex"><Crown className="w-3.5 h-3.5 text-amber-500" aria-label="BGP client" /></span>}
          {row.superBrand && <span title="Super Brand: one of BGP's chosen expansion targets, VIP in the CRM" className="shrink-0 inline-flex" data-testid={`crm-hub-super-${row.id}`}><Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" aria-label="Super Brand" /></span>}
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{meta}</p>
        {row.line && <p className="text-xs text-foreground/80 truncate" data-testid={`crm-hub-line-${row.id}`}>{row.line}</p>}
      </div>
    </div>
  );
}

export function OwnersCell({ row }: { row: CrmHubRow }) {
  if (!row.owners.length) return <span className="text-muted-foreground">No owner</span>;
  const shown = row.owners.slice(0, 2).map(owner => owner.name).join(", ");
  const more = row.owners.length - 2;
  const names = row.owners.map(owner => owner.name).join(", ");
  return (
    <span className={cn("break-words", row.ownersFromDeals && "text-muted-foreground")}
      title={row.ownersFromDeals ? `${names}. From its transactions: nobody is set on the account` : names}>
      {shown}{more > 0 && <span className="text-muted-foreground"> +<span className="font-mono tabular-nums">{more}</span></span>}
    </span>
  );
}

/** The last contact that has happened, and the meeting ahead when there is one ("Next: 12 Feb"). */
export function ContactCell({ row }: { row: CrmHubRow }) {
  const last = lastContactShort(row.lastContactAt);
  const next = lastContactShort(row.nextContactAt);
  if (!last && !next) return <span className="text-muted-foreground">No contact</span>;
  return (
    <span className="whitespace-nowrap tabular-nums" title={[row.lastContactAt ? `Last contact ${fullDay(row.lastContactAt)}` : "", row.nextContactAt ? `Meeting ${fullDay(row.nextContactAt)}` : ""].filter(Boolean).join(". ")}>
      {last}{last && next ? <span className="text-muted-foreground"> · </span> : null}{next && <span className={last ? "text-muted-foreground" : ""}>{next}</span>}
    </span>
  );
}

export function NextActionCell({ row }: { row: CrmHubRow }) {
  const action = row.nextAction;
  if (!action) return <span className="text-muted-foreground" data-testid={`crm-hub-no-next-${row.id}`}>No next step</span>;
  const more = row.openActions - 1;
  return (
    <span className="min-w-0 block" title={[action.title, action.ownerName ? `Owner ${action.ownerName}` : "", action.dueAt ? `Due ${fullDay(action.dueAt)}` : "No date set"].filter(Boolean).join(". ")}>
      <span className="block truncate">{action.title}</span>
      <span className="block text-[11px] text-muted-foreground">
        {action.dueAt
          ? <span className={cn("tabular-nums", action.overdue && "text-destructive font-semibold")}>{action.overdue ? "Overdue " : "Due "}{ukDay(action.dueAt)}</span>
          : "No date"}
        {action.ownerName && <> · {action.ownerName}</>}
        {more > 0 && <> · +<span className="font-mono tabular-nums">{more}</span> more</>}
      </span>
    </span>
  );
}

/** The strategies as pills (each opens it, where the page says how), or the button that starts one. */
export function StrategyCell({ row, actions }: { row: CrmHubRow; actions: CrmRowActions }) {
  if (!row.strategies.length) {
    return (
      <Button type="button" size="sm" variant="outline" className="min-h-7 h-7 px-2.5 text-xs" data-testid={`crm-hub-start-${row.id}`}
        onClick={event => { event.stopPropagation(); actions.onStartStrategy(row); }}>
        <Target className="w-3.5 h-3.5 mr-1" />Start strategy
      </Button>
    );
  }
  const more = row.strategies.length - 2;
  return (
    <span className="flex flex-wrap items-center gap-1 min-w-0">
      {row.strategies.slice(0, 2).map(strategy => actions.onOpenStrategy
        ? <button key={strategy.id} type="button" data-no-min-touch className={cn(pillMetrics, pillInactive, "max-w-[220px]")} title={`Open the strategy: ${strategy.name}`}
            data-testid={`crm-hub-strategy-${row.id}-${strategy.id}`} onClick={event => { event.stopPropagation(); actions.onOpenStrategy?.(strategy.id); }}>
            <Target className="w-3 h-3 shrink-0" /><span className="truncate">{strategy.name}</span>
          </button>
        : <span key={strategy.id} className={cn(pillMetrics, pillInactive, "max-w-[220px]")} title={strategy.name} data-testid={`crm-hub-strategy-${row.id}-${strategy.id}`}>
            <Target className="w-3 h-3 shrink-0" /><span className="truncate">{strategy.name}</span>
          </span>)}
      {more > 0 && <span className="text-[11px] text-muted-foreground" title={row.strategies.slice(2).map(strategy => strategy.name).join(", ")}>+<span className="font-mono tabular-nums">{more}</span></span>}
    </span>
  );
}

export function ContactCount({ row }: { row: CrmHubRow }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap" title={`${row.contactCount.toLocaleString("en-GB")} ${row.contactCount === 1 ? "contact" : "contacts"}`}>
      <Users className="w-3.5 h-3.5" /><span className="font-mono tabular-nums">{row.contactCount.toLocaleString("en-GB")}</span>
    </span>
  );
}

export function ExpandButton({ row, open, onToggle }: { row: CrmHubRow; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" data-no-min-touch aria-expanded={open} aria-label={open ? `Hide the people at ${row.name}` : `Show the people at ${row.name}`}
      className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" data-testid={`crm-hub-expand-${row.id}`}
      onClick={event => { event.stopPropagation(); onToggle(); }}>
      <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
    </button>
  );
}

// ── The people, opened in place ─────────────────────────────────────────────

function PersonLine({ person }: { person: CrmHubPerson }) {
  return (
    <div className="min-w-0 py-1.5" data-testid={`crm-hub-person-${person.id}`}>
      <Link href={`/contacts/${encodeURIComponent(person.id)}`} className="text-sm font-medium hover:underline break-words" onClick={stop}>{person.name}</Link>
      {person.role && <p className="text-[11px] text-muted-foreground break-words">{person.role}</p>}
      {(person.email || person.phone) && (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
          {person.email && <a href={`mailto:${person.email}`} className="inline-flex items-center gap-1 min-w-0 text-primary hover:underline" onClick={stop}>
            <Mail className="w-3 h-3 shrink-0" /><span className="break-all">{person.email}</span></a>}
          {person.phone && <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap" onClick={stop}>
            <Phone className="w-3 h-3 shrink-0" />{person.phone}</a>}
        </p>
      )}
    </div>
  );
}

/** The people in the row first, then "Show all N", which asks for the rest. Nothing here navigates. */
export function PeopleBlock({ row, wide = false }: { row: CrmHubRow; wide?: boolean }) {
  const [all, setAll] = useState(false);
  const rest = useQuery<{ people: CrmHubPerson[] }>({
    queryKey: [CRM_HUB_KEY, "company", row.id, "people"],
    queryFn: async () => (await apiRequest("GET", `${CRM_HUB_KEY}/company/${encodeURIComponent(row.id)}/people`)).json(),
    enabled: all, staleTime: 5 * 60_000, refetchInterval: false, retry: 1,
  });
  const first = new Set(row.people.map(person => person.id));
  const people = all && rest.data ? [...row.people, ...rest.data.people.filter(person => !first.has(person.id))] : row.people;
  const hidden = row.contactCount - row.people.length;
  return (
    <div className="cursor-default" onClick={stop} data-testid={`crm-hub-people-${row.id}`}>
      <p className={label}>People <span className="font-mono tabular-nums">{row.contactCount.toLocaleString("en-GB")}</span></p>
      {people.length === 0
        ? <p className="text-sm text-muted-foreground py-1.5">No contacts recorded here yet.</p>
        : <div className={cn("grid grid-cols-1 gap-x-6", wide && "sm:grid-cols-2 xl:grid-cols-3")}>{people.map(person => <PersonLine key={person.id} person={person} />)}</div>}
      {hidden > 0 && !(all && rest.data) && (
        rest.isError
          ? <p className="text-xs text-muted-foreground mt-1" role="status">The rest could not be loaded. <button type="button" className="text-primary hover:underline" onClick={() => rest.refetch()}>Try again</button></p>
          : <button type="button" className="mt-1 text-xs text-primary hover:underline disabled:opacity-50" disabled={all && rest.isFetching}
              onClick={() => setAll(true)} data-testid={`crm-hub-people-all-${row.id}`}>
              {all && rest.isFetching ? "Loading…" : <>Show all <span className="font-mono tabular-nums">{row.contactCount.toLocaleString("en-GB")}</span></>}
            </button>
      )}
    </div>
  );
}

// ── Card and table row ──────────────────────────────────────────────────────

const openOnKey = (row: CrmHubRow, actions: CrmRowActions) => (event: React.KeyboardEvent) => {
  if (event.target === event.currentTarget && event.key === "Enter") actions.onOpen(row);
};

export function CrmCompanyCard({ row, actions, phone }: { row: CrmHubRow; actions: CrmRowActions; phone: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="link" tabIndex={0} aria-label={`Open ${row.name}`} onClick={() => actions.onOpen(row)} onKeyDown={openOnKey(row, actions)}
      className={cn("border border-card-border bg-card shadow-sm p-3 min-w-0 cursor-pointer transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex flex-col gap-2.5",
        phone ? "rounded-2xl" : "rounded-xl")}
      data-testid={`crm-hub-row-${row.id}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><CompanyCell row={row} size={40} roomy /></div>
        <ExpandButton row={row} open={open} onToggle={() => setOpen(value => !value)} />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className={cn(label, "pt-0.5")}>BGP</dt><dd className="min-w-0"><OwnersCell row={row} /></dd>
        <dt className={cn(label, "pt-0.5")}>Last contact</dt><dd className="min-w-0"><ContactCell row={row} /></dd>
        <dt className={cn(label, "pt-0.5")}>Next action</dt><dd className="min-w-0 min-h-[36px]"><NextActionCell row={row} /></dd>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <div className="min-w-0"><StrategyCell row={row} actions={actions} /></div>
        <ContactCount row={row} />
      </div>
      {open && <div className="border-t border-border pt-2.5"><PeopleBlock row={row} /></div>}
    </div>
  );
}

export const CRM_TABLE_COLUMNS = 7;
export function CrmCompanyTableRow({ row, actions }: { row: CrmHubRow; actions: CrmRowActions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr tabIndex={0} title={`Open ${row.name}`} onClick={() => actions.onOpen(row)} onKeyDown={openOnKey(row, actions)}
        className={cn("align-top cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40", !open && "border-b border-border last:border-b-0")}
        data-testid={`crm-hub-row-${row.id}`}>
        <td className="py-2 pl-3 pr-3 max-w-[340px]"><CompanyCell row={row} size={32} /></td>
        <td className="py-2 pr-3 max-w-[200px]"><OwnersCell row={row} /></td>
        <td className="py-2 pr-3"><ContactCell row={row} /></td>
        <td className="py-2 pr-3 max-w-[280px]"><NextActionCell row={row} /></td>
        <td className="py-2 pr-3"><StrategyCell row={row} actions={actions} /></td>
        <td className="py-2 pr-3 text-right"><ContactCount row={row} /></td>
        <td className="py-1.5 pr-2 text-right"><ExpandButton row={row} open={open} onToggle={() => setOpen(value => !value)} /></td>
      </tr>
      {open && (
        <tr className="border-b border-border last:border-b-0 bg-muted/20">
          <td colSpan={CRM_TABLE_COLUMNS} className="px-3 pb-3 pt-1"><PeopleBlock row={row} wide /></td>
        </tr>
      )}
    </>
  );
}
