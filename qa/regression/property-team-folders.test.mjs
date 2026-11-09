import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { propertyFolderTabs, normaliseFolderLinks, linkedFolderUrls, folderWithin, folderLinkLabel } from '../../shared/property-labels.ts';
import { findPropertyFiles, setPropertyFolderLink, propertyFolderLinks } from '../../server/sharepoint-property-files.ts';
import { sharesId } from '../../server/sharepoint-graph.ts';

process.env.DATABASE_URL ||= 'postgres://t:t@127.0.0.1:1/t';

// The Royal Exchange as SharePoint holds it, 2026-09.
const ROOT = 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20share%20drive/London/The%20Royal%20Exchange';
const INVESTMENT = `${ROOT}/Investment%20and%20model`;
const LEASES = `${ROOT}/Leases`;
const REX_LINKS = { Investment: INVESTMENT, 'London Retail': ROOT, Leases: LEASES };

test('Royal Exchange tabs: folder teams first, then linked teams, then extra folders — each with its own folder', () => {
  const tabs = propertyFolderTabs(['Investment'], REX_LINKS, ROOT, 'London Retail');
  assert.deepEqual(tabs, [
    { label: 'Investment', url: INVESTMENT, kind: 'team', own: true },
    { label: 'London Retail', url: ROOT, kind: 'team', own: true },
    { label: 'Leases', url: LEASES, kind: 'extra', own: true },
  ]);
});

test('a team tab without its own folder uses the property link, else the share-drive path (url null)', () => {
  assert.deepEqual(propertyFolderTabs(['Investment', 'Lease Advisory'], { Investment: INVESTMENT }, ROOT, 'Investment'), [
    { label: 'Investment', url: INVESTMENT, kind: 'team', own: true },
    { label: 'Lease Advisory', url: ROOT, kind: 'team', own: false },
  ]);
  assert.deepEqual(propertyFolderTabs(['Investment'], null, null, 'Investment'), [{ label: 'Investment', url: null, kind: 'team', own: false }]);
  // Before per-team links existed: every tab opened the one linked folder.
  assert.deepEqual(propertyFolderTabs(['Investment', 'London Retail'], undefined, ROOT, 'Investment').map(t => t.url), [ROOT, ROOT]);
  // No folder teams: the viewer's team, plus whatever is linked.
  assert.deepEqual(propertyFolderTabs([], { Leases: LEASES }, null, 'London F&B').map(t => [t.label, t.url]), [['London F&B', null], ['Leases', LEASES]]);
});

test('labels match teams whatever the case, extras sort A–Z, and linked teams follow BGP_TEAMS order', () => {
  const links = normaliseFolderLinks({ 'investment ': INVESTMENT, 'london retail': ROOT, Leases: LEASES, 'Debt': `${ROOT}/Debt`, 'Bad': 42, '': ROOT });
  assert.deepEqual(links, { Investment: INVESTMENT, 'London Retail': ROOT, Leases: LEASES, Debt: `${ROOT}/Debt` });
  const tabs = propertyFolderTabs(['investment'], links, null, 'Investment');
  assert.deepEqual(tabs.map(t => [t.label, t.kind, t.url]), [
    ['investment', 'team', INVESTMENT],
    ['London Retail', 'team', ROOT],
    ['Debt', 'extra', `${ROOT}/Debt`],
    ['Leases', 'extra', LEASES],
  ]);
  assert.deepEqual(normaliseFolderLinks(JSON.stringify({ Leases: LEASES })), { Leases: LEASES });
  assert.deepEqual(normaliseFolderLinks('not json'), {});
  assert.deepEqual(normaliseFolderLinks([LEASES]), {});
  assert.equal(folderLinkLabel('  tenant   rep '), 'Tenant Rep');
  assert.equal(folderLinkLabel('x'.repeat(61)), null);
});

test('linked folders are distinct regardless of URL encoding, and nesting is detected', () => {
  const decoded = 'https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared Documents/BGP share drive/London/The Royal Exchange/';
  assert.deepEqual(linkedFolderUrls(ROOT, { 'London Retail': decoded, Investment: INVESTMENT, Leases: LEASES }), [ROOT, INVESTMENT, LEASES]);
  assert.deepEqual(linkedFolderUrls(null, null), []);
  assert.equal(folderWithin(LEASES, ROOT), true);
  assert.equal(folderWithin(ROOT, decoded), true);
  assert.equal(folderWithin(ROOT, LEASES), false);
  assert.equal(folderWithin(`${ROOT}%202`, ROOT), false, 'a sibling whose name starts the same is not inside');
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
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (/^UPDATE crm_properties SET sharepoint_team_folders/.test(sql)) { writes.push(params); row.sharepoint_team_folders = params[1] && JSON.parse(params[1]); return { rows: [] }; }
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

test('linking a folder: team names canonical, BGP SharePoint links only, empty url unlinks', async () => {
  const row = { name: 'Royal Exchange', sharepoint_folder_url: ROOT, sharepoint_team_folders: null };
  const pool = fakePool(row);
  let out = await setPropertyFolderLink(pool, 'rex', 'investment', INVESTMENT);
  assert.deepEqual(out.folders, { Investment: INVESTMENT });
  out = await setPropertyFolderLink(pool, 'rex', 'Leases', ` ${LEASES} `);
  assert.deepEqual(out.folders, { Investment: INVESTMENT, Leases: LEASES });
  out = await setPropertyFolderLink(pool, 'rex', 'INVESTMENT', `${ROOT}/Debt`);
  assert.deepEqual(out.folders, { Leases: LEASES, Investment: `${ROOT}/Debt` }, 'relinking a team replaces its folder');
  await assert.rejects(setPropertyFolderLink(pool, 'rex', 'Leases', 'https://evil.example.com/Leases'), e => e.status === 400);
  await assert.rejects(setPropertyFolderLink(pool, 'rex', '   ', LEASES), e => e.status === 400);
  await assert.rejects(setPropertyFolderLink(fakePool(null), 'nope', 'Leases', LEASES), e => e.status === 404);
  out = await setPropertyFolderLink(pool, 'rex', 'leases', null);
  out = await setPropertyFolderLink(pool, 'rex', 'Investment', '');
  assert.deepEqual(out.folders, {});
  assert.equal(pool.writes.at(-1)[1], null, 'no folders left stores NULL');
  assert.deepEqual(await propertyFolderLinks(pool, 'rex'), { propertyName: 'Royal Exchange', defaultUrl: ROOT, folders: {} });
});

test('the folder-link routes are staff only and the Files panel resolves each tab its own folder', () => {
  const crm = readFileSync(new URL('../../server/crm.ts', import.meta.url), 'utf8');
  for (const method of ['get', 'put']) {
    const at = crm.indexOf(`app.${method}("/api/crm/properties/:id/sharepoint-folders"`);
    assert.ok(at > 0, `${method} route exists`);
    assert.match(crm.slice(at, at + 400), /resolveCompanyScope\(req\)\) \|\| \(await isClientRequestUser\(req\)\)\) return res\.status\(403\)/);
  }
  const page = readFileSync(new URL('../../client/src/pages/properties.tsx', import.meta.url), 'utf8');
  const panel = page.slice(page.indexOf('export function PropertyFoldersPanel('), page.indexOf('export function PropertySharepointLink('));
  assert.match(panel, /propertyFolderTabs\(folderTeams, folderLinks\?\.folders, sharepointFolderUrl, userTeam\)/);
  assert.match(panel, /const folderUrl = \(activeTab\?\.url \|\| ""\)\.trim\(\)/);
  assert.match(panel, /formData\.append\("folderId", destFolderId\)/, 'uploads still go into the folder being browsed');
  const index = readFileSync(new URL('../../server/index.ts', import.meta.url), 'utf8');
  assert.match(index, /ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS sharepoint_team_folders JSONB/);
  assert.doesNotMatch(readFileSync(new URL('../../shared/schema.ts', import.meta.url), 'utf8'), /sharepoint_team_folders/);
});
