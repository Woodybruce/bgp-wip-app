// Who is involved in the brief and the sign-off (Woody, 2026-11-12): the
// agents (BGP and any joint agent), the client's leasing team and asset
// managers. Each person agrees the brief; a signature counts only on the
// current version, so a change to the terms asks everyone to agree again.
// Routes: server/unit-brief-workspace.ts.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, CircleCheck, CircleDashed, Loader2, Plus, Search, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Pill } from "@/components/ui/pill";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  BRIEF_AGENCY_BASES, BRIEF_PERSON_ROLES, briefMissingText, briefRoleLabel,
  type BriefAgencyBasis, type BriefPeopleCandidates, type BriefPerson, type BriefPersonRole,
} from "@shared/unit-brief";
import type { BriefSectionProps, SuggestedBriefPerson } from "./types";

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const CHIP = "rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap";
const EMERALD = "border-emerald-600/60 text-emerald-700 dark:text-emerald-400";
const AMBER = "border-amber-500/60 text-amber-700 dark:text-amber-400";
const NEUTRAL = "border-border text-muted-foreground";
const GROUPS = ["Agents", "Client"] as const;
const LIST_LIMIT = 40;

const fmtDate = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
// apiRequest throws "409: the server's message".
const serverMessage = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || fallback;
const statusOf = (e: unknown): number => {
  const m = e instanceof Error ? e.message.match(/^(\d{3}):/) : null;
  return m ? Number(m[1]) : 0;
};
const isRole = (r: string | null | undefined): r is BriefPersonRole => BRIEF_PERSON_ROLES.some(x => x.key === r);
const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const listNames = (names: string[]): string =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

interface FormSeed { nonce: number; role: BriefPersonRole | ""; name: string; email: string; firm: string }

export function BriefPeoplePanel({ ws, refresh, suggested, suggestedLabel }: BriefSectionProps & { suggested?: SuggestedBriefPerson[]; suggestedLabel?: string }) {
  const { toast } = useToast();
  const { brief, people, approval, viewer } = ws;
  const canEdit = viewer.canEditTerms;
  // The agents running the letting (BGP, and a joint agent on the scheme)
  // record an agreement for someone with no login.
  const canRecord = viewer.agentControl;
  // A joint agent adds the client's people and joint agents; BGP's own
  // agents are added and removed by BGP.
  const jointAgent = !viewer.seesBgpNotes;
  const [busy, setBusy] = useState<string | null>(null);
  const [seed, setSeed] = useState<FormSeed | null>(null);
  const settle = useRef<number | null>(null);

  // A finished change keeps its button disabled until the brief has been
  // re-read, so a second press cannot land on the old state.
  useEffect(() => {
    setBusy(null);
    if (settle.current) { window.clearTimeout(settle.current); settle.current = null; }
  }, [ws]);
  useEffect(() => () => { if (settle.current) window.clearTimeout(settle.current); }, []);

  const run = async (key: string, failTitle: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      refresh();
      settle.current = window.setTimeout(() => setBusy(null), 4000);
    } catch (e) {
      toast({ title: failTitle, description: serverMessage(e, "Try again."), variant: "destructive" });
      if (statusOf(e) === 409 || statusOf(e) === 404) refresh();
      setBusy(null);
    }
  };

  const openForm = (s: Partial<Omit<FormSeed, "nonce">> = {}) =>
    setSeed({ nonce: Date.now(), role: s.role || "", name: s.name || "", email: s.email || "", firm: s.firm || "" });

  const setBasis = (key: BriefAgencyBasis) => {
    if (key === brief.agencyBasis) return;
    if (approval.agreed > 0) {
      const who = approval.agreed === 1 ? "The person who has agreed" : `The ${approval.agreed} people who have agreed`;
      if (!window.confirm(`Changing the agency basis changes the brief. ${who} will be asked to agree again. Change it?`)) return;
    }
    run("basis", "Agency basis not changed", () => apiRequest("PATCH", `/api/unit-briefs/${brief.id}`, { agencyBasis: key }));
  };

  const isCurrent = (p: BriefPerson) => !!p.agreedAt && p.agreedVersion === brief.version;

  const agree = (p: BriefPerson, mine: boolean) => {
    if (!mine && !window.confirm(`Record that ${p.name} has agreed this brief? The brief will show that you recorded it.`)) return;
    run(`agree:${p.id}`, "Agreement not recorded", () => apiRequest("POST", `/api/unit-briefs/people/${p.id}/agree`, { version: brief.version }));
  };
  const withdraw = (p: BriefPerson, mine: boolean) => {
    if (!mine && !window.confirm(`Withdraw ${p.name}'s agreement to this brief? The brief will show that you withdrew it.`)) return;
    run(`agree:${p.id}`, "Agreement not withdrawn", () => apiRequest("POST", `/api/unit-briefs/people/${p.id}/agree`, { withdraw: true }));
  };
  const remove = (p: BriefPerson) => {
    if (!window.confirm(`Remove ${p.name} from the brief?${p.agreedAt ? " Their agreement goes with them." : ""}`)) return;
    run(`remove:${p.id}`, "Not removed", () => apiRequest("DELETE", `/api/unit-briefs/people/${p.id}`));
  };

  // People the client's document named who are not on the brief yet.
  const suggestions = canEdit
    ? (suggested || []).filter(s => s.name && !(jointAgent && s.role === "bgp_agent") && !people.some(p => same(p.name, s.name) && (!isRole(s.role) || p.role === s.role)))
    : [];
  // The logins and contacts a suggested name can be matched to, so a person
  // is added as their real record (a BGP agent must be a BGP login).
  const matchPool = useQuery<BriefPeopleCandidates>({
    queryKey: ["/api/unit-briefs", brief.id, "people-candidates"],
    queryFn: async () => {
      const r = await fetch(`/api/unit-briefs/${brief.id}/people-candidates`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The list of people could not be loaded");
      return r.json();
    },
    enabled: canEdit && suggestions.length > 0,
  });
  const addSuggested = (s: SuggestedBriefPerson, i: number) => {
    if (!isRole(s.role)) { openForm({ name: s.name, email: s.email || "", firm: s.firm || "" }); return; }
    const role = s.role;
    if (role === "bgp_agent") {
      const login = matchPool.data?.bgp.find(u => same(u.name, s.name));
      // No BGP login of that name: the form lists who can be picked.
      if (!login) { openForm({ role, name: s.name }); return; }
      run(`suggest:${i}`, "Not added", () => apiRequest("POST", `/api/unit-briefs/${brief.id}/people`, { role, userId: login.userId }));
      return;
    }
    if (role === "joint_agent") {
      // A joint agent needs their firm: finish it in the form.
      if (!s.firm) { openForm({ role, name: s.name, email: s.email || "" }); return; }
    } else {
      const known = matchPool.data?.client.find(c => same(c.name, s.name));
      if (known && (known.userId || known.contactId)) {
        run(`suggest:${i}`, "Not added", () => apiRequest("POST", `/api/unit-briefs/${brief.id}/people`, { role, ...(known.userId ? { userId: known.userId } : { contactId: known.contactId }) }));
        return;
      }
    }
    run(`suggest:${i}`, "Not added", () => apiRequest("POST", `/api/unit-briefs/${brief.id}/people`, {
      role, name: s.name, ...(s.firm ? { firm: s.firm } : {}), ...(s.email ? { email: s.email } : {}),
    }));
  };

  const agreedOn = brief.agreedAt || people.map(p => p.agreedAt || "").sort().pop() || null;
  const waiting = Array.from(new Set(people.filter(p => !isCurrent(p)).map(p => p.name)));
  const chipTone = approval.state === "agreed" ? EMERALD : approval.state === "none" ? NEUTRAL : AMBER;
  const changedBy = [brief.termsUpdatedByName ? `by ${brief.termsUpdatedByName}` : "", brief.termsUpdatedAt ? `on ${fmtDate(brief.termsUpdatedAt)}` : ""].filter(Boolean).join(" ");
  const basisLabel = BRIEF_AGENCY_BASES.find(b => b.key === brief.agencyBasis)?.label || "Not set";
  const jointOnSole = brief.agencyBasis === "sole" && people.some(p => p.role === "joint_agent");

  return (
    <div className="space-y-4 min-w-0" data-testid="brief-people-panel">
      <div className="space-y-1.5" data-testid="brief-people-summary">
        <span className={`inline-block ${CHIP} ${chipTone}`} data-testid="brief-people-approval-chip">{approval.label}</span>
        <p className="text-sm" data-testid="brief-people-summary-text">
          {approval.state === "agreed" && `Everyone involved agreed this brief on ${fmtDate(agreedOn)}.`}
          {approval.state === "none" && (canEdit ? "Add the people involved, then each of them agrees the brief." : "No one has been added to this brief yet.")}
          {(approval.state === "awaiting" || approval.state === "draft") && waiting.length > 0 && `Still to agree: ${listNames(waiting)}.`}
          {(approval.state === "awaiting" || approval.state === "draft") && waiting.length === 0 && "Everyone on the brief has agreed it."}
        </p>
        {approval.missing.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="brief-people-missing-side">
            The brief is agreed once both sides are on it and have agreed. Still to add: {briefMissingText(approval.missing)}.
          </p>
        )}
        {approval.state !== "agreed" && approval.stale > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="brief-people-stale-note">
            The terms were changed{changedBy ? ` ${changedBy}` : ""} after {approval.stale === 1 ? "one person" : `${approval.stale} people`} had agreed, so {approval.stale === 1 ? "they are" : "they are each"} asked to agree again.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <p className={MICRO_LABEL}>Agency basis</p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {BRIEF_AGENCY_BASES.map(b => (
              <Pill key={b.key} active={brief.agencyBasis === b.key} aria-pressed={brief.agencyBasis === b.key} disabled={!!busy} className="disabled:opacity-60" onClick={() => setBasis(b.key)} data-testid={`brief-agency-basis-${b.key}`}>
                {b.label}
              </Pill>
            ))}
            {busy === "basis" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Saving" />}
            {!brief.agencyBasis && <span className="text-xs text-muted-foreground">Not set yet. Pick one.</span>}
          </div>
        ) : (
          <p className="text-sm" data-testid="brief-agency-basis-text">{basisLabel}</p>
        )}
        {jointOnSole && <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="brief-agency-basis-mismatch">A joint agent is on the brief, but the basis is sole agent.</p>}
      </div>

      <AgentFeeSplit brief={brief} jointAgentName={people.find(p => p.role === "joint_agent")?.firm || people.find(p => p.role === "joint_agent")?.name || null} canEdit={canEdit} onSaved={refresh} />

      {suggestions.length > 0 && (
        <div className="rounded-lg border border-dashed p-3 space-y-2" data-testid="brief-people-suggested">
          <p className={MICRO_LABEL}>{suggestedLabel || "Named in the client's brief"}</p>
          <ul className="space-y-1.5">
            {suggestions.map((s, i) => (
              <li key={`${s.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1 basis-40">
                  <p className="text-sm font-medium truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[isRole(s.role) ? briefRoleLabel(s.role) : s.role || "Role not given", s.firm, s.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => addSuggested(s, i)} aria-label={`Add ${s.name} to the brief`} data-testid={`brief-suggested-add-${i}`}>
                  {busy === `suggest:${i}` ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                  {isRole(s.role) ? "Add" : "Add, pick the role"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={MICRO_LABEL}>People involved</p>
        {canEdit && !seed && (
          <Button type="button" variant="outline" size="sm" onClick={() => openForm()} data-testid="brief-add-person">
            <UserPlus className="h-3.5 w-3.5 mr-1" /> Add person
          </Button>
        )}
      </div>

      {canEdit && seed && (
        <AddPersonForm
          key={seed.nonce}
          briefId={brief.id}
          people={people}
          seed={seed}
          allowBgpAgent={!jointAgent}
          onClose={() => setSeed(null)}
          onAdded={(p) => {
            setSeed(null);
            refresh();
            toast({ title: "Added to the brief", description: `${p.name}, ${briefRoleLabel(p.role)}` });
          }}
        />
      )}

      {GROUPS.map(group => (
        <section key={group} className="rounded-lg border" data-testid={`brief-people-group-${group.toLowerCase()}`}>
          <h3 className="px-3 pt-2.5 text-sm font-semibold">{group}</h3>
          <div className="divide-y">
            {BRIEF_PERSON_ROLES.filter(r => r.group === group).map(r => {
              const rows = people.filter(p => p.role === r.key);
              return (
                <div key={r.key} className="px-3 py-2.5 space-y-2" data-testid={`brief-people-role-${r.key}`}>
                  <p className={MICRO_LABEL}>{r.label}</p>
                  {rows.length === 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground" data-testid={`brief-people-none-${r.key}`}>
                        {r.key === "joint_agent" && brief.agencyBasis === "sole" ? "None. BGP is sole agent." : r.key === "bgp_agent" && jointAgent ? "None added. BGP adds its own agents." : "None added"}
                      </p>
                      {canEdit && !(jointAgent && r.key === "bgp_agent") && (
                        <Button type="button" variant="outline" size="sm" onClick={() => openForm({ role: r.key })} aria-label={`Add ${r.label.toLowerCase()}`} data-testid={`brief-add-person-${r.key}`}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add
                        </Button>
                      )}
                    </div>
                  ) : (
                    <ul className="space-y-2.5">
                      {rows.map(p => (
                        <PersonRow
                          key={p.id}
                          person={p}
                          current={isCurrent(p)}
                          mine={viewer.personIds.includes(p.id)}
                          isStaff={viewer.isStaff}
                          canRecord={canRecord}
                          canEdit={canEdit}
                          busy={busy}
                          onAgree={agree}
                          onWithdraw={withdraw}
                          onRemove={remove}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {canRecord && (
        <p className="text-xs text-muted-foreground" data-testid="brief-people-staff-note">
          A person with a login agrees for themselves. For someone without one, record their agreement here once they have confirmed it, for example by email; the brief shows that you recorded it.
        </p>
      )}
    </div>
  );
}

function PersonRow({ person: p, current, mine, isStaff, canRecord, canEdit, busy, onAgree, onWithdraw, onRemove }: {
  person: BriefPerson;
  current: boolean;
  mine: boolean;
  isStaff: boolean;
  canRecord: boolean;
  canEdit: boolean;
  busy: string | null;
  onAgree: (p: BriefPerson, mine: boolean) => void;
  onWithdraw: (p: BriefPerson, mine: boolean) => void;
  onRemove: (p: BriefPerson) => void;
}) {
  const stale = !!p.agreedAt && !current;
  const joint = p.role === "joint_agent";
  const detail = (joint ? [p.email] : [p.firm, p.email]).filter(Boolean).join(" · ");
  const signing = busy === `agree:${p.id}`;
  // A person with a login agrees for themselves; the agents running the
  // letting record an agreement only for someone who has none.
  const canSign = mine || (canRecord && !p.userId);
  // BGP's agents are added and removed by BGP.
  const canRemove = canEdit && (isStaff || p.role !== "bgp_agent");
  return (
    <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3" data-testid={`brief-person-${p.id}`}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
          <span className="text-sm font-medium truncate min-w-0" data-testid={`brief-person-name-${p.id}`}>{p.name}</span>
          {joint && <span className={`${CHIP} ${p.firm ? "border-border text-foreground" : NEUTRAL} max-w-full truncate`} data-testid={`brief-person-firm-${p.id}`}>{p.firm || "Firm not given"}</span>}
          {mine && <span className="text-[11px] text-muted-foreground">You</span>}
        </div>
        {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
        <p className="text-xs" data-testid={`brief-person-state-${p.id}`}>
          {current ? (
            <span className="inline-flex flex-wrap items-center gap-x-1 font-medium text-emerald-700 dark:text-emerald-400">
              <CircleCheck className="h-3.5 w-3.5 shrink-0" /> Agreed {fmtDate(p.agreedAt)}
              {p.agreedOnBehalf && p.agreedByName && <span className="font-normal text-muted-foreground">· recorded by {p.agreedByName}</span>}
            </span>
          ) : stale ? (
            <span className="inline-flex items-start gap-1 font-medium text-amber-700 dark:text-amber-400">
              <CircleAlert className="h-3.5 w-3.5 shrink-0 mt-px" /> Agreed an earlier version, asked to agree again
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <CircleDashed className="h-3.5 w-3.5 shrink-0" /> Not yet agreed
            </span>
          )}
        </p>
      </div>
      {(canSign || canRemove || (canRecord && !mine && !current)) && (
        <div className="flex items-center gap-1.5 shrink-0">
          {canRecord && !mine && !current && !!p.userId && (
            <span className="text-xs text-muted-foreground" data-testid={`brief-person-has-login-${p.id}`}>Has a login, agrees for themselves</span>
          )}
          {canSign && current && (
            <Button type="button" variant="ghost" size="sm" disabled={!!busy} onClick={() => onWithdraw(p, mine)} aria-label={mine ? "Withdraw my agreement" : `Withdraw ${p.name}'s agreement`} data-testid={`brief-person-withdraw-${p.id}`}>
              {signing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Withdraw
            </Button>
          )}
          {canSign && !current && mine && (
            <Button type="button" size="sm" disabled={!!busy} onClick={() => onAgree(p, true)} data-testid={`brief-person-agree-${p.id}`}>
              {signing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1" />}Agree brief
            </Button>
          )}
          {canSign && !current && !mine && (
            <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => onAgree(p, false)} aria-label={`Record agreement for ${p.name}`} data-testid={`brief-person-record-${p.id}`}>
              {signing && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Record agreement
            </Button>
          )}
          {canRemove && (
            <Button type="button" variant="ghost" size="sm" className="w-9 px-0 text-muted-foreground hover:text-destructive" disabled={!!busy} onClick={() => onRemove(p)} aria-label={`Remove ${p.name} from the brief`} data-testid={`brief-person-remove-${p.id}`}>
              {busy === `remove:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

interface ListOption { key: string; primary: string; secondary?: string | null }

// A search box over a short scrolling list: works the same with a mouse
// and on a phone keyboard.
function SearchList({ options, selected, onSelect, placeholder, empty, testid, initialQuery }: {
  options: ListOption[];
  selected: string | null;
  onSelect: (key: string) => void;
  placeholder: string;
  empty: string;
  testid: string;
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery || "");
  const needle = q.trim().toLowerCase();
  const matches = needle ? options.filter(o => `${o.primary} ${o.secondary || ""}`.toLowerCase().includes(needle)) : options;
  const shown = matches.slice(0, LIST_LIMIT);
  return (
    <div className="rounded-md border min-w-0" data-testid={testid}>
      <div className="flex items-center gap-2 border-b px-2.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-9 border-0 px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0" data-testid={`${testid}-search`} />
      </div>
      <div className="max-h-48 overflow-y-auto" role="listbox">
        {shown.map(o => {
          const on = o.key === selected;
          return (
            <button
              key={o.key} type="button" role="option" aria-selected={on} onClick={() => onSelect(o.key)}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted/60 ${on ? "bg-muted" : ""}`}
              data-testid={`${testid}-option-${o.key}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{o.primary}</span>
                {o.secondary && <span className="block truncate text-xs text-muted-foreground">{o.secondary}</span>}
              </span>
              {on && <Check className="h-4 w-4 shrink-0" />}
            </button>
          );
        })}
        {matches.length === 0 && <p className="px-2.5 py-3 text-sm text-muted-foreground" data-testid={`${testid}-empty`}>{options.length === 0 ? empty : "No one matches that search."}</p>}
        {matches.length > shown.length && <p className="px-2.5 py-2 text-xs text-muted-foreground">Showing {shown.length} of {matches.length}. Search to narrow the list.</p>}
      </div>
    </div>
  );
}

function AddPersonForm({ briefId, people, seed, allowBgpAgent, onClose, onAdded }: {
  briefId: string;
  people: BriefPerson[];
  seed: FormSeed;
  /** False for a joint agent: BGP's agents are added and removed by BGP. */
  allowBgpAgent: boolean;
  onClose: () => void;
  onAdded: (p: BriefPerson) => void;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<BriefPersonRole | "">(!allowBgpAgent && seed.role === "bgp_agent" ? "" : seed.role);
  const [picked, setPicked] = useState<string | null>(null);
  const [manual, setManual] = useState(!!seed.name);
  const [name, setName] = useState(seed.name);
  const [email, setEmail] = useState(seed.email);
  const [firmId, setFirmId] = useState<string | null>(null);
  const [firmUnlisted, setFirmUnlisted] = useState(!!seed.firm);
  const [firmText, setFirmText] = useState(seed.firm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);

  // Fetched when the form first opens.
  const candidates = useQuery<BriefPeopleCandidates>({
    queryKey: ["/api/unit-briefs", briefId, "people-candidates"],
    queryFn: async () => {
      const r = await fetch(`/api/unit-briefs/${briefId}/people-candidates`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.message || "The list of people could not be loaded");
      return r.json();
    },
  });
  const data = candidates.data;
  const inRole = people.filter(p => p.role === role);

  const changeRole = (next: BriefPersonRole) => { setRole(next); setPicked(null); setError(null); };

  const bgpOptions: ListOption[] = (data?.bgp || [])
    .filter(u => !inRole.some(p => p.userId === u.userId))
    .map(u => ({ key: u.userId, primary: u.name, secondary: u.email }));
  const clientRows = (data?.client || [])
    .map(c => ({ ...c, key: c.userId ? `u-${c.userId}` : c.contactId ? `c-${c.contactId}` : "" }))
    .filter(c => c.key && !inRole.some(p => (c.userId && p.userId === c.userId) || (c.contactId && p.contactId === c.contactId) || same(p.email, c.email) || same(p.name, c.name)));
  const clientOptions: ListOption[] = clientRows.map(c => ({ key: c.key, primary: c.name, secondary: [c.role, c.email].filter(Boolean).join(" · ") }));
  const firm = data?.agentFirms.find(f => f.companyId === firmId) || null;
  const firmOptions: ListOption[] = (data?.agentFirms || []).map(f => ({ key: f.companyId, primary: f.name }));
  const contactOptions: ListOption[] = (firm?.contacts || [])
    .filter(c => !inRole.some(p => p.contactId === c.contactId))
    .map(c => ({ key: c.contactId, primary: c.name, secondary: [c.role, c.email].filter(Boolean).join(" · ") }));

  const isClientRole = role === "client_leasing" || role === "senior_asset_manager" || role === "asset_manager";
  const typed: Record<string, string> = email.trim() ? { name: name.trim(), email: email.trim() } : { name: name.trim() };

  // What to send, or the reason nothing can be sent yet.
  const build = (): { body: Record<string, string> } | { why: string } => {
    if (!role) return { why: "Pick what this person is on the brief." };
    if (role === "bgp_agent") return picked ? { body: { role, userId: picked } } : { why: "Pick the BGP agent from the list." };
    if (role === "joint_agent") {
      if (firmUnlisted ? !firmText.trim() : !firmId) return { why: firmUnlisted ? "Type the firm's name." : "Pick the joint agent's firm." };
      const firmPart: Record<string, string> = firmUnlisted ? { firm: firmText.trim() } : { companyId: firmId as string };
      if (!firmUnlisted && picked) return { body: { role, ...firmPart, contactId: picked } };
      if (!typed.name) return { why: "Name the person at the firm: they are who signs." };
      return { body: { role, ...firmPart, ...typed } };
    }
    if (!manual) {
      const c = clientRows.find(x => x.key === picked);
      if (!c) return { why: "Pick the person from the list, or choose Someone not listed." };
      return { body: c.userId ? { role, userId: c.userId } : { role, contactId: c.contactId as string } };
    }
    if (!typed.name) return { why: "A name is needed." };
    return { body: { role, ...typed } };
  };
  const built = build();
  const usesTyped = "body" in built && "name" in built.body;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (saving) return;
    if ("why" in built) { setError(built.why); return; }
    if (usesTyped && email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Check the email address."); return; }
    setSaving(true);
    setError(null);
    try {
      const added: BriefPerson = await (await apiRequest("POST", `/api/unit-briefs/${briefId}/people`, built.body)).json();
      onAdded(added);
    } catch (err) {
      setError(serverMessage(err, "The person could not be added. Try again."));
      setSaving(false);
    }
  };

  const listState = candidates.isLoading ? (
    <div className="space-y-1.5" data-testid="brief-person-candidates-loading">
      <Skeleton className="h-9 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-4/5" />
    </div>
  ) : candidates.isError ? (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2.5 text-sm text-muted-foreground" data-testid="brief-person-candidates-error">
      <span className="min-w-0 flex-1 basis-40">{(candidates.error as Error | null)?.message || "The list of people could not be loaded"}.{role !== "bgp_agent" ? " You can still type the details in." : ""}</span>
      <Button type="button" variant="outline" size="sm" disabled={candidates.isFetching} onClick={() => candidates.refetch()} data-testid="brief-person-candidates-refresh">Refresh</Button>
    </div>
  ) : null;

  const typedFields = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      <label className="block min-w-0">
        <span className={MICRO_LABEL}>Name</span>
        <Input value={name} onChange={e => { setName(e.target.value); if (e.target.value) setPicked(null); setError(null); }} autoComplete="off" className="h-9 text-sm mt-0.5" data-testid="brief-person-name" />
      </label>
      <label className="block min-w-0">
        <span className={MICRO_LABEL}>Email <span className="font-normal normal-case tracking-normal">· so they can agree with their own login</span></span>
        <Input type="email" inputMode="email" value={email} onChange={e => { setEmail(e.target.value); setError(null); }} autoComplete="off" className="h-9 text-sm mt-0.5" data-testid="brief-person-email" />
      </label>
    </div>
  );

  return (
    <form ref={ref} onSubmit={submit} noValidate className="rounded-lg border bg-muted/30 p-3 space-y-3 min-w-0" data-testid="brief-person-form">
      <p className="text-sm font-semibold">Add a person to the brief</p>

      <div className="max-w-xs">
        <p className={MICRO_LABEL}>They are</p>
        <Select value={role || undefined} onValueChange={v => changeRole(v as BriefPersonRole)}>
          <SelectTrigger className="h-9 text-sm mt-0.5 bg-background" aria-label="What this person is on the brief" data-testid="brief-person-role">
            <SelectValue placeholder="Pick a role" />
          </SelectTrigger>
          <SelectContent>
            {BRIEF_PERSON_ROLES.filter(r => allowBgpAgent || r.key !== "bgp_agent").map(r => (
              <SelectItem key={r.key} value={r.key} data-testid={`brief-person-role-${r.key}`}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {role === "bgp_agent" && (
        <div className="space-y-1">
          <p className={MICRO_LABEL}>Who at BGP</p>
          {listState || (
            <SearchList
              key="bgp" testid="brief-person-bgp-list" options={bgpOptions} selected={picked} initialQuery={seed.name}
              onSelect={k => { setPicked(k); setError(null); }}
              placeholder="Search BGP people"
              empty={(data?.bgp.length || 0) > 0 ? "Everyone at BGP is already on the brief in this role." : "No BGP people are listed for this account."}
            />
          )}
        </div>
      )}

      {isClientRole && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <Pill active={!manual} onClick={() => { setManual(false); setError(null); }} data-testid="brief-person-mode-list">From the client's people</Pill>
            <Pill active={manual} onClick={() => { setManual(true); setPicked(null); setError(null); }} data-testid="brief-person-mode-manual">Someone not listed</Pill>
          </div>
          {!manual ? (
            listState || (
              <SearchList
                key={`client-${role}`} testid="brief-person-client-list" options={clientOptions} selected={picked}
                onSelect={k => { setPicked(k); setError(null); }}
                placeholder={data?.clientCompany.name ? `Search ${data.clientCompany.name} people` : "Search the client's people"}
                empty={(data?.client.length || 0) > 0 ? "Everyone listed is already on the brief in this role. Use Someone not listed to add another." : "No people are held for this client yet. Use Someone not listed."}
              />
            )
          ) : typedFields}
        </div>
      )}

      {role === "joint_agent" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className={MICRO_LABEL}>Firm</p>
            <div className="flex flex-wrap gap-1.5">
              <Pill active={!firmUnlisted} onClick={() => { setFirmUnlisted(false); setError(null); }} data-testid="brief-person-firm-mode-list">From the agents list</Pill>
              <Pill active={firmUnlisted} onClick={() => { setFirmUnlisted(true); setPicked(null); setError(null); }} data-testid="brief-person-firm-mode-manual">Firm not listed</Pill>
            </div>
            {firmUnlisted ? (
              <Input value={firmText} onChange={e => { setFirmText(e.target.value); setError(null); }} placeholder="The firm's name" aria-label="The firm's name" autoComplete="off" className="h-9 text-sm" data-testid="brief-person-firm-text" />
            ) : firm ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="brief-person-firm-picked">{firm.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFirmId(null); setPicked(null); }} data-testid="brief-person-firm-change">Change</Button>
              </div>
            ) : (
              listState || (
                <SearchList
                  key="firms" testid="brief-person-firm-list" options={firmOptions} selected={firmId} initialQuery={seed.firm}
                  onSelect={k => { setFirmId(k); setPicked(null); setError(null); }}
                  placeholder="Search agent firms"
                  empty="No agent firms are in the CRM yet. Use Firm not listed."
                />
              )
            )}
          </div>
          {(firmUnlisted || firm) && (
            <div className="space-y-1.5">
              <p className={MICRO_LABEL}>Who at the firm <span className="font-normal normal-case tracking-normal">· the person who signs</span></p>
              {!firmUnlisted && contactOptions.length > 0 && (
                <>
                  <SearchList
                    key={`contacts-${firmId}`} testid="brief-person-contact-list" options={contactOptions} selected={picked}
                    onSelect={k => { setPicked(k); setName(""); setEmail(""); setError(null); }}
                    placeholder={`Search people at ${firm?.name || "the firm"}`}
                    empty="No people are held for this firm."
                  />
                  <p className="text-xs text-muted-foreground">Or type someone who is not listed:</p>
                </>
              )}
              {typedFields}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive" role="alert" data-testid="brief-person-form-error">{error}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClose} data-testid="brief-person-cancel">Cancel</Button>
        <Button type="submit" size="sm" disabled={saving || !role} data-testid="brief-person-submit">
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          {saving ? "Adding…" : "Add to the brief"}
        </Button>
      </div>
    </form>
  );
}


// The fee split between the agents the client has instructed (Woody,
// 2026-11-12: "fee splits need to be for joint or sole agent"). Sole agent:
// BGP has the whole fee. Joint agents: the joint agent's share, BGP the
// rest. This is not BGP's own internal split, which stays on the deal page.
function AgentFeeSplit({ brief, jointAgentName, canEdit, onSaved }: {
  brief: { id: string; agencyBasis: string | null; jointAgentFeePct?: number | null };
  jointAgentName: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const saved = brief.jointAgentFeePct ?? null;
  const [draft, setDraft] = useState<string>(saved == null ? "" : String(saved));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(saved == null ? "" : String(saved)); }, [saved, brief.id]);
  const joint = brief.agencyBasis === "joint";
  const n = draft.trim() === "" ? null : Number(draft);
  const valid = n === null || (Number.isFinite(n) && n >= 0 && n <= 100);
  const dirty = (n ?? null) !== saved && valid;
  const bgp = n === null || !valid ? null : Math.round((100 - n) * 100) / 100;
  const who = jointAgentName || "Joint agent";
  const save = async (value: number | null) => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/unit-briefs/${brief.id}/agent-fee-split`, { jointAgentPct: value });
      onSaved();
    } catch (e) {
      toast({ title: "Fee split not saved", description: serverMessage(e, "Try again."), variant: "destructive" });
    } finally { setSaving(false); }
  };
  return (
    <div className="space-y-1" data-testid="brief-fee-split">
      <p className={MICRO_LABEL}>Fee split between the agents</p>
      {!brief.agencyBasis && <p className="text-xs text-muted-foreground">Pick sole or joint agents above first.</p>}
      {brief.agencyBasis === "sole" && <p className="text-sm" data-testid="brief-fee-split-text">BGP 100%, as sole agent.</p>}
      {joint && canEdit && <p className="text-xs text-muted-foreground" data-testid="brief-fee-split-note">A change is shown on the brief's timeline with who made it and the figure before and after.</p>}
      {joint && !canEdit && (
        <p className="text-sm tabular-nums" data-testid="brief-fee-split-text">{saved == null ? "Not set yet." : `BGP ${Math.round((100 - saved) * 100) / 100}% · ${who} ${saved}%`}</p>
      )}
      {joint && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm tabular-nums">BGP {bgp == null ? "…" : `${bgp}%`}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <label className="flex items-center gap-1.5 text-sm">
            <span>{who}</span>
            <Input type="text" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value.replace(/[^0-9.]/g, ""))} className="h-8 w-16 text-right tabular-nums" aria-label={`${who}'s share of the fee, as a percentage`} placeholder="50" data-testid="brief-fee-split-input" />
            <span>%</span>
          </label>
          {saved == null && draft === "" && <Button type="button" variant="outline" size="sm" className="h-8" disabled={saving} onClick={() => save(50)} data-testid="brief-fee-split-half">Split it 50 / 50</Button>}
          {dirty && <Button type="button" size="sm" className="h-8" disabled={saving} onClick={() => save(n)} data-testid="brief-fee-split-save">{saving ? "Saving" : "Save split"}</Button>}
          {!valid && <span className="text-xs text-amber-700 dark:text-amber-400">A percentage from 0 to 100.</span>}
        </div>
      )}
    </div>
  );
}
