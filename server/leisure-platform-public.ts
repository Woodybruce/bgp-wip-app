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
import { BRAND, wordmarkSvg, monogramSvg } from "./leisure-platform-brand";

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

  const c = BRAND.colours;
  const head = `<title>Double Bill</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${BRAND.googleFontsHref}">
<style>
/* Double Bill v2: a marquee. Midnight-velvet band with a bulb strip, champagne-gold sheen as the one accent, ivory paper below, Bodoni display over Instrument Sans text and JetBrains Mono data. */
:root{--bg:${c.ivory.light};--fg:${c.ink.light};--muted:${c.muted.light};--line:${c.line.light};--card:${c.card.light};--gold:${c.gold.light};--gold-hi:${c.goldHi.light};--gold-lo:${c.goldLo.light};--midnight:${c.midnight.light};--velvet:${c.velvet.light};--on-dark:#F4ECDC;--good:${c.good.light};--warn:${c.warn.light};--bad:${c.usher.light};--link:${c.goldLo.light};
--display:"Bodoni Moda",${BRAND.type.display.fallback};--body:"Instrument Sans",${BRAND.type.body.fallback};--mono:"JetBrains Mono",${BRAND.type.mono.fallback}}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:${c.ivory.dark};--fg:${c.ink.dark};--muted:${c.muted.dark};--line:${c.line.dark};--card:${c.card.dark};--gold:${c.gold.dark};--gold-hi:${c.goldHi.dark};--gold-lo:${c.goldLo.dark};--midnight:${c.midnight.dark};--velvet:${c.velvet.dark};--on-dark:#F4ECDC;--good:${c.good.dark};--warn:${c.warn.dark};--bad:${c.usher.dark};--link:${c.gold.dark};color-scheme:dark}}
:root[data-theme="dark"]{--bg:${c.ivory.dark};--fg:${c.ink.dark};--muted:${c.muted.dark};--line:${c.line.dark};--card:${c.card.dark};--gold:${c.gold.dark};--gold-hi:${c.goldHi.dark};--gold-lo:${c.goldLo.dark};--midnight:${c.midnight.dark};--velvet:${c.velvet.dark};--on-dark:#F4ECDC;--good:${c.good.dark};--warn:${c.warn.dark};--bad:${c.usher.dark};--link:${c.gold.dark};color-scheme:dark}
body{background:var(--bg);color:var(--fg);font-family:var(--body);font-size:14px;line-height:1.45}
.band{background:radial-gradient(120% 140% at 0% 0%,var(--velvet) 0%,#141830 48%,var(--midnight) 100%);color:var(--on-dark);position:relative}
.band:after{content:"";display:block;height:7px;background-image:radial-gradient(circle at 6px 3.5px,var(--gold-hi) 0 1.4px,var(--gold) 1.5px 2.1px,transparent 2.3px);background-size:14px 7px;background-repeat:repeat-x;border-top:1px solid var(--gold);background-color:var(--midnight)}
.band .in{max-width:1360px;margin:0 auto;padding-block:22px 26px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:flex;flex-wrap:wrap;gap:16px 28px;align-items:flex-end;justify-content:space-between}
.band h1{font-family:var(--display);font-weight:700;font-size:clamp(28px,4.4vw,46px);line-height:1.02;letter-spacing:.005em;margin:14px 0 8px;text-wrap:balance;color:#FBF5E8}
.band .lede{color:#CFC6B2;max-width:66ch;margin:0;font-size:14.5px}
.band .tag{font-family:var(--display);font-style:italic;font-weight:600;font-size:17px;letter-spacing:.01em;background:linear-gradient(135deg,var(--gold-hi),var(--gold) 55%,var(--gold-lo));-webkit-background-clip:text;background-clip:text;color:transparent}
.band .links a{display:inline-block;margin-left:10px;color:var(--gold-hi);font-weight:600;text-decoration:none;border:1px solid var(--gold);border-radius:999px;padding:7px 16px;letter-spacing:.04em;font-size:12.5px;text-transform:uppercase}
.band .links a:hover{background:var(--gold);color:var(--midnight)}
.wm{display:block}
.wrap{max-width:1360px;margin:0 auto;padding-block:18px 48px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-lo);margin-bottom:8px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;min-width:0;position:relative}
.stat:before{content:"";position:absolute;left:14px;right:14px;top:0;height:2px;background:linear-gradient(90deg,var(--gold-hi),var(--gold) 50%,var(--gold-lo))}
.sl{font-size:10.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.sv{font-family:var(--display);font-weight:700;font-size:28px;letter-spacing:.005em;font-variant-numeric:tabular-nums;margin:3px 0 1px}
.sc{font-size:11px;color:var(--muted)}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 16px}
.tab{font-family:var(--body);font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:7px 14px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--midnight);color:var(--gold-hi);border-color:var(--gold)}
.tab:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
section{display:none}section.on{display:block}
h2{font-family:var(--display);font-weight:700;font-size:28px;letter-spacing:.005em;margin:0 0 4px;text-wrap:balance}
h2:after{content:"";display:block;width:56px;height:2px;margin:8px 0 10px;background:linear-gradient(90deg,var(--gold-hi),var(--gold-lo))}
.note{color:var(--muted);font-size:13px;max-width:80ch;margin:0 0 12px}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:600;padding:9px 10px;border-bottom:1px solid var(--gold);white-space:nowrap;background:color-mix(in srgb,var(--card) 94%,var(--gold))}
td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top;min-width:0}
.al{text-align:left}.ar{text-align:right}.ac{text-align:center}
.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.sub{color:var(--muted);font-size:11.5px}
.bad{color:var(--bad);font-size:11.5px}
.chip{display:inline-block;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:2px 8px;border:1px solid var(--line);color:var(--muted)}
.chip.confirmed{color:var(--good);border-color:var(--good)}.chip.likely{color:var(--warn);border-color:var(--warn)}
.chip.priA{color:var(--good);border-color:var(--good)}.chip.priB{color:var(--gold-lo);border-color:var(--gold)}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.board{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;min-width:0}
.board h3{font-family:var(--mono);font-size:10.5px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-lo);margin:0 0 8px}
.board .tw{border:0;background:transparent}
.kv{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;padding:6px 0;border-top:1px solid var(--line)}.kv:first-of-type{border-top:0}
.kv a{color:var(--link);text-decoration:none}
.fact{font-size:12.5px;padding:5px 0;border-top:1px solid var(--line)}.fact:first-of-type{border-top:0}.fact span{color:var(--muted)}
a{color:var(--link)}
ul{padding-left:18px;margin:0}li{margin:4px 0}
.sw{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.swatch{border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--card)}
.swatch i{display:block;height:54px}.swatch b{display:block;font-size:12px;padding:6px 8px 0}.swatch span{display:block;font-size:11px;color:var(--muted);padding:0 8px 8px}
.type-d{font-family:var(--display);font-weight:700;font-size:34px;letter-spacing:.005em;line-height:1.05}
.type-b{font-family:var(--body);font-size:14px}.type-m{font-family:var(--mono);font-size:13px}
.markbox{display:flex;flex-wrap:wrap;gap:16px;align-items:center}
.markbox .dark{background:radial-gradient(120% 140% at 0% 0%,${c.velvet.light} 0%,#141830 48%,${c.midnight.light} 100%);border-radius:8px;padding:18px 22px}
.markbox .light{background:${c.card.light};border:1px solid var(--line);border-radius:8px;padding:18px 22px}
footer{margin-top:28px;color:var(--muted);font-size:12px;border-top:1px solid var(--gold);padding-top:12px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>`;

  const body = `<div class="band"><div class="in">
  <div>
    <span class="wm">${wordmarkSvg(56, { id: "hdr" })}</span>
    <h1>The L&amp;G Leisure Fund and the parks that come next</h1>
    <p class="lede">${esc(BRAND.line)}</p>
  </div>
  <div><div class="tag">${esc(BRAND.tagline)}</div><div class="links" style="margin-top:10px"><a href="${DEEP_DIVE_DOC}" target="_blank" rel="noreferrer">Deep-dive paper</a></div></div>
</div></div>
<div class="wrap">
<div class="eyebrow">Research snapshot 21 Oct 2026 · prepared by ${esc(BRAND.preparedBy)}</div>

<div class="stats">${stats}</div>

<div class="tabs" role="tablist">
  <button class="tab" role="tab" id="tab-sites" aria-selected="true" data-t="sites">Fund sites <span class="num">${LEISURE_SITES.length}</span></button>
  <button class="tab" role="tab" id="tab-fund" aria-selected="false" data-t="fund">Fund &amp; holders</button>
  <button class="tab" role="tab" id="tab-operators" aria-selected="false" data-t="operators">Cinemas &amp; operators <span class="num">${LEISURE_OPERATORS.length}</span></button>
  <button class="tab" role="tab" id="tab-targets" aria-selected="false" data-t="targets">Targets <span class="num">${LEISURE_TARGETS.length}</span></button>
  <button class="tab" role="tab" id="tab-dataroom" aria-selected="false" data-t="dataroom">Data room <span class="num">${DATA_ROOM.length}</span></button>
  <button class="tab" role="tab" id="tab-brand" aria-selected="false" data-t="brand">Brand</button>
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

<section id="brand">
  <h2>Double Bill, the brand</h2>
  <p class="note">A double bill is two films for one ticket. A Double Bill park is the film and the rest of the night on one site. Park names stay; Double Bill signs the landlord line. Cleared at Companies House on 21 Oct 2026 (Encore and Foyer are taken); trade-mark search still to run.</p>
  <div class="grid2">
    <div class="board"><h3>Marks</h3>
      <div class="markbox">
        <div class="dark">${wordmarkSvg(64, { id: "wmd" })}</div>
        <div class="light">${wordmarkSvg(64, { id: "wml", onLight: true })}</div>
        <div class="dark">${monogramSvg(72, { id: "mkd" })}</div>
      </div>
      <p class="sub" style="margin:10px 0 0">The marquee badge: a midnight-velvet ground with a bulb-lit gold border and the two ticket stubs inside, ivory behind and gold in front. The wordmark sets DOUBLE BILL in Bodoni with the gold sheen over a hairline and diamond. Minimum height 28px for the badge, 40px for the wordmark; clear space of one bulb-row all round; the gold is never flattened to a single colour on print.</p>
    </div>
    <div class="board"><h3>Voice</h3><ul>${BRAND.voice.map((v) => `<li>${esc(v)}</li>`).join("")}<li>${esc(BRAND.parkNaming)}</li></ul></div>
    <div class="board"><h3>Colour</h3>
      <div class="sw">${Object.entries(c).map(([k, v]) => `<div class="swatch"><i style="background:${k === "gold" ? "linear-gradient(135deg,#F6E6B2,#D4B165 45%,#C19A45 70%,#8F6E2A)" : v.light}"></i><b>${esc(k === "goldHi" ? "Gold highlight" : k === "goldLo" ? "Gold shadow" : k === "usher" ? "Usher red" : k === "gold" ? "Champagne gold" : k[0].toUpperCase() + k.slice(1))}</b><span class="mono">${v.light} · ${v.dark}</span></div>`).join("")}</div>
      <p class="sub" style="margin:10px 0 0">Champagne gold is the only accent, always as the three-stop sheen on marks and rules. Good, warn and usher red carry meaning, never decoration. Midnight and velvet are grounds, never type colours on ivory.</p>
    </div>
    <div class="board"><h3>Type</h3>
      <div class="type-d"><em>Twice the night out.</em></div>
      <p class="sub" style="margin:4px 0 10px">Bodoni Moda 700 for the wordmark, titles and big numbers; italic for the tagline.</p>
      <div class="type-b">Instrument Sans for everything people read: 14px, generous line height, labels tracked out in capitals.</div>
      <div class="type-m" style="margin-top:8px">JetBrains Mono · £219.2m · 7.7% · CH430688 · 2026-03-31</div>
    </div>
  </div>
</section>

<footer>${monogramSvg(28, { id: "ftr" })}<span>A Double Bill paper, prepared by Bruce Gillingham Pollard. Research snapshot assembled 21 October 2026 from AREF, Companies House, HM Land Registry charge records, L&amp;G releases, agents' schedules and trade press. Not investment advice; figures marked unverified in the paper remain so here.</span></footer>
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
