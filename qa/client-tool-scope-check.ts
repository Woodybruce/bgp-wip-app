// r624 + r626: the ChatBGP doors must honour the same record scope the REST doors
// do. Both dispatchers (`executeCrmToolRaw`, desktop/SSE, and
// `handleCrmToolCall`, the mobile twin) used to run every property-keyed
// WRITE tool without checking the caller's company scope, so a Landsec client
// session could attach imagery to, rename, re-schedule or add a unit to a
// RIVAL landlord's property. Needs direct module access (a client cannot be
// driven through the LLM in the keyless QA env), so this runs like
// tracker-sync-check.ts rather than as a two-bot browser scenario.
import { pool } from "../server/db";

const CAPTION = "QA client-tool-scope-check";
let failures = 0;
function ok(name: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  const { executeCrmToolRaw, handleCrmToolCall } = await import("../server/chatbgp");
  const { resolveCompanyScope, isPropertyInScope } = await import("../server/company-scope");

  const client = await pool.query(`SELECT id FROM users WHERE email = 'mark.warne@landsec.com'`);
  const staff = await pool.query(`SELECT id FROM users WHERE email = 'victoria@brucegillinghampollard.com'`);
  if (!client.rows.length || !staff.rows.length) throw new Error("fixture personas missing");
  const clientReq = () => ({ session: { userId: client.rows[0].id } }) as any;
  const staffReq = () => ({ session: { userId: staff.rows[0].id } }) as any;

  const scope = await resolveCompanyScope(clientReq());
  if (!scope) throw new Error("client scope did not resolve");

  const rival = await pool.query(
    `SELECT p.id, p.name FROM crm_properties p
     WHERE p.landlord_id IS NOT NULL AND p.landlord_id <> $1
       AND NOT EXISTS (SELECT 1 FROM crm_company_properties cp WHERE cp.property_id = p.id AND cp.company_id = $1)
     ORDER BY p.name LIMIT 1`, [scope]);
  const own = await pool.query(`SELECT p.id, p.name FROM crm_properties p WHERE p.landlord_id = $1 LIMIT 1`, [scope]);
  if (!rival.rows.length || !own.rows.length) throw new Error("fixture has no rival / own property to scope against");
  const target = rival.rows[0];
  if (await isPropertyInScope(scope, target.id)) throw new Error(`${target.name} is IN the client's scope — pick another target`);

  const img = [{ kind: "hero", source: "manual_upload", caption: CAPTION }];
  const refused = (r: any) => typeof r?.error === "string" && /part of your portfolio/i.test(r.error);

  try {
    // both doors, the named tool
    const d = await executeCrmToolRaw("add_property_imagery", { propertyId: target.id, images: img }, clientReq());
    ok("client add_property_imagery on a rival property refused (desktop dispatcher)", refused(d.data), JSON.stringify(d.data).slice(0, 120));
    // If the guard is absent the mobile twin inserts and THEN summarises
    // through Claude, which throws in the keyless env — that throw is itself
    // the unguarded path, so report it as a failure rather than aborting.
    let mobileReply = "";
    try {
      const m = await handleCrmToolCall("add_property_imagery", { propertyId: target.id, images: img }, clientReq(),
        { messages: [] }, { role: "assistant" }, { id: "scope-check", function: { name: "add_property_imagery", arguments: "{}" } } as any);
      mobileReply = m?.response?.reply || "";
    } catch (e: any) { mobileReply = `threw past the guard: ${e?.message || e}`; }
    ok("client add_property_imagery on a rival property refused (mobile dispatcher)",
      /part of your portfolio/i.test(mobileReply), mobileReply.slice(0, 120));

    // the siblings that share the shape
    for (const [tool, args] of [
      ["update_property", { id: target.id, name: "QA scope-check rename" }],
      ["upsert_tenancy_schedule", { propertyId: target.id, rows: [{ unitName: "QA scope-check unit" }] }],
      ["create_available_unit", { propertyId: target.id, unitName: "QA scope-check unit" }],
    ] as [string, any][]) {
      const r = await executeCrmToolRaw(tool, args, clientReq());
      ok(`client ${tool} on a rival property refused`, refused(r.data), JSON.stringify(r.data).slice(0, 120));
    }

    // the guard must not be a blanket block
    const o = await executeCrmToolRaw("add_property_imagery", { propertyId: own.rows[0].id, images: img }, clientReq());
    ok("client add_property_imagery on its OWN property still allowed", o.data?.success === true, JSON.stringify(o.data).slice(0, 120));
    const s = await executeCrmToolRaw("add_property_imagery", { propertyId: target.id, images: img }, staffReq());
    ok("staff add_property_imagery on the same property still allowed", s.data?.success === true, JSON.stringify(s.data).slice(0, 120));

    // nothing the client aimed at the rival property actually landed
    const landed = await pool.query(
      `SELECT count(*)::int AS c FROM property_imagery_assets
       WHERE property_id = $1 AND caption = $2 AND generated_by = $3`, [target.id, CAPTION, client.rows[0].id]);
    ok("no client-authored imagery row on the rival property", landed.rows[0].c === 0, `rows=${landed.rows[0].c}`);
    const renamed = await pool.query(`SELECT name FROM crm_properties WHERE id = $1`, [target.id]);
    ok("rival property name unchanged", renamed.rows[0].name === target.name, renamed.rows[0].name);

    // ---- r626: the company- / deal- / contact- / unit-keyed doors ----
    // Same shape, same two dispatchers. The REST twins already refuse these
    // (a client is read-only across the whole of /api/crm bar contacts+deals
    // PUT/POST, which scope themselves), the AI doors did not.
    const rivalDeal = await pool.query(
      `SELECT d.id, d.name, d.status FROM crm_deals d
        WHERE d.landlord_id IS NOT NULL AND d.landlord_id <> $1 ORDER BY d.name LIMIT 1`, [scope]);
    const rivalCo = await pool.query(
      `SELECT id, name FROM crm_companies WHERE company_type = 'Landlord' AND id <> $1 ORDER BY name LIMIT 1`, [scope]);
    const rivalContact = await pool.query(
      `SELECT ct.id, ct.name FROM crm_contacts ct JOIN crm_companies c ON c.id = ct.company_id
        WHERE c.company_type = 'Landlord' AND ct.company_id <> $1 ORDER BY ct.name LIMIT 1`, [scope]);
    const rivalUnit = await pool.query(
      `SELECT u.id, u.unit_name, u.asking_rent FROM available_units u
        WHERE u.property_id = $1 ORDER BY u.unit_name LIMIT 1`, [target.id]);
    const ownContact = await pool.query(`SELECT id, name FROM crm_contacts WHERE company_id = $1 LIMIT 1`, [scope]);
    const ownUnit = await pool.query(
      `SELECT u.id, u.unit_name FROM available_units u WHERE u.property_id = $1 LIMIT 1`, [own.rows[0].id]);
    if (!rivalDeal.rows.length || !rivalCo.rows.length || !rivalContact.rows.length || !rivalUnit.rows.length) {
      throw new Error("fixture has no rival deal / company / contact / unit to scope against");
    }
    const dealBefore = rivalDeal.rows[0];
    const coBefore = rivalCo.rows[0];
    const contactBefore = rivalContact.rows[0];
    const unitBefore = rivalUnit.rows[0];

    for (const [tool, args, label] of [
      ["update_deal", { id: dealBefore.id, name: "QA scope-check rename", fee: 99999 }, "rival deal"],
      ["update_company", { id: coBefore.id, name: "QA scope-check rename" }, "rival company"],
      ["update_contact", { id: contactBefore.id, name: "QA scope-check rename" }, "rival contact"],
      ["update_available_unit", { id: unitBefore.id, askingRent: 999999 }, "rival unit"],
      ["log_viewing", { entityType: "unit", entityId: unitBefore.id, company: CAPTION, viewingDate: "2026-09-09" }, "rival unit"],
      ["log_offer", { entityType: "unit", entityId: unitBefore.id, company: CAPTION, offerDate: "2026-09-09", rentPa: 12345 }, "rival unit"],
      ["update_requirement", { id: "11111111-1111-1111-1111-111111111111", notes: CAPTION }, "an unowned requirement row"],
    ] as [string, any, string][]) {
      const r = await executeCrmToolRaw(tool, args, clientReq());
      ok(`client ${tool} on ${label} refused (desktop dispatcher)`, refused(r.data), JSON.stringify(r.data).slice(0, 110));
    }

    // the mobile twin must refuse the same calls — every round that only
    // censused the desktop dispatcher missed half the bug (r624)
    for (const [tool, args] of [
      ["update_deal", { id: dealBefore.id, name: "QA scope-check rename" }],
      ["update_company", { id: coBefore.id, name: "QA scope-check rename" }],
      ["update_available_unit", { id: unitBefore.id, askingRent: 999999 }],
    ] as [string, any][]) {
      let reply = "";
      try {
        const m = await handleCrmToolCall(tool, args, clientReq(),
          { messages: [] }, { role: "assistant" }, { id: "scope-check", function: { name: tool, arguments: "{}" } } as any);
        reply = m?.response?.reply || "";
      } catch (e: any) { reply = `threw past the guard: ${e?.message || e}`; }
      ok(`client ${tool} on a rival record refused (mobile dispatcher)`,
        /part of your portfolio/i.test(reply), reply.slice(0, 110));
    }

    // link_entities is the ESCALATION door: crm_company_properties is the very
    // table isPropertyInScope reads, so linking your own company to a rival's
    // property would make that property in-scope everywhere.
    const linkRes = await executeCrmToolRaw("link_entities",
      { linkType: "company-property", sourceId: scope, targetId: target.id }, clientReq());
    ok("client link_entities own-company → rival property refused",
      typeof linkRes.data?.error === "string" && /outside your portfolio/i.test(linkRes.data.error),
      JSON.stringify(linkRes.data).slice(0, 110));
    const escalated = await pool.query(
      `SELECT count(*)::int AS c FROM crm_company_properties WHERE company_id = $1 AND property_id = $2`, [scope, target.id]);
    ok("no escalating crm_company_properties link landed", escalated.rows[0].c === 0, `rows=${escalated.rows[0].c}`);
    ok("rival property still OUT of the client's scope", !(await isPropertyInScope(scope, target.id)));

    // and none of it is a blanket block — the client's own records stay writable
    if (ownContact.rows.length) {
      const oc = await executeCrmToolRaw("update_contact", { id: ownContact.rows[0].id, notes: CAPTION }, clientReq());
      ok("client update_contact on its OWN contact still allowed", oc.data?.success === true, JSON.stringify(oc.data).slice(0, 110));
    }
    if (ownUnit.rows.length) {
      const ou = await executeCrmToolRaw("update_available_unit", { id: ownUnit.rows[0].id, notes: CAPTION }, clientReq());
      ok("client update_available_unit on its OWN unit still allowed", ou.data?.success === true, JSON.stringify(ou.data).slice(0, 110));
    }
    const sd = await executeCrmToolRaw("update_deal", { id: dealBefore.id, comments: CAPTION }, staffReq());
    ok("staff update_deal on the same rival deal still allowed", sd.data?.success === true, JSON.stringify(sd.data).slice(0, 110));

    // nothing the client aimed at a rival record landed
    const after = await pool.query(
      `SELECT (SELECT name FROM crm_deals WHERE id = $1) AS deal,
              (SELECT name FROM crm_companies WHERE id = $2) AS co,
              (SELECT name FROM crm_contacts WHERE id = $3) AS contact,
              (SELECT asking_rent FROM available_units WHERE id = $4) AS rent`,
      [dealBefore.id, coBefore.id, contactBefore.id, unitBefore.id]);
    const a = after.rows[0];
    ok("rival deal name unchanged", a.deal === dealBefore.name, String(a.deal));
    ok("rival company name unchanged", a.co === coBefore.name, String(a.co));
    ok("rival contact name unchanged", a.contact === contactBefore.name, String(a.contact));
    ok("rival unit asking rent unchanged", String(a.rent) === String(unitBefore.asking_rent), String(a.rent));
    const logged = await pool.query(
      `SELECT (SELECT count(*)::int FROM unit_viewings WHERE unit_id = $1 AND company_name = $2) AS v,
              (SELECT count(*)::int FROM unit_offers   WHERE unit_id = $1 AND company_name = $2) AS o`,
      [unitBefore.id, CAPTION]);
    ok("no client viewing/offer logged on the rival unit",
      logged.rows[0].v === 0 && logged.rows[0].o === 0, `viewings=${logged.rows[0].v} offers=${logged.rows[0].o}`);
  } finally {
    await pool.query(`DELETE FROM property_imagery_assets WHERE caption = $1`, [CAPTION]);
    await pool.query(`DELETE FROM available_units WHERE unit_name = 'QA scope-check unit'`);
    await pool.query(`UPDATE crm_properties SET name = $2 WHERE id = $1 AND name = 'QA scope-check rename'`, [target.id, target.name]);
    await pool.query(`DELETE FROM unit_viewings WHERE company_name = $1`, [CAPTION]);
    await pool.query(`DELETE FROM unit_offers WHERE company_name = $1`, [CAPTION]);
    await pool.query(`UPDATE crm_contacts SET notes = NULL WHERE notes = $1`, [CAPTION]);
    await pool.query(`UPDATE available_units SET notes = NULL WHERE notes = $1`, [CAPTION]);
    await pool.query(`UPDATE crm_deals SET comments = NULL WHERE comments = $1`, [CAPTION]);
  }

  console.log(failures === 0 ? "  client-tool-scope-check: all green" : `  client-tool-scope-check: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("client-tool-scope-check ERROR", e?.message || e); process.exit(1); });
