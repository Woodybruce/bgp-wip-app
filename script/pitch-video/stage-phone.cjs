// Stages what the four PHONE scenes of the Landsec pitch video need, on the
// DEMO copy of the app: Jersey Mike's agent (Richard Wilcox, a made-up person
// at the agent firm already in the demo), the firm as the brand's tenant rep,
// and quoting terms on a Liverpool ONE unit so Share with a brand has
// something to send. Everything is done through the app's own HTTP API as a
// BGP agent; `reset` is the one part that also uses SQL (see below).
//
//   STAGE_TOKENS=<tokens.json> node script/pitch-video/stage-phone.cjs <phase>
//
// Phases, in order (each is safe to run twice):
//   agent    Richard Wilcox, an agent at the Etch firm already in the CRM
//   rep      that firm recorded as Jersey Mike's tenant rep, Richard the named contact
//   unit     quoting rent and service charge on the Liverpool ONE unit (made-up figures)
//   all      the three above
// Also:
//   status   prints what is there (reads only)
//   reset    takes back what FILMING the scenes leaves behind, so they can be
//            filmed again from the same start: the comment typed on film, the
//            photos added to Jersey Mike's and the shares made of the
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

const STAGER = "charlotte@brucegillinghampollard.com";         // Charlotte Roberts, the lead BGP agent
const FILMED_AS = "md";                                        // the login the phone scenes are filmed as

// The agent. A made-up person: the phone number is from Ofcom's range kept
// for drama (020 7946 0xxx) and the address is on example.com, so nobody real
// is called or written to.
const AGENT = {
  firm: /^etch( group)?$/i,
  name: "Richard Wilcox",
  role: "Agent",
  phone: "020 7946 0143",
  email: null,                 // none: the PDF share needs no address, so no made-up one is shown
};

// Made-up quoting terms for the unit that is shared on film.
const QUOTING = { askingRent: 180000, serviceChargePa: 42000 };

// What the scenes type and add (film.cjs holds the same words and file names).
const COMMENT = "Met Richard Wilcox after the viewing. Jersey Mike's want the service charge budget and a second look at the frontage.";
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

// The agent firm already in the demo CRM. Never a second one.
async function firm() {
  const rows = (await q(`SELECT id, name, company_type FROM crm_companies WHERE merged_into_id IS NULL AND archived_at IS NULL AND company_type ILIKE 'agent%' ORDER BY name`))
    .filter(r => AGENT.firm.test(String(r.name).trim()));
  if (rows.length > 1) throw new Error(`More than one agent firm reads as Etch: ${rows.map(r => r.name).join(", ")}`);
  return rows[0] || null;
}
async function agentContact(firmId) {
  const [row] = await q(`SELECT id, name, role, phone, email, contact_type FROM crm_contacts WHERE company_id = $1 AND lower(name) = lower($2) ORDER BY created_at LIMIT 1`, [firmId, AGENT.name]);
  return row || null;
}

// ---- Phases -----------------------------------------------------------------
const PHASES = {
  async agent() {
    let f = await firm();
    if (!f) {
      const made = await must(STAGER, "POST", "/api/crm/companies", { name: "Etch", companyType: "Agent" });
      f = { id: made.id, name: made.name };
      step(true, `agent firm ${f.name} added to the CRM`);
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
      step(true, `${f.name} is ${BRAND.name}'s tenant rep, ${AGENT.name} the named contact`);
    } else if (have.primary_contact_id !== c.id) {
      await must(STAGER, "PATCH", `/api/brand/representations/${have.id}`, { primaryContactId: c.id });
      step(true, `${AGENT.name} named on the tenant rep line`);
    } else step(false, `${f.name} is ${BRAND.name}'s tenant rep, ${AGENT.name} the named contact`);
  },

  async unit() {
    const [u] = await q(`SELECT unit_name, asking_rent, service_charge_pa FROM available_units WHERE id = $1`, [SHARE_UNIT]);
    if (!u) throw new Error("The Liverpool ONE unit is not on the tracker");
    if (Number(u.asking_rent) === QUOTING.askingRent && Number(u.service_charge_pa) === QUOTING.serviceChargePa) return step(false, `${u.unit_name} has its quoting terms`);
    await must(STAGER, "PATCH", `/api/available-units/${SHARE_UNIT}`, QUOTING);
    step(true, `${u.unit_name}: quoting rent £${QUOTING.askingRent.toLocaleString("en-GB")} and service charge £${QUOTING.serviceChargePa.toLocaleString("en-GB")} a year (made up)`);
  },

  async all() { for (const p of ["agent", "rep", "unit"]) { log(`${p}:`); await PHASES[p](); } },

  async status() {
    const f = await firm();
    const c = f && await agentContact(f.id);
    log(`  firm: ${f ? `${f.name} (${f.id})` : "none"}`);
    log(`  agent: ${c ? `${c.name}, ${c.role || "no role"}, ${c.phone || "no phone"}, ${c.email || "no email"} (${c.id})` : "none"}`);
    const reps = await q(`SELECT r.agent_type, co.name AS firm, ct.name AS contact FROM brand_agent_representations r LEFT JOIN crm_companies co ON co.id = r.agent_company_id LEFT JOIN crm_contacts ct ON ct.id = r.primary_contact_id WHERE r.brand_company_id = $1`, [BRAND.id]);
    log(`  ${BRAND.name} is represented by: ${reps.map(r => `${r.contact || "nobody named"} of ${r.firm || "no firm"} (${r.agent_type})`).join("; ") || "nobody"}`);
    const [u] = await q(`SELECT unit_name, asking_rent, service_charge_pa FROM available_units WHERE id = $1`, [SHARE_UNIT]);
    log(`  share unit: ${u ? `${u.unit_name}, rent ${u.asking_rent ?? "none"}, service charge ${u.service_charge_pa ?? "none"}` : "missing"}`);
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
    [BLUEWATER, `%(tag:unit/${BK_UNIT})%`, `%${COMMENT}`]);
  const photos = (await q(`SELECT id, file_name FROM image_studio_images WHERE company_id = $1 AND NOT ('trashed' = ANY(COALESCE(tags, '{}')))`, [BRAND.id]))
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
