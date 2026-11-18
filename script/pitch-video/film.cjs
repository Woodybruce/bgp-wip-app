// Films the app footage for the Landsec pitch video on the LOCAL demo copy.
//
//   LIVE_DIR=<saved API replies> OUT_DIR=<folder> node script/pitch-video/film.cjs <scene> [<scene> ...]
//
// One clip per scene (webm), with a drawn mouse pointer, eased movement and
// slow scrolling. Each clip's first seconds are page loading: the line
// "<scene> trim <seconds>" printed at the end is where the cut starts.
const fs = require("fs");
const path = require("path");
// Inside the repo "playwright" is the project's own copy; PLAYWRIGHT_PATH names
// the machine's, which has a browser and a video encoder installed.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const BASE = process.env.DEMO_BASE || "http://localhost:5100";
if (!/^http:\/\/localhost:/.test(BASE)) { console.error("film.cjs only films the local demo copy"); process.exit(1); }
const OUT = process.env.OUT_DIR || path.join(process.cwd(), "pitch-video-clips");
const LIVE = process.env.LIVE_DIR || "";
const PASSWORD = (fs.readFileSync(path.join(__dirname, "../../qa/smoke.mjs"), "utf8").match(/const PASSWORD = '([^']+)'/) || [])[1];
const W = 1600, H = 900;

const BLUEWATER = "23b98b43-c5a4-4c16-9eaa-a674f7139749";
const BK_ROW = "b553225f-f020-4845-a86c-c67fabe6128f";
const BK_UNIT = "c0868396-f74b-4661-83e1-ebf7c6bcb062";
const JERSEY_MIKES = "226e6ac9-a1e2-4a7c-8210-e35d87f2df0d";
const LEASING = "jonny.rushton@landsec.com";   // Jonny Rushton, Portfolio Leasing Manager: the login the Landsec scenes are filmed as
const BK_DEAL = "8f3b56ee-65dc-4d8e-87da-1ae9c5b02bfe";
// Jonny Rushton as a person on the unit's Targeting Brief (the staging script
// makes it; a brief made again has a new id, which LEASING_PERSON then names).
const LEASING_PERSON = process.env.LEASING_PERSON || "56d3f740-c257-4074-a229-603022cd3555";
// Will Harvey, the senior asset manager, on the same brief. Agreeing the Heads
// of Terms and the decision on the recommendation are his, so those two scenes
// are filmed as him.
const ASSET = "will.harvey@landsec.com";
const ASSET_PERSON = process.env.ASSET_PERSON || "dda4afc0-ec05-4fbf-984d-6ca4c048360f";

// The phone scenes (staged by stage-phone.cjs). The Liverpool ONE unit that is
// shared on film, and the photos added on film: PHONE_PHOTOS is a comma
// separated list of three jpg files, added to the brand from its own page.
// They are kept outside the repo.
const SHARE_UNIT = "134b127e-c128-444e-9ae1-d9189b3947da";
const PHONE_COMMENT = "Met Richard Willcox after the viewing. Jersey Mike's want the service charge budget and a second look at the frontage.";
const PHONE_PHOTOS = (process.env.PHONE_PHOTOS || "").split(",").map(f => f.trim()).filter(Boolean);

// A BGP staff login has no client colours to wait for (Shot.goto would wait
// out its whole allowance for them), so the phone scenes open a page here.
async function openPhone(s, p, settle = 2500) {
  await s.page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 120000 });
  try { await s.page.waitForLoadState("networkidle", { timeout: 20000 }); } catch {}
  await s.wait(settle);
}

const POINTER = `
(() => {
  if (window.__pointer) return;
  const make = () => {
    const el = document.createElement('div');
    el.id = '__film_pointer';
    el.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);transition:none';
    el.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M3 2 L3 20 L8 15.5 L11.5 23 L14.5 21.7 L11 14.3 L18 14.3 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const ring = document.createElement('div');
    ring.id = '__film_ring';
    ring.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid rgba(184,98,47,.9);z-index:2147483646;pointer-events:none;opacity:0;transform:translate(-200px,-200px) scale(.4)';
    document.documentElement.appendChild(ring);
    document.documentElement.appendChild(el);
    window.__pointer = el;
    document.addEventListener('mousemove', e => { el.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; }, true);
    document.addEventListener('mousedown', e => {
      ring.style.transition = 'none'; ring.style.opacity = '1';
      ring.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(.4)';
      requestAnimationFrame(() => { ring.style.transition = 'transform .35s ease-out, opacity .45s ease-out'; ring.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px) scale(1.25)'; ring.style.opacity = '0'; });
    }, true);
  };
  if (document.documentElement) make(); else document.addEventListener('DOMContentLoaded', make);
})();`;

// FILM_TOKENS names a JSON file of { username: token } for the demo copy, so
// a long filming session does not run into the sign-in limit.
async function login(request, username) {
  try { const saved = JSON.parse(fs.readFileSync(process.env.FILM_TOKENS, "utf8"))[username]; if (saved) return saved; } catch {}
  const r = await request.post(`${BASE}/api/auth/login`, { data: { username, password: PASSWORD } });
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error(`login failed for ${username}: ${r.status()}`);
  return j.token;
}

class Shot {
  constructor(page, name) { this.page = page; this.name = name; const size = page.viewportSize() || { width: W, height: H }; this.x = size.width / 2; this.y = size.height / 2; this.t0 = Date.now(); this.trim = 0; this.bad = []; }
  async wait(ms) { await this.page.waitForTimeout(ms); }
  // The cut starts here: everything before it is loading.
  async start() { await this.moveTo(this.x, this.y, 1); this.trim = (Date.now() - this.t0) / 1000; }
  async goto(p, settle = 2500) {
    await this.page.goto(BASE + p, { waitUntil: "domcontentloaded", timeout: 120000 });
    try { await this.page.waitForLoadState("networkidle", { timeout: 30000 }); } catch {}
    // The client's own colours arrive a little after the page: never start
    // a cut before them, or the side bar changes colour mid-shot.
    try { await this.page.waitForFunction(() => !!document.documentElement.style.getPropertyValue("--sidebar"), null, { timeout: 45000 }); } catch {}
    await this.wait(settle);
  }
  async moveTo(x, y, ms = 700) {
    const steps = Math.max(1, Math.round(ms / 16));
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      if (steps > 1) await this.wait(14);
    }
    this.x = x; this.y = y;
  }
  loc(target) { return typeof target === "string" ? this.page.locator(target).first() : target; }
  async over(target, ms = 800, at = {}) {
    const l = this.loc(target);
    await l.waitFor({ state: "visible", timeout: 20000 });
    await l.scrollIntoViewIfNeeded().catch(() => {});
    await this.wait(250);
    const b = await l.boundingBox();
    if (!b) throw new Error(`${this.name}: nothing to point at`);
    await this.moveTo(b.x + b.width * (at.fx ?? 0.5), b.y + b.height * (at.fy ?? 0.5), ms);
  }
  async click(target, { before = 350, after = 900, ms = 800, at } = {}) {
    await this.over(target, ms, at);
    await this.wait(before);
    await this.page.mouse.down(); await this.wait(70); await this.page.mouse.up();
    await this.wait(after);
  }
  async scroll(dy, ms = 1200) {
    const steps = Math.max(1, Math.round(ms / 16));
    for (let i = 0; i < steps; i++) { await this.page.mouse.wheel(0, dy / steps); await this.wait(16); }
    await this.wait(300);
  }
  async type(text, perKey = 55) { await this.page.keyboard.type(text, { delay: perKey }); }
  // A long note, a word at a time: a heavy form redraws on every key, which
  // makes key-by-key typing crawl on film.
  async write(text, perWord = 130) {
    for (const word of text.split(/(?<= )/)) { await this.page.keyboard.insertText(word); await this.wait(perWord); }
  }
}

// The Brand gap board and a centre's box are replayed from the live app's own
// answers for Bluewater (the demo copy holds too few store locations to work
// them out), cut to what a client login is sent.
async function replayBrandGap(page) {
  if (!LIVE) return;
  const gaps = JSON.parse(fs.readFileSync(path.join(LIVE, "gaps.json"), "utf8"));
  gaps.canWant = false;
  for (const t of gaps.targets || []) {
    t.has_live_requirement = false;
    t.requirement_note = t.requirement_listing || null;
    if (!t.requirement_listing) { t.has_requirement = false; t.requirement = null; }
  }
  gaps.matchingRequirements = (gaps.matchingRequirements || []).filter(r => r.listing).map(({ state, ...r }) => ({ ...r, reason: r.listing }));
  await page.route(/\/api\/property\/[^/]+\/brand-gaps/, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(gaps) }));
  const centre = path.join(LIVE, "centre-lakeside.json");
  if (fs.existsSync(centre)) {
    const box = JSON.parse(fs.readFileSync(centre, "utf8"));
    box.propertyId = null;
    await page.route(/\/api\/benchmark-centres\/Lakeside/, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(box) }));
  }
}

// Brand logos: the demo copy holds none, so a logo the page asks for is read
// once from the live app (one image GET, as opening the page there would) and
// kept on disk. LOGO_SOURCE and LOGO_TOKEN name where; without them the
// pages draw initials.
async function replayLogos(context) {
  const source = process.env.LOGO_SOURCE, token = process.env.LOGO_TOKEN;
  if (!LIVE || !source || !token) return;
  const dir = path.join(LIVE, "logos");
  fs.mkdirSync(dir, { recursive: true });
  await context.route(/\/api\/brand-logo\//, async route => {
    const u = new URL(route.request().url());
    u.searchParams.delete("logoRetry");
    const key = Buffer.from(u.pathname + "?" + u.searchParams.toString()).toString("base64url").slice(0, 180);
    const file = path.join(dir, key);
    try {
      if (!fs.existsSync(file)) {
        const r = await fetch(source + u.pathname + u.search, { headers: { authorization: `Bearer ${token}` } });
        fs.writeFileSync(file, r.ok ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0));
        if (r.ok) fs.writeFileSync(file + ".type", r.headers.get("content-type") || "image/png");
      }
      const body = fs.readFileSync(file);
      if (!body.length) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: 200, contentType: fs.readFileSync(file + ".type", "utf8"), body });
    } catch { return route.fulfill({ status: 404, contentType: "application/json", body: "{}" }); }
  });
}

const SCENES = {
  // 3. Properties: the 14 schemes, then into Bluewater.
  async properties(s) {
    await s.goto("/deals/properties");
    await s.start();
    await s.wait(1200);
    await s.over('text=/14 schemes/', 900);
    await s.wait(1400);
    await s.over('[data-testid="landsec-scheme-liverpool-one"]', 900);
    await s.scroll(520, 2200);
    await s.wait(900);
    await s.over('[data-testid="landsec-scheme-bluewater"]', 900);
    await s.wait(900);
    await s.click('[data-testid="landsec-scheme-link-bluewater"]', { after: 3500 });
    await s.wait(1500);
  },

  // 4. Bluewater: the plan and the schedule, and the Burger King unit.
  async unit(s) {
    await s.goto(`/properties/${BLUEWATER}`, 3500);
    await s.start();
    await s.wait(1000);
    await s.over('[data-testid="property-unit-list"]', 900, { fy: 0.1 });
    await s.scroll(330, 1800);
    await s.wait(900);
    await s.over('[data-testid="plan-canvas"]', 900);
    await s.wait(600);
    await s.click(`[data-testid^="plan-shape-"]:has-text("L057"), [data-testid="plan-canvas"] >> text=L057`, { after: 2200 }).catch(async () => {
      await s.page.evaluate(id => { location.hash = `tenancy-unit-${id}`; }, BK_ROW);
      await s.wait(2200);
    });
    await s.over('[data-testid="property-unit-key-figures"]', 900);
    await s.wait(2200);
    await s.over('[data-testid="property-unit-panel"]', 700, { fy: 0.6 });
    await s.scroll(380, 2000);
    await s.wait(2200);
  },

  // 5. Brand gap: who is missing, and the competing centres.
  async gap(s) {
    await replayBrandGap(s.page);
    await s.goto(`/properties/${BLUEWATER}`, 3000);
    await s.over('button:has-text("Brand gap")', 10);
    await s.scroll(330, 400);
    await s.click('button:has-text("Brand gap")', { before: 100, after: 4000 });
    await s.scroll(210, 400);
    await s.wait(1500);
    await s.start();
    await s.wait(1200);
    await s.over('text=/Rank against the top centres/i', 900);
    await s.wait(1400);
    await s.over('text=/Targets with a requirement/i', 900);
    await s.wait(1200);
    await s.scroll(330, 2200);
    await s.wait(2600);
    await s.click('button:has-text("Competing centres")', { after: 2200 });
    await s.wait(1500);
    await s.click('[data-testid="gap-centre-open-Lakeside"]', { after: 3000 });
    await s.wait(3200);
    await s.page.keyboard.press("Escape");
    await s.wait(900);
  },

  // 6. Jersey Mike's: the brand page and its Expansion score.
  // Its agent (the Tenant rep line) and its chief executive (Key contacts) are
  // passed over on the way, under People & checks.
  async brand(s) {
    await s.goto(`/companies/${JERSEY_MIKES}`, 3000);
    await s.start();
    await s.wait(600);
    await s.over('text=/Entering UK/', 600);
    await s.wait(400);
    await s.click('button:has-text("People & checks")', { before: 250, after: 1100, ms: 700 });
    // (The Overview stays in the page, hidden, and names him in its Activity card: point at the one that shows.)
    await s.over('text=Richard Willcox >> visible=true', 700);
    await s.wait(1300);
    await s.over('text=Satnam Leihal >> visible=true', 600);
    await s.wait(1100);
    await s.click('button:has-text("Expansion")', { before: 250, after: 1800 });
    await s.wait(500);
    await s.scroll(300, 1600);
    await s.wait(1500);
  },

  // 7. The Targeting Brief: the Landsec leasing manager agrees it.
  async brief(s) {
    await s.goto(`/deals/letting?propertyId=${BLUEWATER}`, 3000);
    // The People tab also offers "the usual team for this scheme" from the app's
    // team sheet, which is older than this cast: it is left out of the picture.
    await s.page.addStyleTag({ content: '[data-testid="brief-people-suggested"]{display:none!important}' });
    await s.page.locator(`[data-testid="row-unit-${BK_UNIT}"]`).scrollIntoViewIfNeeded().catch(() => {});
    await s.wait(800);
    await s.start();
    await s.over(`[data-testid="row-unit-${BK_UNIT}"]`, 900, { fx: 0.2 });
    await s.wait(900);
    await s.click(`[data-testid="brief-chip-${BK_UNIT}"], [data-testid="button-brief-${BK_UNIT}"]`, { after: 2500 });
    await s.over('[data-testid="unit-brief-dialog"]', 800, { fy: 0.35 });
    await s.scroll(320, 2200);
    await s.wait(1800);
    await s.click('[data-testid="brief-tab-people"]', { after: 1800 });
    await s.wait(1500);
    await s.click(`[data-testid="brief-person-agree-${LEASING_PERSON}"]`, { before: 700, after: 2500 });
    await s.over('[data-testid="brief-approval-status"]', 800).catch(() => {});
    await s.wait(2500);
  },

  // 8. The offer, typed as a plain note; the form fills itself.
  async offer(s) {
    await s.goto(`/deals/letting?unit=${BK_UNIT}&offer=1`, 3000);
    await s.page.locator('[data-testid="offer-company"]').waitFor({ state: "visible", timeout: 20000 });
    await s.start();
    await s.wait(800);
    await s.click('[data-testid="offer-company"]', { after: 700 });
    await s.write("Jersey Mike's", 200);
    await s.wait(1200);
    await s.click(s.page.locator('[role="option"]').filter({ hasText: /^Jersey Mike's$/ }).first(), { after: 900 });
    await s.click('[data-testid="offer-comments"]', { after: 500 });
    await s.write("Offered: 15 year lease. Rent £275k pax and 9% t/o. 6 MRF");
    await s.wait(700);
    await s.click('[data-testid="note-fill-read"]', { after: 2500 }).catch(async () => { await s.page.keyboard.press("Tab"); await s.wait(2500); });
    for (const box of ["offer-rent", "offer-turnover", "offer-rent-free", "offer-term"]) { await s.over(`[data-testid="${box}"]`, 600).catch(() => {}); await s.wait(700); }
    await s.wait(800);
    await s.click('[data-testid="offer-save"]', { before: 600, after: 3000 });
    await s.wait(1500);
  },

  // 9a. Heads of Terms on the scheme's own form; the senior asset manager signs off.
  async hots(s) {
    await s.goto(`/deals/letting?propertyId=${BLUEWATER}`, 3000);
    await s.page.locator(`[data-testid="row-unit-${BK_UNIT}"]`).scrollIntoViewIfNeeded().catch(() => {});
    await s.wait(800);
    await s.start();
    await s.click(`[data-testid="button-hots-${BK_UNIT}"]`, { after: 3000 });
    await s.over('[data-testid="hots-draft-text"]', 800, { fy: 0.3 }).catch(() => {});
    await s.scroll(500, 3000);
    await s.wait(1500);
    await s.click(`[data-testid="hots-agree-${ASSET_PERSON}"]`, { before: 700, after: 3000 });
    await s.wait(1500);
  },

  // 9b. The checklist, and what the deal is waiting on.
  async checklist(s) {
    await s.goto(`/deals/letting?unit=${BK_UNIT}&checklist=1`, 3000);
    await s.page.locator('[data-testid="checklist-dialog"]').waitFor({ state: "visible", timeout: 20000 });
    await s.start();
    await s.over('[data-testid="checklist-dialog"]', 800, { fy: 0.3 });
    await s.wait(1500);
    await s.scroll(380, 2600);
    await s.wait(2200);
    await s.page.keyboard.press("Escape");
    await s.goto("/deals", 2500);
    await s.click('[data-testid="input-search-deals"]', { after: 300 });
    await s.type("L057", 80);
    await s.wait(1800);
    await s.over(`[data-testid="deal-clock-waiting-${BK_DEAL}"]`, 900).catch(() => {});
    await s.wait(3000);
  },

  // 10. The recommendation in Landsec's template, then the diary.
  async recommendation(s) {
    await s.goto(`/deals/letting?unit=${BK_UNIT}&recommendation=1`, 3000);
    await s.page.locator('[data-testid="recommendation-dialog"]').waitFor({ state: "visible", timeout: 20000 });
    await s.start();
    await s.over('[data-testid="recommendation-dialog"]', 800, { fy: 0.3 });
    await s.wait(1500);
    await s.scroll(600, 3500);
    await s.wait(1500);
    await s.scroll(600, 3000);
    await s.wait(1200);
    await s.click(`[data-testid="recommendation-approve-${ASSET_PERSON}"]`, { before: 700, after: 3000 }).catch(() => {});
    await s.wait(1200);
    await s.wait(1500);
  },

  // 10c. The property's one conversation, with the team's comments on the unit.
  async conversation(s) {
    await s.goto(`/properties/${BLUEWATER}`, 3500);
    await s.start();
    await s.wait(800);
    await s.moveTo(1180, 420, 1000);
    await s.wait(4500);
  },

  // 10d. The people kept informed (a Landsec login that signs nothing): she
  // reads the conversation, where two of them have commented, and the task she
  // set for BGP's lead agent is on her Tasks page under Assigned by me.
  async informed(s) {
    await s.goto(`/properties/${BLUEWATER}`, 3500);
    await s.start();
    await s.wait(700);
    await s.moveTo(1180, 440, 900);
    await s.wait(3600);
    await s.goto("/tasks", 2500);
    await s.click('[data-testid="filter-assigned-by-me"]', { before: 400, after: 1500 });
    await s.over('text=/fit-out programme/', 900, { fx: 0.3 });
    await s.wait(3200);
  },

  // 1b. The phone: the same app in the hand (filmed at phone size).
  async phone(s) {
    await s.goto("/deals/properties", 3000);
    await s.start();
    await s.moveTo(195, 520, 600);
    await s.wait(1200);
    await s.scroll(520, 1800);
    await s.wait(1200);
    await s.click('[data-testid="bottom-nav-deals"]', { after: 3200, ms: 600 });
    await s.click('[data-testid="bottom-nav-tasks"]', { after: 3200, ms: 600 });
    await s.click('[data-testid="bottom-nav-tracker"]', { after: 3200, ms: 600 });
  },

  // 13a. The phone in the hand after the meeting: Jersey Mike's page, its
  // agent under Tenant rep, and Call beside his name.
  // 16. The phone opens on ChatBGP and is asked a question (needs an AI key
  // on the demo server; the wait is for the real answer).
  async phoneAsk(s) {
    await openPhone(s, "/", 3500);
    await s.page.locator('[data-testid="input-mobile-chat"]').first().waitFor({ state: "visible", timeout: 30000 });
    try { await s.page.waitForFunction(() => !!document.documentElement.style.getPropertyValue("--sidebar"), null, { timeout: 45000 }); } catch {}
    await s.wait(1000);
    await s.start();
    await s.wait(1800);
    await s.click('[data-testid="input-mobile-chat"]', { after: 500, ms: 600 });
    await s.write(process.env.PHONE_QUESTION || "What is the Burger King unit at Bluewater waiting on?", 120);
    await s.wait(600);
    await s.click('[data-testid="button-mobile-send"]', { after: 1500, ms: 500 });
    // The answer takes a while: wait while the chat shows it is still at work
    // (its Stop button; the progress line changes as tools run), then for the
    // text to stop changing.
    const composing = () => s.page.evaluate(() => !!document.querySelector('[data-testid="button-mobile-stop-generating"]') || /Composing response/.test(document.body.innerText));
    for (let i = 0; i < 80 && await composing(); i++) await s.wait(1500);
    await s.wait(1200);
    // The text has stopped changing when the page's words hold still.
    let last = -1, still = 0;
    for (let i = 0; i < 40 && still < 3; i++) {
      const size = await s.page.evaluate(() => document.body.innerText.length);
      still = size === last ? still + 1 : 0;
      last = size;
      await s.wait(500);
    }
    // The answer lands scrolled to its end, and the chat pulls itself back to
    // the end each time its messages are read again. Go up to the question
    // in the chat's own scroll box and hold it there, so the clip ends on the
    // question and the first screenful of the answer.
    await s.page.evaluate(q => {
      // The bubble holds the words and the time side by side, so no element's
      // text is the question alone: take the innermost one that starts with it.
      const holds = e => (e.textContent || "").trim().startsWith(q);
      const hit = [...document.querySelectorAll("p, div, span")].filter(e => holds(e) && ![...e.children].some(holds)).pop();
      if (!hit) return;
      let box = hit.parentElement;
      while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 4)) box = box.parentElement;
      if (!box) return;
      const top = Math.max(0, box.scrollTop + hit.getBoundingClientRect().top - box.getBoundingClientRect().top - 20);
      box.scrollTo({ top, behavior: "smooth" });
      setTimeout(() => setInterval(() => { if (Math.abs(box.scrollTop - top) > 2) box.scrollTop = top; }, 50), 900);
    }, process.env.PHONE_QUESTION || "What is the Burger King unit at Bluewater waiting on?");
    await s.wait(1000);
    await s.wait(3200);
  },

  async phoneCall(s) {
    await openPhone(s, `/companies/${JERSEY_MIKES}`, 3000);
    await s.start();
    await s.wait(900);
    await s.click('[data-testid="company-section-contacts"]', { after: 1300, ms: 600 });
    await s.over('[data-testid="company-phone-represented-by"]', 700, { fx: 0.3 });
    await s.wait(1500);
    await s.over('[data-testid^="tenant-rep-call-"]', 700);
    await s.wait(600);
    // A tel: link opens the phone's dialler; in the filming browser nothing follows the tap.
    await s.click('[data-testid^="tenant-rep-call-"]', { before: 100, after: 2500, ms: 100 });
  },

  // 13b. A comment on the unit from the Letting Tracker; it lands in the
  // property's one conversation.
  async phoneComment(s) {
    await openPhone(s, "/available", 3000);
    await s.start();
    await s.wait(400);
    await s.click('[data-testid="input-search-units"]', { before: 200, after: 300, ms: 500 });
    await s.type("L057", 90);
    await s.wait(900);
    // The comment box takes the cursor as it opens.
    await s.click(`[data-testid="unit-comments-${BK_UNIT}"]`, { before: 200, after: 900, ms: 500 });
    await s.page.locator(`[data-testid="unit-comment-input-${BK_UNIT}"]`).focus();
    await s.write(PHONE_COMMENT, 80);
    await s.wait(300);
    await s.click('button[aria-label="Post comment"]', { before: 150, after: 1200, ms: 400 });
    await s.over(s.page.locator(`[data-testid="unit-comments-list-${BK_UNIT}"] > div`).last(), 400);
    await s.wait(1000);
    await s.page.keyboard.press("Escape");
    await s.wait(300);
    await s.over(`[data-testid="unit-comments-${BK_UNIT}"]`, 400);
    await s.wait(900);
  },

  // 13c. Photos from the phone: three added at once from Jersey Mike's own
  // page (News & media), shown there and as the page's cover.
  async phonePhotos(s) {
    if (PHONE_PHOTOS.length < 3) throw new Error("PHONE_PHOTOS must name three jpg files");
    const files = PHONE_PHOTOS.slice(0, 3).map((file, i) => ({ name: `jersey-mikes-argyll-street-${i + 1}.jpg`, mimeType: "image/jpeg", buffer: fs.readFileSync(file) }));
    await openPhone(s, `/companies/${JERSEY_MIKES}`, 3000);
    await s.start();
    await s.wait(800);
    await s.click('[data-testid="company-section-social"]', { after: 1200, ms: 600 });
    // The Photos card to the middle of the screen (a message appears at the foot).
    const centre = id => s.page.evaluate(t => document.querySelector(`[data-testid="${t}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), id);
    await centre("brand-photos-card");
    await s.wait(900);
    await s.over('[data-testid="brand-add-photos"]', 600);
    await s.wait(400);
    // The tap opens the phone's photo picker, which cannot be filmed: the
    // files are handed to the page's own file input.
    let chosen = false;
    s.page.once("filechooser", chooser => { chosen = true; chooser.setFiles(files).catch(() => {}); });
    await s.click('[data-testid="brand-add-photos"]', { before: 100, after: 600, ms: 100 });
    if (!chosen) await s.page.locator('[data-testid="brand-add-photos-input"]').setInputFiles(files);
    await s.page.locator('[data-testid^="brand-photo-"]').nth(2).waitFor({ state: "visible", timeout: 45000 });
    await centre("brand-photos-card");
    await s.wait(600);
    // The confirmation sits over the foot of the screen: close it to see the photos.
    await s.click('[toast-close]', { before: 500, after: 500, ms: 400 }).catch(() => {});
    await s.over('[data-testid="brand-photos-grid"]', 400);
    await s.wait(1300);
    // Back up the page: the first of them is its cover.
    await s.page.evaluate(() => document.querySelector('[data-testid="brand-overview-image"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
    await s.moveTo(195, 300, 600);
    await s.wait(1400);
  },

  // 13d. Share with a brand: a Liverpool ONE unit, for Jersey Mike's, sent to
  // its agent (its tenant rep is offered with the brand's own contacts) as
  // one PDF. The share is logged against the brand.
  async phoneShare(s) {
    await openPhone(s, "/available", 3000);
    // The brand picker lists every company in the CRM, which takes some
    // seconds the first time it is asked for: ask before the cut starts.
    await s.page.evaluate(async () => {
      const token = localStorage.getItem("bgp_auth_token");
      await fetch("/api/crm/companies", { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => {});
    });
    // The unit is found before the cut: the cut opens on its card.
    await s.page.locator('[data-testid="input-search-units"]').fill("P7");
    await s.page.locator(`[data-testid="mobile-unit-${SHARE_UNIT}"]`).waitFor({ state: "visible", timeout: 20000 });
    await s.page.locator('[data-testid="input-search-units"]').blur();
    // The card's menu is opened before the cut too: the cut opens on Share with a brand.
    await s.click(`[data-testid="button-more-${SHARE_UNIT}"]`, { before: 150, after: 800, ms: 400 });
    await s.start();
    await s.wait(500);
    await s.click(`[data-testid="unit-share-${SHARE_UNIT}"]`, { before: 100, after: 800, ms: 350 });
    await s.click('[data-testid="unit-share-company"]', { before: 100, after: 300, ms: 350 });
    await s.write("Jersey", 120);
    await s.click(s.page.locator('[role="option"]').filter({ hasText: /^Jersey Mike's$/ }).first(), { before: 200, after: 500, ms: 300 });
    await s.click('[data-testid="unit-share-contact"]', { before: 100, after: 450, ms: 300 });
    await s.click(s.page.locator('[role="option"]').filter({ hasText: /Richard Willcox/ }).first(), { before: 500, after: 600, ms: 300 });
    await s.click('[data-testid="unit-share-send"]', { before: 200, after: 1300, ms: 400 });
    await s.wait(1300);
  },

  // 12. A joint agent's own login: his schemes only, the same tools.
  async agent(s) {
    await s.goto("/deals/properties", 3000);
    await s.start();
    await s.wait(1500);
    await s.over('[data-testid="landsec-scheme-liverpool-one"]', 900);
    await s.wait(1500);
    await s.click('[data-testid="landsec-scheme-link-liverpool-one"]', { after: 4500 });
    await s.click('input[placeholder^="Message about"], textarea[placeholder^="Message about"]', { after: 500 });
    await s.write("Second viewing on P3R is confirmed for Friday. I'll log the outcome on the tracker.", 110);
    await s.wait(600);
    await s.click('button:has-text("Send")', { after: 2500 });
    await s.wait(1500);
    await s.goto("/landsec/tracker", 2500);
    await s.moveTo(820, 430, 900);
    await s.wait(3000);
  },

  // 10b. The diary: viewings, meetings and the CRM plan in one calendar.
  async calendar(s) {
    await s.goto("/landsec/calendar", 3000);
    await s.start();
    await s.moveTo(820, 420, 900);
    await s.wait(1800);
    await s.moveTo(1100, 560, 1100);
    await s.wait(2500);
  },
};

// Who a scene is filmed as, and at what size, when it is not the leasing
// manager at a desk.
const SCENE_SETUP = {
  phone: { phone: true },
  agent: { user: "david.bell@jointagent.demo" },
  phoneAsk: { phone: true, user: LEASING },
  informed: { user: "becs.blenkinsop@landsec.com" },
  // The offer is typed by BGP's lead agent in the Landsec workspace (the staging
  // script switches her to it first: stage-letting.cjs viewas Landsec).
  offer: { user: "millie@brucegillinghampollard.com" },
  hots: { user: ASSET },
  recommendation: { user: ASSET },
  phoneCall: { phone: true, user: "md" },
  phoneComment: { phone: true, user: "md" },
  phonePhotos: { phone: true, user: "md" },
  phoneShare: { phone: true, user: "md" },
};
const PHONE = { width: 390, height: 844 };

(async () => {
  const wanted = process.argv.slice(2);
  if (!wanted.length) { console.log("scenes:", Object.keys(SCENES).join(", ")); return; }
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const name of wanted) {
    const scene = SCENES[name];
    if (!scene) { console.error("no scene", name); continue; }
    const dir = path.join(OUT, `.${name}`);
    fs.rmSync(dir, { recursive: true, force: true });
    const setup = SCENE_SETUP[name] || {};
    const ctx = await browser.newContext(setup.phone
      ? { viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
          userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          recordVideo: { dir, size: { width: PHONE.width * 2, height: PHONE.height * 2 } } }
      : { viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir, size: { width: W, height: H } } });
    const token = await login(ctx.request, setup.user || process.env.FILM_USER || LEASING);
    await ctx.addInitScript(t => { try { localStorage.setItem("bgp_auth_token", t); } catch {} }, token);
    // On a phone the pointer is a fingertip, not an arrow.
    await ctx.addInitScript(setup.phone ? POINTER.replace(/<svg[\s\S]*?<\/svg>/, '<div style="width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:rgba(20,20,20,.28);border:2px solid rgba(255,255,255,.85)"></div>') : POINTER);
    await replayLogos(ctx);
    const page = await ctx.newPage();
    const shot = new Shot(page, name);
    page.on("response", r => { if (r.url().includes("/api/") && r.status() >= 400) shot.bad.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
    let error = null;
    try { await scene(shot); } catch (e) { error = e; }
    const video = page.video();
    await ctx.close();
    const file = path.join(OUT, `${name}.webm`);
    if (video) { fs.rmSync(file, { force: true }); fs.renameSync(await video.path(), file); }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${name} trim ${shot.trim.toFixed(2)} length ${((Date.now() - shot.t0) / 1000).toFixed(1)}${error ? ` FAILED: ${error.message.split("\n")[0]}` : ""}`);
    for (const b of [...new Set(shot.bad)].slice(0, 6)) console.log("   ", b);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
