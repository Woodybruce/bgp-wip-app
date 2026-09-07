// Proof for the Landsec image-markup fix.
// Runs the REAL edit_image tool (executeCrmToolRaw) as the real Landsec
// client session, plus controls that must still be refused.
import pg from 'pg';
const DB = 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const BASE = 'http://127.0.0.1:5000';
const pool = new pg.Pool({ connectionString: DB });
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [ok]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };

const login = async (email) => {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password: 'B@nd0077!' }),
  });
  if (!r.ok) throw new Error(`login ${email} -> ${r.status} ${await r.text()}`);
  return r.headers.get('set-cookie').split(';')[0];
};

// A 1x1 PNG standing in for Mark's floor plan.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

const markCookie = await login('mark.warne@landsec.com');
const mark = (await pool.query(`SELECT id FROM users WHERE email='mark.warne@landsec.com'`)).rows[0].id;
const scopeRes = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: markCookie } });
const me = await scopeRes.json();
console.log(`Mark: role=${me.role} team=${me.team}`);

// Mark's resolved company scope, the value the fix stamps.
const scope = (await pool.query(
  `SELECT id, name FROM crm_companies WHERE name ILIKE 'Landsec%' ORDER BY name LIMIT 1`)).rows[0];
console.log(`Landsec company: ${scope.name} ${scope.id}\n`);

const mkRow = async (propertyId, companyId, label) => {
  const r = await pool.query(
    `INSERT INTO image_studio_images
       (file_name, category, tags, description, source, mime_type, file_size,
        local_path, uploaded_by, property_id, company_id, created_at)
     VALUES ($1,'Other',ARRAY['probe']::text[],$2,'upload','image/png',$3,'/tmp/probe.png',$4,$5,$6,NOW())
     RETURNING id`,
    [`probe-${label}.png`, label, PNG.length, mark, propertyId, companyId]);
  return r.rows[0].id;
};
const aiEdit = async (imageId, cookie) => {
  const r = await fetch(`${BASE}/api/image-studio/ai-edit`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ imageId, editPrompt: 'sketch a 14-desk layout with a 4-person meeting room' }),
  });
  return { status: r.status, body: (await r.text()).slice(0, 160) };
};

console.log('— THE BUG (pre-fix shape: orphan row, no property, no company) —');
const orphan = await mkRow(null, null, 'orphan');
const a = await aiEdit(orphan, markCookie);
a.status === 403 && /not in your portfolio/i.test(a.body)
  ? ok(`orphan row 403s for Mark: ${a.body}  <- this is what he hit`)
  : bad(`expected 403 "Not in your portfolio", got ${a.status} ${a.body}`);

console.log('\n— THE FIX (row stamped with the caller company, no property) —');
const stamped = await mkRow(null, scope.id, 'stamped');
const b = await aiEdit(stamped, markCookie);
b.status !== 403
  ? ok(`company-stamped row PASSES the scope gate (HTTP ${b.status}: ${b.body})`)
  : bad(`still refused: ${b.status} ${b.body}`);

console.log('\n— CONTROL 1: not a blanket bypass (row stamped to ANOTHER company) —');
const other = (await pool.query(
  `SELECT id, name FROM crm_companies WHERE id <> $1 AND name NOT ILIKE 'Landsec%' ORDER BY name LIMIT 1`,
  [scope.id])).rows[0];
const foreign = await mkRow(null, other.id, 'foreign');
const c = await aiEdit(foreign, markCookie);
c.status === 403
  ? ok(`another company's image STILL 403s for Mark (${other.name}) — scoping intact`)
  : bad(`LEAK: Mark reached ${other.name}'s image, HTTP ${c.status}`);

console.log('\n— CONTROL 2: staff unaffected —');
const vicCookie = await login('victoria@brucegillinghampollard.com');
const d = await aiEdit(orphan, vicCookie);
d.status !== 403
  ? ok(`staff still reach the firm-wide pool (HTTP ${d.status})`)
  : bad(`staff wrongly refused: ${d.body}`);

console.log('\n— THE REAL TOOL, end to end as Mark (executeCrmToolRaw edit_image) —');
await pool.query(
  `INSERT INTO file_storage (storage_key, data, content_type, original_name, size)
   VALUES ($1,$2,'image/png','mortimer-street-plan.png',$3)
   ON CONFLICT (storage_key) DO UPDATE SET data=$2`,
  ['chat-media/probe-plan.png', PNG, PNG.length]);
const { executeCrmToolRaw } = await import('../../server/chatbgp.ts');
const fakeReq = {
  session: { userId: mark },
  headers: { cookie: markCookie, host: '127.0.0.1:5000' },
  protocol: 'http',
};
const res = await executeCrmToolRaw('edit_image', {
  imageUrl: '/api/chat-media/probe-plan.png',
  editPrompt: 'sketch a 14-desk layout with a 4-person meeting room',
}, fakeReq);
const err = res?.data?.error || '';
console.log(`  tool returned: success=${res?.data?.success} error=${JSON.stringify(err).slice(0,180)}`);
/not in your portfolio/i.test(err)
  ? bad('edit_image STILL refuses Mark on a bare uploaded plan')
  : ok('edit_image no longer refuses Mark on a bare uploaded plan (no "Not in your portfolio")');
const newRow = (await pool.query(
  `SELECT company_id, property_id FROM image_studio_images
    WHERE description='Imported from chat for AI edit' AND uploaded_by=$1
    ORDER BY created_at DESC LIMIT 1`, [mark])).rows[0];
newRow && newRow.company_id === scope.id && newRow.property_id === null
  ? ok(`the imported row is stamped company_id=Landsec, property_id=NULL — visible in Mark's own Image Studio`)
  : bad(`imported row wrong: ${JSON.stringify(newRow)}`);

console.log('\n— save_to_image_studio, same fix, as Mark —');
const saveRes = await executeCrmToolRaw('save_to_image_studio', {
  base64Data: PNG.toString('base64'),
  mimeType: 'image/png',
  fileName: 'Mortimer Street ground floor plan',
  category: 'Floor Plans',
}, fakeReq);
const savedId = saveRes?.data?.imageId || saveRes?.data?.id;
const savedRow = savedId
  ? (await pool.query(`SELECT company_id, property_id FROM image_studio_images WHERE id=$1`, [savedId])).rows[0]
  : (await pool.query(`SELECT company_id, property_id FROM image_studio_images WHERE file_name ILIKE 'Mortimer Street%' ORDER BY created_at DESC LIMIT 1`)).rows[0];
savedRow && savedRow.company_id === scope.id && savedRow.property_id === null
  ? ok('an unlinked client save is stamped to Landsec, not orphaned')
  : bad(`save row wrong: ${JSON.stringify(savedRow)} (tool: ${JSON.stringify(saveRes?.data).slice(0,160)})`);
if (savedRow) {
  const s2 = await aiEdit(savedId, markCookie);
  s2.status !== 403 ? ok(`and it is editable afterwards (HTTP ${s2.status})`) : bad(`saved image un-editable: ${s2.body}`);
}

console.log('\n— cleanup —');
await pool.query(`DELETE FROM image_studio_images WHERE 'probe' = ANY(tags) OR description='Imported from chat for AI edit' OR file_name ILIKE 'Mortimer Street%'`);
await pool.query(`DELETE FROM file_storage WHERE storage_key='chat-media/probe-plan.png'`);
console.log('  fixture restored');
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} ok, ${fail} failed`);
await pool.end();
process.exit(fail === 0 ? 0 : 1);
