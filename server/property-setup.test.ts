// Setting up a new property (shared/property-setup.ts; Woody, 23 November
// 2026: "when we set up a new property should ask before its set up some
// basic questions").
import test from "node:test";
import assert from "node:assert/strict";
import { SETUP_STEPS, bgpSharePointUrl, folderTreeOrder, folderTreePaths, safeFolderName } from "../shared/property-setup";

test("the steps, in the order Woody gave them", () => {
  assert.deepEqual(SETUP_STEPS.map(s => s.key), ["address", "owner", "files", "agent", "schedule", "brochure", "plans"]);
});

test("a folder name SharePoint takes", () => {
  assert.equal(safeFolderName("Millennium Bridge House"), "Millennium Bridge House");
  assert.equal(safeFolderName('Unit 7a: "The Arcade" / Phase 2?'), "Unit 7a The Arcade Phase 2");
  assert.equal(safeFolderName("St. James's Market."), "St. James's Market");
  assert.equal(safeFolderName("  Bluewater   "), "Bluewater");
  assert.equal(safeFolderName(null), "");
  assert.equal(safeFolderName("x".repeat(200)).length, 120);
});

test("a folder template's paths are checked before anything is made", () => {
  assert.deepEqual(folderTreePaths(["Brochures", "Marketing Overview/Photos & CGIs", " ", "Heads of Terms//Per Unit"]), {
    paths: [["Brochures"], ["Marketing Overview", "Photos & CGIs"], ["Heads of Terms", "Per Unit"]],
  });
  assert.deepEqual(folderTreePaths([]), { paths: [] });
  assert.ok("problem" in folderTreePaths("Brochures"));
  assert.ok("problem" in folderTreePaths(Array.from({ length: 81 }, (_, i) => `F${i}`)));
  assert.ok("problem" in folderTreePaths(["A/B/C/D/E"]));
  assert.ok("problem" in folderTreePaths(["Rent: 2026"]));
  assert.ok("problem" in folderTreePaths(["Legal/<script>"]));
});

test("every folder of a tree is made after its parent, once", () => {
  assert.deepEqual(folderTreeOrder([["Heads of Terms", "Per Unit"], ["Heads of Terms", "Standard Draft HOTs"], ["Brochures"]]).map(p => p.join("/")), [
    "Heads of Terms", "Heads of Terms/Per Unit", "Heads of Terms/Standard Draft HOTs", "Brochures",
  ]);
  assert.deepEqual(folderTreeOrder([["A", "B", "C"]]).map(p => p.join("/")), ["A", "A/B", "A/B/C"]);
});

test("a property is linked only to a folder on BGP's own SharePoint", () => {
  assert.equal(bgpSharePointUrl("https://brucegillinghampollardlimited.sharepoint.com/sites/BGP/Shared%20Documents/BGP%20-%20Share%20Drive/Bluewater"), true);
  assert.equal(bgpSharePointUrl("https://brucegillinghampollardlimited-my.sharepoint.com/personal/woody/Documents/x"), true);
  assert.equal(bgpSharePointUrl("http://brucegillinghampollardlimited.sharepoint.com/sites/BGP"), false);
  assert.equal(bgpSharePointUrl("https://other.sharepoint.com/sites/BGP"), false);
  assert.equal(bgpSharePointUrl("https://brucegillinghampollardlimited.sharepoint.com.evil.com/x"), false);
  assert.equal(bgpSharePointUrl("not a url"), false);
  assert.equal(bgpSharePointUrl(null), false);
});
