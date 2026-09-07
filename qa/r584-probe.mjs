// r584 proof probe. Two label-vs-code bugs, both feeding ChatBGP's context.
//  BUG 1 available_units.marketing_status is CODES (canonicalised at boot,
//        server/index.ts:1479) — three context builders compared it to the
//        legacy LABELS, so every one returned zero rows.
//  BUG 2 crm_deals.status is CODES — the CLIENT portfolio context and the
//        client search tool excluded dead deals by legacy LABEL, so a
//        WITHDRAWN deal was never excluded from what a landlord is told.
import pg from 'pg';
import { getClientCrmContext, clientScopedCrmSearch } from '../server/chatbgp.ts';

const url = process.env.DATABASE_URL || 'postgresql://postgres:qa-local-pg@127.0.0.1:5432/bgpsmoke';
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (s, p) => (await c.query(s, p)).rows;
let fails = 0;
const chk = (name, cond, detail) => { console.log(`${cond ? '  ok ' : '  FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!cond) fails++; };

console.log('\n── BUG 1 · the "(N available)" line ChatBGP is handed for a property ──');
const prop = (await q(`SELECT id, name, status, asset_class FROM crm_properties WHERE name = 'Bluewater Shopping Centre' LIMIT 1`))[0];
const line = async (pred) => {
  const r = (await q(`SELECT p.name,
      (SELECT COUNT(*) FROM available_units au WHERE au.property_id = p.id) unit_count,
      (SELECT COUNT(*) FROM available_units au WHERE au.property_id = p.id AND ${pred}) available_count
    FROM crm_properties p WHERE p.id = $1`, [prop.id]))[0];
  return `- Property **${r.name}** — ${prop.asset_class || 'unknown class'}, status ${prop.status || 'unknown'}, ${r.unit_count} units (${r.available_count} available)`;
};
const before = await line(`au.marketing_status = 'Available'`);
const after  = await line(`au.marketing_status = 'AVA'`);
console.log('  BEFORE (legacy label): ' + before);
console.log('  AFTER  (canonical code): ' + after);
chk('the legacy predicate reports zero available units', /\(0 available\)/.test(before));
chk('the canonical predicate reports the real count', /\(75 available\)/.test(after), after.match(/\((\d+) available\)/)[0]);
const units = await q(`SELECT unit_name, marketing_status FROM available_units WHERE property_id = $1 ORDER BY unit_name LIMIT 3`, [prop.id]);
console.log('  ...and the very next lines of the SAME context list: ' + units.map(u => `${u.unit_name} [${u.marketing_status}]`).join(', '));
chk('so the pre-fix context contradicted itself', units.some(u => u.marketing_status === 'AVA'));

console.log('\n── BUG 1b · the firm-wide "Available Units" context block ──');
const oldBlock = await q(`SELECT count(*) n FROM available_units WHERE marketing_status IN ('Available', 'Under Offer')`);
const newBlock = await q(`SELECT count(*) n FROM available_units WHERE marketing_status IN ('AVA', 'NEG')`);
console.log(`  BEFORE ${oldBlock[0].n} rows · AFTER ${newBlock[0].n} rows`);
chk('the whole block was empty', oldBlock[0].n === '0');
chk('the canonical set carries the tracker', Number(newBlock[0].n) > 80);

console.log('\n── BUG 2 · a WITHDRAWN deal in what the landlord is told ──');
const landsec = (await q(`SELECT id, name FROM crm_companies WHERE name ILIKE 'Landsec%' ORDER BY name LIMIT 1`))[0];
const target = (await q(`SELECT id, name, status FROM crm_deals WHERE landlord_id = $1 AND status IS NOT NULL ORDER BY updated_at DESC LIMIT 1`, [landsec.id]))[0];
const PHASE = process.env.QA_PHASE || 'wit';
console.log(`  Landsec = ${landsec.id}; deal "${target.name}" real status ${target.status}; PHASE=${PHASE}`);
if (PHASE === 'wit') await c.query(`UPDATE crm_deals SET status = 'WIT' WHERE id = $1`, [target.id]);
try {
  if (PHASE === 'wit') {
    const oldRows = await q(`SELECT d.name FROM crm_deals d WHERE d.landlord_id = $1 AND d.status NOT IN ('Dead','Withdrawn')`, [landsec.id]);
    const newRows = await q(`SELECT d.name FROM crm_deals d WHERE d.landlord_id = $1 AND d.status NOT IN ('WIT')`, [landsec.id]);
    chk('the legacy predicate still ships the withdrawn deal', oldRows.some(r => r.name === target.name));
    chk('the canonical predicate drops it', !newRows.some(r => r.name === target.name));
  }

  // Read the DEALS block only — a tracker unit shares this deal's name, so a
  // whole-context substring test would match the unit line instead.
  const dealsBlock = (ctx) => {
    const lines = ctx.split('\n');
    const i = lines.findIndex(l => /### Active deals/.test(l));
    if (i < 0) return [];
    const out = [];
    for (let j = i + 1; j < lines.length && !/^###/.test(lines[j]); j++) if (lines[j].trim()) out.push(lines[j]);
    return out;
  };
  const ctxWit = dealsBlock(await getClientCrmContext(landsec.id));
  console.log(`  live getClientCrmContext() deals block (deal at ${PHASE === 'wit' ? 'WIT' : target.status}):`);
  console.log(ctxWit.length ? ctxWit.map(l => '    ' + l).join('\n') : '    (empty)');
  chk(PHASE === 'wit' ? 'PATCHED client portfolio context omits the withdrawn deal'
                      : 'CONTROL the live deal IS in the client portfolio context',
      PHASE === 'wit' ? !ctxWit.some(l => l.includes(target.name))
                      : ctxWit.some(l => l.includes(target.name)), `looked for "${target.name}"`);

  const words = target.name.split(/\s+/).filter(w => w.length > 3);
  const searchWit = await clientScopedCrmSearch(landsec.id, words[0]);
  console.log(`  live clientScopedCrmSearch("${words[0]}") -> ${(searchWit?.results?.deals || []).map(d=>d.name+'/'+d.status).join(' | ') || '(none)'}`);
  console.log('  clientScopedCrmSearch result counts: ' + JSON.stringify(Object.fromEntries(Object.entries(searchWit?.results||{}).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))));
  chk(PHASE === 'wit' ? 'PATCHED client search omits the withdrawn deal'
                      : 'CONTROL the live deal IS in the client search',
      PHASE === 'wit' ? !(searchWit?.results?.deals || []).some(d => d.name === target.name)
                      : (searchWit?.results?.deals || []).some(d => d.name === target.name));

  console.log('  (CONTROL runs as a separate process — getClientCrmContext caches 2 min per process)');
} finally {
  await c.query(`UPDATE crm_deals SET status = $2 WHERE id = $1`, [target.id, target.status]);
  const back = (await q(`SELECT status FROM crm_deals WHERE id = $1`, [target.id]))[0];
  console.log(`\n  fixture restored: "${target.name}" back to ${back.status}`);
}
await c.end();
console.log(`\n── r584 probe: ${fails} failure(s) ──`);
process.exit(fails ? 1 : 0);
