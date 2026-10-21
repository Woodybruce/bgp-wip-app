import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Pill, pillTabsList, pillTabsTrigger } from "@/components/ui/pill";
import { ExternalLink, FileText, RefreshCw } from "lucide-react";
import { DoubleBillWordmark } from "@/components/double-bill-brand";
import { MobileCardView } from "@/components/mobile-card-view";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiRequest } from "@/lib/queryClient";

const DEEP_DIVE_DOC = "https://claude.ai/artifact/HXxYHsMLX1KW488NmfJhc4";

type Site = {
  key: string; name: string; town: string; postcode: string; region: string; cinema: string;
  screens: number | null; cinemaChNumber: string | null; valueBandGbpM: string; pctOfFund: number | null;
  tenure: string; titleNumbers: string[]; occupiers: string[]; voids: string[]; flags: string[];
  confidence: "confirmed" | "likely" | "unresolved";
};
type Operator = {
  name: string; chNumber: string; kind: string; owner: string; sitesOnParks: string[];
  latestFromResearch: string; propertyOwned: string; verdict: string;
  accounts: { crmCompanyId: string | null; lastAccountsDocId: string | null; extracted: Record<string, string | null> | null } | null;
};
type Target = { name: string; type: "fund" | "direct" | "operator"; owner: string; sizeGbpM: string; cinema: string; priority: "A" | "B" | "C"; approach: string; note: string };
type Source = { title: string; kind: string; url: string | null; file: string | null; date: string; note: string; fileAvailable: boolean };
type Overview = {
  fund: any; sites: Site[]; operators: Operator[]; targets: Target[]; dataRoom: Source[];
};
type Titles = {
  hmlrLive: boolean; ccodTitlesLoaded: boolean;
  byCompany: Record<string, Array<{ title_number: string; tenure: string | null; property_address: string | null; postcode: string | null; price_paid: string | null; date_proprietor_added: string | null }>>;
  bySite: Record<string, Array<{ titleNumber: string; tenure: string | null; propertyAddress: string | null; pricePaid: string | null; proprietors: string[] }>>;
};

export default function LeisurePlatform() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Overview>({ queryKey: ["/api/leisure-platform/overview"] });
  const { data: titles } = useQuery<Titles>({ queryKey: ["/api/leisure-platform/titles"] });
  const [priority, setPriority] = useState<"all" | "A" | "B" | "C">("all");
  const [targetType, setTargetType] = useState<"all" | "fund" | "direct" | "operator">("all");

  const fetchAccounts = useMutation({
    mutationFn: async (chNumber: string) => {
      const r = await apiRequest("POST", `/api/leisure-platform/operators/${chNumber}/fetch-accounts`);
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/leisure-platform/overview"] }),
  });

  const fund = data?.fund;
  const targets = useMemo(() => (data?.targets || []).filter((t) => (priority === "all" || t.priority === priority) && (targetType === "all" || t.type === targetType)), [data, priority, targetType]);
  const sitesConfirmed = (data?.sites || []).filter((s) => s.confidence === "confirmed").length;
  const titleCount = titles ? Object.values(titles.byCompany).reduce((n, t) => n + t.length, 0) : 0;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <DoubleBillWordmark height={40} className="text-foreground" />
          <h1 className="text-xl font-semibold tracking-tight mt-2">The L&amp;G Leisure Fund and the parks that come next</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Twice the night out. Deep dive, cinema and occupier covenants, and the target list for the Double Bill platform. Research snapshot 21 Oct 2026; titles and accounts live from Land Registry and Companies House.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="rounded-full">
          <a href={DEEP_DIVE_DOC} target="_blank" rel="noreferrer"><FileText className="w-3.5 h-3.5 mr-1.5" />Deep-dive paper</a>
        </Button>
      </div>

      {isLoading || !data ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Stat label="NAV (Mar 2026)" value={`£${fund.navGbpM}m`} ctx={`vs £${fund.navJun2024GbpM}m Jun 2024`} />
            <Stat label="GAV (Jun 2024)" value={`£${fund.gavJun2024GbpM}m`} ctx={`debt £${fund.debtJun2024GbpM}m`} />
            <Stat label="Gearing" value={`${fund.gearingPct}%`} ctx="AREF headline" />
            <Stat label="NIY" value={`${fund.niyPct}%`} ctx={`equiv ${fund.equivalentYieldPct}%`} />
            <Stat label="Assets" value={String(fund.assets)} ctx={`${sitesConfirmed} identified`} />
            <Stat label="Unitholders" value={String(fund.unitholders)} ctx={`${fund.unitsInIssue.toLocaleString()} units`} />
          </div>

          <Tabs defaultValue="sites" className="w-full">
            <TabsList className={pillTabsList}>
              <TabsTrigger value="sites" className={pillTabsTrigger}>Fund sites <span className="font-mono normal-case opacity-70">{data.sites.length}</span></TabsTrigger>
              <TabsTrigger value="fund" className={pillTabsTrigger}>Fund &amp; holders</TabsTrigger>
              <TabsTrigger value="operators" className={pillTabsTrigger}>Cinemas &amp; operators <span className="font-mono normal-case opacity-70">{data.operators.length}</span></TabsTrigger>
              <TabsTrigger value="targets" className={pillTabsTrigger}>Targets <span className="font-mono normal-case opacity-70">{data.targets.length}</span></TabsTrigger>
              <TabsTrigger value="titles" className={pillTabsTrigger}>Land Registry <span className="font-mono normal-case opacity-70">{titleCount}</span></TabsTrigger>
              <TabsTrigger value="dataroom" className={pillTabsTrigger}>Data room <span className="font-mono normal-case opacity-70">{data.dataRoom.length}</span></TabsTrigger>
            </TabsList>

            <TabsContent value="sites" className="mt-3">
              <Card><CardContent className="p-0">
                {isMobile ? (
                  <MobileCardView items={data.sites.map((s) => ({
                    id: s.key, title: s.name, subtitle: `${s.town} · ${s.region}`,
                    status: s.confidence, statusColor: confidenceDot(s.confidence),
                    fields: [
                      { label: "Cinema", value: `${s.cinema}${s.screens ? ` (${s.screens})` : ""}` },
                      { label: "Value band", value: `£${s.valueBandGbpM}m` },
                      { label: "% fund", value: s.pctOfFund != null ? `${s.pctOfFund}%` : null },
                      { label: "Voids", value: s.voids.length ? s.voids.join("; ") : "none known" },
                      { label: "Titles", value: siteTitles(s, titles) },
                    ],
                  }))} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40"><tr>
                        <Th label="Park" align="left" /><Th label="Region" /><Th label="Cinema" align="left" /><Th label="Value £m" /><Th label="% fund" /><Th label="Tenure / titles" align="left" /><Th label="Occupiers" align="left" /><Th label="Voids & flags" align="left" /><Th label="Status" />
                      </tr></thead>
                      <tbody>
                        {data.sites.map((s) => (
                          <tr key={s.key} className="border-t border-border/40 hover:bg-muted/20 align-top">
                            <td className="px-2 py-2 font-medium">{s.name}<div className="text-[10px] text-muted-foreground font-normal">{s.town} · {s.postcode}</div></td>
                            <td className="px-2 py-2 text-center text-[10px]">{s.region}</td>
                            <td className="px-2 py-2">{s.cinema}{s.screens ? <span className="text-muted-foreground"> · {s.screens} scr</span> : null}</td>
                            <td className="px-2 py-2 text-right font-mono">{s.valueBandGbpM}</td>
                            <td className="px-2 py-2 text-right font-mono">{s.pctOfFund != null ? s.pctOfFund.toFixed(1) : "—"}</td>
                            <td className="px-2 py-2 text-[10px]">{s.tenure}<div className="font-mono text-muted-foreground">{siteTitles(s, titles)}</div></td>
                            <td className="px-2 py-2 text-[10px] max-w-[260px]">{s.occupiers.join(", ") || "—"}</td>
                            <td className="px-2 py-2 text-[10px] max-w-[260px]">
                              {s.voids.map((v) => <div key={v} className="text-red-700">{v}</div>)}
                              {s.flags.map((f) => <div key={f} className="text-muted-foreground">{f}</div>)}
                            </td>
                            <td className="px-2 py-2 text-center"><ConfidenceBadge c={s.confidence} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="fund" className="mt-3 space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <Board label="Fund facts">
                  <KV k="Vehicle" v={`${fund.name} (${fund.lpNumber}); feeder ${fund.feeder}`} />
                  <KV k="Manager" v={`${fund.manager}; fund manager ${fund.fundManager}`} />
                  <KV k="Structure" v={fund.structure} />
                  <KV k="Lender" v={fund.lender} />
                  <KV k="Fees" v={`${fund.feeBps} bps of NAV; performance ${fund.performanceFee}`} />
                  <KV k="Returns (annualised, to Jun 2024)" v={`1y ${fund.returns.oneYear}% · 3y ${fund.returns.threeYear}% · 5y ${fund.returns.fiveYear}% · 10y ${fund.returns.tenYear}%`} />
                  <KV k="Rent passing (Jun 2024)" v={`£${fund.rentPassingJun2024GbpM}m; void ${fund.voidPctErv}% of ERV`} />
                </Board>
                <Board label="Nominee & GP companies">
                  {fund.nomineeCompanies.map((n: any) => (
                    <div key={n.number} className="flex justify-between gap-2 text-xs py-1 border-b border-border/30 last:border-0">
                      <span>{n.name}<div className="text-[10px] text-muted-foreground">{n.role}</div></span>
                      <a className="font-mono text-[11px] hover:underline shrink-0" target="_blank" rel="noreferrer" href={`https://find-and-update.company-information.service.gov.uk/company/${n.number}`}>{n.number} <ExternalLink className="inline w-3 h-3" /></a>
                    </div>
                  ))}
                </Board>
                <Board label="Unitholder concentration (Jun 2024)">
                  <table className="w-full text-xs">
                    <thead><tr><Th label="Band" align="left" /><Th label="Holders" /><Th label="% units" /><Th label="£m at NAV" /></tr></thead>
                    <tbody>{fund.unitholderBands.map((b: any) => (
                      <tr key={b.band} className="border-t border-border/30"><td className="px-2 py-1">{b.band}</td><td className="px-2 py-1 text-center font-mono">{b.holders}</td><td className="px-2 py-1 text-right font-mono">{b.pct}</td><td className="px-2 py-1 text-right font-mono">{(fund.navGbpM * b.pct / 100).toFixed(1)}</td></tr>
                    ))}</tbody>
                  </table>
                  <div className="text-[10px] text-muted-foreground mt-2">Largest {fund.majorHolders.largest}% · top 3 {fund.majorHolders.top3}% · top 10 {fund.majorHolders.top10}% · L&amp;G internal {fund.majorHolders.internalPct}% ({fund.majorHolders.internalCount} accounts)</div>
                  <div className="mt-2 space-y-1">{fund.knownInvestors.map((k: any) => <div key={k.name} className="text-xs"><span className="font-medium">{k.name}</span> <span className="text-muted-foreground">· {k.status} · {k.approach}</span></div>)}</div>
                </Board>
                <Board label="NAV per unit (p)">
                  <table className="w-full text-xs"><tbody>{fund.navPerUnitHistory.map((h: any) => (
                    <tr key={h.date} className="border-t border-border/30"><td className="px-2 py-1">{h.date}</td><td className="px-2 py-1 text-right font-mono">{h.navP.toFixed(1)}</td></tr>
                  ))}</tbody></table>
                </Board>
                <Board label="Top tenants (% of rent, Jun 2024)">
                  <table className="w-full text-xs"><tbody>{fund.topTenants.map((t: any, i: number) => (
                    <tr key={i} className="border-t border-border/30"><td className="px-2 py-1">{t.tenant}</td><td className="px-2 py-1 text-right font-mono">{t.pct}</td></tr>
                  ))}</tbody></table>
                </Board>
                <Board label="Sales since 2023">
                  {fund.sales.map((s: any) => <KV key={s.asset} k={`${s.asset} (${s.date})`} v={`£${s.priceGbpM}m at ${s.yieldPct}% to ${s.buyer}; ${s.agent}`} />)}
                </Board>
              </div>
            </TabsContent>

            <TabsContent value="operators" className="mt-3">
              <Card><CardContent className="p-0">
                {isMobile ? (
                  <MobileCardView items={data.operators.map((o) => ({
                    id: o.chNumber, title: o.name, subtitle: o.owner, status: o.kind,
                    fields: [
                      { label: "Latest", value: accountsLine(o) },
                      { label: "Property", value: o.propertyOwned },
                      { label: "On parks", value: o.sitesOnParks.join(", ") || "—" },
                      { label: "Verdict", value: o.verdict },
                    ],
                    footer: <FetchButton o={o} pending={fetchAccounts.isPending && fetchAccounts.variables === o.chNumber} onClick={() => fetchAccounts.mutate(o.chNumber)} />,
                  }))} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40"><tr>
                        <Th label="Operator" align="left" /><Th label="Owner" align="left" /><Th label="On the parks" align="left" /><Th label="Latest accounts" align="left" /><Th label="Property owned" align="left" /><Th label="Verdict" align="left" /><th className="px-2 py-2 w-[130px]"></th>
                      </tr></thead>
                      <tbody>{data.operators.map((o) => (
                        <tr key={o.chNumber} className="border-t border-border/40 hover:bg-muted/20 align-top">
                          <td className="px-2 py-2 font-medium">{o.name}<div className="font-mono text-[10px] text-muted-foreground font-normal"><a className="hover:underline" target="_blank" rel="noreferrer" href={`https://find-and-update.company-information.service.gov.uk/company/${o.chNumber}`}>{o.chNumber}</a> · {o.kind}</div></td>
                          <td className="px-2 py-2 text-[10px]">{o.owner}</td>
                          <td className="px-2 py-2 text-[10px] max-w-[180px]">{o.sitesOnParks.join(", ") || "—"}</td>
                          <td className="px-2 py-2 text-[10px] max-w-[260px]">{accountsLine(o)}</td>
                          <td className="px-2 py-2 text-[10px]">{o.propertyOwned}</td>
                          <td className="px-2 py-2 text-[10px] max-w-[200px]">{o.verdict}</td>
                          <td className="px-2 py-2 text-right"><FetchButton o={o} pending={fetchAccounts.isPending && fetchAccounts.variables === o.chNumber} onClick={() => fetchAccounts.mutate(o.chNumber)} /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </CardContent></Card>
              <p className="text-[10px] text-muted-foreground mt-2">"Fetch accounts" downloads the latest filing from Companies House into the CRM and reads turnover, profit, cash and headcount with the accounts extractor (works on scanned filings). Research figures stay shown until a fetch has run.</p>
            </TabsContent>

            <TabsContent value="targets" className="mt-3 space-y-2">
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "A", "B", "C"] as const).map((p) => <Pill key={p} active={priority === p} onClick={() => setPriority(p)}>{p === "all" ? "All priorities" : `Priority ${p}`}</Pill>)}
                <span className="w-2" />
                {(["all", "fund", "direct", "operator"] as const).map((t) => <Pill key={t} active={targetType === t} onClick={() => setTargetType(t)}>{t === "all" ? "All routes" : t}</Pill>)}
              </div>
              <Card><CardContent className="p-0">
                {isMobile ? (
                  <MobileCardView items={targets.map((t) => ({
                    id: t.name, title: t.name, subtitle: t.owner, status: `Priority ${t.priority}`, statusColor: priorityDot(t.priority),
                    fields: [{ label: "Route", value: t.type }, { label: "Size £m", value: t.sizeGbpM }, { label: "Cinema", value: t.cinema }, { label: "Approach", value: t.approach }, { label: "Note", value: t.note || null }],
                  }))} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40"><tr><Th label="Target" align="left" /><Th label="Route" /><Th label="Owner / counterparty" align="left" /><Th label="Size £m" /><Th label="Cinema" align="left" /><Th label="Approach" align="left" /><Th label="Note" align="left" /><Th label="Pri" /></tr></thead>
                      <tbody>{targets.map((t) => (
                        <tr key={t.name} className="border-t border-border/40 hover:bg-muted/20 align-top">
                          <td className="px-2 py-2 font-medium">{t.name}</td>
                          <td className="px-2 py-2 text-center text-[10px] uppercase">{t.type}</td>
                          <td className="px-2 py-2 text-[10px] max-w-[220px]">{t.owner}</td>
                          <td className="px-2 py-2 text-right font-mono">{t.sizeGbpM}</td>
                          <td className="px-2 py-2 text-[10px]">{t.cinema}</td>
                          <td className="px-2 py-2 text-[10px] max-w-[220px]">{t.approach}</td>
                          <td className="px-2 py-2 text-[10px] text-muted-foreground max-w-[220px]">{t.note || "—"}</td>
                          <td className="px-2 py-2 text-center"><Badge className={`${priorityCls(t.priority)} text-[10px] font-semibold`}>{t.priority}</Badge></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
              </CardContent></Card>
            </TabsContent>

            <TabsContent value="titles" className="mt-3 space-y-3">
              {!titles ? <div className="p-6 text-center text-sm text-muted-foreground">Loading titles…</div> : (
                <>
                  {!titles.ccodTitlesLoaded && (
                    <div className="text-xs text-muted-foreground border border-border/60 rounded-md p-3">
                      No CCOD titles are indexed yet for the nominee companies. Run the Land Registry CCOD ingest (Settings → Subscriptions &amp; APIs → HMLR) and this tab fills itself; {titles.hmlrLive ? "the postcode sweep below is live." : "the hmlr_proprietors dataset is not loaded on this deploy either."}
                    </div>
                  )}
                  {fund.nomineeCompanies.filter((n: any) => titles.byCompany[n.number]).map((n: any) => (
                    <Board key={n.number} label={`${n.name} · ${titles.byCompany[n.number].length} titles`}>
                      {titles.byCompany[n.number].length === 0 ? <div className="text-xs text-muted-foreground">None indexed</div> : (
                        <div className="overflow-x-auto"><table className="w-full text-xs">
                          <thead><tr><Th label="Title" align="left" /><Th label="Tenure" /><Th label="Address" align="left" /><Th label="Postcode" /><Th label="Price paid" /><Th label="Added" /></tr></thead>
                          <tbody>{titles.byCompany[n.number].map((t) => (
                            <tr key={t.title_number} className="border-t border-border/30"><td className="px-2 py-1 font-mono">{t.title_number}</td><td className="px-2 py-1 text-center text-[10px]">{t.tenure || "—"}</td><td className="px-2 py-1 text-[10px]">{t.property_address || "—"}</td><td className="px-2 py-1 text-center font-mono text-[10px]">{t.postcode || "—"}</td><td className="px-2 py-1 text-right font-mono">{t.price_paid ? `£${Number(t.price_paid).toLocaleString()}` : "—"}</td><td className="px-2 py-1 text-center text-[10px]">{t.date_proprietor_added || "—"}</td></tr>
                          ))}</tbody>
                        </table></div>
                      )}
                    </Board>
                  ))}
                  <p className="text-[10px] text-muted-foreground">Known title numbers from the Companies House charges are shown on each site in the Fund sites tab; order the official copy from Property Intelligence → Land Registry → "Official Copy (HMLR)" with the title number.</p>
                </>
              )}
            </TabsContent>

            <TabsContent value="dataroom" className="mt-3">
              <Card><CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40"><tr><Th label="Source" align="left" /><Th label="Kind" /><Th label="Date" /><Th label="What it gives" align="left" /><th className="px-2 py-2 w-[120px]"></th></tr></thead>
                  <tbody>{data.dataRoom.map((d) => (
                    <tr key={d.title} className="border-t border-border/40 hover:bg-muted/20 align-top">
                      <td className="px-2 py-2 font-medium">{d.title}</td>
                      <td className="px-2 py-2 text-center text-[10px] uppercase text-muted-foreground">{d.kind}</td>
                      <td className="px-2 py-2 text-center font-mono text-[10px]">{d.date}</td>
                      <td className="px-2 py-2 text-[10px] text-muted-foreground">{d.note}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {d.file && d.fileAvailable && <a className="inline-flex items-center gap-1 hover:underline mr-2" href={`/api/leisure-platform/data-room/${d.file}`} target="_blank" rel="noreferrer"><FileText className="w-3 h-3" />PDF</a>}
                        {d.url && <a className="inline-flex items-center gap-1 hover:underline" href={d.url} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3" />Open</a>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              </CardContent></Card>
              <p className="text-[10px] text-muted-foreground mt-2">PDFs are the copies filed in the repo under docs/leisure-platform/data-room; links open the live source. The deep-dive paper carries the same register.</p>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function siteTitles(s: Site, titles?: Titles) {
  const live = titles?.bySite?.[s.key]?.map((t) => t.titleNumber) || [];
  const all = Array.from(new Set([...s.titleNumbers, ...live]));
  return all.length ? all.join(", ") : "—";
}

function accountsLine(o: Operator) {
  const e = o.accounts?.extracted;
  if (e && (e.turnover || e.profitBeforeTax)) {
    return `${e.period || "latest"}: turnover ${e.turnover || "—"}, PBT ${e.profitBeforeTax || "—"}, cash ${e.cash || "—"}, staff ${e.employees || "—"} (Companies House)`;
  }
  return o.latestFromResearch;
}

function FetchButton({ o, pending, onClick }: { o: Operator; pending: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" className="rounded-full h-7 text-[11px]" disabled={pending} onClick={onClick}>
      <RefreshCw className={`w-3 h-3 mr-1 ${pending ? "animate-spin" : ""}`} />{o.accounts?.extracted ? "Refresh" : "Fetch accounts"}
    </Button>
  );
}

function Stat({ label, value, ctx }: { label: string; value: string; ctx?: string }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-mono font-semibold">{value}</div>
      {ctx && <div className="text-[10px] text-muted-foreground">{ctx}</div>}
    </CardContent></Card>
  );
}

function Board({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card><CardContent className="p-3">
      <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground mb-2">{label}</div>
      {children}
    </CardContent></Card>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return <div className="text-xs py-1 border-b border-border/30 last:border-0"><span className="text-muted-foreground">{k}: </span>{v}</div>;
}

function Th({ label, align = "center" }: { label: string; align?: "left" | "center" }) {
  return <th className={`px-2 py-2 font-medium text-[10px] uppercase tracking-wide text-muted-foreground text-${align}`}>{label}</th>;
}

function ConfidenceBadge({ c }: { c: Site["confidence"] }) {
  const cls = c === "confirmed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : c === "likely" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-zinc-50 text-zinc-600 border-zinc-200";
  return <Badge className={`${cls} text-[10px]`}>{c}</Badge>;
}
function confidenceDot(c: Site["confidence"]) { return c === "confirmed" ? "bg-emerald-500" : c === "likely" ? "bg-amber-500" : "bg-zinc-400"; }
function priorityCls(p: Target["priority"]) { return p === "A" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : p === "B" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-zinc-50 text-zinc-600 border-zinc-200"; }
function priorityDot(p: Target["priority"]) { return p === "A" ? "bg-emerald-500" : p === "B" ? "bg-blue-500" : "bg-zinc-400"; }
