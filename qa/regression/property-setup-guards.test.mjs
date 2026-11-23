// Setting up a new property (Woody, 23 November 2026). Source guards; the
// rules are tested in server/property-setup.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");

test("the folder tree route is BGP staff's, on the person's own Microsoft 365, linking only BGP's SharePoint", () => {
  const s = read("server/property-setup.ts");
  const at = s.indexOf('router.post("/api/properties/:id/folders/tree"');
  assert.ok(at > 0);
  const route = s.slice(at);
  assert.ok(route.indexOf("await staffMe(req)") < route.indexOf("getValidMsToken(req)"), "staff are checked before anything else");
  assert.match(route, /folderTreePaths\(body\.structure \?\? \[\]\)/);
  assert.match(route, /if \(webUrl && bgpSharePointUrl\(webUrl\)\)/);
  // Folders are made in the folder the person picked, never at a fixed place.
  assert.match(route, /createFolderInItem\(token, driveId, parentId, rootName\)/);
  assert.doesNotMatch(route, /getSharePointDriveId|SHAREPOINT_ROOT_FOLDER|getAppToken/);
  assert.match(read("server/index.ts"), /app\.use\(propertySetupRouter\);/);
});

test("set-up opens for BGP staff after a property is added and from the property's More menu", () => {
  const add = read("client/src/pages/properties.tsx");
  assert.match(add, /const id = data\?\._existingId \|\| \(!data\?\.estateUnit \? data\?\.id : null\);\n\s+if \(id\) navigate\(`\/properties\/\$\{id\}\?setup=1`\);/);
  // The property's own save has no PATCH route.
  assert.doesNotMatch(add, /apiRequest\("PATCH", `\/api\/crm\/properties\/\$\{resolvedExistingId\}`/);
  const page = read("client/src/components/property-detail.tsx");
  assert.match(page, /new URLSearchParams\(window\.location\.search\)\.get\("setup"\) === "1"/);
  assert.match(page, /\{property && !isClientViewer && setupOpen && <PropertySetupDialog /);
  assert.match(page, /\{!isClientViewer && <DropdownMenuItem onClick=\{\(\) => setSetupOpen\(true\)\} data-testid="property-setup-open">/);
  assert.match(page, /q\.delete\("setup"\);\n\s+window\.history\.replaceState/);
});

test("each step saves through the route the property page already uses", () => {
  const d = read("client/src/components/property-page/property-setup.tsx");
  assert.match(d, /SETUP_STEPS\.map/);
  assert.match(d, /apiRequest\("PUT", `\/api\/crm\/properties\/\$\{property\.id\}`, \{\n?\s*address: resultToAddress\(result\)/);
  assert.match(d, /apiRequest\("PUT", `\/api\/crm\/properties\/\$\{property\.id\}`, \{ sharepointFolderUrl: f\.webUrl \}\)/);
  assert.match(d, /apiRequest\("POST", `\/api\/properties\/\$\{property\.id\}\/folders\/tree`/);
  assert.match(d, /fetch\("\/api\/tenancy-schedule\/import-excel"/);
  assert.match(d, /<PropertyOwnershipCard propertyId=\{property\.id\} onOpenAml=\{\(\) => undefined\} showAml=\{false\} \/>/);
  assert.match(d, /<InlineCompetitorAgent /);
  assert.match(d, /<PropertyBrochuresPanel /);
  assert.match(d, /<UploadPlanButton /);
  // The picker lists the person's own Share Drive, folders only.
  const p = read("client/src/components/sharepoint-folder-picker.tsx");
  assert.match(p, /\/api\/microsoft\/files/);
  assert.match(p, /const SHARE_DRIVE = "BGP - Share Drive";/);
  assert.match(p, /\.filter\(i => i\.folder\)/);
});
