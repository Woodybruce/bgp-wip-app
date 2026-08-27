// The canonical contacts board — ONE structure for every surface that
// shows a company's people (brand profile, landlord profile, dashboard
// widget), per Woody 2026-08-04: "we get happy with one structure and then
// we roll it across the app". CRM contacts + the discovery cascade merged
// and deduped, provenance/AI badges on the right, optional extra grouped
// sections for surfaces that add related people (deal brands, agents).
import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, Mail, Linkedin, Loader2, RefreshCw, Plus, ChevronDown, ChevronRight, Phone } from "lucide-react";

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

export function KeyContactRow({ contact, companyId, discovery }: { contact: any; companyId: string; discovery?: any }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
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

  const hasEmail = !!contact.email;
  const hasLinkedin = !!contact.linkedin_url;
  const hasPhone = !!contact.phone;
  const touches: number = contact.interaction_count || 0;
  const lastTouch: string | null = contact.last_interaction_at || null;
  const lastTouchLabel = lastTouch ? formatRelativeShort(lastTouch) : null;

  return (
    <div className="flex items-start gap-2.5 md:gap-2 text-xs hover:bg-muted/50 rounded p-1.5 md:p-1 -mx-1 transition-colors">
      <Link href={`/contacts/${contact.id}`} className="w-9 h-9 md:w-6 md:h-6 rounded-full bg-muted flex items-center justify-center text-[10px] md:text-[9px] font-medium shrink-0 overflow-hidden">
        {contact.avatar_url ? <img src={contact.avatar_url} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.style.display = "none"); }} /> : (contact.name?.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase() || "?")}
      </Link>
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate flex items-center gap-1 text-[13px] md:text-xs">
          <Link href={`/contacts/${contact.id}`} className="hover:underline">{contact.name}</Link>
          {discovery?.bgp?.threadCount ? (
            <span className="text-[9px] px-1 py-0 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 shrink-0" title="BGP has real email history with this person">
              known · {discovery.bgp.threadCount} threads
            </span>
          ) : discovery?.ai?.confidence != null ? (
            <span className="text-[9px] px-1 py-0 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800 shrink-0 tabular-nums" title={discovery.ai?.reason || "AI-verified against RocketReach/Apollo"}>
              AI {discovery.ai.confidence}
            </span>
          ) : null}
          {touches > 0 && (
            <span
              className="ml-auto text-[9px] px-1 py-0 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 shrink-0"
              title={lastTouch ? `${touches} touch${touches === 1 ? "" : "es"} · last ${new Date(lastTouch).toLocaleDateString("en-GB")}` : `${touches} touches`}
            >
              {touches}{lastTouchLabel ? ` · ${lastTouchLabel}` : ""}
            </span>
          )}
        </div>
        {editingRole ? (
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
            className="text-[10px] w-full border rounded px-1 py-0.5 bg-background"
            placeholder="e.g. Head of Leasing"
          />
        ) : (
          <button
            onClick={() => setEditingRole(true)}
            className="text-[11px] text-left truncate w-full text-muted-foreground hover:text-foreground hover:underline decoration-dotted"
            title="Click to edit role"
          >
            {contact.role || <span className="italic text-muted-foreground/70">add role…</span>}
          </button>
        )}
      </div>
      {/* Tap actions — call / email / LinkedIn, same anatomy as the brand
          search results (Woody, 2026-08-25: "easily click and call or
          email"). rounded-full exemption applies (docs/DESIGN.md §3). */}
      {(hasPhone || hasEmail || hasLinkedin) && (
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          {hasPhone && (
            <a href={`tel:${String(contact.phone).replace(/[^\d+]/g, "")}`} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-muted" aria-label={`Call ${contact.name}`} onClick={(e) => e.stopPropagation()}>
              <Phone className="w-3.5 h-3.5" />
            </a>
          )}
          {hasEmail && (
            <a href={`mailto:${contact.email}`} className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-muted" aria-label={`Email ${contact.name}`} onClick={(e) => e.stopPropagation()}>
              <Mail className="w-3.5 h-3.5" />
            </a>
          )}
          {hasLinkedin && (
            <a href={contact.linkedin_url} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-muted" aria-label={`${contact.name} on LinkedIn`} onClick={(e) => e.stopPropagation()}>
              <Linkedin className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function PendingSendersList({ suggestions, companyId }: { suggestions: any[]; companyId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: psViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const psIsClient = !psViewer || psViewer.role === "Client" || !!psViewer.companyScopeId;
  
  const promote = useMutation({
    mutationFn: async (email: string) => {
      const res = await apiRequest("POST", `/api/brand/${companyId}/promote-sender`, { email });
      return res.json();
    },
    onSuccess: (out: any, email: any) => {
      toast({ title: "Contact added", description: `${out.name} (${email}) is now a CRM contact.` });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
    },
    onError: (e: any) => toast({ title: "Couldn't add contact", description: e?.message, variant: "destructive" }),
  });
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-3 pt-2 border-t border-border/40">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
        From BGP inboxes ({suggestions.length} not in CRM)
      </div>
      <div className="space-y-0.5 max-h-[180px] overflow-y-auto pr-1">
        {suggestions.map((s) => (
          <div key={s.email} className="flex items-center gap-1.5 text-[11px] px-1 py-1 rounded hover:bg-muted/50">
            <Mail className="w-2.5 h-2.5 text-muted-foreground shrink-0" />
            <span className="truncate flex-1 font-mono text-[10px]">{s.email}</span>
            <span className="text-[9px] text-muted-foreground shrink-0">{s.touches}{s.last_touch ? ` · ${formatRelativeShort(s.last_touch)}` : ""}</span>
            {!psIsClient && (
            <button
              onClick={() => promote.mutate(s.email)}
              disabled={promote.isPending}
              className="text-[10px] px-1.5 py-0.5 rounded border bg-card hover:bg-muted disabled:opacity-50 shrink-0"
              title="Create a CRM contact for this email and link to this company"
            >
              <Plus className="w-2.5 h-2.5 inline" /> Add
            </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompanyContactsBoard({ companyId, companyName, contacts, pendingSenders = [], extraSections = [], discovery = true, filterPropertyTier = true }: {
  companyId: string;
  companyName: string;
  contacts: any[];
  pendingSenders?: any[];
  // Additional grouped sections (e.g. the dashboard's "Brands on your deals"
  // and "Agents") rendered under the main list with the same row design.
  extraSections?: Array<{ key: string; title: string; tint?: string; rows: any[] }>;
  // The discovery cascade burns provider credits — surfaces that just want
  // the list (dashboard widget) turn it off.
  discovery?: boolean;
  filterPropertyTier?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: kcViewer } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const kcIsClient = !kcViewer || kcViewer.role === "Client" || !!kcViewer.companyScopeId;
  const [showAll, setShowAll] = useState(false);
  const [addedEmails, setAddedEmails] = useState<Set<string>>(new Set());
  const [addingEmail, setAddingEmail] = useState<string | null>(null);
  // Extra sections are collapsed to headers by default — their titles and
  // counts are visible right under the main list instead of a full page of
  // scrolling (Woody, 2026-08-05: "can we have headers instead?").
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  

  // Property-relevant roles only by default. Most of what RocketReach imports
  // is C-suite + store-dev — but historical Apollo data has store managers,
  // baristas, anyone. We filter to property-relevant titles so the panel is
  // useful for "who do I pitch this unit to". User can click 'Show all'.
  const isPropertyTier = (role: string | null | undefined): boolean => {
    if (!role) return false;
    const r = role.toLowerCase();
    return /(property|real estate|acquisition|expansion|portfolio|estates|store dev|store development|store opening|locations|sites)/.test(r)
      || /(founder|ceo|coo|cfo|cmo|managing director|chief executive|chief operating|chief financial|chief marketing|md\b)/.test(r);
  };

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
  const allContacts = contacts || [];
  const normEmail = (e: any) => String(e || "").toLowerCase().trim();
  const normName = (n: any) => String(n || "").toLowerCase().replace(/\s+/g, " ").trim();
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
    .filter((k: any) => k.ai?.verdict !== "drop" && !k.bgp?.inCrm)
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
  const tierEmpty = allContacts.every((c: any) => !isPropertyTier(c.role)) && discovered.every((k: any) => !isPropertyTier(k.title));
  const effectiveShowAll = showAll || (tierEmpty && allContacts.length + discovered.length <= 5);
  const crmVisible = effectiveShowAll || !filterPropertyTier ? allContacts : allContacts.filter((c: any) => isPropertyTier(c.role));
  const discoveredVisible = effectiveShowAll || !filterPropertyTier ? discovered : discovered.filter((k: any) => isPropertyTier(k.title));
  const hiddenCount = (allContacts.length - crmVisible.length) + (discovered.length - discoveredVisible.length);
  const summary = cascade?.summary;

  const addToCrm = async (k: any) => {
    const rowKey = normEmail(k.email) || normName(k.name);
    setAddingEmail(rowKey);
    try {
      await apiRequest("POST", "/api/crm/contacts", {
        name: k.name || (k.email ? k.email.split("@")[0].replace(/\./g, " ").replace(/\b\w/g, (ch: string) => ch.toUpperCase()) : "Unknown"),
        email: k.email || undefined,
        phone: k.phone || k.mobile || undefined,
        role: k.title || undefined,
        companyId,
        companyName,
      });
      setAddedEmails((prev) => new Set(prev).add(rowKey));
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      toast({ title: `${k.name || k.email} added to CRM`, description: `Linked to ${companyName}` });
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
    if (k.bgp?.threadCount) return { label: `known · ${k.bgp.threadCount} threads`, cls: "text-emerald-700 border-emerald-200" };
    if (k.sources?.includes("rocketreach")) return { label: "RocketReach", cls: "text-blue-700 border-blue-200" };
    if (k.sources?.includes("apollo")) return { label: "Apollo", cls: "text-violet-700 border-violet-200" };
    return { label: k.sources?.[0] || "discovered", cls: "" };
  };

  return (
    <Card>
      <CardHeader className="p-3 pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Users className="w-3.5 h-3.5" /> Key contacts
          <Badge variant="outline" className="text-[10px]">{crmVisible.length + discoveredVisible.length}{hiddenCount > 0 ? ` / ${allContacts.length + discovered.length}` : ""}</Badge>
        </CardTitle>
        {!kcIsClient && (
        <button
          onClick={() => rescan()}
          disabled={scanning}
          className="text-[10px] px-2 py-0.5 rounded border bg-card hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1"
          title="Refresh — runs the contact discovery engine again (BGP email + RocketReach + Apollo + AI check)"
        >
          {scanning ? <><Loader2 className="w-3 h-3 animate-spin" /> Scanning…</> : <><RefreshCw className="w-3 h-3" /> Refresh contacts</>}
        </button>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {crmVisible.length === 0 && discoveredVisible.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            {scanning
              ? "Mining BGP email, searching RocketReach + Apollo, AI-checking every candidate — 20-40s on first open…"
              : allContacts.length + discovered.length === 0
                ? "No contacts yet — Refresh contacts runs discovery again."
                : "No property-tier contacts. Click Show all below."}
          </p>
        ) : (
          <div className="max-h-[340px] overflow-y-auto pr-1 space-y-1.5">
            {crmVisible.map((dm: any) => (
              <KeyContactRow key={dm.id} contact={dm} companyId={companyId} discovery={discoveryFor(dm)} />
            ))}
            {discoveredVisible.map((k: any) => {
              const rowKey = normEmail(k.email) || normName(k.name);
              const added = addedEmails.has(rowKey);
              const conf = k.ai?.confidence;
              const confCls = conf == null ? "" : conf >= 70 ? "text-emerald-700 border-emerald-200" : conf >= 40 ? "text-amber-700 border-amber-200" : "text-red-600 border-red-200";
              const src = provenance(k);
              return (
                <div key={rowKey} className="flex items-start gap-2 text-xs rounded p-1 -mx-1 hover:bg-muted/50 transition-colors">
                  <span className="w-6 h-6 rounded-full bg-muted/70 border border-dashed flex items-center justify-center text-[9px] font-medium shrink-0">
                    {(k.name || k.email || "?").split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{k.name || k.email}</p>
                    <p className="text-[10px] text-muted-foreground truncate" title={k.ai?.reason || ""}>
                      {[k.title, k.email, k.phone || k.mobile].filter(Boolean).join(" · ") || "—"}
                    </p>
                  </div>
                  {conf != null && (
                    <Badge variant="outline" className={`text-[9px] shrink-0 tabular-nums ${confCls}`} title={k.ai?.reason || ""}>{conf}</Badge>
                  )}
                  <Badge variant="outline" className={`text-[9px] shrink-0 ${src.cls}`}>{src.label}</Badge>
                  {added ? (
                    <Badge variant="outline" className="text-[9px] shrink-0 text-emerald-700 border-emerald-200">in CRM</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px] shrink-0"
                      onClick={() => addToCrm(k)}
                      disabled={addingEmail === rowKey}
                      data-testid={`button-add-known-${rowKey}`}
                    >
                      {addingEmail === rowKey ? <Loader2 className="w-3 h-3 animate-spin" /> : "+ Add"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {summary && !kcIsClient && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {allContacts.length} in CRM{crmAiChecked > 0 ? ` (${crmAiChecked} AI-verified)` : ""}
            {discovered.length > 0 ? ` · ${discovered.length} new discovered` : " · no new contacts found"}
            {summary.revealed ? ` · ${summary.revealed} emails revealed` : ""}
            {scanning ? " · rescanning…" : ""}
          </p>
        )}
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="mt-1.5 text-[10px] text-primary hover:underline"
          >
            {showAll ? "Show property-tier only" : `Show all ${allContacts.length + discovered.length} contacts`}
          </button>
        )}
        {extraSections.filter(s => s.rows.length > 0).map(s => {
          const isOpen = openSections[s.key] ?? false;
          return (
            <div key={s.key} className="mt-2 pt-1.5 border-t border-border/40">
              <button
                onClick={() => setOpenSections(prev => ({ ...prev, [s.key]: !isOpen }))}
                className={`w-full flex items-center gap-1.5 text-[10px] uppercase tracking-wide font-semibold py-1 rounded hover:bg-muted/50 transition-colors ${s.tint || "text-muted-foreground"}`}
                data-testid={`toggle-contacts-section-${s.key}`}
              >
                {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                <span className="text-left flex-1">{s.title}</span>
                <Badge variant="outline" className="text-[9px] tabular-nums">{s.rows.length}</Badge>
              </button>
              {isOpen && (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 mt-1">
                  {s.rows.map((row: any) => (
                    <KeyContactRow key={row.id} contact={row} companyId={companyId} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <PendingSendersList suggestions={pendingSenders} companyId={companyId} />
      </CardContent>
    </Card>
  );
}
