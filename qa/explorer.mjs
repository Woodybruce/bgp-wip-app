// Explorer bot — zero-token, agent-style sweep of the whole app.
//
// Logs in as each persona, harvests every static route from App.tsx plus
// every in-app link it sees, visits them all at desktop AND phone width,
// and on each page clicks every control a user might touch (skipping
// anything destructive). It understands nothing; it records symptoms:
//   http-5xx      any 5xx response while the page was driving
//   staff-403     staff persona refused by the API gateway
//   page-error    uncaught exception in the page
//   console-error console.error with a stack-looking payload
//   blank-page    route rendered < 40 chars of content
//   dead-click    click produced no DOM change, no navigation, no request
//   h-overflow    page scrolls horizontally on the phone
//
// Failures are fingerprinted and diffed against qa/explorer-known.json so a
// run only surfaces NEW problems; pass --update-known after triaging to
// absorb the current set. Claude (rounds / the parent session) reads the
// delta and fixes — tokens are spent on failures, never on browsing.
//
// Server: expects the DEV server on http://localhost:5000 with the fixture
// DB (same contract as two-bot-round.mjs — dev mode so session cookies work
// over plain http). Never point this at production.
//
// Usage: node qa/explorer.mjs [--pages N] [--clicks N] [--update-known]
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BASE = "http://localhost:5000";
const PASSWORD = "B@nd0077!";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? parseInt(args[i + 1]) : dflt;
};
const PAGE_CAP = argVal("--pages", 70);      // max routes per persona/viewport
const CLICK_CAP = argVal("--clicks", 12);    // max interactive clicks per page
const UPDATE_KNOWN = args.includes("--update-known");

// Every fixture user type gets its own sweep. Staff personas start from the
// full static route list; client personas crawl only what their own UI
// links to (linkCrawlOnly) — that IS the client test: their world and
// nothing else. A staff-only route surfacing in a client's link graph
// shows up here as a finding.
const PERSONAS = [
  { key: "woody", username: "woody@brucegillinghampollard.com", staff: true },        // admin + equity
  { key: "victoria", username: "victoria@brucegillinghampollard.com", staff: true },  // team head
  { key: "nick", username: "nick@brucegillinghampollard.com", staff: true },          // non-admin staff
  { key: "mark", username: "mark.warne@landsec.com", staff: false, linkCrawlOnly: true },   // Landsec client
  { key: "sam", username: "sam.cole@hammerson.com", staff: false, linkCrawlOnly: true },    // rival client (seed-personas)
];
const VIEWPORTS = [
  { key: "desktop", width: 1440, height: 900, ua: null },
  { key: "mobile", width: 390, height: 844, ua: IPHONE_UA },
];

// Environment noise the smoke/two-bot ledger already recognises — never report.
const NOISE_URL = /live-intel|commentary\/regenerate|bgp-commentary|rocketreach|instagram|photo|favicon|manifest|\/logo|fonts|hot-update|vite|placeholder|clearbit|logo\.dev|auth\/microsoft/i;
const NOISE_CONSOLE = /429|Too Many Requests|ResizeObserver|favicon|manifest|third-party cookie|X-Frame|net::ERR_|Failed to load resource|SSO request failed|SSO not configured/i;

// Controls that mutate or leave the app — the explorer never presses these.
const DANGEROUS = /delete|remove|archiv|retire|withdraw|revoke|deactivat|reset|sync|send|submit|invite|pay|purchase|buy|upload|import|export|download|print|sign ?out|log ?out|regenerate|refresh|enrich|kick|approve|reject|confirm|save|create|add |new /i;

// Routes with params need fixture ids we don't guess at; the scripted
// two-bot covers detail pages. Also skip auth/util/addin shells.
const SKIP_ROUTE = /:|\*|\/login|\/logout|\/addin|\/site-share|\/workspace-share|\/kyc-upload|\/whatsapp|\/print/;

function harvestRoutes() {
  const src = fs.readFileSync(path.join(ROOT, "client/src/App.tsx"), "utf8");
  const set = new Set(["/"]);
  for (const m of src.matchAll(/path="([^"]+)"/g)) {
    const p = m[1];
    if (!SKIP_ROUTE.test(p)) set.add(p);
  }
  return [...set];
}

function fp(kind, page, detail) {
  // Fingerprint: stable across runs — strip ids/numbers from detail.
  const d = String(detail || "").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>").replace(/\d{3,}/g, "<n>").slice(0, 160);
  return `${kind}|${page}|${d}`;
}

const KNOWN_PATH = path.join(__dirname, "explorer-known.json");
const known = new Set(fs.existsSync(KNOWN_PATH) ? JSON.parse(fs.readFileSync(KNOWN_PATH, "utf8")) : []);

// Dedupe at record time — a page erroring in a loop (map tiles, polling)
// must not grow memory for the whole run (the v1 unbounded array OOM'd node).
const failures = [];
const seenFp = new Set();
function report(kind, persona, viewport, pageUrl, detail) {
  const f = { kind, persona, viewport, page: pageUrl, detail: String(detail || "").slice(0, 300), fp: fp(kind, pageUrl, detail) };
  if (seenFp.has(f.fp)) return;
  seenFp.add(f.fp);
  failures.push(f);
}

async function login(context, username) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.click('[data-testid="button-show-guest-login"]', { timeout: 15000 });
  await page.fill('input[placeholder="Email address"]', username);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('[data-testid="button-guest-login"]');
  await page.waitForTimeout(2500);
  await page.close();
}

async function explore(persona, viewport, routes) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    ...(viewport.ua ? { userAgent: viewport.ua, hasTouch: true, isMobile: true } : {}),
  });
  await login(context, persona.username);

  let currentRoute = "/";
  let reqSeq = 0;

  const makePage = async () => {
    const p = await context.newPage();
    p.on("dialog", (d) => d.dismiss().catch(() => {}));
    p.on("request", () => { reqSeq++; });
    p.on("response", (res) => {
      const url = res.url();
      if (!url.startsWith(BASE) || NOISE_URL.test(url)) return;
      const s = res.status();
      const short = url.replace(BASE, "").split("?")[0];
      if (s >= 500) report("http-5xx", persona.key, viewport.key, currentRoute, `${s} ${short}`);
      else if (s === 403 && persona.staff) report("staff-403", persona.key, viewport.key, currentRoute, `403 ${short}`);
    });
    p.on("pageerror", (err) => {
      report("page-error", persona.key, viewport.key, currentRoute, err?.message || String(err));
    });
    p.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const t = msg.text();
      if (NOISE_CONSOLE.test(t)) return;
      report("console-error", persona.key, viewport.key, currentRoute, t);
    });
    return p;
  };
  let page = await makePage();

  // Clients explore only from their own landing page outward.
  const queue = persona.linkCrawlOnly ? ["/"] : [...routes];
  const visited = new Set();
  // Detail pages (/deals/:id etc.): follow a small sample per section so
  // record pages are exercised without crawling every company in the CRM.
  const DETAIL_CAP = 2;
  const detailCounts = new Map();

  while (queue.length && visited.size < PAGE_CAP) {
    const route = queue.shift();
    if (visited.has(route)) continue;
    visited.add(route);
    currentRoute = route;

    // Recycle the tab every 25 routes — a single long-lived page accumulates
    // Chromium state across map/chart-heavy screens.
    if (visited.size % 25 === 0) {
      await page.close().catch(() => {});
      page = await makePage();
    }

    try {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2200);
    } catch (e) {
      report("nav-fail", persona.key, viewport.key, route, e?.message);
      continue;
    }

    // Blank page + horizontal overflow checks.
    try {
      const state = await page.evaluate(() => ({
        text: (document.querySelector("main") || document.body)?.innerText?.trim().length || 0,
        overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      }));
      if (state.text < 40) report("blank-page", persona.key, viewport.key, route, `content length ${state.text}`);
      if (viewport.key === "mobile" && state.overflow) report("h-overflow", persona.key, viewport.key, route, "page scrolls horizontally");
    } catch {}

    // Harvest new in-app links (covers pages not in the static route list).
    try {
      const links = await page.evaluate(() =>
        [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href")).filter(Boolean),
      );
      for (const href of links) {
        const clean = href.split("?")[0].split("#")[0];
        if (visited.has(clean) || SKIP_ROUTE.test(clean)) continue;
        if (/\/[0-9a-f]{8}-/.test(clean)) {
          // Detail page — sample DETAIL_CAP per section (first path segment).
          const family = clean.split("/")[1] || "?";
          const n = detailCounts.get(family) || 0;
          if (n >= DETAIL_CAP) continue;
          detailCounts.set(family, n + 1);
        }
        queue.push(clean);
      }
    } catch {}

    // Interaction pass: press safe controls; flag dead clicks.
    let clicks = 0;
    let handles = [];
    try {
      handles = await page.$$("button, [role=tab], [role=menuitem]");
    } catch {}
    for (const h of handles) {
      if (clicks >= CLICK_CAP) break;
      let label = "";
      try {
        label = ((await h.textContent()) || (await h.getAttribute("aria-label")) || (await h.getAttribute("title")) || "").trim().slice(0, 60);
        if (!label || DANGEROUS.test(label)) continue;
        if (!(await h.isVisible())) continue;
        const beforeUrl = page.url();
        const beforeSeq = reqSeq;
        const beforeDom = await page.evaluate(() => document.body.getElementsByTagName("*").length);
        await h.click({ timeout: 3000, trial: false });
        clicks++;
        await page.waitForTimeout(700);
        const afterUrl = page.url();
        const afterSeq = reqSeq;
        const afterDom = await page.evaluate(() => document.body.getElementsByTagName("*").length).catch(() => beforeDom);
        if (afterUrl === beforeUrl && afterSeq === beforeSeq && Math.abs(afterDom - beforeDom) < 2) {
          report("dead-click", persona.key, viewport.key, route, `"${label}" did nothing`);
        }
        // Close whatever opened; return if we navigated away.
        await page.keyboard.press("Escape").catch(() => {});
        if (afterUrl !== beforeUrl) {
          await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      } catch {
        // Element detached / covered — normal churn, not a failure.
      } finally {
        await h.dispose().catch(() => {});
      }
    }
    process.stdout.write(`  [${persona.key}/${viewport.key}] ${route} (${clicks} clicks)\n`);
  }

  await browser.close();
}

const routes = harvestRoutes();
console.log(`Explorer: ${routes.length} static routes harvested · cap ${PAGE_CAP} pages, ${CLICK_CAP} clicks/page`);

for (const persona of PERSONAS) {
  for (const viewport of VIEWPORTS) {
    console.log(`\n── ${persona.key} @ ${viewport.key} ──`);
    try {
      await explore(persona, viewport, routes);
    } catch (e) {
      report("run-error", persona.key, viewport.key, "-", e?.message);
    }
  }
}

// Dedupe within the run, then diff against the known ledger.
const byFp = new Map();
for (const f of failures) if (!byFp.has(f.fp)) byFp.set(f.fp, f);
const unique = [...byFp.values()];
const fresh = unique.filter((f) => !known.has(f.fp));

const stamp = new Date().toISOString().slice(0, 10);
const logDir = path.join(__dirname, "logs");
fs.mkdirSync(logDir, { recursive: true });
const outPath = path.join(logDir, `explorer-${stamp}.jsonl`);
fs.writeFileSync(outPath, unique.map((f) => JSON.stringify(f)).join("\n") + "\n");

console.log(`\n── Explorer complete: ${unique.length} unique failure(s), ${fresh.length} NEW ──`);
const counts = {};
for (const f of unique) counts[f.kind] = (counts[f.kind] || 0) + 1;
console.log(JSON.stringify(counts));
for (const f of fresh.slice(0, 40)) console.log(`  [NEW] ${f.kind} · ${f.persona}/${f.viewport} · ${f.page} · ${f.detail.slice(0, 120)}`);
if (fresh.length > 40) console.log(`  … and ${fresh.length - 40} more (see ${outPath})`);

if (UPDATE_KNOWN) {
  const merged = new Set([...known, ...unique.map((f) => f.fp)]);
  fs.writeFileSync(KNOWN_PATH, JSON.stringify([...merged], null, 2));
  console.log(`Known ledger updated: ${merged.size} fingerprint(s).`);
}
process.exit(0);
