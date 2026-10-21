// Public, read-only rendering of the Leisure Platform research — a single
// self-contained HTML page built from leisure-platform-data.ts. Served at
// /public/leisure-platform/<token> (no login; the token is the only gate,
// rotate LEISURE_PLATFORM_PUBLIC_TOKEN to cut old links off) and also
// written out as a claude.ai artifact by script/leisure-platform-public.ts.
import {
  LEISURE_FUND,
  LEISURE_SITES,
  LEISURE_OPERATORS,
  LEISURE_TARGETS,
  DATA_ROOM,
  LEISURE_PLATFORM_PUBLIC_TOKEN,
} from "./leisure-platform-data";

const DEEP_DIVE_DOC = "https://claude.ai/artifact/HXxYHsMLX1KW488NmfJhc4";

export function publicToken(): string {
  return process.env.LEISURE_PLATFORM_PUBLIC_TOKEN || LEISURE_PLATFORM_PUBLIC_TOKEN;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtM = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })}m`;

function table(headers: Array<[string, "l" | "r" | "c"]>, rows: string[][], cls = "") {
  return `<div class="tw"><table class="${cls}"><thead><tr>${headers
    .map(([h, a]) => `<th class="a${a}">${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td class="a${headers[i][1]}">${c}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

export function renderLeisurePlatformPage(opts: { dataRoomBase: string | null; fullDocument: boolean }): string {
  const f = LEISURE_FUND;
  const navPerUnit = (f.navGbpM * 1e6) / f.unitsInIssue;

  const stats = [
    ["NAV, Mar 2026", fmtM(f.navGbpM), `${fmtM(f.navJun2024GbpM)} at Jun 2024`],
    ["GAV, Jun 2024", fmtM(f.gavJun2024GbpM), `debt ${fmtM(f.debtJun2024GbpM)}`],
    ["Gearing", `${f.gearingPct}%`, "AREF headline"],
    ["Net initial yield", `${f.niyPct}%`, `equivalent ${f.equivalentYieldPct}%`],
    ["Assets", String(f.assets), `${LEISURE_SITES.filter((s) => s.confidence === "confirmed").length} identified`],
    ["Unitholders", String(f.unitholders), `${f.unitsInIssue.toLocaleString()} units · c. ${navPerUnit.toFixed(0)}p each`],
  ]
    .map(([l, v, c]) => `<div class="stat"><div class="sl">${esc(l)}</div><div class="sv">${esc(v)}</div><div class="sc">${esc(c)}</div></div>`)
    .join("");

  const sitesRows = LEISURE_SITES.map((s) => [
    `<b>${esc(s.name)}</b><div class="sub">${esc(s.town)} · ${esc(s.postcode)}</div>`,
    esc(s.region),
    `${esc(s.cinema)}${s.screens ? `<span class="sub"> · ${s.screens} scr</span>` : ""}`,
    `<span class="num">${esc(s.valueBandGbpM)}</span>`,
    `<span class="num">${s.pctOfFund != null ? s.pctOfFund.toFixed(1) : "—"}</span>`,
    `${esc(s.tenure)}${s.titleNumbers.length ? `<div class="sub mono">${esc(s.titleNumbers.join(", "))}</div>` : ""}`,
    `<span class="sub">${esc(s.occupiers.join(", ") || "—")}</span>`,
    `${s.voids.map((v) => `<div class="bad">${esc(v)}</div>`).join("")}${s.flags.map((x) => `<div class="sub">${esc(x)}</div>`).join("")}`,
    `<span class="chip ${s.confidence}">${s.confidence}</span>`,
  ]);

  const operatorRows = LEISURE_OPERATORS.map((o) => [
    `<b>${esc(o.name)}</b><div class="sub mono"><a href="https://find-and-update.company-information.service.gov.uk/company/${esc(o.chNumber)}" target="_blank" rel="noreferrer">${esc(o.chNumber)}</a> · ${esc(o.kind)}</div>`,
    `<span class="sub">${esc(o.owner)}</span>`,
    `<span class="sub">${esc(o.sitesOnParks.join(", ") || "—")}</span>`,
    esc(o.latestFromResearch),
    esc(o.propertyOwned),
    esc(o.verdict),
  ]);

  const targetRows = LEISURE_TARGETS.map((t) => [
    `<b>${esc(t.name)}</b>`,
    `<span class="chip route">${esc(t.type)}</span>`,
    `<span class="sub">${esc(t.owner)}</span>`,
    `<span class="num">${esc(t.sizeGbpM)}</span>`,
    esc(t.cinema),
    esc(t.approach),
    `<span class="sub">${esc(t.note || "—")}</span>`,
    `<span class="chip pri${t.priority}">${t.priority}</span>`,
  ]);

  const dataRoomRows = DATA_ROOM.map((d) => {
    const links: string[] = [];
    if (d.file && opts.dataRoomBase) links.push(`<a href="${esc(opts.dataRoomBase)}/${esc(d.file)}" target="_blank" rel="noreferrer">PDF</a>`);
    if (d.url) links.push(`<a href="${esc(d.url)}" target="_blank" rel="noreferrer">Open</a>`);
    return [`<b>${esc(d.title)}</b>`, `<span class="chip route">${esc(d.kind)}</span>`, `<span class="mono">${esc(d.date)}</span>`, `<span class="sub">${esc(d.note)}</span>`, links.join(" · ") || "—"];
  });

  const bands = table(
    [["Band (Jun 2024)", "l"], ["Holders", "c"], ["% units", "r"], ["£m at NAV", "r"]],
    f.unitholderBands.map((b) => [esc(b.band), String(b.holders), `<span class="num">${b.pct}</span>`, `<span class="num">${((f.navGbpM * b.pct) / 100).toFixed(1)}</span>`]),
  );
  const navHist = table(
    [["Date", "l"], ["NAV per unit (p)", "r"]],
    f.navPerUnitHistory.map((h) => [esc(h.date), `<span class="num">${h.navP.toFixed(1)}</span>`]),
  );
  const tenants = table(
    [["Tenant", "l"], ["% of rent", "r"]],
    f.topTenants.map((t) => [esc(t.tenant), `<span class="num">${t.pct}</span>`]),
  );
  const nominees = f.nomineeCompanies
    .map((n) => `<div class="kv"><span>${esc(n.name)}<div class="sub">${esc(n.role)}</div></span><a class="mono" href="https://find-and-update.company-information.service.gov.uk/company/${esc(n.number)}" target="_blank" rel="noreferrer">${esc(n.number)}</a></div>`)
    .join("");

  const head = `<title>Leisure Platform</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one column, a top band with the fund headline tiles, then pill-tabbed sections of dense tables. */
:root{--bg:#faf7f3;--fg:#1f1a18;--muted:#6f6460;--line:#e6ddd6;--card:#ffffff;--accent:#6e0c25;--accent-soft:#fc9f8d;--good:#1f7a4d;--warn:#9a6a00;--bad:#a8323a;
--display:"Newsreader",Georgia,"Times New Roman",serif;--body:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;--mono:"IBM Plex Mono",ui-monospace,Menlo,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#171312;--fg:#f1ebe6;--muted:#a79b95;--line:#332b28;--card:#211c1a;--accent:#fc9f8d;--accent-soft:#6e0c25;--good:#6cc998;--warn:#e0b45a;--bad:#f08a90;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#171312;--fg:#f1ebe6;--muted:#a79b95;--line:#332b28;--card:#211c1a;--accent:#fc9f8d;--accent-soft:#6e0c25;--good:#6cc998;--warn:#e0b45a;--bad:#f08a90;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--body);font-size:14px;line-height:1.45}
.wrap{max-width:1360px;margin:0 auto;padding-block:20px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
header{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end;justify-content:space-between;border-bottom:2px solid var(--accent);padding-bottom:14px;margin-bottom:18px}
h1{font-family:var(--display);font-weight:600;font-size:clamp(26px,4vw,36px);line-height:1.05;margin:0;text-wrap:balance}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.lede{color:var(--muted);max-width:68ch;margin:6px 0 0}
.links a{display:inline-block;margin-left:10px;color:var(--accent);font-weight:500;text-decoration:none;border-bottom:1px solid currentColor}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:10px 12px;min-width:0}
.sl{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.sv{font-family:var(--mono);font-size:22px;font-weight:500;font-variant-numeric:tabular-nums;margin:2px 0}
.sc{font-size:11px;color:var(--muted)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 14px}
.tab{font-family:var(--body);font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:6px 12px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--fg);color:var(--bg);border-color:transparent}
.tab:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
section{display:none}section.on{display:block}
h2{font-family:var(--display);font-weight:600;font-size:22px;margin:0 0 4px;text-wrap:balance}
.note{color:var(--muted);font-size:13px;max-width:80ch;margin:0 0 12px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap;background:color-mix(in srgb,var(--card) 92%,var(--fg))}
td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top;min-width:0}
.al{text-align:left}.ar{text-align:right}.ac{text-align:center}
.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.sub{color:var(--muted);font-size:11.5px}
.bad{color:var(--bad);font-size:11.5px}
.chip{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:2px 8px;border:1px solid var(--line);color:var(--muted)}
.chip.confirmed{color:var(--good);border-color:var(--good)}.chip.likely{color:var(--warn);border-color:var(--warn)}
.chip.priA{color:var(--good);border-color:var(--good)}.chip.priB{color:var(--accent);border-color:var(--accent)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.board{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px;min-width:0}
.board h3{font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
.board .tw{border:0;background:transparent}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:6px 0;border-top:1px solid var(--line)}.kv:first-of-type{border-top:0}
.kv a{color:var(--accent);text-decoration:none}
.fact{font-size:12.5px;padding:5px 0;border-top:1px solid var(--line)}.fact:first-of-type{border-top:0}.fact span{color:var(--muted)}
a{color:var(--accent)}
ul{padding-left:18px;margin:0}li{margin:4px 0}
footer{margin-top:28px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>`;

  const body = `<div class="wrap">
<header>
  <div>
    <div class="eyebrow">Bruce Gillingham Pollard · research snapshot 21 Oct 2026</div>
    <h1>Leisure Platform</h1>
    <p class="lede">The L&amp;G Leisure Fund deep dive, the cinema and occupier covenants on its parks, and the target list for a branded cinema-anchored leisure-park platform.</p>
  </div>
  <div class="links"><a href="${DEEP_DIVE_DOC}" target="_blank" rel="noreferrer">Deep-dive paper</a></div>
</header>

<div class="stats">${stats}</div>

<div class="tabs" role="tablist">
  <button class="tab" role="tab" id="tab-sites" aria-selected="true" data-t="sites">Fund sites <span class="num">${LEISURE_SITES.length}</span></button>
  <button class="tab" role="tab" id="tab-fund" aria-selected="false" data-t="fund">Fund &amp; holders</button>
  <button class="tab" role="tab" id="tab-operators" aria-selected="false" data-t="operators">Cinemas &amp; operators <span class="num">${LEISURE_OPERATORS.length}</span></button>
  <button class="tab" role="tab" id="tab-targets" aria-selected="false" data-t="targets">Targets <span class="num">${LEISURE_TARGETS.length}</span></button>
  <button class="tab" role="tab" id="tab-dataroom" aria-selected="false" data-t="dataroom">Data room <span class="num">${DATA_ROOM.length}</span></button>
</div>

<section id="sites" class="on">
  <h2>The parks</h2>
  <p class="note">Sixteen cinema-anchored parks worth roughly £340m at a 7.7% net initial yield. Value bands and % of fund are from the June 2024 AREF profile; occupiers and voids from operator directories and press to October 2026. Title is held by the two L&amp;G nominee companies listed under Fund &amp; holders.</p>
  ${table([["Park", "l"], ["Region", "c"], ["Cinema", "l"], ["Value £m", "r"], ["% fund", "r"], ["Tenure / titles", "l"], ["Occupiers", "l"], ["Voids & flags", "l"], ["Status", "c"]], sitesRows)}
</section>

<section id="fund">
  <h2>Fund and holders</h2>
  <p class="note">Closed-ended English LP with no redemption right, no unit transfers since 2019 and NAV per unit down from 951p (Dec 2018) to about ${navPerUnit.toFixed(0)}p. Control sits with the holders' votes and the lender's consent, not with the manager.</p>
  <div class="grid2">
    <div class="board"><h3>Fund facts</h3>
      <div class="fact"><span>Vehicle: </span>${esc(f.name)} (${esc(f.lpNumber)}); feeder ${esc(f.feeder)}</div>
      <div class="fact"><span>Manager: </span>${esc(f.manager)}; fund manager ${esc(f.fundManager)}</div>
      <div class="fact"><span>Structure: </span>${esc(f.structure)}</div>
      <div class="fact"><span>Lender: </span>${esc(f.lender)}</div>
      <div class="fact"><span>Fees: </span>${f.feeBps} bps of NAV; performance ${esc(f.performanceFee)}</div>
      <div class="fact"><span>Returns, annualised to Jun 2024: </span>1y ${f.returns.oneYear}% · 3y ${f.returns.threeYear}% · 5y ${f.returns.fiveYear}% · 10y ${f.returns.tenYear}%</div>
      <div class="fact"><span>Rent passing, Jun 2024: </span>${fmtM(f.rentPassingJun2024GbpM)}; void ${f.voidPctErv}% of ERV</div>
      <div class="fact"><span>Sales: </span>${f.sales.map((s) => `${esc(s.asset)} (${esc(s.date)}) ${fmtM(s.priceGbpM)} at ${s.yieldPct}% to ${esc(s.buyer)}`).join("; ")}</div>
    </div>
    <div class="board"><h3>Nominee and GP companies</h3>${nominees}</div>
    <div class="board"><h3>Unitholder concentration</h3>${bands}
      <p class="sub" style="margin:8px 0 0">Largest ${f.majorHolders.largest}% · top 3 ${f.majorHolders.top3}% · top 10 ${f.majorHolders.top10}% · L&amp;G internal ${f.majorHolders.internalPct}% (${f.majorHolders.internalCount} accounts). ${f.knownInvestors.map((k) => `${esc(k.name)}: ${esc(k.status)}`).join(". ")}.</p></div>
    <div class="board"><h3>NAV per unit</h3>${navHist}</div>
    <div class="board"><h3>Top tenants, % of rent (Jun 2024)</h3>${tenants}</div>
  </div>
</section>

<section id="operators">
  <h2>Cinemas and operators</h2>
  <p class="note">UK admissions are running 15% ahead of 2025 and box office 22% ahead (UK Cinema Association, Sept 2026). Vue is the strongest covenant on the parks, Odeon is parent-dependent, Cineworld cut rents across its estate in 2024. Figures are from the latest Companies House filings.</p>
  ${table([["Operator", "l"], ["Owner", "l"], ["On the parks", "l"], ["Latest accounts", "l"], ["Property owned", "l"], ["Verdict", "l"]], operatorRows)}
</section>

<section id="targets">
  <h2>Targets</h2>
  <p class="note">Three routes used together: fund units bought at a discount, direct parks from motivated sellers, and operators only where they own property. Priority A is this quarter's work.</p>
  ${table([["Target", "l"], ["Route", "c"], ["Owner / counterparty", "l"], ["Size £m", "r"], ["Cinema", "l"], ["Approach", "l"], ["Note", "l"], ["Pri", "c"]], targetRows)}
</section>

<section id="dataroom">
  <h2>Data room</h2>
  <p class="note">Every source behind the figures. Open goes to the live page; PDF is the filed copy${opts.dataRoomBase ? "" : " (filed copies are on the BGP dashboard)"}.</p>
  ${table([["Source", "l"], ["Kind", "c"], ["Date", "c"], ["What it gives", "l"], ["Links", "l"]], dataRoomRows)}
  <h2 style="margin-top:20px">Open questions</h2>
  <ul>
    <li>Is Yeovil the unidentified South West asset, and which of Ashton or Dudley is the 16th? The Land Registry title pull on the nominee companies answers both.</li>
    <li>Was Mansfield a Leisure Fund asset? The regional split says no.</li>
    <li>The partnership agreement's transfer-consent, pre-emption and removal thresholds.</li>
    <li>Current facility size, maturity and covenants with NatWest.</li>
    <li>Names of the 23 holders beyond Greater Manchester Pension Fund.</li>
    <li>Showcase UK: who now holds the freeholds and who is bidding after The Light.</li>
    <li>Site-level admissions (Comscore) for the 16 parks and the 20 targets.</li>
  </ul>
</section>

<footer>Research snapshot assembled 21 October 2026 from AREF, Companies House, HM Land Registry charge records, L&amp;G releases, agents' schedules and trade press. Not investment advice; figures marked unverified in the paper remain so here.</footer>
</div>
<script>
(function(){
  var tabs=document.querySelectorAll('.tab'),secs=document.querySelectorAll('section');
  function show(t){tabs.forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.t===t))});secs.forEach(function(s){s.classList.toggle('on',s.id===t)});}
  tabs.forEach(function(b){b.addEventListener('click',function(){show(b.dataset.t);try{history.replaceState(null,'','#'+b.dataset.t)}catch(e){}})});
  var h=(location.hash||'').replace('#','');if(h&&document.getElementById(h)&&document.getElementById('tab-'+h))show(h);
})();
</script>`;

  if (!opts.fullDocument) return head + "\n" + body;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${head}</head><body style="margin:0">${body}</body></html>`;
}
