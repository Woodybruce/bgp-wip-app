// r624: the ChatBGP doors must honour the same property scope the REST doors
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
  } finally {
    await pool.query(`DELETE FROM property_imagery_assets WHERE caption = $1`, [CAPTION]);
    await pool.query(`DELETE FROM available_units WHERE unit_name = 'QA scope-check unit'`);
    await pool.query(`UPDATE crm_properties SET name = $2 WHERE id = $1 AND name = 'QA scope-check rename'`, [target.id, target.name]);
  }

  console.log(failures === 0 ? "  client-tool-scope-check: all green" : `  client-tool-scope-check: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("client-tool-scope-check ERROR", e?.message || e); process.exit(1); });
