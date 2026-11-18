// Stages one made-up letting on the DEMO copy of the app for the Landsec pitch
// video: Jersey Mike's taking L057 at Bluewater, from the Targeting Brief to
// Solicitors. Everything is done through the app's own HTTP API, as the
// people who would do it, so the records read as they would in real use.
//
//   node script/pitch-video/stage-letting.cjs <phase>
//
// Phases, in order (each is safe to run twice):
//   logins          Jonny Rushton = leasing manager; Will Harvey = asset manager (Bluewater)
//   brief           the Targeting Brief, its people and target; all agree but Jonny
//   viewing         one completed viewing by Jersey Mike's
//   snapshot        saves the unit as it now stands, for `reset` (run it before filming)
//   offer           the offer, a landlord counter, the tenant's reply, terms agreed
//   hots            standard HOTs, generated from the agreed offer; all agree but Will
//                   (agreeing the terms sits with the senior asset manager and Millie:
//                   his sign-off is the one pressed on film)
//   issue           Will agrees, HOTs issued (unit to HOTs), deal checklist started
//   recommendation  drafted and issued by Millie; the Landsec decision is left open
//   informed        the three Landsec people who are kept informed (Gemma Casey,
//                   Becs Blenkinsop, Mark Warne: logins with no Landsec role),
//                   their two comments in the property's conversation and the
//                   task one of them adds for Millie
//   solicitors      final HOTs uploaded, deal converted to Solicitors
// Also:
//   viewas <team|own>  the lead BGP agent's view, through the app's own switch:
//                   `viewas Landsec` before the offer is filmed (she types it in
//                   the Landsec workspace), `viewas own` straight after. Every
//                   other phase needs her on her own view.
//   status          prints where the unit stands (reads only)
//   reset           puts the unit back as it was at `snapshot` (see below)
//   tidy            removes the demo server's "could not email" line from the
//                   recommendation's history (demo database; see the phase)
//   fingerprint <file>   row count and checksum of every table, to compare runs
//
// `reset` is the one part that is not the app's own API: the app has no route
// that takes back issued Heads of Terms, a checklist or a recommendation. It
// restores the rows saved by `snapshot` and removes what was made since, in
// one transaction, in the demo database only.
//
// It only ever talks to the local demo (localhost) and the bgpdemo database.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Pool } = require("pg");

const BASE = process.env.DEMO_BASE || "http://localhost:5100";
const DB_URL = process.env.DEMO_DATABASE_URL || "postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpdemo";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("DEMO_BASE must be the local demo (http://localhost:<port>)"); process.exit(1); }
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\/bgpdemo(\?|$)/.test(DB_URL)) { console.error("DEMO_DATABASE_URL must name the local bgpdemo database"); process.exit(1); }
const SNAPSHOT_FILE = process.env.STAGE_SNAPSHOT || path.join(os.homedir(), ".bgp-pitch-video", "stage-letting-snapshot.json");

// The shared demo password is kept in one place, the smoke suite.
function demoPassword() {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "qa", "smoke.mjs"), "utf8");
  const m = src.match(/const PASSWORD = '([^']+)'/);
  if (!m) throw new Error("PASSWORD not found in qa/smoke.mjs; set DEMO_PASSWORD");
  return m[1];
}

// ---- The demo facts ---------------------------------------------------------
const PROPERTY = "23b98b43-c5a4-4c16-9eaa-a674f7139749"; // Bluewater Shopping Centre
const UNIT = "c0868396-f74b-4661-83e1-ebf7c6bcb062";     // L057 Bluewater - Lower Level (tracker row)
const DEAL = "8f3b56ee-65dc-4d8e-87da-1ae9c5b02bfe";     // Ref 3550
const TENANCY = "b553225f-f020-4845-a86c-c67fabe6128f";  // its tenancy schedule row
const BRAND = { id: "226e6ac9-a1e2-4a7c-8210-e35d87f2df0d", name: "Jersey Mike's" };
const SCHEME = "bluewater";

const WHO = {
  admin: "victoria@brucegillinghampollard.com",
  millie: "millie@brucegillinghampollard.com",     // the lead BGP agent (Millie Edwards, Director)
  ben: "ben@brucegillinghampollard.com",           // Ben Sykes, in support
  jonny: "jonny.rushton@landsec.com",              // the Portfolio Leasing Manager (Jonny Rushton)
  will: "will.harvey@landsec.com",                 // the Senior Asset Manager for Bluewater (Will Harvey)
  // Kept informed: Landsec logins with no Landsec role, so the full view.
  gemma: "gemma.casey@landsec.com",                // Senior Asset Director
  becs: "becs.blenkinsop@landsec.com",             // Senior Leasing Manager (Retail)
  markw: "mark.warne@landsec.com",                 // Commercial Director
};
const WILL_NAME = "Will Harvey";

// A viewing is confirmed only with a contact at the brand, and the demo holds
// none for Jersey Mike's. This is a team, not an invented person.
const BRAND_CONTACT = { name: "Jersey Mike's UK property team", role: "Property" };

const BRIEF = {
  title: "Targeting Brief: L057 Lower Level, Bluewater",
  fields: {
    objective: "Relet L057 to a food brand that is new to Bluewater, ahead of the current lease ending on 24 December 2028. Improve on the passing rent of £264,537 a year.",
    locationContext: "Lower level food unit of 3,147 sq ft, trading as Burger King today.",
    targetCriteria: "Quick service and fast casual food brands with a proven UK format, a growing estate and a covenant that supports a 15 year lease.",
    priorityCategories: "Fast casual sandwiches and subs. Better burger. Chicken. Healthy bowls.",
    agentInstruction: "BGP to approach the target list, report to Landsec each week and bring every offer with a recommendation.",
    successMeasures: "Heads of Terms agreed with a priority A brand at or above the quoting rent, with no gap between tenants.",
    agencyBasis: "sole",
  },
  commercials: {
    quotingRentPa: 275000, ervPa: 264550, nerFloorPa: 255000, rentFreeMonthsMax: 9, leaseTermYears: 15,
    breakOption: "Tenant break no earlier than year 10",
    rentReview: "Every five years, upward only to open market rent",
    turnoverRentPct: 9,
    permittedUse: "Quick service restaurant and takeaway",
    otherTerms: "Turnover rent of 9% of net sales, paid as a top up where it is more than the base rent.",
  },
  target: {
    operatorName: BRAND.name, companyId: BRAND.id, category: "Fast casual subs", priority: "A", status: "Approached",
    rationale: "A growing UK estate and not yet trading at Bluewater. The format suits a lower level food unit of this size.",
  },
};

const VIEWING = {
  time: "11:00", outcome: "Interested",
  notes: "Walked the unit and the lower mall with the Jersey Mike's property team. They liked the frontage and asked for the service charge budget.",
  attendees: "Millie Edwards (BGP), Jersey Mike's UK property team",
};

// The note that is typed on film, and the terms it reads as.
const OFFER_NOTE = "Offered: 15 year lease. Rent £275k pax and 9% t/o. 6 MRF";
const FIRST_OFFER = { rentPa: 275000, turnoverRentPct: 9, rentFreeMonths: 6, termYears: 15 };
const COUNTER = {
  party: "landlord", rentPa: 285000, rentFreeMonths: 3,
  rentReview: "Every five years, upward only to open market rent",
  note: "Landsec countered at £285,000 a year with three months rent free and no break.",
};
const AGREED = {
  party: "tenant", rentPa: 280000, turnoverRentPct: 9, rentFreeMonths: 6, termYears: 15,
  breakOption: "Tenant break at year 10",
  rentReview: "Every five years, upward only to open market rent",
  note: "Jersey Mike's came back at £280,000 a year, six months rent free and a tenant break at year 10. Landsec accepted.",
};

const RECOMMENDATION = {
  terms: {
    handoverSpec: "Handed over in its existing condition with services capped. The tenant fits out at its own cost.",
    timing: "Exchange within eight weeks of solicitors being instructed. Access on vacant possession.",
    costs: "No landlord works and no capital contribution. Each side pays its own legal costs.",
    conditionality: "Subject to contract, Landsec approval and vacant possession from the current tenant.",
  },
  commentary: {
    againstErv: "The headline rent of £280,000 a year is about 6% above the ERV of £264,550 and £5,000 above the quoting rent. After six months rent free the net effective rent is about £270,700 a year, above the floor in the brief.",
    improvement: "We moved the rent from £275,000 to £280,000 and held rent free at six months against a ceiling of nine in the brief. We do not think there is more rent to find without losing the tenant.",
    strategyFit: "Yes. Jersey Mike's is a priority A target on the agreed brief and is a fast casual brand that is new to the centre.",
    turnoverView: "Jersey Mike's has not yet shared a sales forecast for this store. We have asked for one. The 9% turnover rent gives Landsec a share of trade above the base rent.",
    handover: "Existing condition with services capped. No landlord works are needed.",
    conditions: "Subject to contract, Landsec approval and vacant possession. The use does not change, so no planning condition is expected.",
    otherInterest: "One viewing has been held and this is the only offer. We do not expect a better one in the next quarter.",
    nextSteps: "With Landsec approval we will instruct solicitors on the agreed Heads of Terms and open the AML check on the tenant.",
  },
  recommendation: "proceed",
  summary: "We recommend Landsec proceeds with Jersey Mike's at £280,000 a year plus 9% turnover rent, on a 15 year lease with a tenant break at year 10 and six months rent free.",
};

// The first items of the standard checklist, in its order: who is responsible
// and whether it is ticked. The fifth is the first open required item, so it
// is what the deal is waiting on.
const CHECKLIST_PLAN = [
  { who: "millie", done: true },
  { who: "jonny", done: true },
  { who: "will", done: false },
  { who: "millie", done: false },
  { who: "jonny", done: false },
];

// ---- Plumbing ---------------------------------------------------------------
const pool = new Pool({ connectionString: DB_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const log = (...a) => console.log(...a);
const step = (ok, text) => log(`  ${ok ? "+" : "="} ${text}`); // + done now, = already so

// The app allows 20 sign-ins in 15 minutes, and every phase acts as several
// people. With STAGE_TOKENS naming a JSON file of { email: token }, a person's
// token is read from it; one who is not in it yet is given a token row in the
// demo database's auth_tokens (where the app keeps them) and added to the
// file. Without STAGE_TOKENS each person signs in with the password.
const TOKENS_FILE = process.env.STAGE_TOKENS || null;
const readTokens = () => (TOKENS_FILE && fs.existsSync(TOKENS_FILE) ? JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8") || "{}") : {});
async function passwordLogin(email) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: email, password: demoPassword() }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(`Sign-in failed for ${email}: ${r.status} ${j.message || j.error || ""}`);
  return { token: j.token, id: j.id, name: j.name };
}
const sessions = {};
async function login(who) {
  if (sessions[who]) return sessions[who];
  const email = WHO[who];
  if (TOKENS_FILE) {
    const [user] = await q(`SELECT id, name FROM users WHERE lower(email) = $1 AND is_active IS DISTINCT FROM false`, [email]);
    if (!user) throw new Error(`There is no active login for ${email} yet (run the logins phase)`);
    const tokens = readTokens();
    if (!tokens[email]) {
      tokens[email] = `film_${require("crypto").randomBytes(20).toString("hex")}`;
      await q(`INSERT INTO auth_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + interval '30 days')`, [tokens[email], user.id]);
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 1));
      log(`  (token for ${email} added to ${TOKENS_FILE})`);
    }
    sessions[who] = { token: tokens[email], id: user.id, name: user.name };
  } else sessions[who] = await passwordLogin(email);
  return sessions[who];
}
const idOf = async who => (await login(who)).id;

// One API call as a person. Returns { status, ok, body }; never throws on a refusal.
async function call(who, method, url, body, opts = {}) {
  const s = await login(who);
  const headers = { authorization: `Bearer ${s.token}` };
  let payload;
  if (opts.form) payload = opts.form;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const r = await fetch(`${BASE}${url}`, { method, headers, body: payload });
  if (opts.buffer) return { status: r.status, ok: r.ok, body: r.ok ? Buffer.from(await r.arrayBuffer()) : await r.json().catch(() => null) };
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { message: text.slice(0, 300) }; }
  return { status: r.status, ok: r.ok, body: parsed };
}
// The same, where a refusal stops the phase with the app's own words.
async function must(who, method, url, body, opts) {
  const r = await call(who, method, url, body, opts);
  if (!r.ok) {
    const e = new Error(`${method} ${url} as ${who}: ${r.status} ${r.body?.message || r.body?.error || JSON.stringify(r.body)}`);
    e.status = r.status; e.body = r.body;
    throw e;
  }
  return r.body;
}

const todayLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);
// The nearest weekday on or before a date.
function weekdayOnOrBefore(day) {
  let d = day;
  while ([0, 6].includes(new Date(`${d}T00:00:00.000Z`).getUTCDay())) d = addDays(d, -1);
  return d;
}
const isBrand = o => o.companyId === BRAND.id || /jersey\s*mike/i.test(String(o.companyName || ""));
const sameTerm = (a, b) => (a === null || a === undefined || a === "" ? "" : String(a).trim()) === (b === null || b === undefined || b === "" ? "" : String(b).trim());

async function briefOf() {
  const b = await must("millie", "GET", `/api/available-units/${UNIT}/brief`);
  return b && b.id ? b : null;
}
async function workspaceOf(briefId, who = "millie") {
  return must(who, "GET", `/api/unit-briefs/${briefId}/workspace`);
}

// ---- 1. logins --------------------------------------------------------------
async function phaseLogins() {
  log("logins");
  const list = await must("admin", "GET", "/api/landsec/access");
  if (!list.schemes.some(s => s.key === SCHEME)) throw new Error(`No scheme "${SCHEME}" in the Landsec registry`);
  const find = email => list.users.find(u => String(u.email).toLowerCase() === email);

  const jonny = find(WHO.jonny);
  if (!jonny) throw new Error("Jonny Rushton's login is not a Landsec client login in this demo");
  if (jonny.role !== "leasing_manager") {
    await must("admin", "POST", "/api/landsec/access", { email: WHO.jonny, role: "leasing_manager" });
    step(true, "Jonny Rushton is a Landsec leasing manager");
  } else step(false, "Jonny Rushton is a Landsec leasing manager");

  const will = find(WHO.will);
  const willRight = will && will.role === "asset_manager" && (will.schemes || []).length === 1 && will.schemes[0] === SCHEME && will.active;
  if (!willRight) {
    // A new login is created with the shared demo password by the route itself.
    await must("admin", "POST", "/api/landsec/access", {
      email: WHO.will, name: WILL_NAME, role: "asset_manager", schemes: [SCHEME], ...(will ? {} : { password: demoPassword() }),
    });
    step(true, `${WILL_NAME} is a Landsec asset manager for Bluewater${will ? "" : " (login created)"}`);
  } else step(false, `${WILL_NAME} is a Landsec asset manager for Bluewater`);

  // A new login is signed in once with the shared password, to prove it works.
  // A refusal here (the sign-in limit) does not undo the login that was made.
  if (!will && TOKENS_FILE) {
    await passwordLogin(WHO.will).then(() => log(`  check: ${WILL_NAME} signs in with the shared demo password`), e => log(`  sign-in not checked: ${e.message}`));
  }
  // Check: the panel shows the roles, and each login is answered as itself.
  const after = await must("admin", "GET", "/api/landsec/access");
  for (const who of ["jonny", "will"]) {
    const s = await login(who);
    const row = after.users.find(u => u.id === s.id);
    const me = await must(who, "GET", "/api/auth/me");
    log(`  check: ${me.name || me.user?.name} (${me.email || me.user?.email}) is signed in; Landsec role ${row?.role}; schemes ${row?.schemes?.length ? row.schemes.join(", ") : "all"}`);
  }
}

// ---- 2. brief ---------------------------------------------------------------
async function phaseBrief() {
  log("brief");
  let brief = await briefOf();
  if (!brief) {
    // The app's own Add brief: the unit is picked from the tenancy schedule,
    // which also ties the tracker row to that schedule row. Only when the
    // names agree, so it can never list a second unit.
    const [u] = await q(`SELECT unit_name, tenancy_unit_id FROM available_units WHERE id = $1`, [UNIT]);
    const [t] = await q(`SELECT coalesce(nullif(trim(unit_number), ''), premises) AS unit_name, property_id FROM tenancy_schedule_units WHERE id = $1`, [TENANCY]);
    const sameUnit = u && t && t.property_id === PROPERTY && String(t.unit_name || "").trim().toLowerCase() === String(u.unit_name || "").trim().toLowerCase()
      && (!u.tenancy_unit_id || u.tenancy_unit_id === TENANCY);
    const started = await must("millie", "POST", "/api/unit-briefs/start", sameUnit ? { tenancyUnitId: TENANCY, title: BRIEF.title } : { trackerUnitId: UNIT, title: BRIEF.title });
    if (started.unit?.id !== UNIT) throw new Error(`Add brief answered with another unit (${started.unit?.id}). Stop and look at the tracker.`);
    step(true, `brief started by Millie Edwards${sameUnit ? ", unit picked from the tenancy schedule" : ""} (deal #${started.dealRef})`);
    brief = await briefOf();
  } else step(false, "the unit has its brief");

  const saved = await must("millie", "PATCH", `/api/unit-briefs/${brief.id}`, { ...BRIEF.fields, commercials: BRIEF.commercials });
  step(!!saved.termsChanged, `terms and commercials (version ${saved.version})`);

  const people = [
    { who: "millie", role: "bgp_agent" }, { who: "ben", role: "bgp_agent" },
    { who: "jonny", role: "client_leasing" }, { who: "will", role: "senior_asset_manager" },
  ];
  let ws = await workspaceOf(brief.id);
  for (const p of people) {
    const s = await login(p.who);
    if (ws.people.some(x => x.userId === s.id)) { step(false, `${s.name} is on the brief`); continue; }
    await must("millie", "POST", `/api/unit-briefs/${brief.id}/people`, { role: p.role, userId: s.id });
    step(true, `${s.name} added to the brief`);
  }

  const withTargets = await briefOf();
  if ((withTargets.targets || []).some(t => t.companyId === BRAND.id || /jersey\s*mike/i.test(t.operatorName))) step(false, `${BRAND.name} is a target`);
  else {
    await must("millie", "POST", `/api/unit-briefs/${brief.id}/targets`, { ...BRIEF.target, agentUserIds: [await idOf("millie")] });
    step(true, `${BRAND.name} added as a priority A target`);
  }

  // Everyone agrees as themselves, except Jonny: that is pressed on film.
  ws = await workspaceOf(brief.id);
  for (const who of ["millie", "ben", "will"]) {
    const s = await login(who);
    const person = ws.people.find(x => x.userId === s.id);
    if (person.agreedAt && person.agreedVersion === ws.brief.version) { step(false, `${s.name} has agreed the brief`); continue; }
    await must(who, "POST", `/api/unit-briefs/people/${person.id}/agree`, { version: ws.brief.version });
    step(true, `${s.name} agreed the brief`);
  }

  ws = await workspaceOf(brief.id, "jonny");
  const mark = ws.people.find(x => x.userId === ws.viewer.userId);
  log(`  check (as Jonny Rushton): ${ws.approval.label}; version ${ws.brief.version}; Jonny ${mark?.agreedAt && mark.agreedVersion === ws.brief.version ? "HAS agreed" : "has not agreed yet"}; quoting rent £${ws.brief.commercials.quotingRentPa}; people ${ws.people.map(p => p.name).join(", ")}`);
}

// ---- 3. viewing -------------------------------------------------------------
async function brandContactId() {
  const have = await q(`SELECT id FROM crm_contacts WHERE company_id = $1 AND lower(name) = lower($2) LIMIT 1`, [BRAND.id, BRAND_CONTACT.name]);
  if (have[0]) return { id: have[0].id, made: false };
  const made = await must("millie", "POST", "/api/crm/contacts", { name: BRAND_CONTACT.name, role: BRAND_CONTACT.role, companyId: BRAND.id });
  return { id: made.id, made: true };
}
async function phaseViewing() {
  log("viewing");
  const contact = await brandContactId();
  step(contact.made, `contact at ${BRAND.name}: ${BRAND_CONTACT.name}`);
  const have = (await must("millie", "GET", `/api/available-units/${UNIT}/viewings`)).filter(isBrand);
  if (have.length) step(false, `${BRAND.name} viewing on ${have[0].viewingDate}`);
  else {
    const date = weekdayOnOrBefore(addDays(todayLondon(), -4));
    await must("millie", "POST", `/api/available-units/${UNIT}/viewings`, {
      companyId: BRAND.id, contactId: contact.id, viewingDate: date, viewingTime: VIEWING.time,
      outcome: VIEWING.outcome, notes: VIEWING.notes, attendees: VIEWING.attendees,
    });
    step(true, `completed viewing by ${BRAND.name} on ${date}`);
  }
  const seen = (await must("jonny", "GET", `/api/available-units/${UNIT}/viewings`)).filter(isBrand);
  for (const v of seen) log(`  check (as Jonny Rushton): ${v.companyName}, ${v.viewingDate} ${v.viewingTime || ""}, ${v.status}, outcome ${v.outcome}, details ${v.detailsConfirmedAt ? "confirmed" : "NOT confirmed"}`);
}

// ---- 4. offer ---------------------------------------------------------------
async function brandOffer() {
  const offers = (await must("millie", "GET", `/api/available-units/${UNIT}/offers`)).filter(isBrand).filter(o => !["Rejected", "Withdrawn", "Closed"].includes(o.status));
  return offers[offers.length - 1] || null;
}
async function phaseOffer() {
  log("offer");
  if (!fs.existsSync(SNAPSHOT_FILE)) await phaseSnapshot();
  const today = todayLondon();
  let offer = await brandOffer();
  if (!offer) {
    const contact = await brandContactId();
    offer = await must("millie", "POST", `/api/available-units/${UNIT}/offers`, {
      companyId: BRAND.id, companyName: BRAND.name, contactId: contact.id, contactName: BRAND_CONTACT.name,
      offerDate: addDays(today, -2), ...FIRST_OFFER, comments: OFFER_NOTE,
    });
    step(true, `first offer logged by Millie Edwards: £${FIRST_OFFER.rentPa} a year, ${FIRST_OFFER.turnoverRentPct}% turnover, ${FIRST_OFFER.rentFreeMonths} months rent free, ${FIRST_OFFER.termYears} years`);
  } else step(false, `an offer from ${offer.companyName} is on the unit (${offer.status})`);

  let neg = await must("millie", "GET", `/api/unit-offers/${offer.id}/negotiation`);
  if (neg.offer.status !== "Agreed") {
    const first = neg.rounds[0]?.roundDate || today;
    const counterDate = first >= addDays(today, -1) ? today : addDays(today, -1);
    if (neg.rounds.length === 1) {
      const { party, note, ...terms } = COUNTER;
      neg = await must("millie", "POST", `/api/unit-offers/${offer.id}/rounds`, { party, roundDate: counterDate, note, ...terms });
      step(true, `landlord counter: £${COUNTER.rentPa} a year, ${COUNTER.rentFreeMonths} months rent free`);
      // The screen offers this move when a unit still at Marketing gets its first counter.
      if (neg.suggestStatus === "NEG" && !process.env.STAGE_SKIP_NEG) {
        const moved = await must("millie", "PATCH", `/api/available-units/${UNIT}`, { marketingStatus: "NEG" });
        step(true, `unit moved to Negotiating${moved.mirrorWarning ? ` (${moved.mirrorWarning})` : ""}`);
      }
    } else step(false, `the negotiation has ${neg.rounds.length} positions`);
    // The position the terms are agreed at.
    const { party, note, ...terms } = AGREED;
    const atAgreed = Object.keys(terms).every(k => sameTerm(neg.offer[k], terms[k]));
    if (!atAgreed) {
      neg = await must("millie", "POST", `/api/unit-offers/${offer.id}/rounds`, { party, roundDate: today, note, ...terms });
      step(true, `tenant's reply: £${AGREED.rentPa} a year, ${AGREED.rentFreeMonths} months rent free, ${AGREED.breakOption.toLowerCase()}`);
    } else step(false, "the offer already stands at the agreed terms");
    neg = await must("millie", "POST", `/api/unit-offers/${offer.id}/status`, { status: "Agreed" });
    step(true, "terms agreed");
  } else step(false, "terms are agreed");

  neg = await must("jonny", "GET", `/api/unit-offers/${offer.id}/negotiation`);
  log(`  check (as Jonny Rushton): ${neg.offer.companyName}, ${neg.offer.status}, £${neg.offer.rentPa} a year, ${neg.offer.turnoverRentPct}% turnover, ${neg.offer.rentFreeMonths} months rent free, ${neg.offer.termYears} years, ${neg.offer.breakOption}; ${neg.rounds.length} positions (${neg.rounds.map(r => `${r.party} £${r.rentPa}`).join(" > ")})`);
}

// ---- 5. hots ----------------------------------------------------------------
async function phaseHots() {
  log("hots");
  let ws = await must("millie", "GET", `/api/unit-hots/${UNIT}`);
  if (!ws.template.text) {
    ws = await must("millie", "POST", `/api/unit-hots/${UNIT}/template/standard`, {});
    step(true, `standard Heads of Terms created: ${ws.template.standardName}`);
  } else step(false, `the property has its standard Heads of Terms: ${ws.template.standardName || "its own text"}`);
  if (ws.template.schemeStandardName && ws.template.standardName !== ws.template.schemeStandardName) log(`  note: the scheme's own form is "${ws.template.schemeStandardName}" but the property's standard is "${ws.template.standardName || "its own text"}"`);

  if (ws.stage === "issued" || ws.stage === "final") step(false, `Heads of Terms are already ${ws.stage}`);
  else {
    if (!ws.content || !ws.agreedOffer || ws.offer?.id !== ws.agreedOffer.id || ws.offerOutOfStep) {
      ws = await must("millie", "POST", `/api/unit-hots/${UNIT}/generate`, ws.content ? { replace: true } : {});
      step(true, `generated from the agreed offer (version ${ws.version})`);
    } else step(false, `the draft is generated from the agreed offer (version ${ws.version})`);
    // Everyone on the brief agrees as themselves, except Will: his is pressed on film.
    for (const who of ["millie", "ben", "jonny"]) {
      const s = await login(who);
      if (ws.signers.find(x => x.userId === s.id)?.agreedAt) { step(false, `${s.name} has agreed the Heads of Terms`); continue; }
      ws = await must(who, "POST", `/api/unit-hots/${UNIT}/agree`, { version: ws.version });
      step(true, `${s.name} agreed the Heads of Terms`);
    }
  }
  ws = await must("jonny", "GET", `/api/unit-hots/${UNIT}`);
  const made = ws.events.filter(e => e.kind === "generated").pop();
  log(`  check (as Jonny Rushton): stage ${ws.stage}; version ${ws.version}; agreed ${ws.approval.agreed} of ${ws.approval.total} (${ws.signers.map(s => `${s.name} ${s.agreedAt ? "yes" : "no"}`).join(", ")}); blanks left in the draft: ${ws.gaps.length}`);
  if (made) log(`  history: ${made.authorName} ${made.body}`);
}

// ---- 6. issue ---------------------------------------------------------------
async function phaseIssue() {
  log("issue");
  // The brief comes first: by now Jonny has agreed it on film. If not, he does here.
  const brief = await briefOf();
  let bws = await workspaceOf(brief.id, "jonny");
  const me = bws.people.find(x => x.userId === bws.viewer.userId);
  if (!(me.agreedAt && me.agreedVersion === bws.brief.version)) {
    await must("jonny", "POST", `/api/unit-briefs/people/${me.id}/agree`, { version: bws.brief.version });
    step(true, "Jonny Rushton agreed the brief (it had not been pressed on film)");
  } else step(false, "Jonny Rushton has agreed the brief");

  let ws = await must("will", "GET", `/api/unit-hots/${UNIT}`);
  if (ws.stage === "issued" || ws.stage === "final") step(false, `Heads of Terms are ${ws.stage}`);
  else {
    if (!ws.signers.find(x => x.isMe)?.agreedAt) {
      ws = await must("will", "POST", `/api/unit-hots/${UNIT}/agree`, { version: ws.version });
      step(true, "Will Harvey agreed the Heads of Terms (it had not been pressed on film)");
    } else step(false, "Will Harvey has agreed the Heads of Terms");
    ws = await must("millie", "POST", `/api/unit-hots/${UNIT}/issue`, {});
    step(true, `Heads of Terms issued by ${ws.issuedByName}; unit is now ${ws.unit.marketingStatus}${ws.statusWarning ? ` (${ws.statusWarning})` : ""}`);
  }

  // The deal checklist: opened by Millie (which starts it), then who has what.
  let list = (await must("millie", "GET", `/api/deal-checklists/unit/${UNIT}`)).checklist;
  if (!list.responsible) {
    list = await must("millie", "PUT", `/api/deal-checklists/${list.id}/responsible`, { personKey: `user:${await idOf("millie")}` });
    step(true, "Millie Edwards is responsible for the letting");
  } else step(false, `${list.responsible.name} is responsible for the letting`);
  for (let i = 0; i < CHECKLIST_PLAN.length; i++) {
    const plan = CHECKLIST_PLAN[i];
    let item = list.items[i];
    const s = await login(plan.who);
    if (!item.assignee) {
      list = await must("millie", "PUT", `/api/deal-checklists/items/${item.id}/assignee`, { personKey: `user:${s.id}` });
      step(true, `${s.name}: ${item.label}${list.emailed === false && list.emailError ? "  [no email sent: " + list.emailError + "]" : ""}`);
      item = list.items.find(x => x.id === item.id);
    } else step(false, `${item.assignee.name}: ${item.label}`);
    if (plan.done && !item.doneAt) {
      list = await must(plan.who, "POST", `/api/deal-checklists/items/${item.id}/done`, { done: true });
      step(true, `ticked by ${s.name}`);
    }
  }
  list = (await must("jonny", "GET", `/api/deal-checklists/unit/${UNIT}`)).checklist;
  log(`  check (as Jonny Rushton): checklist at stage ${list.stage}; ${list.items.filter(i => i.doneAt).length} of ${list.items.length} done; ${list.items.filter(i => i.assignee).length} with a responsible person; waiting: ${JSON.stringify(list.waiting)}`);
}

// ---- 7. recommendation ------------------------------------------------------
async function phaseRecommendation() {
  log("recommendation");
  let ws = await must("millie", "GET", `/api/unit-recommendations/${UNIT}`);
  if (!ws.id) {
    ws = await must("millie", "POST", `/api/unit-recommendations/${UNIT}/start`, {});
    step(true, "started from the agreed offer");
  } else step(false, "the recommendation is started");
  const want = RECOMMENDATION;
  const same = Object.keys(want.terms).every(k => sameTerm(ws.terms[k], want.terms[k]))
    && Object.keys(want.commentary).every(k => sameTerm(ws.commentary[k], want.commentary[k]))
    && ws.recommendation === want.recommendation && sameTerm(ws.summary, want.summary);
  if (!same) {
    ws = await must("millie", "PUT", `/api/unit-recommendations/${UNIT}/content`, { baseVersion: ws.version, terms: want.terms, commentary: want.commentary, recommendation: want.recommendation, summary: want.summary });
    step(true, "terms, commentary, recommendation and summary written");
  } else step(false, "terms, commentary, recommendation and summary are written");
  if (ws.missing.length) log(`  still missing: ${ws.missing.join("; ")}`);
  if (!(ws.issuedAt && ws.issuedVersion === ws.version)) {
    ws = await must("millie", "POST", `/api/unit-recommendations/${UNIT}/issue`, {});
    step(true, `issued by ${ws.issuedByName}${ws.emailReason ? `  [no email sent: ${ws.emailReason}]` : ""}`);
  } else step(false, `issued by ${ws.issuedByName}`);
  ws = await must("jonny", "GET", `/api/unit-recommendations/${UNIT}`);
  log(`  check (as Jonny Rushton): stage ${ws.stage}; version ${ws.version}; ${ws.terms.tenant}, £${ws.terms.rentPa} a year, ${ws.terms.termYears} years; net effective £${ws.measure.nerPa}; ${ws.measure.headlineVsErvPct}% of ERV; deciders ${ws.deciders.map(d => `${d.name} ${d.decision || "not decided"}`).join(", ")}; Mark can decide: ${ws.viewer.canDecide}`);
}

// ---- 8. solicitors ----------------------------------------------------------
async function phaseSolicitors() {
  log("solicitors");
  let ws = await must("millie", "GET", `/api/unit-hots/${UNIT}`);
  if (ws.conversion) { step(false, `already converted (deal #${ws.conversion.dealRef})`); }
  else {
    if (!ws.finalFile) {
      // The final agreed Heads of Terms: the issued draft, as the app prints it.
      const pdf = await must("millie", "GET", `/api/unit-hots/${UNIT}/download`, undefined, { buffer: true });
      const form = new FormData();
      form.append("file", new Blob([pdf], { type: "application/pdf" }), "Final agreed Heads of Terms, L057 Bluewater.pdf");
      ws = await must("millie", "POST", `/api/unit-hots/${UNIT}/final`, undefined, { form });
      step(true, `final agreed Heads of Terms uploaded: ${ws.finalFile.fileName}`);
    } else step(false, `final agreed Heads of Terms on file: ${ws.finalFile.fileName}`);
    const r = await call("millie", "POST", `/api/unit-hots/${UNIT}/convert`, {});
    if (!r.ok) {
      log(`  REFUSED (${r.status}${r.body?.code ? `, ${r.body.code}` : ""}): ${r.body?.message}`);
      process.exitCode = 2;
      return;
    }
    step(true, `converted to Solicitors: deal #${r.body.dealRef}, tenant ${r.body.tenantName}`);
    if (r.body.aml && !r.body.aml.ok) log(`  AML: ${r.body.aml.message}`);
    if (r.body.statusWarning) log(`  warning: ${r.body.statusWarning}`);
  }
  ws = await must("jonny", "GET", `/api/unit-hots/${UNIT}`);
  log(`  check (as Jonny Rushton): unit ${ws.unit.marketingStatus}; HOTs stage ${ws.stage}; converted ${ws.conversion ? "yes" : "no"}`);
}

// ---- informed ---------------------------------------------------------------
// Three Landsec people are kept informed: they see everything live, comment and
// add tasks, and sign nothing. Each is a Landsec login with NO Landsec role
// (so the full view). The logins panel always gives a login a role, so the
// two that do not exist are made in the demo database as copies of the
// leasing manager's row (the app's own start-up list already holds Mark
// Warne's login and makes it when it is missing); what they say and add goes
// through the app's API.
const INFORMED = [
  { who: "gemma", name: "Gemma Casey", title: "Senior Asset Director",
    comment: `@[L057 Bluewater - Lower Level](tag:unit/${UNIT}) Thanks all. Jersey Mike's would be a first for Bluewater. Please keep the rent free inside the brief.` },
  { who: "markw", name: "Mark Warne", title: "Commercial Director",
    comment: "Good progress. I am following this one. Tell me if you need anything from me to get to Heads of Terms." },
  { who: "becs", name: "Becs Blenkinsop", title: "Senior Leasing Manager (Retail)" },
];
const INFORMED_TASK = {
  title: "Send Becs the Jersey Mike's fit-out programme for L057 before Heads of Terms are issued",
  description: "Added by Becs Blenkinsop from the Bluewater conversation.",
};
async function phaseInformed() {
  log("informed");
  const [model] = await q(`SELECT id FROM users WHERE lower(email) = $1`, [WHO.jonny]);
  if (!model) throw new Error("The leasing manager's login is missing (run logins first)");
  const copied = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`)).map(r => r.column_name)
    .filter(c => !["id", "username", "name", "email", "profile_pic_url", "is_active", "phone", "dashboard_layout", "dashboard_widgets"].includes(c));
  for (const p of INFORMED) {
    const email = WHO[p.who];
    const [have] = await q(`SELECT id, name, is_active FROM users WHERE lower(email) = $1`, [email]);
    if (!have) {
      await q(`INSERT INTO users (id, username, name, email, is_active, ${copied.map(c => `"${c}"`).join(", ")})
               SELECT gen_random_uuid(), $1, $2, $1, true, ${copied.map(c => `"${c}"`).join(", ")} FROM users WHERE id = $3`, [email, p.name, model.id]);
      step(true, `${p.name} (${p.title}): login made`);
    } else if (have.is_active === false || have.name !== p.name) {
      await q(`UPDATE users SET is_active = true, name = $2 WHERE id = $1`, [have.id, p.name]);
      step(true, `${p.name} (${p.title}): login switched on`);
    } else step(false, `${p.name} (${p.title}) has a login`);
    const gone = await q(`DELETE FROM landsec_access WHERE user_id = (SELECT id FROM users WHERE lower(email) = $1) RETURNING id`, [email]);
    if (gone.length) step(true, `${p.name}: Landsec role removed (kept informed, full view)`);
  }
  // Their comments, in the property's one conversation.
  for (const p of INFORMED.filter(x => x.comment)) {
    const s = await login(p.who);
    const { threadId } = await must(p.who, "POST", `/api/chat/threads/record/property/${PROPERTY}`, {});
    const [said] = await q(`SELECT id FROM chat_messages WHERE thread_id = $1 AND user_id = $2 AND content = $3`, [threadId, s.id, p.comment]);
    if (said) { step(false, `${p.name} has commented`); continue; }
    await must(p.who, "POST", `/api/chat/threads/${threadId}/messages`, { content: p.comment });
    step(true, `${p.name} commented in the Bluewater conversation`);
  }
  // A task one of them sets for the lead BGP agent, on the letting.
  const becs = await login("becs"), millieId = await idOf("millie");
  const [task] = await q(`SELECT id FROM user_tasks WHERE assigned_by_user_id = $1 AND user_id = $2 AND title = $3`, [becs.id, millieId, INFORMED_TASK.title]);
  if (task) step(false, "Becs Blenkinsop's task for Millie Edwards is set");
  else {
    await must("becs", "POST", "/api/tasks", { ...INFORMED_TASK, assigneeUserId: millieId, linkedPropertyId: PROPERTY, linkedDealId: DEAL, priority: "high", dueDate: addDays(todayLondon(), 5) });
    step(true, `Becs Blenkinsop set a task for Millie Edwards: ${INFORMED_TASK.title}`);
  }
  for (const p of INFORMED) {
    const me = await must(p.who, "GET", "/api/auth/me");
    const role = await q(`SELECT landsec_role FROM landsec_access WHERE user_id = $1`, [(await login(p.who)).id]);
    log(`  check: ${me.name || me.user?.name} is signed in; Landsec role ${role[0]?.landsec_role || "none (full view)"}`);
  }
}

// ---- viewas -----------------------------------------------------------------
async function phaseViewAs() {
  const team = process.argv[3];
  if (!team) throw new Error("viewas <team|own>");
  const r = await must("millie", "POST", "/api/auth/active-team", { team: team === "own" ? null : team });
  log(`viewas: Millie Edwards is on ${r.activeTeam || "her own view"}${r.viewingAsClient ? " (viewing as the client)" : ""}`);
}

// ---- status -----------------------------------------------------------------
async function phaseStatus() {
  const [u] = await q(
    `SELECT au.unit_name, au.marketing_status, au.asking_rent, au.sqft, au.tenancy_unit_id, au.hots_version, au.hots_issued_at, au.hots_final_file_id,
            length(coalesce(au.hots_content, '')) AS hots_chars, d.deal_ref, d.status AS deal_status, d.rent_pa, d.tenant_id
       FROM available_units au LEFT JOIN crm_deals d ON d.id = au.deal_id WHERE au.id = $1`, [UNIT]);
  const n = async (sql, p = [UNIT]) => Number((await q(sql, p))[0].n);
  log(`unit: ${u.unit_name}; tracker status ${u.marketing_status}; deal #${u.deal_ref} ${u.deal_status}; rent on the deal £${u.rent_pa}; tenant on the deal ${u.tenant_id || "none"}`);
  log(`brief: ${await n(`SELECT count(*) AS n FROM unit_briefs WHERE unit_id = $1`)}; people ${await n(`SELECT count(*) AS n FROM unit_brief_people p JOIN unit_briefs b ON b.id = p.brief_id WHERE b.unit_id = $1`)}, agreed ${await n(`SELECT count(*) AS n FROM unit_brief_people p JOIN unit_briefs b ON b.id = p.brief_id WHERE b.unit_id = $1 AND p.agreed_at IS NOT NULL AND p.agreed_version = b.version`)}`);
  log(`viewings: ${await n(`SELECT count(*) AS n FROM unit_viewings WHERE unit_id = $1 AND deleted_at IS NULL`)}; offers: ${await n(`SELECT count(*) AS n FROM unit_offers WHERE unit_id = $1`)} (agreed ${await n(`SELECT count(*) AS n FROM unit_offers WHERE unit_id = $1 AND status = 'Agreed'`)}); positions: ${await n(`SELECT count(*) AS n FROM unit_offer_rounds WHERE unit_id = $1`)}`);
  log(`heads of terms: ${u.hots_chars > 0 ? `draft v${u.hots_version}` : "none"}; sign-offs ${await n(`SELECT count(*) AS n FROM unit_hots_signoffs WHERE unit_id = $1`)}; issued ${u.hots_issued_at ? "yes" : "no"}; final file ${u.hots_final_file_id ? "yes" : "no"}`);
  log(`checklist: ${await n(`SELECT count(*) AS n FROM deal_checklists WHERE unit_id = $1`)}; recommendation: ${await n(`SELECT count(*) AS n FROM unit_recommendations WHERE unit_id = $1`)}; comments not yet logged: ${await n(`SELECT count(*) AS n FROM letting_suggestions WHERE unit_id = $1 AND status = 'open'`)}`);
  log(`snapshot for reset: ${fs.existsSync(SNAPSHOT_FILE) ? `${SNAPSHOT_FILE} (taken ${JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")).takenAt})` : "none"}`);
}

// ---- snapshot and reset (the demo database, not the API) --------------------
// Every row that phases 4 to 8 can touch, found by the unit, its deal or its
// schedule row. `cols` limits a table to named columns (Bluewater's own row
// is shared with everything else on the scheme).
const BRIEFS = `(SELECT id FROM unit_briefs WHERE unit_id = '${UNIT}')`;
const TASKS = `linked_deal_id = '${DEAL}' OR (linked_property_id = '${PROPERTY}' AND (source_ref LIKE 'deal_checklist:%' OR source_ref IN (SELECT 'viewing_followup:' || id FROM unit_viewings WHERE unit_id = '${UNIT}')))`;
const SAVED = [
  { t: "available_units", where: `id = '${UNIT}'` },
  { t: "crm_deals", where: `id = '${DEAL}'` },
  { t: "crm_properties", where: `id = '${PROPERTY}'`, cols: ["hots_template", "hots_template_docx", "hots_template_docx_name"] },
  { t: "tenancy_schedule_units", where: `id = '${TENANCY}' OR letting_tracker_unit_id = '${UNIT}'` },
  { t: "leasing_schedule_units", where: `tenancy_unit_id = '${TENANCY}'` },
  { t: "landsec_units", where: `tenancy_unit_id = '${TENANCY}'` },
  { t: "landsec_deal_clock", where: `deal_id = '${DEAL}'` },
  { t: "unit_briefs", where: `unit_id = '${UNIT}'` },
  { t: "unit_brief_people", where: `brief_id IN ${BRIEFS}` },
  { t: "unit_brief_comments", where: `brief_id IN ${BRIEFS}` },
  { t: "unit_target_operators", where: `brief_id IN ${BRIEFS}` },
  { t: "unit_viewings", where: `unit_id = '${UNIT}'` },
  { t: "unit_interest", where: `unit_id = '${UNIT}'` },
  { t: "unit_offers", where: `unit_id = '${UNIT}'` },
  { t: "unit_offer_rounds", where: `unit_id = '${UNIT}'` },
  { t: "unit_hots_signoffs", where: `unit_id = '${UNIT}'` },
  { t: "unit_hots_events", where: `unit_id = '${UNIT}'` },
  { t: "deal_checklists", where: `unit_id = '${UNIT}'` },
  { t: "deal_checklist_items", where: `unit_id = '${UNIT}'` },
  { t: "unit_recommendation_decisions", where: `recommendation_id IN (SELECT id FROM unit_recommendations WHERE unit_id = '${UNIT}')` },
  { t: "unit_recommendation_events", where: `recommendation_id IN (SELECT id FROM unit_recommendations WHERE unit_id = '${UNIT}')` },
  { t: "unit_recommendations", where: `unit_id = '${UNIT}'` },
  { t: "unit_marketing_files", where: `unit_id = '${UNIT}'` },
  { t: "letting_suggestions", where: `unit_id = '${UNIT}'` },
  { t: "deal_audit_log", where: `deal_id = '${DEAL}'` },
  { t: "deal_events", where: `deal_id = '${DEAL}'` },
  { t: "aml_recheck_reminders", where: `deal_id = '${DEAL}'` },
  // Before user_tasks: a "New task" notice is found through its task.
  { t: "user_notifications", where: `tag IN (SELECT 'task-' || id FROM user_tasks WHERE ${TASKS})` },
  { t: "user_tasks", where: TASKS },
];
const snapshotRows = async (db, s) => (await db.query(`SELECT row_to_json(x) AS row FROM ${s.t} x WHERE ${s.where}`)).rows.map(r => r.row);

async function phaseSnapshot() {
  if (fs.existsSync(SNAPSHOT_FILE) && !process.argv.includes("--force")) { log(`snapshot: one is already saved (${SNAPSHOT_FILE}); add --force to replace it`); return; }
  const tables = {};
  for (const s of SAVED) tables[s.t] = await snapshotRows(pool, s);
  // A snapshot is the state to come back to: the unit before any offer. One
  // taken later would make `reset` restore a half-run letting.
  const unit = tables.available_units[0];
  const started = tables.unit_offers.length > 0 || String(unit?.hots_content || "").trim() !== "" || !/^(ava|available|marketing)?$/i.test(String(unit?.marketing_status || ""));
  if (started && !process.argv.includes("--force")) {
    log(`snapshot: NOT saved. The unit already has an offer, Heads of Terms or a status past Marketing (${unit?.marketing_status}), so this is not the state to reset to. Add --force to save it anyway.`);
    return;
  }
  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ takenAt: new Date().toISOString(), unit: UNIT, tables }, null, 1));
  const u = tables.available_units[0];
  log(`snapshot: saved to ${SNAPSHOT_FILE} (unit at ${u.marketing_status}, ${tables.unit_offers.length} offers, ${tables.unit_viewings.length} viewings, brief people ${tables.unit_brief_people.length})`);
}

async function phaseReset() {
  if (!fs.existsSync(SNAPSHOT_FILE)) throw new Error(`No snapshot at ${SNAPSHOT_FILE}. Nothing to put the unit back to.`);
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
  if (snap.unit !== UNIT) throw new Error("The snapshot is for another unit");
  log(`reset: back to the snapshot of ${snap.takenAt} (demo database, one transaction)`);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // The stored final Heads of Terms files that are about to go.
    const keepFiles = new Set((snap.tables.unit_marketing_files || []).map(r => r.id));
    const files = (await db.query(`SELECT id, file_path FROM unit_marketing_files WHERE unit_id = $1`, [UNIT])).rows.filter(f => !keepFiles.has(f.id));
    for (const f of files) await db.query(`DELETE FROM file_storage WHERE storage_key = $1`, [String(f.file_path).replace(/^\/uploads\//, "")]);
    for (const s of SAVED) {
      const saved = snap.tables[s.t] || [];
      const now = await snapshotRows(db, s);
      // Ids are compared as text: most are uuids, a few tables count in numbers.
      const savedIds = new Set(saved.map(r => String(r.id)));
      const nowIds = new Set(now.map(r => String(r.id)));
      let removed = 0, restored = 0;
      if (!s.cols) {
        const gone = now.filter(r => !savedIds.has(String(r.id))).map(r => String(r.id));
        if (gone.length) removed = (await db.query(`DELETE FROM ${s.t} WHERE id::text = ANY($1::text[])`, [gone])).rowCount;
      }
      for (const row of saved) {
        const cols = (s.cols || Object.keys(row).filter(c => c !== "id")).map(c => `"${c}"`).join(", ");
        const before = now.find(r => String(r.id) === String(row.id));
        if (before && JSON.stringify(s.cols ? s.cols.map(c => before[c]) : before) === JSON.stringify(s.cols ? s.cols.map(c => row[c]) : row)) continue;
        if (nowIds.has(String(row.id))) await db.query(`UPDATE ${s.t} SET (${cols}) = (SELECT ${cols} FROM json_populate_record(null::${s.t}, $1::json)) WHERE id::text = $2`, [JSON.stringify(row), String(row.id)]);
        else if (!s.cols) await db.query(`INSERT INTO ${s.t} SELECT * FROM json_populate_record(null::${s.t}, $1::json)`, [JSON.stringify(row)]);
        restored++;
      }
      if (removed || restored) step(true, `${s.t}: ${removed} removed, ${restored} put back`);
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally { db.release(); }
  await phaseStatus();
}

// ---- tidy -------------------------------------------------------------------
// The demo server has no email service, so issuing the recommendation writes
// "could not email ..." into its history. That line is about the demo, not
// the letting. There is no route that removes a history line: this deletes it
// in the demo database.
async function phaseTidy() {
  const gone = await q(
    `DELETE FROM unit_recommendation_events WHERE kind = 'email_failed'
        AND recommendation_id IN (SELECT id FROM unit_recommendations WHERE unit_id = $1) RETURNING id`, [UNIT]);
  log(`tidy: ${gone.length} "could not email" line${gone.length === 1 ? "" : "s"} removed from the recommendation's history (demo database)`);
}

// ---- fingerprint ------------------------------------------------------------
// Row count and checksum of every table, to prove what a run changed and that
// a reset put it back. Stored files are counted by key and size.
async function phaseFingerprint(file) {
  if (!file) throw new Error("fingerprint <file>");
  const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map(r => r.table_name);
  const out = {};
  for (const t of tables) {
    const row = t === "file_storage" ? "x.storage_key || ':' || x.size" : "x::text";
    const [r] = await q(`SELECT count(*)::int AS n, md5(coalesce(string_agg(md5(${row}), '' ORDER BY md5(${row})), '')) AS sum FROM "${t}" x`);
    out[t] = `${r.n}:${r.sum}`;
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  log(`fingerprint: ${tables.length} tables written to ${file}`);
}

const PHASES = {
  logins: phaseLogins, brief: phaseBrief, viewing: phaseViewing, snapshot: phaseSnapshot, offer: phaseOffer, hots: phaseHots,
  issue: phaseIssue, recommendation: phaseRecommendation, solicitors: phaseSolicitors, informed: phaseInformed, viewas: phaseViewAs, status: phaseStatus, reset: phaseReset, tidy: phaseTidy,
  fingerprint: () => phaseFingerprint(process.argv[3]),
};

(async () => {
  const phase = process.argv[2];
  if (!PHASES[phase]) { console.error(`Usage: node script/pitch-video/stage-letting.cjs <${Object.keys(PHASES).join("|")}>`); process.exit(1); }
  try { await PHASES[phase](); }
  catch (e) { console.error(`STOPPED: ${e.message}`); process.exitCode = 1; }
  finally { await pool.end(); }
})();
