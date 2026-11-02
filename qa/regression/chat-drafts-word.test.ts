import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { decodeHTML } from "entities";
import { createChatDraftWord } from "../../server/chat-drafts-word";

async function wordExport(markdown: string) {
  const zip = new AdmZip(await createChatDraftWord("Link export", markdown));
  const document = zip.readAsText("word/document.xml");
  const relationships = zip.readAsText("word/_rels/document.xml.rels");
  const links = [...relationships.matchAll(/<Relationship\b([^>]+)\/?\s*>/g)]
    .map(match => Object.fromEntries([...match[1].matchAll(/([\w:]+)="([^"]*)"/g)]
      .map(attribute => [attribute[1], decodeHTML(attribute[2])])))
    .filter(relationship => relationship.Type.endsWith("/hyperlink"));
  return { zip, document, relationships, links };
}

test("Word exports public links as native hyperlinks with the original label formatting", async () => {
  const destination = "https://example.invalid/Folder(2)/report.pdf?q=a&b=c";
  const { document, links } = await wordExport(`[**Public** *report* ~~old~~ \`code\`](${destination})`);
  assert.equal(links.length, 1);
  assert.equal(links[0].Target, destination);
  assert.equal(links[0].TargetMode, "External");
  const hyperlink = [...document.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g)]
    .find(match => match[1].includes(`r:id="${links[0].Id}"`));
  assert.ok(hyperlink, "the document hyperlink must reference its external OOXML relationship");
  assert.match(hyperlink[2], /<w:rStyle w:val="Hyperlink"\/>/);
  assert.match(hyperlink[2], /<w:b\/>/);
  assert.match(hyperlink[2], /<w:i\/>/);
  assert.match(hyperlink[2], /<w:strike\/>/);
  assert.match(hyperlink[2], /w:ascii="Consolas"/);
  for (const label of ["Public", "report", "old", "code"]) assert.match(hyperlink[2], new RegExp(`>${label}<`));
});

test("Word hyperlinks survive headings, lists, tables and reference-style links", async () => {
  const { document, links } = await wordExport(
    "## [Website](https://example.invalid/)\n\n- [Email](mailto:hello@example.invalid)\n\n"
    + "| Contact |\n| --- |\n| [Call](tel:+442012345678) |\n\n[Report][report]\n\n[report]: http://example.invalid/report",
  );
  assert.deepEqual(links.map(link => link.Target).sort(), [
    "https://example.invalid/", "mailto:hello@example.invalid", "tel:+442012345678", "http://example.invalid/report",
  ].sort());
  assert.equal((document.match(/<w:hyperlink\b/g) ?? []).length, links.length);
  for (const link of links) {
    assert.equal(link.TargetMode, "External");
    assert.ok(document.includes(`r:id="${link.Id}"`));
  }
  assert.match(document, /Heading2/);
  assert.match(document, /<w:numPr>/);
  assert.match(document, /<w:tbl>/);
});

test("Word strips private, credential-bearing and unsafe link destinations but preserves styled labels", async () => {
  const destinations = [
    "/api/chat-media/CANARY.pdf?token=CANARY",
    "/api/lr-bg/register/AB123?token=CANARY",
    "https://bgp.invalid/api/chat-media/CANARY.pdf",
    "https://bgp.invalid/%61pi/chat-media/CANARY.pdf",
    "https://bgp.invalid/%2561pi/chat-media/CANARY.pdf",
    "https://example.invalid/?%74oken=CANARY",
    "https://example.invalid/?ACCESS_TOKEN=CANARY",
    "https://example.invalid/#/compose?access_token=CANARY",
    ...["X-Amz-Credential", "X-Amz-Signature", "X-Goog-Credential", "X-Goog-Signature"]
      .map(key => `https://storage.invalid/report.pdf?${key}=CANARY`),
    "javascript:CANARY", "java&#x73;cript:CANARY", "vbscript:CANARY", "data:text/html,CANARY",
    "file:///tmp/CANARY", "//example.invalid/CANARY", "/deals/CANARY",
    "https://user:CANARY@example.invalid/report",
  ];
  const markdown = destinations.map((destination, index) => `**[Label${index} *retained*](${destination})**`).join("\n\n");
  const { zip, document, links } = await wordExport(markdown);
  assert.equal(links.length, 0);
  assert.doesNotMatch(document, /<w:hyperlink\b/);
  for (const entry of zip.getEntries().filter(entry => /\.(?:xml|rels)$/.test(entry.entryName))) {
    assert.doesNotMatch(zip.readAsText(entry), /CANARY/, entry.entryName);
  }
  const paragraphs = [...document.matchAll(/<w:p>[\s\S]*?<\/w:p>/g)].map(match => match[0]);
  for (let index = 0; index < destinations.length; index++) {
    const paragraph = paragraphs.find(value => value.includes(`>Label${index} <`));
    assert.ok(paragraph, `label ${index} is retained`);
    assert.match(paragraph, /<w:b\/>/);
    assert.match(paragraph, /<w:i\/>/);
    assert.match(paragraph, />retained</);
  }
});
