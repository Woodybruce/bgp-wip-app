import "./test-database-url";
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyAddress, copyFileName, precheckPagesToCopy } from "./web-page-copy";
import { renderPagePdf } from "./render-page";

test("a page is filed under its address without the fragment, and only web addresses are copied", () => {
  assert.equal(copyAddress("https://news.example/story#comments"), "https://news.example/story");
  assert.equal(copyAddress("http://news.example/a?b=1"), "http://news.example/a?b=1");
  assert.equal(copyAddress("file:///etc/passwd"), null);
  assert.equal(copyAddress("javascript:alert(1)"), null);
  assert.equal(copyAddress("not a link"), null);
  assert.equal(copyAddress(`https://news.example/${"a".repeat(700)}`), null);
});

test("the copy is named after the site and the page's title", () => {
  assert.equal(copyFileName("https://www.bbc.co.uk/news/1", "Owner charged: what we know"), "bbc.co.uk - Owner charged what we know.pdf");
  assert.equal(copyFileName("https://example.org/x", ""), "example.org.pdf");
});

test("the pages a check relied on: each web finding's source, red flags before possible namesakes", () => {
  const pages = precheckPagesToCopy({ web: { lines: [
    { name: "Jane Doe", findings: [
      { kind: "adverse_media", summary: "Fraud charge (may be another Jane Doe)", url: "https://news.example/a", unsureIdentity: true },
      { kind: "public_role", summary: "Member of parliament", url: "https://parliament.example/jane", unsureIdentity: false },
      { kind: "adverse_media", summary: "No link", url: null },
    ] },
  ] } });
  assert.deepEqual(pages.map(p => p.url), ["https://parliament.example/jane", "https://news.example/a"]);
  assert.equal(pages[0].about, "Jane Doe, public role: Member of parliament");
  assert.deepEqual(precheckPagesToCopy(null), []);
});

test("a copy is never taken of this machine, a private network or a non-web address", async () => {
  for (const url of ["http://127.0.0.1:9/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/", "http://[::1]/", "file:///etc/passwd"]) {
    const out = await renderPagePdf(url, { stamp: "test" });
    assert.ok("error" in out, url);
    assert.match((out as { error: string }).error, /Refusing|not a web address/, url);
  }
});
