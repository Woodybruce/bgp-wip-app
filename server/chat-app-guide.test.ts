import assert from "node:assert/strict";
import test from "node:test";
import { APP_MAP } from "./chatbgp-app-map";
import { searchAppGuide } from "./chat-app-guide";

test("the phone add-people search returns the actual chat-header instructions", () => {
  const result = searchAppGuide({ query: "phone add people chat" });
  assert.equal(result.mode, "search");
  if (result.mode !== "search") return;
  assert.ok(result.results.length > 0);
  assert.match(result.results[0].title, /Phone app/);
  assert.match(result.results[0].text, /add-person icon/);
  assert.match(result.results[0].text, /Chat Settings on the Add People list/);
  assert.ok(result.results[0].offset > 0, "retrieval must locate the relevant paragraph, not only return a section prefix");
});

test("business-card search preserves practical profile and sharing directions", () => {
  const result = searchAppGuide({ query: "business card" });
  assert.equal(result.mode, "search");
  if (result.mode !== "search") return;
  const text = result.results.map(item => item.text).join("\n");
  assert.match(text, /Business card/i);
  assert.match(text, /\/business-card/);
  assert.match(text, /QR code|My Profile|Share \/ Copy link/);
});

test("all source text can be reconstructed exactly through section pagination, including the giant desktop section", () => {
  let indexOffset: number | null = 0;
  const entries: Array<{ sectionId: string; totalCharacters: number }> = [];
  while (indexOffset !== null) {
    const result = searchAppGuide({ offset: indexOffset });
    assert.equal(result.mode, "index");
    if (result.mode !== "index") return;
    assert.ok(JSON.stringify(result).length <= 12_000);
    entries.push(...result.sections);
    indexOffset = result.nextOffset;
  }
  assert.ok(entries.some(entry => entry.totalCharacters > 24_000));
  assert.equal(new Set(entries.map(entry => entry.sectionId)).size, entries.length);
  let reconstructed = "";
  for (const entry of entries) {
    let offset: number | null = 0;
    let sectionText = "";
    while (offset !== null) {
      const result = searchAppGuide({ sectionId: entry.sectionId, offset });
      assert.equal(result.mode, "section");
      if (result.mode !== "section") return;
      assert.equal(result.offset, offset);
      assert.ok(JSON.stringify(result).length <= 12_000);
      assert.ok(result.text.length > 0);
      sectionText += result.text;
      assert.equal(result.nextOffset, sectionText.length < entry.totalCharacters ? sectionText.length : null);
      offset = result.nextOffset;
    }
    assert.equal(sectionText.length, entry.totalCharacters);
    reconstructed += sectionText;
  }
  assert.equal(reconstructed, APP_MAP);
});

test("no query returns a usable index and invalid section or absent terms fail without fabricated advice", () => {
  const index = searchAppGuide();
  assert.equal(index.mode, "index");
  if (index.mode !== "index") return;
  assert.ok(index.sections.some(section => section.sectionId === "phone-app-installed-staff"));
  assert.ok(index.sections.some(section => section.sectionId === "desktop-navigation-sidebar"));
  const unknown = searchAppGuide({ sectionId: "missing-section" });
  assert.equal(unknown.mode, "error");
  const absent = searchAppGuide({ query: "zyxqvnosuchnavigationword" });
  assert.equal(absent.mode, "search");
  if (absent.mode !== "search") return;
  assert.equal(absent.totalMatches, 0);
  assert.deepEqual(absent.results, []);
  assert.equal(absent.nextOffset, null);
});

test("broad searches are capped and paginated without duplicated or inaccessible sections", () => {
  const seen = new Set<string>();
  let offset: number | null = 0;
  let total = 0;
  while (offset !== null) {
    const result = searchAppGuide({ query: "phone desktop chat property business card", offset });
    assert.equal(result.mode, "search");
    if (result.mode !== "search") return;
    assert.ok(JSON.stringify(result).length <= 12_000);
    total = result.totalMatches;
    for (const item of result.results) {
      assert.equal(seen.has(item.sectionId), false);
      seen.add(item.sectionId);
      const page = searchAppGuide({ sectionId: item.sectionId, offset: item.offset });
      assert.equal(page.mode, "section");
      if (page.mode === "section") assert.ok(page.text.startsWith(item.text));
    }
    offset = result.nextOffset;
  }
  assert.equal(seen.size, total);
  assert.ok(total > 4);
});

test("huge queries and out-of-range offsets remain bounded and well defined", () => {
  const large = searchAppGuide({ query: "business card ".repeat(10_000) });
  assert.ok(JSON.stringify(large).length <= 12_000);
  const negative = searchAppGuide({ sectionId: "desktop-navigation-sidebar", offset: -5 });
  assert.equal(negative.mode, "section");
  if (negative.mode === "section") assert.equal(negative.offset, 0);
  const pastEnd = searchAppGuide({ sectionId: "desktop-navigation-sidebar", offset: Number.MAX_SAFE_INTEGER });
  assert.equal(pastEnd.mode, "section");
  if (pastEnd.mode === "section") {
    assert.equal(pastEnd.text, "");
    assert.equal(pastEnd.nextOffset, null);
    assert.equal(pastEnd.offset, pastEnd.totalCharacters);
  }
});
