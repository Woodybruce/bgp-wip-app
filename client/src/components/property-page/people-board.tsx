// The property page's People tab and the people on one unit
// (docs/contacts-board-plan-2026-11-13.md). Both read one feed,
// GET /api/properties/:id/people (usePropertyPeople), which the server cuts
// for the login (recordPersonForViewer). The board draws what it is sent and
// offers an action only where the reply's viewer flags and the entry allow it,
// never on "is this login staff".
//
// Every person with a CRM record is drawn by KeyContactRow, through the one
// adapter below. A BGP person, a company with no named person, an occupier
// name and a brief person with no record get a quiet one-line row.
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, MoreHorizontal, Phone, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Pill, PillCount, pillMetrics } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { KeyContactRow, contactDisplayName } from "@/components/company-contacts-board";
import { ActionEditor } from "@/components/crm-engagement/dialogs";
import { invalidateEngagement } from "@/components/crm-engagement/overview";
import { UnitBriefDialog } from "@/components/unit-brief-dialog";
import { InlineAgents } from "@/pages/properties";
import type { User } from "@shared/schema";
import type { ActionInput, EngagementData, EngagementOptions } from "@shared/crm-engagement";
import type { PropertyUnit } from "@shared/property-units";
import {
  PEOPLE_GROUPS, PROPERTY_CLIENT_ROLES, actionPlaceFor, peopleOnUnit, unplaced,
  type PeopleGroup, type RecordPeopleReply, type RecordPerson, type RecordRelationship,
} from "@shared/record-people";
import { plainError, propertyPeopleKey, unitDisplayLabel, usePropertyPeople, usePropertyUnits } from "./use-property-page";

type Viewer = RecordPeopleReply["viewer"];
type Filter = "all" | PeopleGroup;

const subHead = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const meta = "text-[11px] text-muted-foreground";
const iconLink = "p-1.5 md:p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0";
// Roles the board shows beside a person only when they add to the job title.
const QUIET_ROLES = new Set(["Linked to this property", "Added by the team", "Client's team"]);
const BRIEF_ROLES = new Set(["Leasing team", "Senior asset manager", "Asset manager"]);

// "3 Nov", with the year when it is not this year.
function dayMonth(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString("en-GB", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

const initials = (name: string) => (name || "?").split(/\s+/).map(part => part.replace(/[^A-Za-z0-9]/g, "")[0] || "").join("").slice(0, 2).toUpperCase() || "?";

// The role a person was given at this property (crm_property_clients), if any.
const clientRole = (person: RecordPerson): RecordRelationship | undefined =>
  person.relationships.find(rel => rel.group === "client" && rel.source !== "brief" && !BRIEF_ROLES.has(rel.role));
const setRoleHere = (person: RecordPerson) => { const rel = clientRole(person); return rel?.roleSource === "set" ? rel.role : null; };
const pinned = (person: RecordPerson) => person.relationships.some(rel => rel.group === "added" && rel.role === "Added by the team");
const briefRel = (person: RecordPerson) => person.relationships.find(rel => (rel.source === "brief" || BRIEF_ROLES.has(rel.role) || rel.role === "Joint agent") && !!rel.trackerId);
// The unit a person is on, only when every placed relationship is on the same
// one: a tenant of two units, or a viewer of another, names no unit.
const placeOf = (person: RecordPerson) => {
  const placed = person.relationships.filter(rel => rel.scheduleRowId || rel.unitName);
  return new Set(placed.map(rel => rel.scheduleRowId || rel.trackerId || rel.unitName)).size === 1 ? placed[0] : null;
};

// A role set at the property reads "<role> · this property". A role on one
// unit's brief says which brief, so it is never read as the whole property's.
function setRoleWords(person: RecordPerson, propertyName: string): { here: string | null; words: string | null } {
  if (person.roleSource !== "set" || !person.roleOnRecord) return { here: null, words: null };
  const rel = person.relationships.find(r => r.roleSource === "set" && r.role === person.roleOnRecord);
  if (!rel || !(rel.source === "brief" || BRIEF_ROLES.has(rel.role) || (rel.role === "Joint agent" && !!rel.trackerId))) return { here: person.roleOnRecord, words: null };
  const unit = rel.unitName ? unitDisplayLabel(rel.unitName, propertyName) : null;
  return { here: null, words: `${person.roleOnRecord} on the ${unit ? `${unit} ` : ""}brief` };
}

// What the board says about a person beside their name: on a narrow row the
// role pill, then the brief role or the derived role where it adds to the job
// title, then (BGP staff only, sent only to them) the last contact, the next
// CRM action and the strategy they are in.
function asideFor(person: RecordPerson, withRole: boolean, planUnavailable: boolean, propertyName: string): ReactNode {
  const parts: string[] = [];
  const { here, words } = person.contactId ? setRoleWords(person, propertyName) : { here: null, words: null };
  if (words) parts.push(words);
  if (withRole && person.roleSource === "derived" && person.roleOnRecord && !QUIET_ROLES.has(person.roleOnRecord)
    && person.roleOnRecord.toLowerCase() !== (person.jobTitle || "").toLowerCase()) parts.push(person.roleOnRecord);
  const last = dayMonth(person.lastContactAt);
  if (last) parts.push(`Last contact ${last}${person.lastContactPerson ? ` with ${contactDisplayName(person.lastContactPerson.name)}` : ""}`);
  const plan = person.plan;
  if (plan && !planUnavailable) {
    if (plan.next) parts.push(`Next: ${plan.next.title}${dayMonth(plan.next.dueAt) ? ` ${dayMonth(plan.next.dueAt)}` : ""}${plan.next.ownerName ? ` · ${plan.next.ownerName}` : ""}`);
    else if (plan.openCount) parts.push(`${plan.openCount} open action${plan.openCount === 1 ? "" : "s"}`);
    const strategies = plan.strategies.filter(s => person.kind === "company" || (!!person.contactId && s.contactIds.includes(person.contactId)));
    for (const strategy of strategies.slice(0, 1)) parts.push(`In ${strategy.name}`);
  }
  const pill = here ? <RecordRolePill role={here} className="[@container(min-width:560px)]:hidden" /> : null;
  if (!parts.length) return pill;
  const line = parts.join(" · ");
  return <>{pill}<span className={cn(meta, "block truncate")} title={line} data-testid={`people-aside-${person.id}`}>{line}</span></>;
}

// The one-line row: a BGP person, a company, an occupier name or a brief person with no record.
function QuietRow({ person, aside, menu, propertyName, showRole = true }: { person: RecordPerson; aside: ReactNode; menu: ReactNode[]; propertyName: string; showRole?: boolean }) {
  const companyHref = person.kind === "company" && person.company?.id ? `/companies/${person.company.id}` : null;
  const { here, words } = setRoleWords(person, propertyName);
  const context = [
    words ?? (person.roleSource === "set" || !showRole ? null : person.roleOnRecord),
    person.side === "bgp" ? "BGP" : person.kind === "person" && person.company?.name && person.company.name !== person.name ? person.company.name : null,
  ].filter((part): part is string => !!part && !QUIET_ROLES.has(part));
  const name = <span className={cn("truncate", person.kind === "company" ? "font-medium" : "font-semibold")}>{contactDisplayName(person.name)}</span>;
  return (
    <div className="flex items-center gap-2 text-sm rounded px-1 py-1 [@container(min-width:560px)]:py-0.5 -mx-1 hover:bg-muted/50 transition-colors" data-testid={`people-row-${person.id}`}>
      <span className={cn("w-5 h-5 flex items-center justify-center text-[11px] font-medium shrink-0 overflow-hidden",
        person.kind === "company" ? "rounded bg-muted text-muted-foreground" : person.side === "bgp" ? "rounded-full bg-foreground text-background" : "rounded-full bg-muted")} aria-hidden>
        {initials(person.name)}
      </span>
      <div className="min-w-0 flex-1 [@container(min-width:560px)]:flex [@container(min-width:560px)]:items-center [@container(min-width:560px)]:gap-2">
        <div className="flex items-center gap-1 min-w-0 [@container(min-width:560px)]:max-w-[45%] [@container(min-width:560px)]:shrink-0">
          {companyHref ? <Link href={companyHref} className="min-w-0 truncate hover:underline">{name}</Link> : name}
          {here && <RecordRolePill role={here} className="hidden [@container(min-width:560px)]:inline-flex" />}
        </div>
        {here && <RecordRolePill role={here} className="[@container(min-width:560px)]:hidden" />}
        {context.length > 0 && <span className={cn(meta, "block truncate min-w-0 [@container(min-width:560px)]:flex-1 [@container(min-width:560px)]:text-xs")}>{context.join(" · ")}</span>}
        {aside && <div className="[@container(min-width:560px)]:hidden min-w-0">{aside}</div>}
      </div>
      {aside && <div className="hidden [@container(min-width:560px)]:block min-w-0 max-w-[40%]">{aside}</div>}
      <div className="flex items-center shrink-0">
        {person.email && <a href={`mailto:${person.email}`} className={iconLink} aria-label={`Email ${person.name}`} title={person.email}><Mail className="w-4 h-4" /></a>}
        {person.phone && <a href={`tel:${person.phone.replace(/[^\d+]/g, "")}`} className={iconLink} aria-label={`Call ${person.name}`} title={person.phone}><Phone className="w-4 h-4" /></a>}
        {menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-no-min-touch className={iconLink} aria-label={`More for ${contactDisplayName(person.name)}`} data-testid={`people-menu-${person.id}`}>
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs">{menu}</DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

// The role at this property reads as its own thing beside the name, apart from
// the job title. On a narrow row it sits on its own line, so the name is never
// squeezed out.
function RecordRolePill({ role, className }: { role: string; className?: string }) {
  return (
    <span className={cn(pillMetrics, "shrink-0 border border-border text-foreground max-w-full overflow-hidden text-ellipsis", className)} title={`${role} at this property`} data-testid="people-record-role">
      {role} · this property
    </span>
  );
}

// The adapter: a feed entry becomes KeyContactRow's contact by naming each
// field, so nothing else in the entry reaches the row.
function PersonRow({ person, aside, menu, onChanged, propertyName, showRole }: { person: RecordPerson; aside: ReactNode; menu: ReactNode[]; onChanged: () => void; propertyName: string; showRole?: boolean }) {
  if (!person.contactId) return <QuietRow person={person} aside={aside} menu={menu} propertyName={propertyName} showRole={showRole} />;
  const kind = person.companyKind;
  const { here } = setRoleWords(person, propertyName);
  return (
    <KeyContactRow
      contact={{ id: person.contactId, name: person.name, role: person.jobTitle, email: person.email, phone: person.phone, left_at: person.leftAt ?? null }}
      companyId={person.company?.id ?? ""}
      companyName={person.company?.name ?? ""}
      isLandlord={kind === "landlord" || kind === "brand"}
      meetingHistory={kind === "landlord"}
      recordRole={here ? <RecordRolePill role={here} className="hidden [@container(min-width:560px)]:inline-flex" /> : undefined}
      aside={aside || undefined}
      menuItems={menu.length ? <>{menu}</> : undefined}
      onChanged={onChanged}
    />
  );
}

// The units group's blocks: each person once, under the units they are on
// (a tenant of two units under "Unit 3, Unit 4"), in the page's unit order,
// then "Not tied to a unit" for the rest.
export function unitBlocks<T extends RecordPerson>(list: T[], feed: PropertyUnit[], labelOf: (unit: PropertyUnit) => string) {
  const onUnits = feed.map(unit => new Set(peopleOnUnit(list, unit)));
  const blocks = new Map<string, { key: string; label: string; title?: string; people: T[]; first: number }>();
  for (const person of list) {
    const at = feed.map((unit, i) => ({ unit, i })).filter(({ i }) => onUnits[i].has(person));
    if (!at.length) continue;
    const key = at.map(({ unit }) => unit.id).join("+");
    if (!blocks.has(key)) blocks.set(key, { key, label: at.map(({ unit }) => labelOf(unit)).join(", "), title: at.map(({ unit }) => unit.label).join(", "), people: [], first: at[0].i });
    blocks.get(key)!.people.push(person);
  }
  const placed = [...blocks.values()].sort((a, b) => a.first - b.first || a.key.localeCompare(b.key));
  const rest = unplaced(list, feed);
  return rest.length ? [...placed, { key: "none", label: "Not tied to a unit", title: undefined, people: rest, first: feed.length }] : placed;
}

type ActionDraft ={ person: RecordPerson; companyId: string; kind: "landlord" | "brand"; scheduleRowId: string | null; unitName: string | null };

// Add action from a person: the CRM plan's own form, loaded and saved exactly
// as the landlord and brand pages' CRM plan card does it.
function AddActionFromPerson({ draft, propertyId, propertyName, onClose, onSaved }: {
  draft: ActionDraft; propertyId: string; propertyName: string; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const { companyId } = draft;
  const query = useQuery<EngagementData>({
    queryKey: ["/api/crm/engagement", { companyId }],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 60_000, retry: false, refetchInterval: false,
  });
  const optionsQuery = useQuery<EngagementOptions>({
    queryKey: ["/api/crm/engagement", "options", companyId],
    queryFn: async () => (await apiRequest("GET", `/api/crm/engagement/options?companyId=${encodeURIComponent(companyId)}`)).json(),
    staleTime: 5 * 60_000, retry: false, refetchInterval: false,
  });
  async function saveAction(input: ActionInput) {
    try { await apiRequest("POST", "/api/crm/engagement/actions", input); }
    catch (error) {
      const message = error instanceof Error ? error.message : "The CRM action could not be saved.";
      const json = message.match(/\{.*\}$/s)?.[0];
      if (json) { let detail: string | undefined; try { detail = JSON.parse(json).error; } catch {} if (detail) throw new Error(detail); }
      throw new Error(message);
    }
    await invalidateEngagement();
    onSaved();
    toast({ title: "CRM action saved" });
  }
  if (query.isError || optionsQuery.isError) {
    return (
      <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add CRM action</DialogTitle><DialogDescription>The action form could not be loaded. Close this and try again.</DialogDescription></DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }
  if (!query.data || !optionsQuery.data) return null;
  const place = draft.kind === "brand" ? actionPlaceFor(propertyId, draft.scheduleRowId, optionsQuery.data.sharePartners, "brand") : null;
  const initial: Partial<ActionInput> = {
    companyId, title: "",
    notes: `About ${contactDisplayName(draft.person.name)} at ${propertyName}${draft.unitName ? `, ${draft.unitName}` : ""}`,
    ...(place ? { propertyId: place.propertyId, tenancyUnitId: place.tenancyUnitId } : {}),
  };
  return <ActionEditor companyId={companyId} kind={draft.kind} initial={initial} options={optionsQuery.data} data={query.data} onClose={onClose} onSave={saveAction} />;
}

export function PropertyPeopleBoard({ propertyId, propertyName, landlordId, agentLinks, allUsers, colorMap }: {
  propertyId: string;
  propertyName: string;
  landlordId?: string | null;
  // For the BGP team control (InlineAgents), as the page already loads them.
  agentLinks: Array<{ propertyId: string; userId: string; role?: string | null }>;
  allUsers: User[];
  colorMap?: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const people = usePropertyPeople(propertyId);
  const units = usePropertyUnits(propertyId);
  const [filter, setFilter] = useState<Filter>("all");
  const [roleFor, setRoleFor] = useState<RecordPerson | null>(null);
  const [removeFor, setRemoveFor] = useState<RecordPerson | null>(null);
  const [actionFor, setActionFor] = useState<ActionDraft | null>(null);
  const [briefFor, setBriefFor] = useState<{ trackerId: string; unitName: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: crmContacts = [], isLoading: contactsLoading } = useQuery<any[]>({ queryKey: ["/api/crm/contacts"], enabled: adding, staleTime: 5 * 60 * 1000 });

  const reply = people.data;
  const viewer: Viewer = reply?.viewer || { staff: false, canSetRoles: false, canAddActions: false, canPinHide: false };
  const planUnavailable = reply?.plan === "unavailable";

  const refresh = (companyId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: propertyPeopleKey(propertyId) });
    void queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId, "linked-contacts"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/crm/properties", propertyId, "clients"] });
    if (companyId) {
      void queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId] });
      void queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    }
  };
  const run = async (work: () => Promise<unknown>, done: string, companyId?: string | null) => {
    setBusy(true);
    try { await work(); toast({ title: done }); }
    catch (error) { toast({ title: "That did not save", description: plainError(error), variant: "destructive" }); }
    finally { setBusy(false); refresh(companyId); }
  };
  const setOverride = (contactId: string, kind: "pin" | "hide") =>
    run(() => apiRequest("POST", `/api/properties/${encodeURIComponent(propertyId)}/contact-override`, { contactId, kind }), kind === "pin" ? "Added to this property" : "Hidden from this property");
  const clearOverride = (contactId: string, done: string) =>
    run(() => apiRequest("DELETE", `/api/properties/${encodeURIComponent(propertyId)}/contact-override/${encodeURIComponent(contactId)}`), done);
  const roleUrl = (contactId: string) => `/api/properties/${encodeURIComponent(propertyId)}/people/${encodeURIComponent(contactId)}/client-role`;
  const saveRole = (contactId: string, role: string | null, companyId: string | null | undefined, done: string) =>
    run(() => apiRequest("PUT", roleUrl(contactId), { role }), done, companyId);

  // The menu a row offers: each item only where the reply's flags and the entry allow it.
  const menuFor = (person: RecordPerson): ReactNode[] => {
    const items: ReactNode[] = [];
    const id = person.contactId;
    if (id && person.ownerPerson && viewer.canSetRoles) {
      items.push(<DropdownMenuItem key="role" onSelect={() => setRoleFor(person)} data-testid={`people-set-role-${person.id}`}>Role at {propertyName}</DropdownMenuItem>);
    }
    if (id && clientRole(person) && viewer.canSetRoles) {
      items.push(<DropdownMenuItem key="remove" onSelect={() => setRemoveFor(person)} data-testid={`people-remove-client-${person.id}`}>Remove from the client's team</DropdownMenuItem>);
    }
    const kind = person.companyKind;
    if (viewer.canAddActions && (kind === "landlord" || kind === "brand") && person.company?.id) {
      const place = placeOf(person);
      items.push(<DropdownMenuItem key="action" onSelect={() => setActionFor({ person, companyId: person.company!.id!, kind, scheduleRowId: place?.scheduleRowId || null, unitName: place?.unitName ? unitDisplayLabel(place.unitName, propertyName) : null })} data-testid={`people-add-action-${person.id}`}>Add action</DropdownMenuItem>);
    }
    const brief = briefRel(person);
    if (brief?.trackerId) {
      items.push(<DropdownMenuItem key="brief" onSelect={() => setBriefFor({ trackerId: brief.trackerId!, unitName: brief.unitName || "Unit" })} data-testid={`people-open-brief-${person.id}`}>Open brief</DropdownMenuItem>);
    }
    if (id && viewer.canPinHide) {
      items.push(pinned(person)
        ? <DropdownMenuItem key="unpin" onSelect={() => clearOverride(id, "Removed from this property")} data-testid={`people-unpin-${person.id}`}>Remove from this property</DropdownMenuItem>
        : <DropdownMenuItem key="hide" onSelect={() => setOverride(id, "hide")} data-testid={`people-hide-${person.id}`}>Hide from this property</DropdownMenuItem>);
    }
    return items;
  };
  const row = (person: RecordPerson, withRole: boolean, key = person.id) => (
    <PersonRow key={key} person={person} aside={asideFor(person, withRole && !!person.contactId, planUnavailable, propertyName)} menu={menuFor(person)} onChanged={() => refresh(person.company?.id)} propertyName={propertyName} />
  );

  if (people.isLoading) {
    return (
      <section className="rounded-lg border border-border bg-card p-3 space-y-2" aria-busy="true" data-testid="property-people-board">
        <h3 className={subHead}>People</h3>
        <Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-3/5" />
      </section>
    );
  }
  if (!reply) {
    return (
      <section className="rounded-lg border border-border bg-card p-3 space-y-2" data-testid="property-people-board">
        <h3 className={subHead}>People</h3>
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">The people on this property could not be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => { void people.refetch(); }} data-testid="property-people-retry">Retry</Button>
        </div>
      </section>
    );
  }

  // BGP people already drawn by the team control are not drawn again. Only a
  // staff reply says who is assigned, so only staff get the control; anyone
  // else sees every BGP person once, as a row.
  const teamControl = viewer.staff;
  const shown = reply.people.filter(p => !(teamControl && p.group === "bgp" && p.source === "assigned"));
  const byGroup = new Map<PeopleGroup, RecordPerson[]>(PEOPLE_GROUPS.map(g => [g.key, []]));
  for (const person of shown) byGroup.get(person.group)?.push(person);
  const groupCount = (key: PeopleGroup) => key === "bgp" ? reply.people.filter(p => p.group === "bgp").length : byGroup.get(key)!.length;
  const total = reply.people.length;
  const offered = PEOPLE_GROUPS.filter(g => groupCount(g.key) > 0);
  const active: Filter = filter !== "all" && groupCount(filter) === 0 ? "all" : filter;

  const ownerCompanies = new Set([...(landlordId ? [landlordId] : []), ...reply.people.filter(p => p.ownerPerson && p.company?.id).map(p => p.company!.id!)]);
  const onBoard = new Set(reply.people.map(p => p.contactId).filter(Boolean));
  const matches = search.trim().length >= 2
    ? crmContacts.filter(c => !onBoard.has(c.id) && ((c.name || "").toLowerCase().includes(search.toLowerCase()) || (c.companyName || c.company_name || "").toLowerCase().includes(search.toLowerCase()))).slice(0, 8)
    : [];

  // The units group, split by unit in the page's own unit order, then the people on none of them.
  const unitsGroup = () => {
    const list = byGroup.get("units")!;
    const feed = units.data?.units;
    if (!feed) return <div className="space-y-0.5">{list.map(p => row(p, true))}</div>;
    const blocks = unitBlocks(list, feed as PropertyUnit[], unit => unitDisplayLabel(unit.label, propertyName, unit.floor));
    return (
      <div className="divide-y divide-border/60">
        {blocks.map(block => (
          <div key={block.key} className="py-1.5 first:pt-0 grid gap-x-3 gap-y-0.5 [@container(min-width:560px)]:grid-cols-[8rem_minmax(0,1fr)]" data-testid={`people-unit-${block.key}`}>
            <p className={cn(meta, "font-medium truncate pt-1 [@container(min-width:560px)]:pt-1.5")} title={block.title}>{block.label}</p>
            <div className="min-w-0 space-y-0.5">{block.people.map(p => row(p, true, `${block.key}:${p.id}`))}</div>
          </div>
        ))}
      </div>
    );
  };

  const groupBody = (key: PeopleGroup) => {
    if (key === "units") return unitsGroup();
    const list = byGroup.get(key)!;
    return (
      <div className="space-y-0.5">
        {key === "bgp" && teamControl && (
          <div className="flex items-center gap-2 flex-wrap pb-1">
            <InlineAgents propertyId={propertyId} agentLinks={agentLinks} allUsers={allUsers} colorMap={colorMap} landlordId={landlordId} />
          </div>
        )}
        {list.map(p => row(p, key !== "owner" && key !== "client"))}
      </div>
    );
  };
  const groupsShown = PEOPLE_GROUPS.filter(g => (active === "all" || active === g.key) && (groupCount(g.key) > 0 || (g.key === "bgp" && viewer.staff)));

  return (
    <section className="rounded-lg border border-border bg-card p-3 space-y-3 min-w-0 [container-type:inline-size]" data-testid="property-people-board">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={subHead}>People</h3>
        <div className="flex flex-wrap items-center gap-3">
          {reply.hiddenCount > 0 && viewer.canPinHide && (
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground hover:underline" disabled={busy}
              onClick={() => clearOverride("__hidden__", "Hidden people restored")} data-testid="people-restore-hidden">
              <span className="font-mono tabular-nums">{reply.hiddenCount}</span> hidden · restore
            </button>
          )}
          {viewer.canPinHide && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => { setAdding(v => !v); setSearch(""); }} data-testid="people-add-person">
              <Plus className="w-3.5 h-3.5" /> Add person
            </Button>
          )}
        </div>
      </div>

      {adding && (
        <div className="rounded-md border border-border bg-muted/30 p-2 space-y-1.5" data-testid="people-add-panel">
          <Input autoFocus placeholder="Search CRM contacts…" aria-label="Search CRM contacts" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm" data-testid="people-add-search" />
          {search.trim().length >= 2 && (contactsLoading
            ? <p className={cn(meta, "px-1 py-1")}>Searching CRM contacts…</p>
            : matches.length === 0
            ? <p className={cn(meta, "px-1 py-1")}>No matching CRM contacts.</p>
            : <div className="space-y-0.5 max-h-[220px] overflow-y-auto">
              {matches.map((c: any) => {
                const owner = viewer.canSetRoles && !!c.companyId && ownerCompanies.has(c.companyId);
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 px-1 py-1 rounded hover:bg-muted" data-testid={`people-add-row-${c.id}`}>
                    <span className="min-w-0 flex-1 truncate text-sm">{c.name}<span className={cn(meta, "ml-2")}>{c.companyName || c.company_name || ""}</span></span>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
                      onClick={async () => { await setOverride(c.id, "pin"); setAdding(false); setSearch(""); }} data-testid={`people-add-pin-${c.id}`}>Add</Button>
                    {owner && (
                      <select aria-label={`Add ${c.name} to the client's team with a role`} className="h-7 rounded-md border border-input bg-background px-2 text-xs max-w-full" value="" disabled={busy}
                        onChange={async e => { const role = e.target.value; if (!role) return; await saveRole(c.id, role, c.companyId, `Added to the client's team as ${role}`); setAdding(false); setSearch(""); }}
                        data-testid={`people-add-role-${c.id}`}>
                        <option value="">Add to the client's team with a role</option>
                        {PROPERTY_CLIENT_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>)}
        </div>
      )}

      {offered.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter people">
          <Pill active={active === "all"} aria-pressed={active === "all"} onClick={() => setFilter("all")} data-testid="people-filter-all">All <PillCount n={total} active={active === "all"} /></Pill>
          {offered.map(g => (
            <Pill key={g.key} active={active === g.key} aria-pressed={active === g.key} onClick={() => setFilter(g.key)} data-testid={`people-filter-${g.key}`}>
              {g.label.replace(/, by unit$/, "")} <PillCount n={groupCount(g.key)} active={active === g.key} />
            </Pill>
          ))}
        </div>
      )}

      {viewer.staff && planUnavailable && <p className={meta} data-testid="people-plan-unavailable">CRM plan unavailable</p>}

      {total === 0 && !viewer.staff ? (
        <p className="text-sm text-muted-foreground">No people on this property yet.</p>
      ) : (
        <div className="space-y-4">
          {groupsShown.map(g => (
            <section key={g.key} className="space-y-1 min-w-0" aria-label={g.label} data-testid={`people-group-${g.key}`}>
              <h4 className={subHead}>{g.label} <span className="font-mono tabular-nums normal-case tracking-normal font-normal">{groupCount(g.key)}</span></h4>
              {groupBody(g.key)}
            </section>
          ))}
        </div>
      )}

      {roleFor && (
        <Dialog open onOpenChange={open => { if (!open) setRoleFor(null); }}>
          <DialogContent className="max-w-md" data-testid="people-role-dialog">
            <DialogHeader>
              <DialogTitle>Role at {propertyName}</DialogTitle>
              <DialogDescription>{contactDisplayName(roleFor.name)}'s role at this property. Their job title{roleFor.jobTitle ? `, ${roleFor.jobTitle},` : ""} stays as it is.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {PROPERTY_CLIENT_ROLES.map(role => (
                <Button key={role} type="button" size="sm" variant={setRoleHere(roleFor) === role ? "default" : "outline"} disabled={busy}
                  onClick={async () => { const person = roleFor; setRoleFor(null); await saveRole(person.contactId!, role, person.company?.id, `${contactDisplayName(person.name)} is ${role} at ${propertyName}`); }}
                  data-testid={`people-role-${role.toLowerCase().replace(/\s+/g, "-")}`}>
                  {role}
                </Button>
              ))}
            </div>
            {setRoleHere(roleFor) && (
              <Button type="button" variant="ghost" size="sm" className="justify-self-start" disabled={busy}
                onClick={async () => { const person = roleFor; setRoleFor(null); await saveRole(person.contactId!, null, person.company?.id, "Role cleared"); }} data-testid="people-role-clear">
                Clear the role
              </Button>
            )}
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={!!removeFor} onOpenChange={open => { if (!open) setRemoveFor(null); }}>
        <AlertDialogContent data-testid="people-remove-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from the client's team?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeFor ? `${contactDisplayName(removeFor.name)} will leave the client's team at ${propertyName} and lose the "property client" mark on ${removeFor.company?.name || "the landlord"}'s key contacts.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction data-testid="people-remove-confirm" onClick={() => {
              const person = removeFor; setRemoveFor(null);
              if (person?.contactId) void run(() => apiRequest("DELETE", roleUrl(person.contactId!)), "Removed from the client's team", person.company?.id);
            }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {actionFor && (
        <AddActionFromPerson draft={actionFor} propertyId={propertyId} propertyName={propertyName}
          onClose={() => setActionFor(null)} onSaved={() => refresh(actionFor.companyId)} />
      )}
      {briefFor && (
        <UnitBriefDialog unit={{ id: briefFor.trackerId, unitName: briefFor.unitName, propertyId }} open onClose={() => setBriefFor(null)} initialTab="people" />
      )}
    </section>
  );
}

// The people on one unit, in the unit panel: the tenant, the agents and the
// people on the unit's brief. Viewings and offers are in the Letting block.
// Nothing is drawn when there is nobody.
export function UnitPeopleBlock({ propertyId, propertyName, unit, card }: { propertyId: string; propertyName?: string | null; unit: Pick<PropertyUnit, "scheduleRowId" | "trackerId">; card: boolean }) {
  const people = usePropertyPeople(propertyId);
  const reply = people.data;
  if (!reply) return null;
  const onThis = (rel: RecordRelationship) => (!!rel.scheduleRowId && rel.scheduleRowId === unit.scheduleRowId) || (!!rel.trackerId && rel.trackerId === unit.trackerId);
  const here = peopleOnUnit(reply.people, unit);
  const pick = (test: (rel: RecordRelationship) => boolean) => here.filter(p => p.relationships.some(rel => onThis(rel) && test(rel)));
  const sections = ([
    ["Tenant", pick(rel => rel.role === "Tenant")],
    ["Agents", pick(rel => rel.role === "Leasing agent" || rel.role === "Joint agent")],
    ["On the brief", pick(rel => rel.role !== "Joint agent" && (rel.source === "brief" || BRIEF_ROLES.has(rel.role) || rel.role.startsWith("BGP agent on")))],
  ] as Array<[string, RecordPerson[]]>).filter(([, list]) => list.length > 0);
  if (!sections.length) return null;
  const planUnavailable = reply.plan === "unavailable";
  return (
    <section
      aria-label="People on this unit"
      className={cn("min-w-0 space-y-2 [container-type:inline-size]", card ? "rounded-lg border border-border bg-card p-3" : "border-t border-border pt-3 first:border-t-0 first:pt-0")}
      data-testid="property-unit-people"
    >
      <h3 className={subHead}>People</h3>
      {sections.map(([title, list]) => (
        <div key={title} className="space-y-0.5" data-testid={`property-unit-people-${title.toLowerCase().replace(/\s+/g, "-")}`}>
          <p className="text-[11px] font-medium text-muted-foreground">{title}</p>
          {list.map(person => <PersonRow key={person.id} person={person} aside={asideFor(person, false, planUnavailable, propertyName || "")} menu={[]} onChanged={() => { void people.refetch(); }} propertyName={propertyName || ""} showRole={false} />)}
        </div>
      ))}
    </section>
  );
}
