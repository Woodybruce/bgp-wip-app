// Setting up a new property (Woody, 23 November 2026). Source guards; the
// rules are tested in server/property-setup.test.ts. Its Files step is the
// folder engine's picker since 24 November 2026
// (docs/folders-review-2026-11-20.md): the old folder tree route and the
// Share Drive picker it used are gone.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const exists = f => existsSync(new URL(`../../${f}`, import.meta.url));

test("the old folder tree route and its picker are gone; the engine makes and links folders", () => {
  assert.equal(exists("server/property-setup.ts"), false);
  assert.equal(exists("client/src/components/sharepoint-folder-picker.tsx"), false);
  const index = read("server/index.ts");
  assert.doesNotMatch(index, /propertySetupRouter|\.\/property-setup"/);
  // Nothing writes a property's folder as an address any more from set-up.
  const d = read("client/src/components/property-page/property-setup.tsx");
  assert.doesNotMatch(d, /sharepointFolderUrl|\/folders\/tree|\/api\/microsoft\/folder-templates|ShareDriveFolderPicker/);
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
  assert.match(d, /fetch\("\/api\/tenancy-schedule\/import-excel"/);
  assert.match(d, /<PropertyOwnershipCard propertyId=\{property\.id\} onOpenAml=\{\(\) => undefined\} showAml=\{false\} \/>/);
  assert.match(d, /<InlineCompetitorAgent /);
  assert.match(d, /<PropertyBrochuresPanel /);
  assert.match(d, /<UploadPlanButton /);
});

test("the Files step links and makes folders through the folder engine, the property folder template for a new one", () => {
  const d = read("client/src/components/property-page/property-setup.tsx");
  assert.match(d, /import \{ RecordFolderPicker \} from "@\/components\/folders\/record-folders";/);
  // The summary reads the engine's view of the property, the same query key as the page.
  assert.match(d, /queryKey: recordFoldersKey\("property", property\.id\)/);
  assert.match(d, /folderApi\("GET", `\/api\/folders\/property\/\$\{property\.id\}`\)/);
  // Pick an existing folder, or make a new property folder where the person chooses.
  assert.match(d, /data-testid="setup-files-existing"/);
  assert.match(d, /data-testid="setup-files-new"/);
  assert.match(d, /<RecordFolderPicker open=\{picker === "link"\}[^\n]*record=\{\{ type: "property", id: property\.id, name: property\.name \}\}[^\n]*onDone=\{\(\) => mark\("files"\)\}/);
  assert.match(d, /<RecordFolderPicker open=\{picker === "new"\}[^\n]*startNew defaultTemplate="property"[^\n]*onDone=\{\(\) => mark\("files"\)\}/);
  // The picker marks the step only after a folder was linked or made.
  const r = read("client/src/components/folders/record-folder-picker.tsx");
  const picker = r.slice(r.indexOf("export function RecordFolderPicker("));
  assert.match(read("client/src/components/folders/record-folders.tsx"), /export \{ RecordFolderPicker \} from "\.\/record-folder-picker";/);
  assert.match(picker, /if \(linked\) \{ toast\([^\n]*onDone\?\.\(\); \}/);
  assert.equal((picker.match(/onDone\?\.\(\)/g) || []).length, 3);
});
