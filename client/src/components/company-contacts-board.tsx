// The canonical contacts board — ONE structure for every surface that
// shows a company's people (brand profile, landlord profile, dashboard
// widget), per Woody 2026-08-04: "we get happy with one structure and then
// we roll it across the app". CRM contacts + the discovery cascade merged
// and deduped, provenance/AI badges on the right, optional extra grouped
// sections for surfaces that add related people (deal brands, agents).
import { isKeyContactRole, nameKey, isEmailPlaceholderName, keyContactHiddenReason, compareKeyContacts, type KeyContactSignals, type KeyContactHiddenReason } from "@shared/contact-tiers";
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pillMetrics, pillInactive } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Users, Mail, Linkedin, Loader2, RefreshCw, Plus, ChevronDown, ChevronRight, Phone, MoreHorizontal } from "lucide-react";

function formatRelativeShort(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 56) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

const AI_FLAG_LABELS: Record<string, string> = {
  not_a_person: "Not a person?", duplicate: "Duplicate?", title_mismatch: "Title?", should_be_key: "Key?", should_be_hidden: "Not key?", stale: "Left?",
};

type ContactsCheck = { summary: string[]; lead: string | null; flags: Array<{ contactId: string; issue: string; note: string }>; missing: Array<{ email: string; note: string }> };

// The AI sense check of this board — who leads on property, what looks
// wrong, who BGP emails but hasn't saved. Re-runs when the contacts or the
// email history change.
function useContactsCheck(companyId: string, enabled: boolean) {
  const key = ["/api/brand", companyId, "contacts-check"];
  const { data } = useQuery<{ check: ContactsCheck | null; stale: boolean; contacts: number }>({
    queryKey: key,
    queryFn: async () => (await apiRequest("GET", `/api/brand/${companyId}/contacts-check`)).json(),
    enabled,
    staleTime: 10 * 60_000,
  });
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/brand/${companyId}/contacts-check`)).json(),
    onSuccess: (out: { check: ContactsCheck | null }) => queryClient.setQueryData(key, (prev: any) => ({ ...(prev || {}), check: out.check, stale: false })),
  });
  useEffect(() => {
    if (enabled && data && !data.check && data.contacts > 0 && !run.isPending && !run.isSuccess && !run.isError) run.mutate();
  }, [enabled, data]);
  return { check: data?.check || null, running: run.isPending, failed: run.isError };
}

// A photo that fails to load falls back to initials — hiding the <img>
// left an empty circle (Woody, 2026-09-27).
function ContactAvatar({ url, name }: { url?: string | null; name?: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || "").split(/\s+/).map(p => p.replace(/[^A-Za-z0-9]/g, "")[0] || "").join("").slice(0, 2).toUpperCase() || "?";
  if (!url || failed) return <>{initials}</>;
  return <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />;
}

// One line per person on desktop, two on the phone: name · role · emails ·
// small icon links · ⋯ — the 3-line rows with round buttons made a
// 33-person board a page long (Woody, 2026-09-28).
export function KeyContactRow({ contact, companyId, discovery, aiFlag, isLead, canMarkLeft = false, muted = false }: { contact: any; companyId: string; discovery?: any; aiFlag?: { issue: string; note: string } | null; isLead?: boolean; canMarkLeft?: boolean; muted?: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: rowViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const rowIsClient = !rowViewer || rowViewer.role === "Client" || !!rowViewer.companyScopeId;
  const [editingRole, setEditingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState(contact.role || "");

  const saveRole = useMutation({
    mutationFn: async (value: string) => {
      const res = await apiRequest("PUT", `/api/crm/contacts/${contact.id}`, { role: value || null });
      return res.json();
    },
    onSuccess: () => {
      setEditingRole(false);
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Couldn't save role", description: e?.message, variant: "destructive" }),
  });
  const markLeft = useMutation({
    mutationFn: async (left: boolean) => (await apiRequest("POST", `/api/crm/contacts/${contact.id}/left-company`, { companyId, left })).json(),
    onSuccess: (_out, left) => {
      toast({ title: left ? `${contactDisplayName(contact.name)} marked as left` : `${contactDisplayName(contact.name)} back as current` });
      void queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId, "workspace"] });
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e?.message, variant: "destructive" }),
  });

  const hasEmail = !!contact.email;
  const hasLinkedin = !!contact.linkedin_url;
  const hasPhone = !!contact.phone;
  const touches: number = contact.interaction_count || 0;
  const lastTouch: string | null = contact.last_interaction_at || null;
  const lastTouchLabel = lastTouch ? formatRelativeShort(lastTouch) : null;
  const touchText = `${touches.toLocaleString("en-GB")} email${touches === 1 ? "" : "s"}${lastTouchLabel ? ` · ${lastTouchLabel}` : ""}`;
  const touchTitle = lastTouch ? `${touches} email${touches === 1 ? "" : "s"} with BGP · last ${new Date(lastTouch).toLocaleDateString("en-GB")}` : `${touches} emails with BGP`;
  const leftLabel = contact.left_at ? `Left · ${new Date(contact.left_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : null;
  // "mshulman" stays as saved (the server renames from signatures) but reads
  // as a stand-in, not a person's name.
  const placeholderName = isEmailPlaceholderName(contact.name, contact.email);
  const iconLink = "p-1.5 md:p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted shrink-0";
  const roleOrStatus = editingRole ? (
    <input
      autoFocus
      value={roleDraft}
      onChange={(e) => setRoleDraft(e.target.value)}
      onBlur={() => {
        if (roleDraft.trim() !== (contact.role || "").trim()) saveRole.mutate(roleDraft.trim());
        else setEditingRole(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") saveRole.mutate(roleDraft.trim());
        if (e.key === "Escape") { setEditingRole(false); setRoleDraft(contact.role || ""); }
      }}
      className="text-[11px] w-full [@container(min-width:560px)]:w-48 border rounded px-1 py-0.5 bg-background"
      placeholder="e.g. Head of Leasing"
    />
  ) : (
    <button
      type="button"
      data-no-min-touch
      onClick={() => setEditingRole(true)}
      className="text-[11px] [@container(min-width:560px)]:text-xs text-left truncate min-w-0 text-muted-foreground hover:text-foreground hover:underline decoration-dotted"
      title={contact.role ? `${contact.role} — click to edit` : "Add role"}
    >
      {contact.role || <span className="italic text-muted-foreground/70">add role…</span>}
    </button>
  );

  return (
    <div className={`flex items-center gap-2 text-sm hover:bg-muted/50 rounded px-1 py-1 [@container(min-width:560px)]:py-0.5 -mx-1 transition-colors ${muted ? "opacity-60" : ""}`} data-testid={`key-contact-row-${contact.id}`}>
      <Link href={`/contacts/${contact.id}`} className="w-5 h-5 rounded-full bg-muted flex items-center justify-center text-[11px] font-medium shrink-0 overflow-hidden">
        <ContactAvatar url={contact.avatar_url} name={contact.name} />
      </Link>
      <div className="min-w-0 flex-1 [@container(min-width:560px)]:flex [@container(min-width:560px)]:items-center [@container(min-width:560px)]:gap-2">
        <div className="flex items-center gap-1 min-w-0 [@container(min-width:560px)]:max-w-[45%] [@container(min-width:560px)]:shrink-0">
          <Link href={`/contacts/${contact.id}`} className={`hover:underline truncate ${placeholderName ? "font-normal text-muted-foreground" : "font-semibold"}`}>{contactDisplayName(contact.name)}</Link>
          {placeholderName && <span className="text-[11px] text-muted-foreground/70 shrink-0 whitespace-nowrap" title="Saved from an inbox — the real name replaces it once BGP sees their signature">name from email</span>}
          {isLead && <Badge variant="outline" className="text-[11px] px-1 py-0 shrink-0 bg-foreground text-background border-transparent" title="The AI check's read of BGP's main property contact here">Lead</Badge>}
          {/* A "Title?" / "Left?" badge on every row was noise — a small dot
              with the note on hover; the full list sits in the AI check
              notes (Woody, 2026-09-27). */}
          {aiFlag && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" title={`${AI_FLAG_LABELS[aiFlag.issue] || "Check"} ${aiFlag.note}`} aria-label={`AI check: ${AI_FLAG_LABELS[aiFlag.issue] || "Check"}`} data-testid="key-contact-ai-flag" />}
          {!touches && discovery?.bgp?.threadCount ? (
            <Badge variant="outline" className="text-[11px] px-1 py-0 shrink-0 tabular-nums bg-primary/10 text-primary border-primary/30" title="BGP has real email history with this person">
              known · {discovery.bgp.threadCount} threads
            </Badge>
          ) : !touches && discovery?.ai?.confidence != null ? (
            <Badge variant="outline" className="text-[11px] px-1 py-0 shrink-0 tabular-nums bg-primary/10 text-primary border-primary/30" title={discovery.ai?.reason || "AI-verified against RocketReach/Apollo"}>
              AI {discovery.ai.confidence}
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 min-w-0 [@container(min-width:560px)]:flex-1">
          {roleOrStatus}
          {/* Phone: status / count end the role line (line two). */}
          {leftLabel ? (
            <span className="[@container(min-width:560px)]:hidden shrink-0 text-[11px] text-muted-foreground" title={contact.left_note || undefined}>· {leftLabel}</span>
          ) : touches > 0 && (
            <span className="[@container(min-width:560px)]:hidden shrink-0 text-[11px] text-muted-foreground font-mono tabular-nums" title={touchTitle}>· {touchText}</span>
          )}
        </div>
        {/* Account-mode provenance (Delivery 3): where this contact enters
            the account — employer, property links, portfolio names. Only
            renders when the caller passes workspace-shaped contacts. */}
        {(contact.employerName || (contact.via && contact.via.length > 0) || (contact.propertyNames && contact.propertyNames.length > 0)) && (
          <div className="hidden [@container(min-width:560px)]:flex items-center gap-1 shrink-0 max-w-[40%] overflow-hidden">
            {contact.employerName && (
              <Badge variant="outline" className="text-[11px] px-1 py-0 text-muted-foreground truncate">{contact.employerName}</Badge>
            )}
            {(contact.via || []).filter((v: string) => v !== "employer").map((v: string) => (
              <Badge key={v} variant="outline" className="text-[11px] px-1 py-0 text-muted-foreground whitespace-nowrap">
                {v === "property" ? "property link" : v === "property_client" ? "property client" : v}
              </Badge>
            ))}
            {(contact.propertyNames || []).map((p: string) => (
              <Badge key={p} variant="outline" className="text-[11px] px-1 py-0 bg-primary/10 text-primary border-primary/30 whitespace-nowrap">{p}</Badge>
            ))}
          </div>
        )}
      </div>
      {leftLabel ? (
        <span className="hidden [@container(min-width:560px)]:inline shrink-0 text-[11px] text-muted-foreground" title={contact.left_note || undefined} data-testid="key-contact-left">{leftLabel}</span>
      ) : touches > 0 && (
        <span className="hidden [@container(min-width:560px)]:inline shrink-0 text-[11px] text-muted-foreground font-mono tabular-nums" title={touchTitle}>{touchText}</span>
      )}
      <div className="flex items-center shrink-0">
        {hasEmail && (
          <a href={`mailto:${contact.email}`} className={iconLink} aria-label={`Email ${contact.name}`} title={contact.email} onClick={(e) => e.stopPropagation()}>
            <Mail className="w-4 h-4" />
          </a>
        )}
        {hasPhone && (
          <a href={`tel:${String(contact.phone).replace(/[^\d+]/g, "")}`} className={iconLink} aria-label={`Call ${contact.name}`} title={String(contact.phone)} onClick={(e) => e.stopPropagation()}>
            <Phone className="w-4 h-4" />
          </a>
        )}
        {hasLinkedin && (
          <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className={`${iconLink} hidden md:inline-flex`} aria-label={`${contact.name} on LinkedIn`} onClick={(e) => e.stopPropagation()}>
            <Linkedin className="w-4 h-4" />
          </a>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" data-no-min-touch className={iconLink} aria-label={`More for ${contactDisplayName(contact.name)}`} data-testid={`key-contact-menu-${contact.id}`}>
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          {/* Keep focus off the trigger so "Edit role"'s input isn't blurred shut. */}
          <DropdownMenuContent align="end" className="text-xs" onCloseAutoFocus={(e) => e.preventDefault()}>
            <DropdownMenuItem asChild><Link href={`/contacts/${contact.id}`}>Open contact</Link></DropdownMenuItem>
            <DropdownMenuItem onClick={() => setEditingRole(true)}>{contact.role ? "Edit role" : "Add role"}</DropdownMenuItem>
            {hasLinkedin && <DropdownMenuItem asChild className="md:hidden"><a href={contact.linkedin_url} target="_blank" rel="noreferrer">LinkedIn</a></DropdownMenuItem>}
            {/* Staff only — the endpoint 403s clients. */}
            {canMarkLeft && !rowIsClient && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => markLeft.mutate(!contact.left_at)} disabled={markLeft.isPending} data-testid={`key-contact-left-toggle-${contact.id}`}>
                  {contact.left_at ? "Not left" : "Mark as left"}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface PromotedContact {
  id: string;
  name: string;
  email: string | null;
  created: boolean;
  companyId: string | null;
  companyName: string | null;
  employerConfirmed: boolean;
}

// Automated senders aren't people to add (noreply@wagamama.com was offered
// with Add to CRM) (Woody, 2026-09-28).
const AUTOMATED_SENDER_RE = /^(?:no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounces?)(?:[+._-][^@]*)?@/i;
// Meeting-room and resource mailboxes (mr4.4@shaftesburycapital.com) aren't
// people either (Woody, 2026-09-28).
const ROOM_MAILBOX_RE = /^(?:mr[._-]?\d[^@]*|(?:meeting-?)?rooms?(?:[\d._-][^@]*)?|[^@]*(?:meetingroom|meeting\.room|boardroom|confroom|conferenceroom)[^@]*|resources?(?:[\d._-][^@]*)?|reception(?:[\d._-][^@]*)?)@/i;
const isMachineMailbox = (email: unknown) => { const e = String(email || "").trim(); return AUTOMATED_SENDER_RE.test(e) || ROOM_MAILBOX_RE.test(e); };
// Top of the board: the six people worth calling; the rest sit behind one
// "Show all N" (Woody, 2026-09-28).
const KEY_CONTACTS_SHOWN = 6;
const HIDDEN_ORDER: Record<KeyContactHiddenReason, number> = { left: 0, placeholder: 1, stale: 2 };
// "Jane Smith/GBR" — a directory's country suffix, display only.
export const contactDisplayName = (name: string | null | undefined) => String(name || "").replace(/\s*\/\s*[A-Z]{2,3}\s*$/, "");

function PendingSendersList({ suggestions: allSuggestions, companyId }: { suggestions: any[]; companyId: string }) {
  const suggestions = allSuggestions.filter(s => !isMachineMailbox(s.email));
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: psViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const psIsClient = !psViewer || psViewer.role === "Client" || !!psViewer.companyScopeId;
  const [saved, setSaved] = useState<Record<string, PromotedContact>>({});
  const [lastSaved, setLastSaved] = useState<{ companyId: string; contact: PromotedContact } | null>(null);
  // An inner scroll box cut the last row mid-name — show 6, then "+N more".
  const [showAllSenders, setShowAllSenders] = useState(false);

  const promote = useMutation({
    mutationFn: async ({ sender, sourceCompanyId }: { sender: any; sourceCompanyId: string }) => {
      const res = await apiRequest("POST", `/api/brand/${sourceCompanyId}/promote-sender`, { email: sender.email, name: sender.name });
      return res.json() as Promise<PromotedContact>;
    },
    onSuccess: (out, { sender, sourceCompanyId }) => {
      setSaved(previous => ({ ...previous, [`${sourceCompanyId}:${sender.email}`]: out }));
      setLastSaved({ companyId: sourceCompanyId, contact: out });
      toast({ title: out.created ? "Contact added to CRM" : "Contact already in CRM", description: out.employerConfirmed ? `Employer: ${out.companyName}` : "Employer not set — open the contact to add it." });
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/brand", sourceCompanyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Couldn't add contact", description: e?.message, variant: "destructive" }),
  });
  if (suggestions.length === 0 && lastSaved?.companyId !== companyId) return null;
  return (
    <div className="mt-3 pt-2 border-t border-border/40">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
        From BGP inboxes <span className="font-mono tabular-nums">({suggestions.filter(sender => !saved[`${companyId}:${sender.email}`]).length} to review)</span>
      </div>
      <div className="space-y-0.5">
        {(showAllSenders ? suggestions : suggestions.slice(0, 6)).map((s) => (
          <div key={s.email} className="flex items-center gap-1.5 text-[11px] px-1 py-1 rounded hover:bg-muted/50">
            <Mail className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
            <span className="truncate flex-1 text-[11px]">{s.email}</span>
            <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums" title="Emails with BGP · last one">{Number(s.touches || 0).toLocaleString("en-GB")} email{Number(s.touches) === 1 ? "" : "s"}{s.last_touch ? ` · ${formatRelativeShort(s.last_touch)}` : ""}</span>
            {!psIsClient && (saved[`${companyId}:${s.email}`] ? <Link href={`/contacts/${saved[`${companyId}:${s.email}`].id}`} className="inline-flex min-h-11 md:min-h-0 items-center text-sm md:text-xs underline">In CRM</Link> :
            <Button variant="outline" size="sm"
              onClick={() => promote.mutate({ sender: s, sourceCompanyId: companyId })} disabled={promote.isPending}
              className="min-h-11 md:min-h-0 md:h-7 md:px-2 text-sm md:text-xs shrink-0" data-testid={`pending-sender-add-${s.email}`}
              title="Save this person to CRM"
            >
              <Plus className="w-3 h-3 mr-1" /> Add to CRM
            </Button>
            )}
          </div>
        ))}
      </div>
      {suggestions.length > 6 && (
        <button type="button" className="mt-1 text-[11px] text-primary hover:underline" onClick={() => setShowAllSenders(v => !v)}>
          {showAllSenders ? "Show fewer" : `+${(suggestions.length - 6).toLocaleString("en-GB")} more`}
        </button>
      )}
    </div>
  );
}

export function CompanyContactsBoard({ companyId, companyName, contacts, pendingSenders = [], extraSections = [], discovery = true, filterPropertyTier = true, isLandlord = false, topSlot = null }: {
  companyId: string;
  companyName: string;
  contacts: any[];
  pendingSenders?: any[];
  // Additional grouped sections (e.g. the dashboard's "Brands on your deals"
  // and "Agents") rendered under the main list with the same row design.
  extraSections?: Array<{ key: string; title: string; tint?: string; rows: any[] }>;
  /** Rendered first inside the card — the brand's tenant reps (Woody, 2026-09-23). */
  topSlot?: React.ReactNode;
  // The discovery cascade burns provider credits — surfaces that just want
  // the list (dashboard widget) turn it off.
  discovery?: boolean;
  filterPropertyTier?: boolean;
  // Landlord companies get no property-tier role filter: that tier is
  // retail/tenant-oriented (store dev, expansion, C-suite of a brand), so it
  // hides landlord-side roles (asset management, leasing, estates surveyors).
  // Callers pass the same isLandlord signal the rest of the profile uses.
  isLandlord?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: kcViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const kcIsClient = !kcViewer || kcViewer.role === "Client" || !!kcViewer.companyScopeId;
  const [showAll, setShowAll] = useState(false);
  // The AI check reads a brand's board (property people vs C-suite); agent
  // firms show everyone (filterPropertyTier off) and skip it.
  const aiCheck = useContactsCheck(companyId, !kcIsClient && discovery && !isLandlord && filterPropertyTier);
  const aiFlagFor = (id: string) => aiCheck.check?.flags.find(f => f.contactId === String(id)) || null;
  const [addedContacts, setAddedContacts] = useState<Record<string, PromotedContact>>({});
  const [lastAdded, setLastAdded] = useState<{ companyId: string; contact: PromotedContact } | null>(null);
  const [addingEmail, setAddingEmail] = useState<string | null>(null);
  // Extra sections are collapsed to headers by default — their titles and
  // counts are visible right under the main list instead of a full page of
  // scrolling (Woody, 2026-08-05: "can we have headers instead?").
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  // Account-mode filters (Delivery 3): only active when contacts carry the
  // workspace shape (via / employerName / propertyNames).
  const [employerFilter, setEmployerFilter] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");

  // Property-relevant roles only by default. Most of what RocketReach imports
  // is C-suite + store-dev — but historical Apollo data has store managers,
  // baristas, anyone. We filter to property-relevant titles so the panel is
  // useful for "who do I pitch this unit to". User can click 'Show all'.
  const isPropertyTier = (role: string | null | undefined): boolean => isKeyContactRole(role);

  // Discovery cascade (BGP email archaeology + RocketReach premium lookups +
  // Apollo + AI judge) runs AUTOMATICALLY on open for staff — no button
  // press, same as the rest of the brand AI (Woody, 2026-08-03).
  const { data: cascade, isFetching: scanning, refetch: rescan } = useQuery<any>({
    queryKey: ["/api/brand", companyId, "contacts-cascade"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${companyId}/contacts-cascade`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("scan failed");
      return res.json();
    },
    enabled: !kcIsClient && discovery,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  // ONE deduped list: CRM contacts first, then discovered candidates that
  // don't match a CRM row (matched by email, falling back to name). When a
  // candidate DOES match a CRM row, its discovery data (thread history, AI
  // confidence, source) decorates that row instead of being thrown away —
  // otherwise the AI-check/known badges never showed for brands whose
  // contacts were already imported (Woody, 2026-08-03).
  const normEmail = (e: any) => String(e || "").toLowerCase().trim();
  const normName = (n: any) => String(n || "").toLowerCase().replace(/\s+/g, " ").trim();
  // The same person saved twice ("Mark  Standish" / "Mark Standish") shows
  // once — the row with an email / BGP history wins.
  const allContacts = (() => {
    const byName = new Map<string, any>();
    const out: any[] = [];
    for (const c of contacts || []) {
      const key = nameKey(c.name);
      const prev = key ? byName.get(key) : null;
      if (!prev) { if (key) byName.set(key, c); out.push(c); continue; }
      const score = (x: any) => (x.email ? 2 : 0) + (x.last_interaction_at ? 1 : 0);
      if (score(c) > score(prev)) { out[out.indexOf(prev)] = c; byName.set(key, c); }
    }
    return out;
  })();
  const crmEmailSet = new Set(allContacts.map((c: any) => normEmail(c.email)).filter(Boolean));
  const crmNameSet = new Set(allContacts.map((c: any) => normName(c.name)).filter(Boolean));
  const discoveryByKey = new Map<string, any>();
  for (const k of (cascade?.contacts || [])) {
    const e = normEmail(k.email);
    const n = normName(k.name);
    if (e && !discoveryByKey.has(e)) discoveryByKey.set(e, k);
    if (n && !discoveryByKey.has(n)) discoveryByKey.set(n, k);
  }
  const discoveryFor = (c: any) => discoveryByKey.get(normEmail(c.email)) || discoveryByKey.get(normName(c.name)) || null;
  const seenDiscovered = new Set<string>();
  const discovered = (cascade?.contacts || [])
    .filter((k: any) => k.ai?.verdict !== "drop" && !k.bgp?.inCrm && !isMachineMailbox(k.email))
    .filter((k: any) => {
      const e = normEmail(k.email);
      const n = normName(k.name);
      if (e && crmEmailSet.has(e)) return false;
      if (!e && n && crmNameSet.has(n)) return false;
      const dupKey = e || n;
      if (!dupKey || seenDiscovered.has(dupKey)) return false;
      seenDiscovered.add(dupKey);
      return true;
    });
  const crmAiChecked = allContacts.filter((c: any) => discoveryFor(c)?.ai).length;

  // When nothing survives the property-tier filter and the full list is
  // small anyway, gating a handful of contacts behind "Show all 1" is pure
  // friction — just list them (UX #85). The gate keeps working for long lists.
  // Landlords bypass the tier entirely (see the isLandlord prop above).
  const accountMode = allContacts.some((c: any) => c.via || c.employerName || c.propertyNames);
  const employerOptions = accountMode
    ? [...new Set(allContacts.map((c: any) => c.employerName).filter(Boolean))].sort() as string[]
    : [];
  const propertyOptions = accountMode
    ? [...new Set(allContacts.flatMap((c: any) => c.propertyNames || []))].sort() as string[]
    : [];
  const accountFiltered = !accountMode ? allContacts : allContacts.filter((c: any) => {
    if (employerFilter && c.employerName !== employerFilter) return false;
    if (propertyFilter && !(c.propertyNames || []).includes(propertyFilter)) return false;
    if (roleFilter && !String(c.role || "").toLowerCase().includes(roleFilter.toLowerCase())) return false;
    return true;
  });
  const accountFiltersActive = !!(employerFilter || propertyFilter || roleFilter);
  const applyTierFilter = filterPropertyTier && !isLandlord;
  // CRM rows and discovered candidates ranked together (shared/contact-tiers
  // compareKeyContacts): key role, then BGP email volume / recency, then a
  // real name. Leavers, 0-email inbox placeholders and people silent 2+ years
  // never make the top list (Woody, 2026-09-28).
  type BoardItem = { kind: "crm"; row: any; sig: KeyContactSignals; hidden: KeyContactHiddenReason | null } | { kind: "discovered"; row: any; sig: KeyContactSignals; hidden: KeyContactHiddenReason | null };
  const latest = (...values: any[]) => values.filter(Boolean).sort().reverse()[0] || null;
  const now = Date.now();
  const items: BoardItem[] = [
    ...accountFiltered.map((c: any): BoardItem => {
      const d = discoveryFor(c);
      const sig = { name: c.name, email: c.email, role: c.role, emails: Number(c.interaction_count || 0) || Number(d?.bgp?.threadCount || 0), lastAt: latest(c.last_interaction_at, d?.bgp?.lastEmailed), leftAt: c.left_at || null, inCrm: true };
      return { kind: "crm", row: c, sig, hidden: keyContactHiddenReason(sig, now) };
    }),
    ...discovered.map((k: any): BoardItem => {
      const sig = { name: k.name, email: k.email, role: k.title, emails: Number(k.bgp?.threadCount || 0), lastAt: k.bgp?.lastEmailed || null, inCrm: false };
      return { kind: "discovered", row: k, sig, hidden: keyContactHiddenReason(sig, now) };
    }),
  ];
  const byRank = (a: BoardItem, b: BoardItem) => compareKeyContacts(a.sig, b.sig, { landlord: isLandlord, now });
  const current = items.filter(i => !i.hidden).sort(byRank);
  const retired = items.filter(i => i.hidden).sort((a, b) => (HIDDEN_ORDER[a.hidden!] - HIDDEN_ORDER[b.hidden!]) || byRank(a, b));
  // Brands lead with property / C-suite only (Woody, 2026-09-25: "we don't
  // want any regional managers"); if a brand has none, the top list falls
  // back to whoever BGP emails. Landlords and agents rank everyone.
  const tierEmpty = current.every(i => !isPropertyTier(i.sig.role));
  const topPool = applyTierFilter && !tierEmpty ? current.filter(i => isPropertyTier(i.sig.role)) : current;
  const top = topPool.slice(0, KEY_CONTACTS_SHOWN);
  const rest = current.filter(i => !top.includes(i));
  const totalPeople = items.length;
  const summary = cascade?.summary;
  // A sender already listed above (CRM or discovered) isn't shown again
  // (Woody, 2026-09-23: David Menendez twice on Honest Greens).
  const inboxSenders = pendingSenders.filter((sender: any) => {
    const e = normEmail(sender.email);
    return !sender.in_crm && !isMachineMailbox(sender.email) && (!e || (!crmEmailSet.has(e) && !discovered.some((k: any) => normEmail(k.email) === e)));
  });
  const moreCount = rest.length + retired.length;
  // Nothing to expand but the discovery summary → the summary line shows on
  // its own; a "Show 0 from BGP inboxes" toggle opened onto nothing.
  const hasMore = moreCount > 0 || inboxSenders.length > 0;

  const addToCrm = async (k: any) => {
    const rowKey = normEmail(k.email) || normName(k.name);
    setAddingEmail(rowKey);
    try {
      const response = await apiRequest("POST", `/api/brand/${companyId}/promote-sender`, {
        name: k.name || undefined,
        email: k.email || undefined,
        phone: k.phone || k.mobile || undefined,
        mobile: k.mobile || undefined,
        role: k.title || undefined,
        linkedin: k.linkedin_url || k.linkedin || undefined,
      });
      const contact: PromotedContact = await response.json();
      setAddedContacts(previous => ({ ...previous, [`${companyId}:${rowKey}`]: contact }));
      setLastAdded({ companyId, contact });
      void queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      toast({ title: contact.created ? "Contact added to CRM" : "Contact already in CRM", description: contact.employerConfirmed ? `Employer: ${contact.companyName}` : "Employer not set — open the contact to add it." });
    } catch (e: any) {
      toast({ title: "Couldn't add contact", description: e?.message, variant: "destructive" });
    } finally {
      setAddingEmail(null);
    }
  };

  // Provenance label for the right-hand side of each discovered row:
  // "known" = BGP has real email history with them; otherwise the provider
  // that surfaced them.
  const provenance = (k: any): { label: string; cls: string } => {
    if (k.bgp?.threadCount) return { label: `known · ${k.bgp.threadCount} threads`, cls: "text-primary border-border" };
    if (k.sources?.includes("rocketreach")) return { label: "RocketReach", cls: "text-primary border-border" };
    if (k.sources?.includes("apollo")) return { label: "Apollo", cls: "text-muted-foreground border-border" };
    return { label: k.sources?.[0] || "discovered", cls: "" };
  };

  const hiddenLabel = (item: BoardItem) => item.hidden === "placeholder" ? "no name · no emails" : item.hidden === "stale" && item.sig.lastAt ? `last email ${formatRelativeShort(String(item.sig.lastAt))} ago` : null;
  const renderItem = (item: BoardItem) => {
    if (item.kind === "crm") {
      const dm = item.row;
      const canMarkLeft = !dm.via || dm.via.includes("employer");
      const note = hiddenLabel(item);
      return (
        <div key={`crm-${dm.id}`} title={note || undefined}>
          <KeyContactRow contact={dm} companyId={companyId} discovery={discoveryFor(dm)} aiFlag={aiFlagFor(dm.id)} isLead={aiCheck.check?.lead === String(dm.id)} canMarkLeft={canMarkLeft} muted={!!item.hidden} />
        </div>
      );
    }
    const k = item.row;
    const rowKey = normEmail(k.email) || normName(k.name);
    const added = addedContacts[`${companyId}:${rowKey}`];
    const conf = k.ai?.confidence;
    const confCls = conf == null ? "" : conf >= 70 ? "text-primary border-border" : conf >= 40 ? "text-muted-foreground border-border" : "text-destructive border-border";
    const src = provenance(k);
    return (
      <div key={`found-${rowKey}`} className={`flex items-center gap-2 text-sm rounded px-1 py-1 md:py-0.5 -mx-1 hover:bg-muted/50 transition-colors ${item.hidden ? "opacity-60" : ""}`}>
        <span className="w-5 h-5 rounded-full bg-muted/70 border border-dashed flex items-center justify-center text-[11px] font-medium shrink-0">
          {(k.name || k.email || "?").split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1 [@container(min-width:560px)]:flex [@container(min-width:560px)]:items-center [@container(min-width:560px)]:gap-2">
          <p className="font-semibold truncate [@container(min-width:560px)]:max-w-[45%] [@container(min-width:560px)]:shrink-0">{contactDisplayName(k.name) || k.email}</p>
          <p className="text-[11px] [@container(min-width:560px)]:text-xs text-muted-foreground truncate [@container(min-width:560px)]:flex-1" title={[k.title, k.email, k.phone || k.mobile, k.ai?.reason].filter(Boolean).join(" · ")}>
            {[k.title, k.email].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
        {conf != null && (
          <Badge variant="outline" className={`hidden md:inline-flex text-[11px] px-1 py-0 shrink-0 tabular-nums ${confCls}`} title={k.ai?.reason || ""}>{conf}</Badge>
        )}
        <Badge variant="outline" className={`hidden md:inline-flex text-[11px] px-1 py-0 shrink-0 ${src.cls}`}>{src.label}</Badge>
        {added ? (
          <Link href={`/contacts/${added.id}`} className="inline-flex min-h-11 md:min-h-0 items-center text-xs underline shrink-0" data-testid={`contact-cascade-open-${rowKey}`}>In CRM · open</Link>
        ) : !kcIsClient ? (
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 md:min-h-0 md:h-6 px-2 text-xs shrink-0"
            onClick={() => addToCrm(k)}
            disabled={addingEmail !== null}
            data-testid={`button-add-known-${rowKey}`}
          >
            {addingEmail === rowKey ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add to CRM"}
          </Button>
        ) : null}
      </div>
    );
  };
  const aiNotes = aiCheck.check ? aiCheck.check.summary.length + aiCheck.check.missing.length + aiCheck.check.flags.length : 0;

  return (
    <Card data-testid={`company-contacts-board-${companyId}`}>
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
        {/* "6 of 33" — how many of the company's people this shows (Woody, 2026-09-28). */}
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Users className="w-3.5 h-3.5" /> Key contacts
          {totalPeople > 0 && <span className="font-mono tabular-nums normal-case tracking-normal" data-testid="key-contacts-count">· {top.length === totalPeople ? totalPeople : `${top.length} of ${totalPeople}`}</span>}
        </CardTitle>
        {!kcIsClient && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => rescan()}
          disabled={scanning}
          className="min-h-11 md:min-h-0 md:h-7 px-2 text-xs text-muted-foreground shrink-0"
          data-testid="contact-cascade-refresh"
          title="Refresh contact discovery"
        >
          {scanning ? <><Loader2 className="w-3 h-3 animate-spin" /> Scanning…</> : <><RefreshCw className="w-3 h-3" /> Refresh</>}
        </Button>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0 [container-type:inline-size]">
        {topSlot}
        {accountMode && (employerOptions.length > 0 || propertyOptions.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {employerOptions.length > 0 && (
              <select
                value={employerFilter}
                onChange={e => setEmployerFilter(e.target.value)}
                className="h-7 text-[11px] rounded border border-border bg-background px-1.5"
                aria-label="Filter by employer"
                data-testid="account-contacts-filter-employer"
              >
                <option value="">All employers</option>
                {employerOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {propertyOptions.length > 0 && (
              <select
                value={propertyFilter}
                onChange={e => setPropertyFilter(e.target.value)}
                className="h-7 text-[11px] rounded border border-border bg-background px-1.5"
                aria-label="Filter by property"
                data-testid="account-contacts-filter-property"
              >
                <option value="">All properties</option>
                {propertyOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            <input
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              placeholder="Role…"
              className="h-7 text-[11px] rounded border border-border bg-background px-1.5 w-24"
              aria-label="Filter by role"
              data-testid="account-contacts-filter-role"
            />
            {accountFiltersActive && (
              <button
                onClick={() => { setEmployerFilter(""); setPropertyFilter(""); setRoleFilter(""); }}
                className="h-7 text-[11px] text-muted-foreground hover:text-foreground px-1"
              >
                Clear
              </button>
            )}
          </div>
        )}
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            {scanning
              ? "Mining BGP email, searching RocketReach + Apollo, AI-checking every candidate — 20-40s on first open…"
              : totalPeople === 0
                ? "No contacts yet — Refresh runs discovery again."
                : "No current key people — Show all below."}
          </p>
        ) : (
          <div className="space-y-0.5" data-testid="key-contacts-top">
            {top.map(renderItem)}
          </div>
        )}
        {/* One toggle for everything that isn't a key person: the rest of
            the ranked list, then leavers / placeholders / the long-silent
            greyed at the end, the discovery summary and the inbox senders
            (Woody, 2026-09-28). */}
        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAll(v => !v)}
            className={`${pillMetrics} ${pillInactive} mt-2`}
            data-testid="key-contacts-show-all"
          >
            {showAll ? "Show fewer" : moreCount > 0 ? `Show all ${totalPeople}` : `Show ${inboxSenders.length} from BGP inboxes`}
          </button>
        )}
        {showAll && (
          <>
            {rest.length > 0 && <div className="space-y-0.5 mt-2" data-testid="key-contacts-rest">{rest.map(renderItem)}</div>}
            {retired.length > 0 && (
              <div className="mt-2 pt-1.5 border-t border-border/40" data-testid="key-contacts-retired">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Left or inactive <span className="font-mono tabular-nums">{retired.length}</span></div>
                <div className="space-y-0.5">{retired.map(renderItem)}</div>
              </div>
            )}
            {summary && !kcIsClient && (
              <p className="text-[11px] text-muted-foreground mt-1.5">
                {allContacts.length} in CRM{crmAiChecked > 0 ? ` (${crmAiChecked} AI-verified)` : ""}
                {discovered.length > 0 ? ` · ${discovered.length} new discovered` : " · no new contacts found"}
                {summary.revealed ? ` · ${summary.revealed} emails revealed` : ""}
                {scanning ? " · rescanning…" : ""}
              </p>
            )}
            <PendingSendersList suggestions={inboxSenders} companyId={companyId} />
          </>
        )}
        {/* The AI's notes on the list are working notes ("Adrian's email
            domain is unusual…") — folded behind one line, open on click
            (Woody, 2026-09-27); below the people, it's secondary
            (Woody, 2026-09-28). Nothing shows while it runs. */}
        {aiCheck.check && aiNotes > 0 && (
          <details className="rounded-md border border-border bg-muted/30 px-2 py-1 mt-2" data-testid="key-contacts-ai-check">
            <summary className="text-[11px] font-medium text-muted-foreground cursor-pointer">AI check · {aiNotes} note{aiNotes === 1 ? "" : "s"}</summary>
            <ul className="text-xs space-y-0.5 list-disc pl-4 mt-1">{aiCheck.check.summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
            {aiCheck.check.flags.length > 0 && (
              <ul className="text-xs space-y-0.5 pl-1 mt-1" data-testid="key-contacts-ai-flags">
                {aiCheck.check.flags.map((f, i) => {
                  const who = (contacts || []).find((ct: any) => String(ct.id) === f.contactId)?.name;
                  return (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
                      <span><span className="font-medium">{who || "Contact"}</span> <span className="text-amber-700 dark:text-amber-400">{AI_FLAG_LABELS[f.issue] || "Check"}</span> {f.note}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {aiCheck.check.missing.length > 0 && (
              <p className="text-[11px] text-muted-foreground mt-1">Not saved: {aiCheck.check.missing.map(m => `${m.email} (${m.note})`).join(" · ")}</p>
            )}
          </details>
        )}
        {extraSections.filter(s => s.rows.length > 0).map(s => {
          const isOpen = openSections[s.key] ?? false;
          return (
            <div key={s.key} className="mt-2 pt-1.5 border-t border-border/40">
              <button
                onClick={() => setOpenSections(prev => ({ ...prev, [s.key]: !isOpen }))}
                className={`w-full flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold py-1 rounded hover:bg-muted/50 transition-colors ${s.tint || "text-muted-foreground"}`}
                data-testid={`toggle-contacts-section-${s.key}`}
              >
                {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                <span className="text-left flex-1">{s.title}</span>
                <span className="text-[11px] font-mono tabular-nums">{s.rows.length}</span>
              </button>
              {isOpen && (
                <div className="space-y-0.5 max-h-[220px] overflow-y-auto pr-1 mt-1">
                  {s.rows.map((row: any) => (
                    <KeyContactRow key={row.id} contact={row} companyId={companyId} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
