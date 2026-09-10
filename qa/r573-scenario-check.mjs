import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const BASE = 'http://127.0.0.1:5000';
const j = async (r) => { try { return await r.json(); } catch { return null; } };
const login = await j(await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }) }));
const auth = { Authorization: 'Bearer ' + login.token, 'content-type': 'application/json' };

const contacts = await j(await fetch(`${BASE}/api/crm/contacts`, { headers: auth }));
const list = Array.isArray(contacts) ? contacts : (contacts?.contacts || []);
console.log('contacts', list.length, list[0] && Object.keys(list[0]).slice(0,12));
const contact = list[0];
const made = [];
for (const [nm, st] of [['QA-PROBE weekly live','NEG'], ['QA-PROBE weekly dead','WIT']]) {
  const r = await fetch(`${BASE}/api/crm/deals`, { method:'POST', headers: auth,
    body: JSON.stringify({ name: nm, dealType: 'Consultant', status: st, clientContactId: contact.id, internalAgent: ['Victoria Broadhead'] }) });
  const d = await j(r);
  console.log('create', nm, r.status, d?.id, 'clientContactId=', d?.clientContactId ?? d?.client_contact_id);
  if (d?.id) made.push(d.id);
}
const pdf = await fetch(`${BASE}/api/weekly-report/${contact.id}.pdf`, { headers: { Authorization: auth.Authorization } });
const buf = Buffer.from(await pdf.arrayBuffer());
const { PDFParse } = require('pdf-parse');
const text = String((await new PDFParse({ data: new Uint8Array(buf) }).getText()).text);
console.log('--- pdf ---'); console.log(text.replace(/\n{3,}/g,'\n\n'));
for (const id of made) console.log('delete', id, (await fetch(`${BASE}/api/crm/deals/${id}`, { method:'DELETE', headers: auth })).status);
