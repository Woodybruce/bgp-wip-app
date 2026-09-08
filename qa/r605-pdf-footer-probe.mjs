// r605 — prove the two document-templates.ts footer sites that r601 patched
// and r604 could only call "patched-not-proven" (no fixture template).
//   :1144  exportDocumentToPdf()   — reached by direct import (email/whatsapp
//          are its only callers, neither is an HTTP route)
//   :2975  POST /api/doc-runs/export (format:"pdf") — takes content in the
//          BODY, so it needs no doc_template row at all.
// Both must render ONE page for one page of content, with the footer ON it.
import zlib from 'node:zlib';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:5000';

function pdfPages(buf) {
  const bin = Buffer.from(buf).toString('latin1');
  return (bin.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

// pdfkit writes standard-font text as hex TJ arrays interleaved with kerning
// offsets — join only the hex runs, or a number lands mid-word (harness note).
function pdfText(buf) {
  const bin = Buffer.from(buf).toString('latin1');
  let hay = '';
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(bin))) {
    const start = m.index + m[0].length;
    const end = bin.indexOf('endstream', start);
    if (end < 0) continue;
    try {
      const out = zlib.inflateSync(Buffer.from(bin.slice(start, end), 'latin1')).toString('latin1');
      for (const arr of out.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
        hay += [...arr[1].matchAll(/<([0-9a-f]*)>/gi)]
          .map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('') + '\n';
      }
      for (const lit of out.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) hay += lit[1] + '\n';
    } catch { /* not a flate stream */ }
  }
  return hay;
}

const CONTENT = [
  '# Bluewater Shopping Centre — Unit BX10',
  '',
  'A short one-page note so the page count is unambiguous. **Bold** and *italic*',
  'both appear so the inline formatting path runs.',
  '',
  '- Guide rent £45,000 pa',
  '- Term 10 years',
].join('\n');

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'ok ' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

// ---- door 1: exportDocumentToPdf (document-templates.ts:1144) -------------
{
  const { exportDocumentToPdf } = await import('../server/document-templates.ts');
  const buf = await exportDocumentToPdf(CONTENT, 'r605 probe');
  const pages = pdfPages(buf);
  const text = pdfText(buf);
  check('exportDocumentToPdf renders exactly 1 page', pages === 1, `${pages} page(s)`);
  check('exportDocumentToPdf footer is on that page',
    /Bruce Gillingham Pollard/.test(text) && /Page\s*1\s*of\s*1/.test(text));
}

// ---- door 2: POST /api/doc-runs/export (document-templates.ts:2975) ------
{
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'victoria@brucegillinghampollard.com', password: 'B@nd0077!' }),
  });
  const token = (await login.json()).token;
  if (!token) { check('doc-runs/export login', false, `login ${login.status}`); }
  else {
    const res = await fetch(`${BASE}/api/doc-runs/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ content: CONTENT, title: 'r605 probe', format: 'pdf' }),
    });
    check('POST /api/doc-runs/export?format=pdf → 200', res.ok, `HTTP ${res.status}`);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      const pages = pdfPages(buf);
      const text = pdfText(buf);
      check('doc-runs export renders exactly 1 page', pages === 1, `${pages} page(s)`);
      check('doc-runs export footer is on that page',
        /Bruce Gillingham Pollard/.test(text) && /Page\s*1\s*of\s*1/.test(text));
    }
  }
}

console.log(failures === 0 ? '\nr605 pdf-footer probe: all green' : `\nr605 pdf-footer probe: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
