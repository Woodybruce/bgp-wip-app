// Team view on the landlord page — the investment, tenant rep and lease
// advisory teams' read of one landlord, each linked into that team's own
// tracker (Woody, 2026-09-26). Leasing keeps the Portfolio and Deals boards
// above. Staff only; opens on the viewer's own team.
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useTeam } from "@/lib/team-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { ArrowUpRight, CalendarClock, Loader2, Plus, Users } from "lucide-react";
import { AGENT_ROLES } from "@shared/agent-roles";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";

type Tab = "investment" | "tenantRep" | "leaseAdvisory" | "agents";

const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtMonth = (d: any) => d ? new Date(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "—";
const money = (v: any) => {
  const n = Number(v);
  if (!n) return null;
  return n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}m` : `£${Math.round(n / 1000)}k`;
};
const MATTER_LABEL: Record<string, string> = { rent_review: "Rent review", lease_renewal: "Lease renewal", dilapidations: "Dilapidations", service_charge: "Service charge", general: "General" };

function Section({ title, count, link, linkLabel, children, empty }: { title: string; count?: number; link?: string; linkLabel?: string; children?: React.ReactNode; empty?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          {title}{count != null && <Badge variant="outline" className="text-[9px] tabular-nums">{count}</Badge>}
        </span>
        {link && <Link href={link} className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5">{linkLabel || "Open"}<ArrowUpRight className="w-3 h-3" /></Link>}
      </div>
      {children || (empty && <p className="text-xs text-muted-foreground italic">{empty}</p>)}
    </div>
  );
}

function Row({ href, title, sub, right }: { href?: string; title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode }) {
  const body = (
    <div className="flex items-center justify-between gap-2 min-w-0 rounded border bg-card px-2 py-1.5 hover:bg-muted/40">
      <div className="min-w-0">
        <div className="text-xs font-medium truncate">{title}</div>
        {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
      </div>
      {right && <div className="flex items-center gap-1 shrink-0">{right}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function AccountTeamViewsCard({ companyId }: { companyId: string }) {
  const { activeTeam, userTeam } = useTeam();
  const team = (activeTeam && activeTeam !== "all" ? activeTeam : userTeam) || "";
  const [tab, setTab] = useState<Tab>(team === "Tenant Rep" ? "tenantRep" : team === "Lease Advisory" ? "leaseAdvisory" : "investment");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/accounts", companyId, "teams"],
    queryFn: async () => {
      const r = await fetch(`/api/accounts/${companyId}/teams`, { credentials: "include", headers: getAuthHeaders() });
      if (r.status === 403) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const track = useMutation({
    mutationFn: async (ev: any) => (await apiRequest("POST", "/api/lease-events", {
      propertyId: ev.propertyId, address: ev.propertyName, landlord: data?.landlordName, tenant: ev.tenant,
      unitRef: ev.unit, eventType: ev.type, eventDate: ev.date, status: "Monitoring", sourceEvidence: "Landlord page",
    })).json(),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/accounts", companyId, "teams"] }); toast({ title: "Added to Lease events" }); },
    onError: (e: any) => toast({ title: "Couldn't track that event", description: e?.message, variant: "destructive" }),
  });

  if (data === null) return null;
  const inv = data?.investment, tr = data?.tenantRep, la = data?.leaseAdvisory;
  const f = inv?.flags || {};
  const CLOSED = /^(WIT|Withdrawn|COM|Completed|INV|Invoiced|Lost)$/i;
  const byLive = (a: any, b: any) => Number(CLOSED.test(a.status || "")) - Number(CLOSED.test(b.status || ""));
  const sales = (inv?.tracker || []).filter((t: any) => t.side === "selling").sort(byLive);
  const purchases = (inv?.tracker || []).filter((t: any) => t.side !== "selling").sort(byLive);
  // Every status code reads as words — "AVA"/"LIVE" leaked raw (Woody, 2026-09-27)
  const statusLabel = (st: string) => { const c = legacyToCode(st); return c ? DEAL_STATUS_LABELS[c] : st; };
  const list = (v: any) => Array.isArray(v) ? v.join(", ") : String(v || "").replace(/^\{|\}$/g, "").replace(/"/g, "").split(",").join(", ");
  const spaceWithFits = (tr?.space || []).filter((u: any) => u.fits.length > 0);
  const events: any[] = la?.events || [];
  const forSale = new Set<string>(data?.forSalePropertyIds || []);
  const saleBadge = (propertyId: string) => forSale.has(propertyId) ? <Badge className="text-[9px] bg-amber-50 text-amber-800 border-amber-200" title="On BGP's Sales board">for sale</Badge> : null;
  const shownEvents = showAllEvents ? events : events.slice(0, 10);

  return (
    <Card data-testid="account-team-views">
      <CardHeader className="p-3 pb-2 space-y-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Users className="w-3.5 h-3.5" /> Team view
          {data && data.portfolioCount > 0 && <span className="normal-case tracking-normal font-normal">across {data.portfolioCount} propert{data.portfolioCount === 1 ? "y" : "ies"}</span>}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          <Pill active={tab === "investment"} onClick={() => setTab("investment")} data-testid="team-tab-investment">Investment</Pill>
          <Pill active={tab === "tenantRep"} onClick={() => setTab("tenantRep")} data-testid="team-tab-tenant-rep">Tenant rep</Pill>
          <Pill active={tab === "agents"} onClick={() => setTab("agents")} data-testid="team-tab-agents">Agents{data?.agents?.length ? ` · ${data.agents.length}` : ""}</Pill>
          <Pill active={tab === "leaseAdvisory"} onClick={() => setTab("leaseAdvisory")} data-testid="team-tab-lease-advisory">Lease advisory{events.length ? ` · ${la.eventsTotal > events.length ? `${events.length}+` : events.length}` : ""}</Pill>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading && <p className="text-sm text-muted-foreground italic flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Gathering the teams' view…</p>}
        {error && <p className="text-sm text-muted-foreground italic">Couldn't load the team view — try again.</p>}

        {data && tab === "investment" && (
          <div className="grid gap-4 md:grid-cols-2" data-testid="team-view-investment">
            <div className="space-y-4">
              {(f.disposing_now || f.acquiring_now || f.distress_flag || f.investment_hunter_flag) && (
                <div className="flex flex-wrap gap-1.5">
                  {f.disposing_now && <Badge className="bg-amber-50 text-amber-800 border-amber-200" title={f.disposing_now_notes || ""}>Disposing now{f.disposing_now_notes ? ` — ${String(f.disposing_now_notes).slice(0, 60)}` : ""}</Badge>}
                  {f.acquiring_now && <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200" title={f.acquiring_now_notes || ""}>Acquiring now</Badge>}
                  {f.distress_flag && <Badge className="bg-rose-50 text-rose-800 border-rose-200" title={f.distress_notes || ""}>Distress signal</Badge>}
                  {f.investment_hunter_flag && <Badge variant="outline" title={f.investment_hunter_notes || ""}>Investment hunter pick</Badge>}
                </div>
              )}
              <Section title="Selling — on BGP's investment boards" count={sales.length} link="/investment-tracker" linkLabel="Investment tracker" empty="Nothing they're selling on BGP's investment boards.">
                {sales.length > 0 && <div className="space-y-1">{sales.slice(0, 6).map((t: any) => (
                  <Row key={t.id} href={t.deal_id ? `/deals/${t.deal_id}` : "/investment-tracker"} title={<span className={CLOSED.test(t.status || "") ? "text-muted-foreground" : ""}>{t.asset_name}</span>} sub={[statusLabel(t.status), t.board_type === "Purchases" && t.client && `BGP buying for ${t.client}`, t.bid_deadline && `bids ${t.bid_deadline}`].filter(Boolean).join(" · ")}
                    right={<>{money(t.guide_price) && <span className="text-[10px] tabular-nums">{money(t.guide_price)}</span>}{t.niy ? <span className="text-[10px] text-muted-foreground tabular-nums">{Number(t.niy).toFixed(2)}% NIY</span> : null}</>} />
                ))}</div>}
              </Section>
              <Section title="Might sell — flagged in the portfolio" count={inv.salesCandidates.length} empty="No properties marked for sale or investment work.">
                {inv.salesCandidates.length > 0 && <div className="space-y-1">{inv.salesCandidates.slice(0, 6).map((p: any) => (
                  <Row key={p.id} href={`/properties/${p.id}`} title={p.name} sub={[p.status && statusLabel(p.status), list(p.asset_class)].filter(Boolean).join(" · ")} />
                ))}</div>}
              </Section>
              {inv.debtEvents.length > 0 && (
                <Section title="Debt & capital events" count={inv.debtEvents.length}>
                  <div className="space-y-1">{inv.debtEvents.slice(0, 5).map((e: any) => (
                    <Row key={e.id} href={e.property_id ? `/properties/${e.property_id}` : undefined} title={`${e.event_type}${e.property_name ? ` · ${e.property_name}` : ""}`} sub={[e.lender, money(e.amount), e.notes].filter(Boolean).join(" · ")} right={<span className="text-[10px] text-muted-foreground">{fmtDate(e.event_date)}</span>} />
                  ))}</div>
                </Section>
              )}
            </div>
            <div className="space-y-4">
              <Section title="Buying — investment requirements" count={inv.requirements.length} link="/requirements?type=investment" linkLabel="Requirements" empty="No investment requirements recorded.">
                {inv.requirements.length > 0 && <div className="space-y-1">{inv.requirements.slice(0, 6).map((r: any) => (
                  <Row key={r.id} href="/requirements?type=investment" title={r.name} sub={[(r.use_types || []).join(", "), (r.size_range || []).join(", "), (r.requirement_locations || []).join(", ")].filter(Boolean).join(" · ")} right={r.status && <Badge variant="outline" className="text-[9px]">{r.status}</Badge>} />
                ))}</div>}
                {(f.mandate_asset_class || f.mandate_lot_size_min || f.mandate_lot_size_max) && (
                  <p className="text-[11px] text-muted-foreground">Mandate: {[f.mandate_asset_class, (f.mandate_lot_size_min || f.mandate_lot_size_max) && `${money(f.mandate_lot_size_min) || "—"}–${money(f.mandate_lot_size_max) || "—"} lots`, (f.mandate_geographies || []).join?.(", ")].filter(Boolean).join(" · ")}</p>
                )}
              </Section>
              <Section title="Buying — on BGP's investment boards" count={purchases.length} link="/investment-tracker" linkLabel="Investment tracker" empty="Nothing they're buying on BGP's investment boards.">
                {purchases.length > 0 && <div className="space-y-1">{purchases.slice(0, 5).map((t: any) => (
                  <Row key={t.id} href={t.deal_id ? `/deals/${t.deal_id}` : "/investment-tracker"} title={<span className={CLOSED.test(t.status || "") ? "text-muted-foreground" : ""}>{t.asset_name}</span>} sub={[statusLabel(t.status), t.vendor && `vendor ${t.vendor}`].filter(Boolean).join(" · ")} right={money(t.guide_price) && <span className="text-[10px] tabular-nums">{money(t.guide_price)}</span>} />
                ))}</div>}
              </Section>
              {(inv.sentToThem?.length > 0 || inv.theirBids?.length > 0 || inv.theirViewings?.length > 0) && (
                <Section title="Sent to them / viewings / bids" count={(inv.sentToThem?.length || 0) + (inv.theirBids?.length || 0) + (inv.theirViewings?.length || 0)} link="/investment-tracker" linkLabel="Investment tracker">
                  <div className="space-y-1">
                    {(inv.theirViewings || []).slice(0, 5).map((v: any) => (
                      <Row key={`v-${v.id}`} href={v.deal_id ? `/deals/${v.deal_id}` : "/investment-tracker"} title={v.asset_name} sub={["Viewed", fmtDate(v.viewing_date), v.contact, v.outcome].filter(Boolean).join(" · ")} />
                    ))}
                    {inv.theirBids.slice(0, 5).map((o: any) => (
                      <Row key={`b-${o.id}`} href={o.deal_id ? `/deals/${o.deal_id}` : "/investment-tracker"} title={o.asset_name} sub={["Bid", o.status && statusLabel(o.status), fmtDate(o.offer_date)].filter(Boolean).join(" · ")} right={money(o.offer_price) && <span className="text-[10px] tabular-nums">{money(o.offer_price)}</span>} />
                    ))}
                    {inv.sentToThem.slice(0, 5).map((d: any) => (
                      <Row key={`s-${d.id}`} href={d.deal_id ? `/deals/${d.deal_id}` : "/investment-tracker"} title={d.asset_name} sub={["Sent particulars", fmtDate(d.sent_date), d.response].filter(Boolean).join(" · ")} />
                    ))}
                  </div>
                </Section>
              )}
              <Section title="Investment comps" count={inv.comps.length} link="/investment-comps" linkLabel="Comps" empty="No recorded trades as buyer or seller.">
                {inv.comps.length > 0 && <div className="space-y-1">{inv.comps.slice(0, 5).map((c: any) => (
                  <Row key={c.id} href={c.property_id ? `/properties/${c.property_id}` : "/investment-comps"} title={c.property_name || "Trade"} sub={[c.side === "sold" ? "Sold" : "Bought", c.city, c.cap_rate && `${(Number(c.cap_rate) < 1 ? Number(c.cap_rate) * 100 : Number(c.cap_rate)).toFixed(2)}%`].filter(Boolean).join(" · ")} right={<><span className="text-[10px] tabular-nums">{money(c.price)}</span><span className="text-[10px] text-muted-foreground">{fmtMonth(c.transaction_date)}</span></>} />
                ))}</div>}
              </Section>
            </div>
          </div>
        )}

        {data && tab === "tenantRep" && (
          <div className="grid gap-4 md:grid-cols-2" data-testid="team-view-tenant-rep">
            <Section title="Space on their schemes that fits a brand's requirement" count={spaceWithFits.length} link="/requirements?type=leasing" linkLabel={`Requirements · ${tr.liveRequirements} live`}
              empty={tr.space.length ? `${tr.space.length} vacant or marketing units — none fits a live requirement's size with a matching use or location.` : "No vacant or marketing units on their schemes."}>
              {spaceWithFits.length > 0 && <div className="space-y-1">{spaceWithFits.slice(0, 10).map((u: any) => (
                <Row key={`${u.kind}-${u.id}`} href={u.kind === "marketing" ? `/available?propertyId=${u.propertyId}&unitId=${u.id}` : `/leasing-schedule/${u.propertyId}`}
                  title={`${u.propertyName}${u.unitName ? ` · ${u.unitName}` : ""}`}
                  sub={<>Fits: {u.fits.map((s: any, i: number) => <span key={s.requirementId}>{i > 0 && ", "}{s.bgpClient ? <strong className="text-foreground" title="BGP acts for this brand">{s.name} ★</strong> : s.name}</span>)}{u.fitCount > u.fits.length ? ` +${u.fitCount - u.fits.length}` : ""}</>}
                  right={<>{saleBadge(u.propertyId)}{u.sqft ? <span className="text-[10px] tabular-nums">{Number(u.sqft).toLocaleString()} sq ft</span> : null}{u.status && <Badge variant="outline" className="text-[9px]">{statusLabel(u.status)}</Badge>}</>} />
              ))}</div>}
            </Section>
            <div className="space-y-4">
              <Section title="Other vacant / marketing space" count={tr.space.length - spaceWithFits.length} link="/available" linkLabel="Letting tracker">
                {tr.space.length - spaceWithFits.length > 0 && <div className="space-y-1">{tr.space.filter((u: any) => !u.fits.length).slice(0, 6).map((u: any) => (
                  <Row key={`${u.kind}-${u.id}`} href={u.kind === "marketing" ? `/available?propertyId=${u.propertyId}&unitId=${u.id}` : `/leasing-schedule/${u.propertyId}`}
                    title={`${u.propertyName}${u.unitName ? ` · ${u.unitName}` : ""}`} right={<>{u.sqft ? <span className="text-[10px] tabular-nums">{Number(u.sqft).toLocaleString()} sq ft</span> : null}{u.status && <Badge variant="outline" className="text-[9px]">{statusLabel(u.status)}</Badge>}</>} />
                ))}</div>}
              </Section>
              <p className="text-[11px] text-muted-foreground">★ BGP acts for the brand (a live tenant rep deal or search) — <Link href="/tenant-rep" className="text-primary hover:underline">Tenant rep board</Link></p>
              <Section title="BGP acting for tenants here" count={tr.deals.length} link="/deals/list?team=Tenant%20Rep" linkLabel="Tenant rep deals" empty="No live tenant rep deals on their schemes.">
                {tr.deals.length > 0 && <div className="space-y-1">{tr.deals.slice(0, 6).map((d: any) => (
                  <Row key={d.id} href={`/deals/${d.id}`} title={d.tenant_name || d.name} sub={[d.property_name, d.deal_type].filter(Boolean).join(" · ")} right={d.status && <Badge variant="outline" className="text-[9px]">{statusLabel(d.status)}</Badge>} />
                ))}</div>}
              </Section>
            </div>
          </div>
        )}

        {data && tab === "agents" && (
          <div data-testid="team-view-agents">
            <Section title="Agents across their estate" count={data.agents.length} link="/contacts" linkLabel="CRM · Agents tab" empty="No agents recorded against their properties, deals or account.">
              {data.agents.length > 0 && <div className="grid gap-1 md:grid-cols-2">{data.agents.slice(0, 20).map((a: any) => (
                <Row key={a.firmId} href={`/companies/${a.firmId}`} title={a.name}
                  sub={[
                    a.represents.length ? `Acts for them: ${a.represents.join(", ")}` : null,
                    a.competing.length ? `Instructed on ${a.competing.slice(0, 2).join(", ")}${a.competing.length > 2 ? ` +${a.competing.length - 2}` : ""}` : null,
                    a.deals ? `${a.deals} deal${a.deals === 1 ? "" : "s"} here${a.openDeals ? `, ${a.openDeals} live` : ""}` : null,
                    a.viewings ? `brought ${a.viewings} viewing${a.viewings === 1 ? "" : "s"}` : null,
                  ].filter(Boolean).join(" · ")}
                  right={<>{Object.keys(a.roles).slice(0, 2).map(r => <Badge key={r} variant="outline" className="text-[9px]">{AGENT_ROLES.find(x => x.role === r)?.short || r}</Badge>)}</>} />
              ))}</div>}
            </Section>
          </div>
        )}

        {data && tab === "leaseAdvisory" && (
          <div className="grid gap-4 md:grid-cols-2" data-testid="team-view-lease-advisory">
            <Section title={`Lease events — next ${18} months`} count={la?.eventsTotal ?? events.length} link="/lease-events" linkLabel="Lease events tracker" empty="No expiries, breaks or reviews on file for their schemes.">
              {events.length > 0 && <div className="space-y-1">
                {shownEvents.map((e: any, i: number) => (
                  <Row key={`${e.propertyId}-${e.unit}-${e.type}-${e.date}-${i}`} href={e.matterId ? `/pla/matters/${e.matterId}` : undefined}
                    title={<span className="flex items-center gap-1.5"><CalendarClock className="w-3 h-3 text-amber-600 shrink-0" />{e.type} · {fmtMonth(e.date)}</span>}
                    sub={[e.propertyName, e.unit, e.tenant].filter(Boolean).join(" · ")}
                    right={<>{saleBadge(e.propertyId)}{e.trackedId
                      ? <Link href="/lease-events" className="text-[10px] text-emerald-700 hover:underline">{e.trackedStatus || "Tracked"}</Link>
                      : <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" disabled={track.isPending} onClick={(ev) => { ev.preventDefault(); track.mutate(e); }} data-testid="button-track-lease-event"><Plus className="w-3 h-3" />Track</Button>}</>} />
                ))}
                {events.length > 10 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAllEvents(v => !v)}>{showAllEvents ? "Show fewer" : `Show all ${events.length}`}</Button>}
              </div>}
            </Section>
            <Section title="Live lease advisory matters" count={la.matters.length} link="/pla/matters" linkLabel="Lease advisory jobs" empty="No live matters on their schemes.">
              {la.matters.length > 0 && <div className="space-y-1">{la.matters.map((m: any) => (
                <Row key={m.id} href={`/pla/matters/${m.id}`} title={`${MATTER_LABEL[m.matter_type] || m.matter_type}${m.property_name ? ` · ${m.property_name}` : ""}`}
                  sub={[m.acting_for && `acting for ${m.acting_for}`, m.lead_name, m.expiry_date && `expiry ${fmtMonth(m.expiry_date)}`].filter(Boolean).join(" · ")}
                  right={<Badge variant="outline" className="text-[9px]">{m.status}</Badge>} />
              ))}</div>}
            </Section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

