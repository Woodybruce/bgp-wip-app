// r573: prove/verify the client weekly-update PDF's headline figures.
// Logs in as staff, pulls GET /api/weekly-report/:contactId.pdf, extracts text.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const BASE = 'http://127.0.0.1:5000';
const CONTACT = process.argv[2];
const TAG = process.argv[3] || 'out';

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: "victoria@brucegillinghampollard.com", password: "B@nd0077!" }),
});
const auth = await login.json();
const token = auth.token || auth.accessToken;
if (!token) { console.error('login failed', login.status, JSON.stringify(auth).slice(0,300)); process.exit(1); }

const r = await fetch(`${BASE}/api/weekly-report/${CONTACT}.pdf`, { headers: { Authorization: `Bearer ${token}` } });
console.log('PDF status', r.status, r.headers.get('content-type'));
if (r.status !== 200) { console.error(await r.text()); process.exit(1); }
const buf = Buffer.from(await r.arrayBuffer());
const out = `/tmp/r573-weekly-${TAG}.pdf`;
fs.writeFileSync(out, buf);
const { PDFParse } = require('pdf-parse');
const parser = new PDFParse({ data: new Uint8Array(buf) });
const data = await parser.getText();
console.log(`--- ${out} (${buf.length} bytes) ---`);
console.log(String(data.text).replace(/\n{3,}/g, '\n\n'));
