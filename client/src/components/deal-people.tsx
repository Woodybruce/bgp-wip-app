// Everyone on a transaction, with their email and phone (Woody, 24 November
// 2026, on #4664's Parties & AML: "add up there all the other contacts on the
// deal with email and phone number? should be client/s and the details of the
// other side plus advisors agents and solicitors and ability to add a contact
// to the deal"). The BGP team first, then our client, the other side, agents,
// solicitors and advisers. Fed by GET /api/deals/:id/people
// (server/deal-people.ts); BGP staff only.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, MoreHorizontal, Plus, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill, pillMetrics } from "@/components/ui/pill";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { BgpTeamGroup, type BgpTeamPerson } from "@/components/bgp-team-group";
import { useToast } from "@/hooks/use-toast";
import { getAuthHeaders, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { DEAL_PARTY_LABEL } from "@shared/deal-parties";
import { DEAL_PEOPLE_GROUPS, DEAL_PEOPLE_GROUP_LABEL, type DealPeopleGroup, type DealPeopleView, type DealPerson } from "@shared/deal-people";

const peopleKey = (dealId: string) => ["/api/deals", dealId, "people"];
const base = (dealId: string) => `/api/deals/${encodeURIComponent(dealId)}/people`;

async function readJson(res: Response) {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.message || "Something went wrong.");
  return j;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function Initials({ name }: { name: string }) {
  const initials = name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
  return <div className="w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-semibold shrink-0">{initials}</div>;
}

function ContactLine({ person }: { person: Pick<DealPerson, "email" | "phones" | "detailsFrom"> }) {
  if (!person.email && !person.phones.length) return null;
  return (
    <div className="text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
      {person.email && <a href={`mailto:${person.email}`} className="text-primary hover:underline truncate max-w-full" data-testid="deal-person-email">{person.email}</a>}
      {person.phones.map(p => <a key={p} href={telHref(p)} className="text-primary hover:underline tabular-nums whitespace-nowrap" data-testid="deal-person-phone">{p}</a>)}
      {person.detailsFrom === "sra" && <span className="text-muted-foreground">(head office, from the SRA)</span>}
      {person.detailsFrom === "firm" && <span className="text-muted-foreground">(the firm's number)</span>}
    </div>
  );
}

function PersonRow({ person, onAdd, onDetails, onRemove, readOnly }: {
  person: DealPerson;
  readOnly?: boolean;
  onAdd: (group: DealPeopleGroup, company: string | null) => void;
  onDetails: (person: DealPerson) => void;
  onRemove: (person: DealPerson) => void;
}) {
  const name = person.contactId
    ? <Link href={`/contacts/${person.contactId}`} className="font-semibold truncate hover:underline">{person.name}</Link>
    : person.companyId
      ? <Link href={`/companies/${person.companyId}`} className="font-semibold truncate hover:underline">{person.name}</Link>
      : <span className="font-semibold truncate">{person.name}</span>;
  const sub = [person.jobTitle, person.company].filter(Boolean).join(" at ");
  const missing = !readOnly && !!person.contactId && (!person.email || !person.phones.length);
  return (
    <div className="flex items-start gap-2 text-sm rounded px-1 py-1 -mx-1 hover:bg-muted/50 transition-colors min-w-0" data-testid={`deal-person-${person.key}`}>
      <Initials name={person.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          {name}
          {person.roles.map(role => (
            <span key={role} className={cn(pillMetrics, "shrink-0 border border-border text-foreground normal-case tracking-normal max-w-full overflow-hidden text-ellipsis")}>{role}</span>
          ))}
        </div>
        {sub && <div className="text-xs text-muted-foreground truncate">{sub}</div>}
        {person.noPerson && !person.email && !person.phones.length && <div className="text-xs text-muted-foreground">Nobody named yet</div>}
        <ContactLine person={person} />
        {missing && (
          <button type="button" data-no-min-touch className="text-xs text-primary hover:underline" onClick={() => onDetails(person)} data-testid={`deal-person-details-${person.key}`}>
            {!person.email && !person.phones.length ? "Add their email or phone" : !person.email ? "Add their email" : "Add their phone"}
          </button>
        )}
      </div>
      <div className="flex items-center shrink-0">
        {!readOnly && person.noPerson && (person.group === "client" || person.group === "other_side" || person.group === "agents" || person.group === "solicitors") && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onAdd(person.group, person.name)} data-testid={`deal-person-add-at-${person.key}`}>
            <Plus className="w-3.5 h-3.5 mr-1" />Add someone
          </Button>
        )}
        {person.contactId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-no-min-touch className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted" aria-label={`More for ${person.name}`} data-testid={`deal-person-menu-${person.key}`}>
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="text-xs w-56">
              <DropdownMenuItem asChild><Link href={`/contacts/${person.contactId}`}>Open their contact page</Link></DropdownMenuItem>
              {missing && <DropdownMenuItem onSelect={() => onDetails(person)}>Add their details</DropdownMenuItem>}
              {person.linked && !readOnly && <DropdownMenuItem onSelect={() => onRemove(person)} data-testid={`deal-person-remove-${person.key}`}>Take them off this transaction</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

interface SearchHit { id: string; name: string; company: string | null; jobTitle: string | null; email: string | null; phones: string[] }

// Add a contact: find them in the CRM, or add someone new; say who they are on the transaction.
function AddContactDialog({ dealId, open, onClose, start, parties }: {
  dealId: string; open: boolean; onClose: () => void;
  start: { group: DealPeopleGroup; company: string | null };
  parties: DealPeopleView["parties"];
}) {
  const { toast } = useToast();
  const [group, setGroup] = useState<DealPeopleGroup>(start.group);
  const [label, setLabel] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<SearchHit | null>(null);
  // The firm defaults to the party when adding someone at our client or the other side.
  const partyFor = (g: DealPeopleGroup) => g === "client" ? parties.find(p => p.client)?.name || null
    : g === "other_side" ? (parties.filter(p => !p.client).length === 1 ? parties.find(p => !p.client)!.name : null) : null;
  const [fresh, setFresh] = useState({ name: "", email: "", phone: "", company: start.company || partyFor(start.group) || "", jobTitle: "" });
  const [mode, setMode] = useState<"find" | "new">("find");
  useEffect(() => {
    if (!open) return;
    setGroup(start.group); setLabel(""); setQ(""); setPicked(null); setMode("find");
    setFresh({ name: "", email: "", phone: "", company: start.company || partyFor(start.group) || "", jobTitle: "" });
  }, [open, start.group, start.company]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickGroup = (g: DealPeopleGroup) => {
    setGroup(g);
    setFresh(f => ({ ...f, company: f.company && f.company !== partyFor(group) ? f.company : partyFor(g) || "" }));
  };
  const term = q.trim();
  const { data: hits, isFetching } = useQuery<{ contacts: SearchHit[] }>({
    queryKey: [base(dealId), "search", term],
    queryFn: async () => readJson(await fetch(`${base(dealId)}/search?q=${encodeURIComponent(term)}`, { credentials: "include", headers: getAuthHeaders() })),
    enabled: open && mode === "find" && term.length >= 2,
    staleTime: 30_000,
  });
  const save = useMutation({
    mutationFn: async () => {
      const body = mode === "find" && picked
        ? { contactId: picked.id, group, label: label.trim() || null }
        : { ...fresh, group, label: label.trim() || null };
      return readJson(await fetch(base(dealId), {
        method: "POST", credentials: "include", headers: { ...getAuthHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
    },
    onSuccess: (view: DealPeopleView & { created?: boolean }) => {
      queryClient.setQueryData(peopleKey(dealId), view);
      toast({ title: view.created ? "Added, and saved in the CRM" : "Added to the transaction" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Not added", description: e.message, variant: "destructive" }),
  });
  const canSave = mode === "find" ? !!picked : !!fresh.name.trim() && (!!fresh.email.trim() || !!fresh.phone.trim());
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="deal-people-add-dialog">
        <DialogHeader>
          <DialogTitle>Add a contact</DialogTitle>
          <DialogDescription>Who they are on the transaction, then find them in the CRM or add them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={e => { if (e.key === "Enter" && canSave && !save.isPending && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); save.mutate(); } }}>
          <div className="flex flex-wrap gap-1.5" data-testid="deal-people-add-group">
            {DEAL_PEOPLE_GROUPS.map(g => <Pill key={g} active={group === g} onClick={() => pickGroup(g)} data-testid={`deal-people-group-${g}`}>{DEAL_PEOPLE_GROUP_LABEL[g]}</Pill>)}
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Their role on the transaction (optional)</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Asset manager, surveyor, the tenant's solicitor" data-testid="deal-people-add-label" />
          </div>
          <div className="flex gap-1.5">
            <Pill active={mode === "find"} onClick={() => setMode("find")} data-testid="deal-people-mode-find">In the CRM</Pill>
            <Pill active={mode === "new"} onClick={() => { setMode("new"); setPicked(null); }} data-testid="deal-people-mode-new">Someone new</Pill>
          </div>
          {mode === "find" ? (
            <div className="space-y-1.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={e => { setQ(e.target.value); setPicked(null); }} placeholder="Name, email or firm" className="pl-8" autoFocus data-testid="deal-people-search" />
              </div>
              {term.length >= 2 && (
                <div className="max-h-56 overflow-y-auto rounded-md border divide-y" data-testid="deal-people-search-results">
                  {isFetching && !hits ? <p className="p-2 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Searching the CRM…</p>
                    : !hits?.contacts.length ? (
                      <p className="p-2 text-xs text-muted-foreground">Nobody in the CRM matches. <button type="button" data-no-min-touch className="text-primary hover:underline" onClick={() => { setMode("new"); setFresh(f => ({ ...f, name: term.includes("@") ? "" : term, email: term.includes("@") ? term : "" })); }}>Add them as someone new</button></p>
                    ) : hits.contacts.map(h => (
                      <button key={h.id} type="button" data-no-min-touch onClick={() => setPicked(h)}
                        className={cn("w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/60", picked?.id === h.id && "bg-primary/10")} data-testid={`deal-people-hit-${h.id}`}>
                        <span className="font-medium text-sm">{h.name}</span>
                        {(h.jobTitle || h.company) && <span className="text-muted-foreground"> · {[h.jobTitle, h.company].filter(Boolean).join(" at ")}</span>}
                        <span className="block text-muted-foreground truncate">{[h.email, ...h.phones].filter(Boolean).join(" · ") || "No email or phone held"}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2" data-testid="deal-people-new">
              <div className="space-y-1"><Label className="text-[11px]">Name</Label><Input value={fresh.name} onChange={e => setFresh(f => ({ ...f, name: e.target.value }))} autoFocus data-testid="deal-people-new-name" /></div>
              <div className="space-y-1"><Label className="text-[11px]">Firm or company</Label><Input value={fresh.company} onChange={e => setFresh(f => ({ ...f, company: e.target.value }))} data-testid="deal-people-new-company" /></div>
              <div className="space-y-1"><Label className="text-[11px]">Email</Label><Input type="email" value={fresh.email} onChange={e => setFresh(f => ({ ...f, email: e.target.value }))} data-testid="deal-people-new-email" /></div>
              <div className="space-y-1"><Label className="text-[11px]">Phone</Label><Input value={fresh.phone} onChange={e => setFresh(f => ({ ...f, phone: e.target.value }))} data-testid="deal-people-new-phone" /></div>
              <div className="space-y-1 sm:col-span-2"><Label className="text-[11px]">Job title (optional)</Label><Input value={fresh.jobTitle} onChange={e => setFresh(f => ({ ...f, jobTitle: e.target.value }))} /></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending} data-testid="deal-people-add-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}{picked ? `Add ${picked.name}` : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Fill a blank email or phone on someone already on the transaction (never an overwrite).
function DetailsDialog({ dealId, person, onClose }: { dealId: string; person: DealPerson | null; onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => { setEmail(""); setPhone(""); }, [person?.key]);
  const save = useMutation({
    mutationFn: async () => readJson(await fetch(`${base(dealId)}/${encodeURIComponent(person!.contactId!)}/details`, {
      method: "POST", credentials: "include", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() || null, phone: phone.trim() || null }),
    })),
    onSuccess: (view: DealPeopleView) => { queryClient.setQueryData(peopleKey(dealId), view); toast({ title: "Saved in the CRM" }); onClose(); },
    onError: (e: Error) => toast({ title: "Not saved", description: e.message, variant: "destructive" }),
  });
  if (!person) return null;
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="deal-people-details-dialog">
        <DialogHeader>
          <DialogTitle>{person.name}</DialogTitle>
          <DialogDescription>Saved on their CRM contact. To change what is there, use their contact page.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {!person.email && <div className="space-y-1"><Label className="text-[11px]">Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus data-testid="deal-people-details-email" /></div>}
          {!person.phones.length && <div className="space-y-1"><Label className="text-[11px]">Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} data-testid="deal-people-details-phone" /></div>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || (!email.trim() && !phone.trim())} data-testid="deal-people-details-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// readOnly: the transaction page's copy (Woody, 25 November 2026: "remove the ability
// to add a contact that should also be reserved for the AML board. this is view only
// in transactions"). People are added and changed on the AML board. bgpTeam left out
// draws no BGP team group (the AML board's copy).
export function DealPeopleCard({ dealId, bgpTeam, onChangeTeam, readOnly }: { dealId: string; bgpTeam?: BgpTeamPerson[]; onChangeTeam?: () => void; readOnly?: boolean }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<DealPeopleView>({
    queryKey: peopleKey(dealId),
    queryFn: async () => readJson(await fetch(base(dealId), { credentials: "include", headers: getAuthHeaders() })),
  });
  const [adding, setAdding] = useState<{ group: DealPeopleGroup; company: string | null } | null>(null);
  const [details, setDetails] = useState<DealPerson | null>(null);
  const remove = useMutation({
    mutationFn: async (person: DealPerson) => readJson(await fetch(`${base(dealId)}/${encodeURIComponent(person.contactId!)}`, { method: "DELETE", credentials: "include", headers: getAuthHeaders() })),
    onSuccess: (view: DealPeopleView) => { queryClient.setQueryData(peopleKey(dealId), view); toast({ title: "Taken off the transaction" }); },
    onError: (e: Error) => toast({ title: "Not taken off", description: e.message, variant: "destructive" }),
  });
  const people = data?.people || [];
  const named = people.filter(p => !p.noPerson).length + (bgpTeam?.length || 0);
  const heading = (g: DealPeopleGroup) => {
    if (g !== "client" && g !== "other_side") return DEAL_PEOPLE_GROUP_LABEL[g];
    const ps = (data?.parties || []).filter(p => (g === "client") === p.client);
    return `${DEAL_PEOPLE_GROUP_LABEL[g]}${ps.length ? ` · ${ps.map(p => `${DEAL_PARTY_LABEL[p.role]}, ${p.name}`).join("; ")}` : ""}`;
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-3" data-testid="deal-people">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">People <span className="font-mono tabular-nums text-muted-foreground">{named}</span></h3>
          {!readOnly && (
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAdding({ group: "advisers", company: null })} data-testid="deal-people-add">
              <UserPlus className="w-3.5 h-3.5 mr-1" />Add a contact
            </Button>
          )}
        </div>
        {bgpTeam && <BgpTeamGroup
          people={bgpTeam}
          details
          emptyText="No BGP agent on the transaction yet."
          addControl={onChangeTeam ? (
            <button type="button" data-no-min-touch className="text-[11px] text-primary hover:underline" onClick={onChangeTeam} data-testid="deal-people-change-team">
              Change the team (Fees &amp; invoicing)
            </button>
          ) : null}
        />}
        {isLoading ? <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Reading who is on the transaction…</p>
          : error ? <p className="text-xs text-amber-800 dark:text-amber-300">{String((error as Error).message)}</p>
          : DEAL_PEOPLE_GROUPS.map(g => {
            const rows = people.filter(p => p.group === g);
            if (!rows.length) return null;
            return (
              <div key={g} className="space-y-0.5 min-w-0" data-testid={`deal-people-group-list-${g}`}>
                <div className="flex items-center justify-between gap-2 pb-0.5">
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate">{heading(g)}</h4>
                  {!readOnly && <button type="button" data-no-min-touch className="text-[11px] text-primary hover:underline shrink-0" onClick={() => setAdding({ group: g, company: null })} data-testid={`deal-people-add-${g}`}>Add</button>}
                </div>
                {rows.map(p => <PersonRow key={p.key} person={p} readOnly={readOnly} onAdd={(group, company) => setAdding({ group, company })} onDetails={setDetails} onRemove={person => remove.mutate(person)} />)}
              </div>
            );
          })}
        {data && !people.some(p => p.group === "agents" || p.group === "solicitors" || p.group === "advisers") && (
          <p className="text-xs text-muted-foreground">No agents, solicitors or advisers recorded yet.</p>
        )}
      </CardContent>
      {adding && <AddContactDialog dealId={dealId} open start={adding} parties={data?.parties || []} onClose={() => setAdding(null)} />}
      <DetailsDialog dealId={dealId} person={details} onClose={() => setDetails(null)} />
    </Card>
  );
}
