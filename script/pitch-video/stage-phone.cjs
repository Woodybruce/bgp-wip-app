// Stages what the four PHONE scenes of the Landsec pitch video need, on the
// DEMO copy of the app: Jersey Mike's agent (Richard Willcox of ETCH., with the
// details the firm publishes on its own website), the firm as the brand's
// tenant rep, and quoting terms on a Liverpool ONE unit so Share with a brand
// has something to send. Everything is done through the app's own HTTP API as a
// BGP agent; `reset` is the one part that also uses SQL (see below).
//
//   STAGE_TOKENS=<tokens.json> node script/pitch-video/stage-phone.cjs <phase>
//
// Phases, in order (each is safe to run twice):
//   agent    the agent firm ETCH. (London) and Richard Willcox, its Founding
//            Partner. It first takes back what an earlier run of this script
//            staged against the wrong firm: the tenant rep link to the
//            Birmingham "Etch Group" and the contact it added there. That
//            company's own record is left as it was.
//   rep      ETCH. recorded as Jersey Mike's tenant rep, Richard the named contact
//   unit     quoting rent and service charge on the Liverpool ONE unit (made-up figures)
//   people   Jersey Mike's chief executive, Satnam Leihal, as a contact at the
//            brand, with BGP's own note on his record
//   meeting  a meeting with Jersey Mike's on the brand's record: Woody Bruce,
//            Jonny Rushton of Landsec, Richard Willcox and Satnam Leihal
//   all      the five above
// Also:
//   status   prints what is there (reads only)
//   reset    takes back what FILMING the scenes leaves behind, so they can be
//            filmed again from the same start: the comment typed on film, the
//            photos added from the phone and the shares made of the
//            Liverpool ONE unit. The comment and the photos go through the
//            app's API (delete message, move to the bin); the app has no route
//            that removes a share from a unit's sharing history, so those rows
//            and their stored PDFs are deleted in the demo database.
//
// It only ever talks to the local demo (localhost) and the bgpdemo database.
const fs = require("fs");
const { Pool } = require("pg");

const BASE = process.env.DEMO_BASE || "http://localhost:5100";
const DB_URL = process.env.DEMO_DATABASE_URL || "postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpdemo";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) { console.error("DEMO_BASE must be the local demo (http://localhost:<port>)"); process.exit(1); }
if (!/@(127\.0\.0\.1|localhost)(:\d+)?\/bgpdemo(\?|$)/.test(DB_URL)) { console.error("DEMO_DATABASE_URL must name the local bgpdemo database"); process.exit(1); }
const TOKENS_FILE = process.env.STAGE_TOKENS;
if (!TOKENS_FILE || !fs.existsSync(TOKENS_FILE)) { console.error("STAGE_TOKENS must name the JSON file of { login: token } for the demo copy"); process.exit(1); }

// ---- The demo facts ---------------------------------------------------------
const BRAND = { id: "226e6ac9-a1e2-4a7c-8210-e35d87f2df0d", name: "Jersey Mike's" };
const BLUEWATER = "23b98b43-c5a4-4c16-9eaa-a674f7139749";
const BK_UNIT = "c0868396-f74b-4661-83e1-ebf7c6bcb062";        // L057 Bluewater - Lower Level
const SHARE_UNIT = "134b127e-c128-444e-9ae1-d9189b3947da";     // P7, Leisure, Liverpool ONE

const STAGER = "millie@brucegillinghampollard.com";            // Millie Edwards, the lead BGP agent
const FILMED_AS = "md";                                        // the login the phone scenes are filmed as

// The agent firm and the person, as the firm's own website gives them
// (etchgroup.com, its contact page). Nothing on film sends an email or makes
// a call: the Call link opens no dialler in the filming browser and the share
// is a PDF.
const FIRM = {
  name: "ETCH.",
  companyType: "Agent",
  domain: "etchgroup.com",
  domainUrl: "https://www.etchgroup.com",
  headOfficeAddress: { street: "5 Garrick Street, Covent Garden", city: "London", postcode: "WC2E 9AR" },
};
const AGENT = {
  name: "Richard Willcox",
  role: "Founding Partner",
  phone: "+44 7778 487401",
  email: "richard@etchgroup.com",
};
// What the earlier run staged against the wrong firm.
const WRONG = { firm: /^etch group$/i, name: /^richard wil+cox$/i, phone: "020 7946 0143" };

// The brand's chief executive, a contact at the brand itself. The note is
// BGP's own (a contact's notes are never sent to a client login).
const CEO = { name: "Satnam Leihal", role: "CEO", notes: "Knows Mark Warne and Jonny Rushton at Landsec outside this instruction." };
// The meeting, a few working days before the staged viewing (stage-letting.cjs
// holds the viewing four days back from the day it is staged).
const MEETING = {
  subject: "Meeting with Jersey Mike's",
  preview: "Attendees: Woody Bruce (BGP), Jonny Rushton (Landsec), Richard Willcox (ETCH.) and Satnam Leihal (Jersey Mike's CEO). Introduction to Bluewater and the lower level food units.",
  loggedBy: "md",          // Woody Bruce was there
  daysBeforeViewing: 5,
};

// Made-up quoting terms for the unit that is shared on film.
const QUOTING = { askingRent: 180000, serviceChargePa: 42000 };

// What the scenes type and add (film.cjs holds the same words and file names).
const COMMENT = "Met Richard Willcox after the viewing. Jersey Mike's want the service charge budget and a second look at the frontage.";
const PHOTO_NAMES = /^jersey-mikes-argyll-street-\d+\.jpg$/i;

// ---- Plumbing ---------------------------------------------------------------
const pool = new Pool({ connectionString: DB_URL });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const log = (...a) => console.log(...a);
const step = (ok, text) => log(`  ${ok ? "+" : "="} ${text}`); // + done now, = already so

function tokenFor(who) {
  const t = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"))[who];
  if (!t) throw new Error(`${TOKENS_FILE} has no token for ${who}`);
  return t;
}
// One API call as a person. Returns { status, ok, body }; never throws on a refusal.
async function call(who, method, url, body) {
  const headers = { authorization: `Bearer ${tokenFor(who)}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: r.status, ok: r.ok, body: parsed };
}
async function must(who, method, url, body) {
  const r = await call(who, method, url, body);
  if (!r.ok) throw new Error(`${method} ${url} as ${who}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

// ETCH. in the demo CRM, by its exact name. Never the Birmingham "Etch Group",
// and never a second ETCH.
async function firm() {
  const rows = await q(`SELECT id, name, company_type, domain, domain_url, head_office_address FROM crm_companies
                         WHERE merged_into_id IS NULL AND archived_at IS NULL AND company_type ILIKE 'agent%' AND lower(trim(name)) = lower($1) ORDER BY created_at`, [FIRM.name]);
  if (rows.length > 1) throw new Error(`More than one agent firm is named ${FIRM.name}`);
  return rows[0] || null;
}
// The earlier run's tenant rep link to "Etch Group" and the contact it added there.
async function wronglyStaged() {
  const firms = (await q(`SELECT id, name FROM crm_companies WHERE company_type ILIKE 'agent%'`)).filter(r => WRONG.firm.test(String(r.name).trim()));
  const ids = firms.map(f => f.id);
  if (!ids.length) return { reps: [], contacts: [] };
  const contacts = (await q(`SELECT id, name FROM crm_contacts WHERE company_id = ANY($1::text[]) AND phone = $2`, [ids, WRONG.phone])).filter(c => WRONG.name.test(String(c.name).trim()));
  const reps = await q(`SELECT id FROM brand_agent_representations WHERE brand_company_id = $1 AND (agent_company_id = ANY($2::text[]) OR primary_contact_id = ANY($3::text[]))`,
    [BRAND.id, ids, contacts.map(c => c.id)]);
  return { reps, contacts };
}
async function agentContact(firmId) {
  const [row] = await q(`SELECT id, name, role, phone, email, contact_type FROM crm_contacts WHERE company_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [firmId, AGENT.name]);
  return row || null;
}

// ---- Phases -----------------------------------------------------------------
const PHASES = {
  async agent() {
    const wrong = await wronglyStaged();
    for (const r of wrong.reps) await must(STAGER, "DELETE", `/api/brand/representations/${r.id}`);
    for (const c of wrong.contacts) await must(STAGER, "DELETE", `/api/crm/contacts/${c.id}`);
    step(wrong.reps.length + wrong.contacts.length > 0, `${wrong.reps.length} tenant rep link(s) to Etch Group and ${wrong.contacts.length} contact(s) staged there earlier removed`);
    let f = await firm();
    if (!f) {
      const made = await must(STAGER, "POST", "/api/crm/companies", FIRM);
      if (String(made.name).trim() !== FIRM.name) throw new Error(`The CRM answered with ${made.name}, not a new ${FIRM.name}`);
      f = { id: made.id, name: made.name };
      step(true, `agent firm ${f.name} added to the CRM (${FIRM.headOfficeAddress.street}, ${FIRM.headOfficeAddress.city})`);
    } else if (f.domain !== FIRM.domain || f.domain_url !== FIRM.domainUrl || ["street", "city", "postcode"].some(k => (f.head_office_address || {})[k] !== FIRM.headOfficeAddress[k])) {
      await must(STAGER, "PUT", `/api/crm/companies/${f.id}`, { domain: FIRM.domain, domainUrl: FIRM.domainUrl, headOfficeAddress: FIRM.headOfficeAddress });
      step(true, `agent firm ${f.name}'s website and office put right`);
    } else step(false, `agent firm ${f.name} is in the CRM`);
    const want = { name: AGENT.name, role: AGENT.role, phone: AGENT.phone, email: AGENT.email, contactType: "Agent", companyId: f.id, companyName: f.name };
    const have = await agentContact(f.id);
    if (!have) {
      await must(STAGER, "POST", "/api/crm/contacts", want);
      step(true, `${AGENT.name} added at ${f.name} (${AGENT.phone})`);
    } else if (have.role !== want.role || have.phone !== want.phone || have.email !== want.email || have.contact_type !== want.contactType) {
      await must(STAGER, "PUT", `/api/crm/contacts/${have.id}`, { role: want.role, phone: want.phone, email: want.email, contactType: want.contactType });
      step(true, `${AGENT.name}'s details put right`);
    } else step(false, `${AGENT.name} is at ${f.name}`);
  },

  async rep() {
    const f = await firm();
    const c = f && await agentContact(f.id);
    if (!c) throw new Error("Run the agent phase first");
    const [have] = await q(`SELECT id, primary_contact_id FROM brand_agent_representations WHERE brand_company_id = $1 AND agent_company_id = $2 AND agent_type = 'tenant_rep' AND end_date IS NULL ORDER BY created_at LIMIT 1`, [BRAND.id, f.id]);
    if (!have) {
      await must(STAGER, "POST", "/api/brand/representations", { brandCompanyId: BRAND.id, agentCompanyId: f.id, primaryContactId: c.id, agentType: "tenant_rep" });
      step(true, `${f.name} is the tenant rep for ${BRAND.name}, ${AGENT.name} the named contact`);
    } else if (have.primary_contact_id !== c.id) {
      await must(STAGER, "PATCH", `/api/brand/representations/${have.id}`, { primaryContactId: c.id });
      step(true, `${AGENT.name} named on the tenant rep line`);
    } else step(false, `${f.name} is the tenant rep for ${BRAND.name}, ${AGENT.name} the named contact`);
  },

  async unit() {
    const [u] = await q(`SELECT unit_name, asking_rent, service_charge_pa FROM available_units WHERE id = $1`, [SHARE_UNIT]);
    if (!u) throw new Error("The Liverpool ONE unit is not on the tracker");
    if (Number(u.asking_rent) === QUOTING.askingRent && Number(u.service_charge_pa) === QUOTING.serviceChargePa) return step(false, `${u.unit_name} has its quoting terms`);
    await must(STAGER, "PATCH", `/api/available-units/${SHARE_UNIT}`, QUOTING);
    step(true, `${u.unit_name}: quoting rent £${QUOTING.askingRent.toLocaleString("en-GB")} and service charge £${QUOTING.serviceChargePa.toLocaleString("en-GB")} a year (made up)`);
  },

  async people() {
    const [have] = await q(`SELECT id, role, notes FROM crm_contacts WHERE company_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [BRAND.id, CEO.name]);
    if (!have) {
      await must(STAGER, "POST", "/api/crm/contacts", { name: CEO.name, role: CEO.role, notes: CEO.notes, companyId: BRAND.id, companyName: BRAND.name });
      step(true, `${CEO.name}, ${CEO.role}, added at ${BRAND.name} with BGP's note`);
    } else if (have.role !== CEO.role || have.notes !== CEO.notes) {
      await must(STAGER, "PUT", `/api/crm/contacts/${have.id}`, { role: CEO.role, notes: CEO.notes });
      step(true, `${CEO.name}'s job title and note put right`);
    } else step(false, `${CEO.name}, ${CEO.role}, is a contact at ${BRAND.name}`);
  },

  async meeting() {
    const [ceo] = await q(`SELECT id FROM crm_contacts WHERE company_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [BRAND.id, CEO.name]);
    if (!ceo) throw new Error("Run the people phase first");
    const [have] = await q(`SELECT id, interaction_date FROM crm_interactions WHERE company_id = $1 AND type = 'meeting' AND subject = $2 LIMIT 1`, [BRAND.id, MEETING.subject]);
    if (have) return step(false, `the meeting is on ${BRAND.name}'s record (${new Date(have.interaction_date).toISOString().slice(0, 10)})`);
    // A few days before the viewing; never a weekend.
    const [v] = await q(`SELECT viewing_date FROM unit_viewings WHERE unit_id = $1 AND deleted_at IS NULL ORDER BY viewing_date LIMIT 1`, [BK_UNIT]);
    let day = new Date(`${v ? String(v.viewing_date).slice(0, 10) : new Date().toISOString().slice(0, 10)}T10:30:00.000Z`);
    day = new Date(day.getTime() - MEETING.daysBeforeViewing * 86400000);
    while ([0, 6].includes(day.getUTCDay())) day = new Date(day.getTime() - 86400000);
    const made = await must(MEETING.loggedBy, "POST", "/api/interactions/log", { type: "meeting", direction: "outbound", contactId: ceo.id, companyId: BRAND.id, subject: MEETING.subject, preview: MEETING.preview, interactionDate: day.toISOString() });
    // A login that signs in with a saved token is not named on the line it logs: name him in the demo database.
    await q(`UPDATE crm_interactions SET bgp_user = (SELECT u.name FROM users u JOIN auth_tokens t ON t.user_id = u.id WHERE t.token = $2) WHERE id = $1 AND bgp_user IS NULL`, [made.id, tokenFor(MEETING.loggedBy)]);
    step(true, `"${MEETING.subject}" logged for ${day.toISOString().slice(0, 10)} (${made.id})`);
  },

  async all() { for (const p of ["agent", "rep", "unit", "people", "meeting"]) { log(`${p}:`); await PHASES[p](); } },

  async status() {
    const f = await firm();
    const c = f && await agentContact(f.id);
    log(`  firm: ${f ? `${f.name} (${f.id})` : "none"}`);
    log(`  agent: ${c ? `${c.name}, ${c.role || "no role"}, ${c.phone || "no phone"}, ${c.email || "no email"} (${c.id})` : "none"}`);
    const reps = await q(`SELECT r.agent_type, co.name AS firm, ct.name AS contact FROM brand_agent_representations r LEFT JOIN crm_companies co ON co.id = r.agent_company_id LEFT JOIN crm_contacts ct ON ct.id = r.primary_contact_id WHERE r.brand_company_id = $1`, [BRAND.id]);
    log(`  ${BRAND.name} is represented by: ${reps.map(r => `${r.contact || "nobody named"} of ${r.firm || "no firm"} (${r.agent_type})`).join("; ") || "nobody"}`);
    const [u] = await q(`SELECT unit_name, asking_rent, service_charge_pa FROM available_units WHERE id = $1`, [SHARE_UNIT]);
    log(`  share unit: ${u ? `${u.unit_name}, rent ${u.asking_rent ?? "none"}, service charge ${u.service_charge_pa ?? "none"}` : "missing"}`);
    const [ceo] = await q(`SELECT name, role, notes FROM crm_contacts WHERE company_id = $1 AND lower(name) = lower($2) LIMIT 1`, [BRAND.id, CEO.name]);
    log(`  chief executive: ${ceo ? `${ceo.name}, ${ceo.role}; note: ${ceo.notes || "none"}` : "none"}`);
    const [mt] = await q(`SELECT subject, interaction_date, bgp_user FROM crm_interactions WHERE company_id = $1 AND type = 'meeting' AND subject = $2 LIMIT 1`, [BRAND.id, MEETING.subject]);
    log(`  meeting: ${mt ? `${mt.subject}, ${new Date(mt.interaction_date).toISOString().slice(0, 10)}, logged by ${mt.bgp_user || "nobody named"}` : "none"}`);
    const left = await leftByFilming();
    log(`  left by filming: ${left.comments.length} comment(s), ${left.photos.length} photo(s), ${left.shares.length} share(s)`);
  },

  async reset() {
    const left = await leftByFilming();
    for (const m of left.comments) {
      const r = await call(FILMED_AS, "DELETE", `/api/chat/threads/${m.thread_id}/messages/${m.id}`);
      if (!r.ok) throw new Error(`The comment could not be deleted: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    step(left.comments.length > 0, `${left.comments.length} filmed comment(s) deleted`);
    for (const p of left.photos) {
      const r = await call(FILMED_AS, "POST", `/api/image-studio/${p.id}/trash`);
      if (!r.ok) throw new Error(`A photo could not be moved to the bin: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    step(left.photos.length > 0, `${left.photos.length} filmed photo(s) moved to the bin`);
    if (left.shares.length) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const keys = left.shares.map(s => s.pack_storage_key).filter(Boolean);
        await db.query(`DELETE FROM unit_shares WHERE id = ANY($1::text[])`, [left.shares.map(s => s.id)]);
        if (keys.length) await db.query(`DELETE FROM file_storage WHERE storage_key = ANY($1::text[])`, [keys]);
        await db.query("COMMIT");
      } catch (e) { await db.query("ROLLBACK"); throw e; } finally { db.release(); }
    }
    step(left.shares.length > 0, `${left.shares.length} share(s) of the Liverpool ONE unit removed (demo database)`);
  },
};

// What filming the scenes leaves in the demo: found by the exact words and
// file names the scenes use, and nothing else.
async function leftByFilming() {
  const comments = await q(
    `SELECT m.id, m.thread_id FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
      WHERE t.linked_type = 'property' AND t.linked_id = $1 AND m.content LIKE $2 AND m.content LIKE $3`,
    // Either spelling of the agent's name: the earlier cut typed it with one L.
    [BLUEWATER, `%(tag:unit/${BK_UNIT})%`, `%${COMMENT.replace("Willcox", "Wil%cox")}`]);
  // Every photo a scene added: from the brand's page (filed against the
  // brand) or, in the earlier cut, from Images.
  const photos = (await q(`SELECT id, file_name FROM image_studio_images WHERE (company_id = $1 OR 'phone-upload' = ANY(COALESCE(tags, '{}'))) AND NOT ('trashed' = ANY(COALESCE(tags, '{}')))`, [BRAND.id]))
    .filter(p => PHOTO_NAMES.test(String(p.file_name || "")));
  const shares = await q(`SELECT id::text AS id, pack_storage_key FROM unit_shares WHERE unit_id = $1`, [SHARE_UNIT]);
  return { comments, photos, shares };
}

(async () => {
  const phase = process.argv[2];
  if (!PHASES[phase]) { console.log("phases:", Object.keys(PHASES).join(", ")); process.exitCode = 1; return; }
  log(`${phase}:`);
  await PHASES[phase]();
})().catch(e => { console.error(e.message || e); process.exitCode = 1; }).finally(() => pool.end());
