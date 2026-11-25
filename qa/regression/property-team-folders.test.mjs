import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normaliseFolderLinks, linkedFolderUrls, folderLinkLabel } from '../../shared/property-labels.ts';
import { findPropertyFiles } from '../../server/sharepoint-property-files.ts';
import { sharesId } from '../../server/sharepoint-graph.ts';

process.env.DATABASE_URL ||= 'postgres://t:t@127.0.0.1:1/t';

// The Royal Exchange as SharePoint holds it, 2026-09.
const ROOT = 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20share%20drive/London/The%20Royal%20Exchange';
const INVESTMENT = `${ROOT}/Investment%20and%20model`;
const LEASES = `${ROOT}/Leases`;
const REX_LINKS = { Investment: INVESTMENT, 'London Retail': ROOT, Leases: LEASES };

// The team tabs and their link routes are gone (Folders, 24 November 2026): the
// stored links are read by Folders (read only, until moved over) and the finders.
test('stored folder labels: team names canonical whatever the case, bad entries dropped', () => {
  const links = normaliseFolderLinks({ 'investment ': INVESTMENT, 'london retail': ROOT, Leases: LEASES, 'Debt': `${ROOT}/Debt`, 'Bad': 42, '': ROOT });
  assert.deepEqual(links, { Investment: INVESTMENT, 'London Retail': ROOT, Leases: LEASES, Debt: `${ROOT}/Debt` });
  assert.deepEqual(normaliseFolderLinks(JSON.stringify({ Leases: LEASES })), { Leases: LEASES });
  assert.deepEqual(normaliseFolderLinks('not json'), {});
  assert.deepEqual(normaliseFolderLinks([LEASES]), {});
  assert.equal(folderLinkLabel('  tenant   rep '), 'Tenant Rep');
  assert.equal(folderLinkLabel('x'.repeat(61)), null);
});

test('linked folders are distinct regardless of URL encoding', () => {
  const decoded = 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared Documents/BGP share drive/London/The Royal Exchange/';
  assert.deepEqual(linkedFolderUrls(ROOT, { 'London Retail': decoded, Investment: INVESTMENT, Leases: LEASES }), [ROOT, INVESTMENT, LEASES]);
  assert.deepEqual(linkedFolderUrls(null, null), []);
});

const DRIVE = 'b!TkfPTD5QkkaKK2ThhYzkbeZV8L-Ly5xIm6a79Utuotf_bKhaqTNzTLlcjCkAWwlf';
const file = (id, name, folder) => ({ id, name, size: 1000 + id.length, file: {}, lastModifiedDateTime: '2026-09-01T09:00:00Z', webUrl: `https://x/${id}`, parentReference: { driveId: DRIVE, path: `/drives/${DRIVE}/root:/BGP share drive/London/The Royal Exchange${folder}` } });

function fakeGraph({ failing = [] } = {}) {
  const roots = { [sharesId(ROOT)]: 'ROOT', [sharesId(INVESTMENT)]: 'INV', [sharesId(LEASES)]: 'LEASES' };
  const children = {
    ROOT: [{ id: 'INV', name: 'Investment and model', folder: {} }, { id: 'LEASES', name: 'Leases', folder: {} }, file('AGENTS', 'Agents list - REX - October.xlsx', '')],
    INV: [file('MODEL', 'REX Tenancy Schedule model Sept 2026.xlsx', '/Investment and model')],
    LEASES: [file('TS', 'REX Tenancy Schedule Sept 2026.xlsx', '/Leases')],
  };
  const walked = [];
  const graph = async (path) => {
    if (path.startsWith('/shares/')) {
      const share = path.slice('/shares/'.length).split('/')[0];
      if (failing.includes(share)) throw new Error('Graph API 404: itemNotFound');
      const id = roots[share];
      if (!id) throw new Error(`unknown share ${share}`);
      walked.push(id);
      return { id, name: id, parentReference: { driveId: DRIVE } };
    }
    if (path === '/search/query') return { value: [] };
    const id = path.match(/\/items\/([^/]+)\/children/)?.[1];
    if (id) return { value: children[id] || [] };
    throw new Error(`unexpected Graph call ${path}`);
  };
  return { graph, walked };
}

function fakePool(row) {
  return {
    query: async (sql) => {
      if (/FROM crm_properties/.test(sql)) return { rows: row ? [row] : [] };
      return { rows: [] };
    },
  };
}

test('the SharePoint finder walks every linked folder, not just the property link', async () => {
  const { graph, walked } = fakeGraph();
  const pool = fakePool({ name: 'Royal Exchange', sharepoint_folder_url: null, sharepoint_team_folders: { Investment: INVESTMENT, Leases: LEASES } });
  const out = await findPropertyFiles(pool, 'rex', 'schedule', 'leasing', { graph });
  assert.deepEqual(walked.sort(), ['INV', 'LEASES']);
  assert.deepEqual(out.linkedFolders, [INVESTMENT, LEASES]);
  assert.equal(out.linkedFolder, INVESTMENT);
  assert.deepEqual(out.candidates.map(c => c.name).sort(), ['REX Tenancy Schedule Sept 2026.xlsx', 'REX Tenancy Schedule model Sept 2026.xlsx']);
  assert.ok(out.candidates.every(c => c.source === 'folder'));
});

test('overlapping links (the root and folders inside it) list each file once', async () => {
  const { graph, walked } = fakeGraph();
  const pool = fakePool({ name: 'Royal Exchange', sharepoint_folder_url: ROOT, sharepoint_team_folders: REX_LINKS });
  const out = await findPropertyFiles(pool, 'rex', 'schedule', 'leasing', { graph });
  assert.deepEqual(walked.sort(), ['INV', 'LEASES', 'ROOT'], 'the London Retail link is the property link, walked once');
  const names = out.candidates.map(c => c.name);
  assert.equal(names.length, new Set(names).size);
  assert.deepEqual(names.sort(), ['Agents list - REX - October.xlsx', 'REX Tenancy Schedule Sept 2026.xlsx', 'REX Tenancy Schedule model Sept 2026.xlsx']);
});

test('one linked folder failing names that folder and the others still show', async () => {
  const { graph } = fakeGraph({ failing: [sharesId(LEASES)] });
  const pool = fakePool({ name: 'Royal Exchange', sharepoint_folder_url: null, sharepoint_team_folders: { Investment: INVESTMENT, Leases: LEASES } });
  const out = await findPropertyFiles(pool, 'rex', 'schedule', 'leasing', { graph });
  assert.deepEqual(out.candidates.map(c => c.name), ['REX Tenancy Schedule model Sept 2026.xlsx']);
  assert.deepEqual(out.warnings, ["Linked folder “Leases”: That file or folder isn't in SharePoint any more — it may have been moved or deleted."]);
});

test('the old folder-link routes and the team-tab Files panel are gone; the column stays, read by Folders and the finders', () => {
  const crm = readFileSync(new URL('../../server/crm.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(crm, /\/sharepoint-folders"/);
  const page = readFileSync(new URL('../../client/src/pages/properties.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /function PropertyFoldersPanel\(|function SetUpFoldersDialog\(/);
  assert.doesNotMatch(readFileSync(new URL('../../server/sharepoint-property-files.ts', import.meta.url), 'utf8'), /UPDATE crm_properties SET sharepoint_team_folders/, 'nothing writes the old column');
  const index = readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
  assert.match(index, /ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS sharepoint_team_folders JSONB/);
  assert.doesNotMatch(readFileSync(new URL('../../shared/schema.ts', import.meta.url), 'utf8'), /sharepoint_team_folders/);
});
