// r624: does a Landsec client's ChatBGP session get to attach imagery to a
// RIVAL landlord's property? Calls both dispatchers directly (no AI key
// needed) with a synthetic client req, then cleans up.
import { pool } from "../server/db";

async function main() {
  const { executeCrmToolRaw, handleCrmToolCall } = await import("../server/chatbgp");
  const u = await pool.query(`SELECT id, email, team, role FROM users WHERE email = $1`, ['mark.warne@landsec.com']);
  console.log('[mark]', u.rows[0]);
  const { resolveCompanyScope, isPropertyInScope } = await import("../server/company-scope");
  const req: any = { session: { userId: u.rows[0].id } };
  const scope = await resolveCompanyScope(req);
  console.log('[scope]', scope);

  // a property that is NOT in Mark's scope
  const cand = await pool.query(
    `SELECT p.id, p.name, p.landlord_id FROM crm_properties p
     WHERE p.landlord_id IS NOT NULL AND p.landlord_id <> $1
       AND NOT EXISTS (SELECT 1 FROM crm_company_properties cp WHERE cp.property_id = p.id AND cp.company_id = $1)
     ORDER BY p.name LIMIT 5`, [scope]);
  console.log('[out-of-scope candidates]', cand.rows.map((r: any) => `${r.name} ${r.id}`));
  const target = cand.rows[0];
  if (!target) throw new Error('no out-of-scope property in fixture');
  console.log('[in scope?]', await isPropertyInScope(scope!, target.id));

  const images = [{ kind: 'hero', source: 'manual_upload', sourceUrl: 'https://example.invalid/r624.png', caption: 'QA r624 probe' }];

  const desktop = await executeCrmToolRaw('add_property_imagery', { propertyId: target.id, images }, { session: { userId: u.rows[0].id } } as any);
  console.log('[DESKTOP executeCrmToolRaw]', JSON.stringify(desktop.data));

  // The mobile twin summarises its result through Claude, which throws in the
  // keyless QA env — AFTER its insert. Catch it and count the rows instead.
  try {
    const mobile = await handleCrmToolCall('add_property_imagery', { propertyId: target.id, images: [{ ...images[0], caption: 'QA r624 probe mobile' }] },
      { session: { userId: u.rows[0].id } } as any,
      { messages: [] }, { role: 'assistant' }, { id: 'r624', function: { name: 'add_property_imagery', arguments: '{}' } } as any);
    console.log('[MOBILE handleCrmToolCall]', JSON.stringify(mobile.response));
  } catch (e: any) {
    console.log('[MOBILE handleCrmToolCall threw at the summary step]', e.message);
  }

  // sibling doors on the same rival property
  for (const [tool, args] of [
    ['update_property', { id: target.id, name: 'QA r624 renamed' }],
    ['upsert_tenancy_schedule', { propertyId: target.id, rows: [{ unitName: 'QA r624 unit' }] }],
    ['create_available_unit', { propertyId: target.id, unitName: 'QA r624 unit' }],
  ] as any[]) {
    try {
      const r = await executeCrmToolRaw(tool, args, { session: { userId: u.rows[0].id } } as any);
      console.log(`[RIVAL ${tool}]`, JSON.stringify(r.data).slice(0, 220));
    } catch (e: any) { console.log(`[RIVAL ${tool}] threw`, e.message); }
  }

  // the legitimate case must still work: Mark's OWN property
  const own = await pool.query(
    `SELECT p.id, p.name FROM crm_properties p WHERE p.landlord_id = $1 LIMIT 1`, [scope]);
  console.log('[own property]', own.rows[0]);
  const ownRes = await executeCrmToolRaw('add_property_imagery',
    { propertyId: own.rows[0].id, images: [{ ...images[0], caption: 'QA r624 probe own' }] },
    { session: { userId: u.rows[0].id } } as any);
  console.log('[OWN add_property_imagery]', JSON.stringify(ownRes.data));

  // and staff must still be able to touch the rival property
  const vic = await pool.query(`SELECT id FROM users WHERE email = $1`, ['victoria@brucegillinghampollard.com']);
  const staffRes = await executeCrmToolRaw('add_property_imagery',
    { propertyId: target.id, images: [{ ...images[0], caption: 'QA r624 probe staff' }] },
    { session: { userId: vic.rows[0].id } } as any);
  console.log('[STAFF add_property_imagery on the same property]', JSON.stringify(staffRes.data));

  const nameNow = await pool.query(`SELECT name FROM crm_properties WHERE id = $1`, [target.id]);
  console.log('[rival property name unchanged?]', nameNow.rows[0].name, nameNow.rows[0].name === target.name);
  const stray = await pool.query(
    `SELECT (SELECT count(*) FROM available_units WHERE property_id = $1) AS units,
            (SELECT count(*) FROM tenancy_schedule_units WHERE property_id = $1) AS ts`, [target.id]);
  console.log('[rival property units / tenancy rows]', stray.rows[0]);

  const rows = await pool.query(`SELECT id, kind, caption, generated_by FROM property_imagery_assets WHERE property_id = $1 AND caption LIKE 'QA r624 probe%'`, [target.id]);
  console.log('[rows landed on the rival property]', rows.rows.length, rows.rows);
  await pool.query(`DELETE FROM property_imagery_assets WHERE caption LIKE 'QA r624 probe%'`);
  await pool.query(`UPDATE crm_properties SET name = $2 WHERE id = $1 AND name = 'QA r624 renamed'`, [target.id, target.name]);
  console.log('[cleanup] deleted');
  process.exit(0);
}
main().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
