// Folders on the remaining pages (Woody, 24 November 2026: "go ahead with the
// folder suggestion"; docs/folders-review-2026-11-20.md, step 5). Source
// guards: a landlord's Files card, a brand's and an agent firm's Documents &
// gallery, each scheme, a Lease Advisory matter, a Pathway run and the ChatBGP
// page's property panels draw the folder engine, BGP staff only; a client
// login keeps its data room and never reads /api/folders/; and the old folder
// screens and routes are gone. The rules are tested in
// server/folders-pages.test.ts.
//   node --import tsx --test qa/regression/folders-pages-guards.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

const url = f => new URL(`../../${f}`, import.meta.url);
const read = f => readFileSync(url(f), 'utf8');
const between = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `${from} is there`);
  const b = text.indexOf(to, a + from.length);
  return text.slice(a, b < 0 ? undefined : b);
};

test('a landlord\'s Files card: the company\'s Folders for BGP staff, the data room for a client login, nothing until the sign-in is known', () => {
  const panel = read('client/src/components/brand-profile-panel.tsx');
  const card = between(panel, 'function LandlordSidebarBlock(', '// Email and Call beside a named agent');
  assert.match(card, /\{!sbUser \? null : sbIsStaff \? \(\s*<RecordFolders recordType="company" recordId=\{companyId\} recordName=\{companyName\} bare \/>\s*\) : \(\s*<ClientPropertyFoldersPanel propertyName="" \/>\s*\)\}/);
  // The client-tree build stays as it was; Set Up Folders and the team tabs are gone.
  assert.match(card, /data-testid="button-setup-client-property-folders"/);
  assert.match(card, /apiRequest\("POST", "\/api\/microsoft\/client-folders", \{ companyId \}\)/);
  assert.doesNotMatch(panel, /\bPropertyFoldersPanel\b|SetUpFoldersDialog|button-setup-landlord-folders|folderTeams=/);
  assert.match(panel, /<AccountFolderTreeCard companyId=\{companyId\} \/>/);
});

test('a brand\'s (and an agent firm\'s) Documents & gallery: the company\'s Folders, BGP staff only, where the old folder link was', () => {
  const panel = read('client/src/components/brand-profile-panel.tsx');
  assert.doesNotMatch(panel, /openSharePointFolder|\/api\/microsoft\/company-folders|BGP_SHAREPOINT_SITE_URL|Open SharePoint folder/);
  assert.match(panel, /\{!isLandlord && !sbIsClient && <RecordFolders recordType="company" recordId=\{companyId\} recordName=\{c\.name\} compact bare \/>\}/);
  // A brand's page with no saved image: the quiet line, then the Folders, staff only.
  assert.match(panel, /brandPage && !sbIsClient && uniqueImages\.length === 0 && \(\s*<BrandQuietBlock testId="brand-gallery-quiet">[\s\S]*?<\/BrandQuietLine>\s*<RecordFolders recordType="company" recordId=\{companyId\} recordName=\{c\.name\} compact bare \/>\s*<\/BrandQuietBlock>/);
});

test('each scheme shows its Folders to BGP staff; the old pasted link is no longer written', () => {
  const panel = read('client/src/components/property-schemes-panel.tsx');
  assert.match(panel, /const folderStaff = useIsFolderStaff\(\);/);
  assert.match(panel, /\{folderStaff && \([\s\S]{0,200}<RecordFolders recordType="scheme" recordId=\{s\.id\} recordName=\{s\.name\} compact bare hideTitle \/>/);
  assert.doesNotMatch(panel, /sharepointFolderUrl/);
  const server = read('server/property-schemes.ts').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(server, /sharepoint_folder_url|sharepointFolderUrl/, 'neither read nor written by the schemes routes');
});

test('a Lease Advisory matter: its Folders, a new folder starting as the Lease Advisory folders; nothing made by itself under BGP share drive', () => {
  const page = read('client/src/pages/pla-matters.tsx');
  assert.match(page, /<RecordFolders\n\s+recordType="pla_matter"\n\s+recordId=\{matter\.id\}/);
  assert.doesNotMatch(page, /apply-folder-template|Apply folder template|matter\.sharepointFolderUrl/);
  assert.equal(existsSync(url('server/pla-folder-template.ts')), false);
  const server = read('server/pla-matters.ts');
  assert.doesNotMatch(server, /apply-folder-template|applyLeaseAdvisoryFolderTemplate|getValidMsToken|pla-folder-template/);
  assert.match(read('client/src/components/folders/record-folder-picker.tsx'), /defaultTemplate: defaultTemplate \|\| defaultFolderTemplate\(target\.type\),/);
  assert.match(read('client/src/components/folders/folder-picker.tsx'), /folderTemplatesInOrder\(create\.defaultTemplate\)\.map\(/);
});

test('a Pathway run: its Folders, then its property\'s; stage 1 no longer looks for a folder at BGP share drive/Investment/<address>', () => {
  const page = read('client/src/pages/property-pathway.tsx');
  const panel = between(page, 'function PathwayFoldersPanel(', 'function RelinkCrmDialog(');
  assert.match(panel, /<RecordFolders recordType="pathway_run" recordId=\{run\.id\} recordName=\{run\.address\} bare \/>/);
  assert.doesNotMatch(page, /\bPropertyFoldersPanel\b|SetUpFoldersDialog/);
  const server = read('server/property-pathway.ts');
  assert.doesNotMatch(server, /parentPath: "Investment"/);
});

test('the ChatBGP page lists a property\'s Folders read only, BGP staff only', () => {
  const page = read('client/src/pages/chatbgp.tsx');
  assert.doesNotMatch(page, /\/api\/microsoft\/property-folders|FolderTreeItem|activeFolderTeam/);
  assert.equal((page.match(/const folderStaff = useIsFolderStaff\(\);/g) || []).length, 2);
  assert.equal((page.match(/\{folderStaff && propertyId && \(/g) || []).length, 2);
  assert.equal((page.match(/<RecordFolderLinks recordType="property" recordId=\{propertyId\}/g) || []).length, 2);
  const links = read('client/src/components/folders/record-folder-links.tsx');
  // The engine is read only for staff; a client login is shown nothing here.
  assert.match(links, /enabled: staff && !!recordId,/);
  assert.match(links, /if \(!staff\) return null;/);
  assert.match(links, /return !!me && me\.role !== "Client" && !me\.companyScopeId;/);
  assert.doesNotMatch(links, /folderApi\("(POST|PATCH|PUT|DELETE)"/, 'read only');
});

test('compact Folders open a folder in a window, never under the strip', () => {
  const r = read('client/src/components/folders/record-folders.tsx');
  assert.match(r, /const current = compact \? all\.find\(f => f\.id === openId\) \|\| null : /);
  assert.match(r, /\{current && !compact && <OpenFolder /);
  assert.match(r, /\{compact && \(\s*<FolderDialog open=\{!!current\}/);
});

const walk = dir => readdirSync(url(dir)).flatMap(name => {
  const path = `${dir}/${name}`;
  return statSync(url(path)).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
});

test('the old folder screens and their routes are gone, and nothing calls them', () => {
  const gone = /\/api\/microsoft\/property-folders|\/api\/microsoft\/company-folders|\/api\/microsoft\/folders["`?/]|\/api\/microsoft\/folder-templates|\/api\/microsoft\/company-folder-templates|\/sharepoint-folders["`?]|\/apply-folder-template/;
  for (const file of walk('client/src')) assert.doesNotMatch(read(file), gone, file);
  const ms = read('server/microsoft.ts');
  assert.doesNotMatch(ms, /app\.(get|post|put|patch|delete)\("\/api\/microsoft\/(property-folders|company-folders|folders"|folder-templates|company-folder-templates)/);
  assert.doesNotMatch(ms, /TEAM_FOLDER_TREES|COMPANY_FOLDER_TREES/);
  assert.match(ms, /app\.post\("\/api\/microsoft\/client-folders"/, 'the client-tree job stays');
  assert.doesNotMatch(read('server/crm.ts'), /\/sharepoint-folders"/);
  assert.doesNotMatch(read('server/sharepoint-property-files.ts'), /setPropertyFolderLink|propertyFolderLinks/);
  assert.doesNotMatch(read('shared/property-labels.ts'), /propertyFolderTabs|folderWithin/);
  for (const f of ['client/src/pages/properties.tsx', 'client/src/pages/instructions.tsx', 'client/src/pages/companies.tsx']) {
    assert.doesNotMatch(read(f), /function (PropertyFoldersPanel|SetUpFoldersDialog|PropertyFoldersBrowser|CompanyFoldersCard)\(/, f);
  }
  // The client data room stays, with the test id the smoke suite waits for.
  assert.match(read('client/src/pages/properties.tsx'), /export function ClientPropertyFoldersPanel\(/);
});

test('the migration offers the brand page\'s old place, read once as the admin, never at boot', () => {
  const m = read('server/folders/migration.ts');
  const report = between(m, 'export async function buildMigrationPreview(', 'async function readSetting');
  assert.match(report, /const companiesPlace = await companiesPlaceRows\(db, token, live\);/);
  const place = between(m, 'export async function companiesPlaceRows(', '/** The report, read with');
  assert.match(place, /listChildren\(token, library\.driveId, place\.itemId, \{ foldersOnly: true \}\)/);
  assert.match(place, /WHERE merged_into_id IS NULL AND lower\(btrim\(regexp_replace\(name, /);
  for (const f of ['server/index.ts', 'server/routes.ts']) assert.doesNotMatch(read(f), /companiesPlaceRows/);
});
