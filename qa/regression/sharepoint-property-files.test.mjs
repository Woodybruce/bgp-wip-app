import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  brochureType, brochureTier, scheduleTier, documentDate, mergeCandidates, rankBrochureCandidates,
  rankScheduleCandidates, findPropertyFiles, plainGraphError, resolveFileRef, urlKey,
} from '../../server/sharepoint-property-files.ts';

process.env.DATABASE_URL ||= 'postgres://t:t@127.0.0.1:1/t';

// The Royal Exchange (EC3) as SharePoint holds it, 2026-09.
const BGP_DRIVE = 'b!TkfPTD5QkkaKK2ThhYzkbeZV8L-Ly5xIm6a79Utuotf_bKhaqTNzTLlcjCkAWwlf';
const SHARE_DRIVE = 'b!_EckNDf-lUG0T_MQjE7Nqo-V_Y5rxp5Cp3bj2IIbLO3LyUrmoUjMSouD_tbkxpCE';
const FOLDER_URL = 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20share%20drive/London/The%20Royal%20Exchange';
const DEC25_URL = 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/Marketing/Marketing%20Details%20%20Boards%20%20Requirement%20Flyers/Marketing%20Details/The%20Royal%20Exchange/Brochure/Royal_Exchange_Brochure_Dec%2025.pdf';
const dec25 = { id: '01HHIVQ5UH3OVLMKOAEBDJ7KZDSC2MGNUX', name: 'Royal_Exchange_Brochure_Dec 25.pdf', webUrl: DEC25_URL, size: 9_800_000, file: {}, lastModifiedDateTime: '2025-12-09T10:00:00Z', parentReference: { driveId: BGP_DRIVE } };
const investment = { id: '01PHLFORXFTJHEOILSQRFK55OAJBE2BS4S', name: 'The Royal Exchange EC3.pdf', size: 22_000_000, file: {}, lastModifiedDateTime: '2026-05-14T09:00:00Z', parentReference: { driveId: SHARE_DRIVE },
  webUrl: 'https://brucegillinghampollardlimited-my.sharepoint.com/personal/woody_brucegillinghampollard_com/Documents/Bruce%20Gillingham%20Pollard%20-%20Share%20Drive/Investment/Portfolios/Project%20Unison/Asset%20Files/5.%20REX/Brochure/The%20Royal%20Exchange%20EC3.pdf' };
const folderPath = (p) => ({ driveId: BGP_DRIVE, path: `/drives/${BGP_DRIVE}/root:/BGP share drive/London/The Royal Exchange${p}` });
// Touched in SharePoint after Dec 25, but its folder dates it April 2024.
const v02 = { id: 'V02', name: 'Royal_Exchange_Brochure_v02.pdf', size: 6_000_000, file: {}, lastModifiedDateTime: '2026-02-01T09:00:00Z', parentReference: folderPath('/Marketing/New Marketing Details April 2024'), webUrl: 'https://x/v02.pdf' };
const lease = { id: 'LEASE', name: 'Lease - Unit 12 2019.pdf', size: 1_000_000, file: {}, lastModifiedDateTime: '2026-06-01T09:00:00Z', parentReference: folderPath('/Leases'), webUrl: 'https://x/lease.pdf' };
const ts = { id: 'TS', name: 'REX Tenancy Schedule Sept 2026.xlsx', size: 90_000, file: {}, lastModifiedDateTime: '2026-09-02T09:00:00Z', parentReference: folderPath('/Leases'), webUrl: 'https://x/ts.xlsx' };
const budget = { id: 'BUDGET', name: 'Service charge budget 2026.xlsx', size: 90_000, file: {}, lastModifiedDateTime: '2026-09-20T09:00:00Z', parentReference: folderPath('/Leases'), webUrl: 'https://x/budget.xlsx' };
const lock = { id: 'LOCK', name: '~$REX Tenancy Schedule Sept 2026.xlsx', size: 165, file: {}, lastModifiedDateTime: '2026-09-21T09:00:00Z', parentReference: folderPath('/Leases'), webUrl: 'https://x/lock.xlsx' };

function fakeGraph({ searchFails = false } = {}) {
  const calls = [];
  const graph = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET', body: options.body });
    if (path.startsWith('/shares/')) return { id: 'ROOT', name: 'The Royal Exchange', parentReference: { driveId: BGP_DRIVE } };
    if (path === '/search/query') {
      if (searchFails) throw new Error('Graph API 403: Forbidden');
      return { value: [{ hitsContainers: [{ hits: [{ resource: dec25 }, { resource: investment }] }] }] };
    }
    const children = {
      ROOT: [{ id: 'MKT', name: 'Marketing', folder: {} }, { id: 'LEASES', name: 'Leases', folder: {} }],
      MKT: [{ id: 'APR24', name: 'New Marketing Details April 2024', folder: {} }],
      APR24: [v02],
      LEASES: [lease, ts, budget, lock],
    };
    const id = path.match(/\/items\/([^/]+)\/children/)?.[1];
    if (id) return { value: children[id] || [] };
    throw new Error(`unexpected Graph call ${path}`);
  };
  return { graph, calls };
}

function fakePool({ folderUrl = FOLDER_URL, index = [] } = {}) {
  const queries = [];
  return {
    queries,
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM crm_properties/.test(sql)) return { rows: [{ name: 'Royal Exchange', sharepoint_folder_url: folderUrl }] };
      if (/FROM knowledge_base/.test(sql)) return { rows: index };
      return { rows: [] };
    },
  };
}

test('leasing vs investment: the name decides when it says, else an investment / portfolio / project folder', () => {
  assert.equal(brochureType('Royal_Exchange_Brochure_Dec 25.pdf', 'sites/BGP/Shared Documents/Marketing/Marketing Details/The Royal Exchange/Brochure'), 'leasing');
  assert.equal(brochureType('The Royal Exchange EC3.pdf', 'Bruce Gillingham Pollard - Share Drive/Investment/Portfolios/Project Unison/Asset Files/5. REX/Brochure'), 'investment');
  assert.equal(brochureType('Royal Exchange OM.pdf', ''), 'investment');
  assert.equal(brochureType('Royal Exchange - For Sale.pdf', 'London'), 'investment');
  assert.equal(brochureType('Leasing brochure.pdf', 'BGP share drive/Investment/Royal Exchange'), 'leasing');
  // Lower-case "om" in a word is not an OM.
  assert.equal(brochureType('Tom Dixon unit details.pdf', 'London/Marketing'), 'leasing');
  assert.equal(brochureTier('Royal_Exchange_Brochure_v02.pdf', ''), 2);
  assert.equal(brochureTier('The Royal Exchange EC3.pdf', 'x/Brochure'), 1);
  assert.equal(brochureTier('Lease - Unit 12 2019.pdf', 'x/Leases'), 0);
});

test('schedule names: tenancy schedule / TS / rent roll / leasing schedule rank above other sheets', () => {
  assert.equal(scheduleTier('REX Tenancy Schedule Sept 2026.xlsx', ''), 2);
  assert.equal(scheduleTier('REX_TS_Q3.xlsm', ''), 2);
  assert.equal(scheduleTier('Rent Roll.xlsx', ''), 2);
  assert.equal(scheduleTier('Leasing Schedule 2026.xls', ''), 2);
  assert.equal(scheduleTier('Lease events.xlsx', ''), 1);
  assert.equal(scheduleTier('Service charge schedule 2026.xlsx', ''), 0);
  assert.equal(scheduleTier('Stats.xlsx', ''), 0);
});

test('a written month and year dates the document before SharePoint modified dates', () => {
  assert.equal(documentDate('Royal_Exchange_Brochure_Dec 25.pdf', '', '2026-03-01T00:00:00Z'), '2025-12-01');
  assert.equal(documentDate('Royal_Exchange_Brochure_v02.pdf', 'BGP share drive/London/The Royal Exchange/Marketing/New Marketing Details April 2024', '2026-02-01T09:00:00Z'), '2024-04-01');
  assert.equal(documentDate('Marketing.pdf', 'London/Marketing', '2026-02-01T09:00:00Z'), '2026-02-01');
});

test('Royal Exchange: the Dec 25 leasing brochure comes first for Leasing, the Project Unison brochure for Investment', async () => {
  const index = [{ file_name: dec25.name, file_path: 'Marketing/Marketing Details/The Royal Exchange/Brochure/Royal_Exchange_Brochure_Dec 25.pdf', file_url: DEC25_URL, last_modified: '2025-12-09T10:00:00Z', size_bytes: 9_800_000 }];
  const { graph, calls } = fakeGraph();
  const leasing = await findPropertyFiles(fakePool({ index }), 'rex', 'brochure', 'leasing', { graph });
  assert.deepEqual(leasing.candidates.map(c => c.name), [dec25.name, v02.name, lease.name, investment.name]);
  assert.equal(leasing.candidates[0].type, 'leasing');
  assert.equal(leasing.candidates[0].itemId, dec25.id, 'the indexed copy merges into the searched item and keeps its ids');
  assert.equal(leasing.candidates[1].source, 'folder');
  assert.equal(leasing.candidates[1].path, 'BGP share drive/London/The Royal Exchange/Marketing/New Marketing Details April 2024');
  assert.equal(leasing.linkedFolder, FOLDER_URL);
  assert.deepEqual(leasing.warnings, []);
  const search = calls.find(c => c.path === '/search/query');
  const body = JSON.parse(search.body);
  assert.match(body.requests[0].query.queryString, /^"Royal Exchange" AND filetype:pdf/);
  assert.equal(body.requests[0].region, 'GBR');

  const inv = await findPropertyFiles(fakePool({ index }), 'rex', 'brochure', 'investment', { graph: fakeGraph().graph });
  assert.equal(inv.candidates[0].name, investment.name);
  assert.equal(inv.candidates[0].type, 'investment');
  assert.equal(inv.candidates[0].driveId, SHARE_DRIVE);
});

test('schedules from the linked folder: tenancy schedule first, lock files dropped', async () => {
  const { graph } = fakeGraph();
  const out = await findPropertyFiles(fakePool(), 'rex', 'schedule', 'leasing', { graph });
  assert.deepEqual(out.candidates.map(c => c.name), [ts.name, budget.name]);
});

test('no linked folder: search only, and the folder is never walked', async () => {
  const { graph, calls } = fakeGraph();
  const out = await findPropertyFiles(fakePool({ folderUrl: null }), 'rex', 'brochure', 'leasing', { graph });
  assert.equal(out.linkedFolder, null);
  assert.deepEqual(out.candidates.map(c => c.name), [dec25.name, investment.name]);
  assert.equal(calls.some(c => c.path.startsWith('/shares/') || c.path.includes('/children')), false);
});

test('a Graph failure becomes a plain warning, and the other sources still show', async () => {
  const { graph } = fakeGraph({ searchFails: true });
  const out = await findPropertyFiles(fakePool(), 'rex', 'brochure', 'leasing', { graph });
  assert.deepEqual(out.candidates.map(c => c.name), [v02.name, lease.name]);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /^Search: /);
  assert.doesNotMatch(out.warnings[0], /Graph API|Forbidden|\{/);
  assert.equal(plainGraphError(new Error('Graph API 404: itemNotFound')), "That file or folder isn't in SharePoint any more — it may have been moved or deleted.");
  assert.equal(plainGraphError(new Error('Graph API 403: accessDenied')), "The app isn't allowed to read that SharePoint location.");
  assert.equal(plainGraphError(new Error('Azure credentials not configured')), "SharePoint isn't connected on this server right now.");
});

test('merge keeps one row per file across sources and matches Office links by their document id', () => {
  const a = { name: 'a.xlsx', path: '', webUrl: 'https://h/_layouts/15/Doc.aspx?sourcedoc=%7B11111111-2222-3333-4444-555555555555%7D&file=a.xlsx', driveId: null, itemId: null, size: null, lastModified: null, source: 'index' };
  const b = { ...a, webUrl: 'https://h/_layouts/15/Doc.aspx?sourcedoc={11111111-2222-3333-4444-555555555555}&file=a.xlsx&action=default', driveId: 'D', itemId: 'I', source: 'search' };
  const c = { ...a, webUrl: 'https://h/_layouts/15/Doc.aspx?sourcedoc=%7B99999999-2222-3333-4444-555555555555%7D&file=b.xlsx', source: 'index' };
  const merged = mergeCandidates([[a], [b, c]]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].itemId, 'I');
  assert.notEqual(urlKey(a.webUrl), urlKey(c.webUrl));
  assert.equal(rankScheduleCandidates(merged).length, 2);
  assert.equal(rankBrochureCandidates(merged, 'leasing').length, 0, 'spreadsheets are never brochure candidates');
});

test('import refs: only BGP tenant SharePoint URLs or well-formed ids are resolved', async () => {
  const graph = async () => { throw new Error('should not be called'); };
  await assert.rejects(resolveFileRef({ webUrl: 'https://evil.example.com/x.pdf' }, { graph }), e => e.status === 400);
  await assert.rejects(resolveFileRef({ driveId: 'b!x', itemId: '../../me' }, { graph }), e => e.status === 400);
  const ok = await resolveFileRef({ webUrl: investment.webUrl }, { graph: async (p) => { assert.match(p, /^\/shares\/u!/); return investment; } });
  assert.deepEqual(ok, { driveId: SHARE_DRIVE, itemId: investment.id, name: investment.name, size: investment.size, webUrl: investment.webUrl, lastModified: investment.lastModifiedDateTime });
  await assert.rejects(resolveFileRef({ driveId: 'b!x', itemId: 'FOLDER' }, { graph: async () => ({ id: 'FOLDER', folder: {}, parentReference: { driveId: 'b!x' } }) }), e => e.status === 400);
});

function fakeImportPool(propertyId) {
  const inserted = [];
  let nextId = 1;
  const client = {
    query: async (sql, params = []) => {
      if (/FROM crm_properties WHERE id = \$1 FOR UPDATE/.test(sql)) return { rows: [{ id: propertyId }] };
      if (/SELECT \* FROM tenancy_schedule_units/.test(sql)) return { rows: [] };
      if (/^INSERT INTO tenancy_schedule_units/.test(sql)) {
        const columns = sql.match(/\(([^)]+)\) VALUES/)[1].split(', ');
        const row = Object.fromEntries(columns.map((c, i) => [c, params[i]]));
        row.id = String(nextId++);
        inserted.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return {
    inserted,
    connect: async () => client,
    query: async (sql) => /COUNT\(\*\) FILTER/.test(sql) ? { rows: [{ total: inserted.length, resolved: 0, unresolved: inserted.length }] } : { rows: [] },
  };
}

test('the workbook import shared by upload and SharePoint reads the header row and imports the units', async () => {
  const XLSX = await import('xlsx');
  const { importTenancyWorkbook } = await import('../../server/tenancy-schedule.ts');
  const ws = XLSX.utils.aoa_to_sheet([
    ['The Royal Exchange — tenancy schedule'],
    ['Unit', 'Tenant', 'Use', 'Status'],
    ['1', 'Tiffany & Co', 'Retail', 'Occupied'],
    ['2', 'Vacant', 'Retail', null],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TS');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const pool = fakeImportPool('rex');
  const result = await importTenancyWorkbook(pool, 'rex', buffer);
  assert.equal(result.imported, 2);
  assert.equal(result.headerRow, 2);
  assert.deepEqual(pool.inserted.map(r => [r.property_id, r.unit_number, r.tenant_name, r.status]), [['rex', '1', 'Tiffany & Co', 'Occupied'], ['rex', '2', 'Vacant', 'Vacant']]);
  assert.match(result.message, /^2 new units/);

  const bad = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(bad, XLSX.utils.aoa_to_sheet([['Budget'], ['Line', 'Amount'], ['Cleaning', 100]]), 'Sheet1');
  await assert.rejects(importTenancyWorkbook(fakeImportPool('rex'), 'rex', XLSX.write(bad, { type: 'buffer', bookType: 'xlsx' })), e => e.status === 400 && /header row/.test(e.message));
});

test('the upload route and the SharePoint route both go through importTenancyWorkbook; brochures share storeBrochure', () => {
  const ts = readFileSync(new URL('../../server/tenancy-schedule.ts', import.meta.url), 'utf8');
  const upload = ts.slice(ts.indexOf('router.post("/api/tenancy-schedule/import-excel",'), ts.indexOf('router.get("/api/tenancy-schedule/property/:propertyId/sharepoint-candidates"'));
  const sharepoint = ts.slice(ts.indexOf('router.post("/api/tenancy-schedule/import-excel-from-sharepoint"'));
  assert.match(upload, /importTenancyWorkbook\(pool, String\(propertyId\), req\.file\.buffer/);
  assert.match(sharepoint.slice(0, 2000), /importTenancyWorkbook\(await getPool\(\), String\(propertyId\), buffer/);
  assert.match(sharepoint.slice(0, 2000), /isClientRequestUser/);
  const br = readFileSync(new URL('../../server/property-brochures.ts', import.meta.url), 'utf8');
  assert.equal((br.match(/await storeBrochure\(/g) || []).length, 2);
  assert.equal((br.match(/INSERT INTO property_brochures\s+\(property_id, type, original_name, storage_key, mime_type, size_bytes, page_count, uploaded_by, file_sha256/g) || []).length, 1);
  const fromSp = br.slice(br.indexOf('"/api/properties/:id/brochures/from-sharepoint"'));
  assert.match(fromSp.slice(0, 800), /isClientRequestUser/);
});
