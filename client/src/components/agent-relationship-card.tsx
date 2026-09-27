// An agent firm's relationship with BGP, on the agent page (Woody,
// 2026-09-26). The roles they play come from the evidence — who they act
// for, deals by role, requirements sent, instructions they compete for,
// sales, lease advisory as the other side, viewings. Staff only.
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Handshake, Loader2 } from "lucide-react";
import { AGENT_ROLES, type AgentRole } from "@shared/agent-roles";

type Tab = "teams" | "deals" | "requirements" | "instructions" | "sales" | "leaseAdvisory" | "viewings";

const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
const money = (v: any) => { const n = Number(v); if (!n) return null; return n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(1)}m` : `£${Math.round(n / 1000)}k`; };
const list = (v: any) => Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v || "");
const MATTER_LABEL: Record<string, string> = { rent_review: "Rent review", lease_renewal: "Lease renewal", dilapidations: "Dilapidations", service_charge: "Service charge", general: "General" };

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

// Which side of BGP the agent sat on, for a deal row.
function sideLabel(role: AgentRole, bgpActingFor: string | null) {
  if (role === "joint_agent") return "alongside BGP";
  if (role === "letting") return bgpActingFor === "tenant" ? "other side" : "leasing agent";
  if (role === "tenant_rep") return (bgpActingFor || "landlord") === "landlord" ? "brought the tenant" : "tenant side";
  return role === "investment_sell" ? "vendor's agent" : "purchaser's agent";
}

export function AgentRelationshipCard({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/agents", companyId, "relationship"],
    queryFn: async () => {
      const r = await fetch(`/api/agents/${companyId}/relationship`, { credentials: "include", headers: getAuthHeaders() });
      if (r.status === 403) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    staleTime: 5 * 60_000,
  });
  const counts: Record<Tab, number> = {
    teams: (data?.teams || []).filter((g: any) => g.team).length,
    deals: data?.deals?.length || 0,
    requirements: (data?.leasingRequirements?.length || 0) + (data?.investmentRequirements?.length || 0),
    instructions: data?.competing?.length || 0,
    sales: (data?.investment?.sellingFor?.length || 0) + (data?.investment?.bids?.length || 0) + (data?.investment?.sentSales?.length || 0),
    leaseAdvisory: data?.otherSide?.length || 0,
    viewings: data?.viewings?.length || 0,
  };
  // Who they act for is listed (with add / end) in the representation card
  // below, so it isn't repeated here.
  const TABS: Array<[Tab, string]> = [["teams", "Teams"], ["deals", "Deals"], ["requirements", "Requirements"], ["instructions", "Instructions"], ["sales", "Sales"], ["leaseAdvisory", "Lease advisory"], ["viewings", "Viewings"]];
  const shown = TABS.filter(([t]) => counts[t] > 0);
  const [tab, setTab] = useState<Tab | null>(null);
  useEffect(() => { setTab(null); }, [companyId]);
  const active = tab && counts[tab] > 0 ? tab : shown[0]?.[0] || null;

  if (data === null) return null;
  return (
    <Card data-testid="agent-relationship">
      <CardHeader className="p-3 pb-2 space-y-2">
        <CardTitle className="text-[11px] flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
          <Handshake className="w-3.5 h-3.5" /> Relationship with BGP
          {data && <span className="normal-case tracking-normal font-normal">{data.openDeals} live deal{data.openDeals === 1 ? "" : "s"} · {data.people.total} people</span>}
        </CardTitle>
        {data && (
          <div className="flex flex-wrap gap-1.5" data-testid="agent-roles">
            {data.roles.length
              ? data.roles.map((r: any) => {
                  const meta = AGENT_ROLES.find(x => x.role === r.role);
                  return <Badge key={r.role} variant="outline" className="text-[11px] font-normal" title={meta?.description}>{meta?.label || r.role} <span className="ml-1 tabular-nums text-muted-foreground">{r.count}</span></Badge>;
                })
              : <span className="text-xs text-muted-foreground italic">No recorded dealings yet — roles appear as deals, requirements, viewings and matters link to this firm or its people.</span>}
          </div>
        )}
        {shown.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {shown.map(([t, label]) => <Pill key={t} active={active === t} onClick={() => setTab(t)} data-testid={`agent-tab-${t}`}>{label} {counts[t]}</Pill>)}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {isLoading && <p className="text-sm text-muted-foreground italic flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" />Gathering their dealings with BGP…</p>}
        {data && active === "teams" && (
          <div className="grid gap-3 md:grid-cols-2" data-testid="agent-teams">
            {(data.teams || []).map((g: any) => {
              const busy = g.people.filter((p: any) => p.activity > 0);
              const quiet = g.people.length - busy.length;
              return (
                <div key={g.team || "none"} className="space-y-1">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                    {g.team ? `${g.team} team` : "No team set"}<Badge variant="outline" className="text-[9px] tabular-nums">{g.people.length}</Badge>
                  </div>
                  {busy.slice(0, 8).map((p: any) => (
                    <Row key={p.id} href={`/contacts/${p.id}`} title={p.name}
                      sub={[p.title, p.inferred && (p.recordedTeam ? `recorded as ${p.recordedTeam} — their work is ${g.team}` : "team from their work")].filter(Boolean).join(" · ")}
                      right={<>{Object.entries(p.capacities).sort((a: any, b: any) => b[1] - a[1]).slice(0, 2).map(([role, n]: any) => (
                        <Badge key={role} variant="outline" className="text-[9px]">{AGENT_ROLES.find(r => r.role === role)?.short || role} {n}</Badge>
                      ))}</>} />
                  ))}
                  {quiet > 0 && <p className="text-[11px] text-muted-foreground">{busy.length ? `+${quiet} more with no recorded dealings` : `${quiet} people, no recorded dealings yet`}</p>}
                </div>
              );
            })}
          </div>
        )}
        {data && active === "deals" && (
          <div className="space-y-1">{[...data.deals].sort((a: any, b: any) => Number(b.open) - Number(a.open)).map((d: any) => (
            <Row key={`${d.role}-${d.id}`} href={`/deals/${d.id}`} title={d.name}
              sub={[d.roleLabel, sideLabel(d.role, d.bgp_acting_for), d.property_name, d.contact_name].filter(Boolean).join(" · ")}
              right={<Badge variant="outline" className={`text-[9px] ${d.open ? "" : "text-muted-foreground"}`}>{d.status}</Badge>} />
          ))}</div>
        )}
        {data && active === "requirements" && (
          <div className="space-y-1">
            {data.leasingRequirements.map((r: any) => (
              <Row key={`l-${r.id}`} href={r.brand_id ? `/companies/${r.brand_id}` : "/requirements"} title={r.brand_name}
                sub={["Leasing", list(r.size), list(r.requirement_locations), r.agent_name].filter(Boolean).join(" · ")}
                right={<Badge variant="outline" className="text-[9px]">{r.status || "Active"}</Badge>} />
            ))}
            {data.investmentRequirements.map((r: any) => (
              <Row key={`i-${r.id}`} href={r.client_id ? `/companies/${r.client_id}` : "/requirements?type=investment"} title={r.client_name || r.name}
                sub={["Investment", list(r.size_range), list(r.requirement_locations)].filter(Boolean).join(" · ")}
                right={r.status && <Badge variant="outline" className="text-[9px]">{r.status}</Badge>} />
            ))}
          </div>
        )}
        {data && active === "instructions" && (
          <div className="space-y-1">{data.competing.map((p: any) => (
            <Row key={p.id} href={`/properties/${p.id}`} title={p.name} sub={["Instructed instead of BGP", p.landlord_name, p.competitor_agent_instructed_at && `since ${fmtDate(p.competitor_agent_instructed_at)}`].filter(Boolean).join(" · ")}
              right={p.competitor_agent_status && <Badge variant="outline" className="text-[9px]">{p.competitor_agent_status === "won_by_bgp" ? "Won by BGP" : p.competitor_agent_status}</Badge>} />
          ))}</div>
        )}
        {data && active === "sales" && (
          <div className="space-y-1">
            {data.investment.sellingFor.map((t: any) => <Row key={`s-${t.id}`} href={t.deal_id ? `/deals/${t.deal_id}` : "/investment-tracker"} title={t.asset_name} sub={["Selling agent", t.vendor, t.status].filter(Boolean).join(" · ")} right={money(t.guide_price) && <span className="text-[10px] tabular-nums">{money(t.guide_price)}</span>} />)}
            {data.investment.bids.map((o: any) => <Row key={`b-${o.id}`} href={o.deal_id ? `/deals/${o.deal_id}` : "/investment-tracker"} title={o.asset_name} sub={["Bid", o.status, fmtDate(o.offer_date)].filter(Boolean).join(" · ")} right={money(o.offer_price) && <span className="text-[10px] tabular-nums">{money(o.offer_price)}</span>} />)}
            {data.investment.sentSales.map((s: any) => <Row key={`d-${s.id}`} href={s.deal_id ? `/deals/${s.deal_id}` : "/investment-tracker"} title={s.asset_name} sub={["Sent particulars", fmtDate(s.sent_date), s.response].filter(Boolean).join(" · ")} />)}
          </div>
        )}
        {data && active === "leaseAdvisory" && (
          <div className="space-y-1">{data.otherSide.map((m: any) => (
            <Row key={m.id} href={`/pla/matters/${m.id}`} title={`${MATTER_LABEL[m.matter_type] || m.matter_type}${m.property_name ? ` · ${m.property_name}` : ""}`}
              sub={["Other side", m.surveyor_name, m.acting_for && `BGP acting for ${m.acting_for}`, m.agreed_rent ? `agreed ${money(m.agreed_rent)}` : m.counter_quoting_rent ? `their quote ${money(m.counter_quoting_rent)}` : null].filter(Boolean).join(" · ")}
              right={<Badge variant="outline" className="text-[9px]">{m.status}</Badge>} />
          ))}</div>
        )}
        {data && active === "viewings" && (
          <div className="space-y-1">{data.viewings.map((v: any) => (
            <Row key={v.id} title={`${v.brand_name || "Viewing"}${v.property_name ? ` · ${v.property_name}` : ""}`} sub={[v.unit_name, v.agent_name, v.outcome || v.status].filter(Boolean).join(" · ")} right={<span className="text-[10px] text-muted-foreground">{fmtDate(v.viewing_date)}</span>} />
          ))}</div>
        )}
      </CardContent>
    </Card>
  );
}
