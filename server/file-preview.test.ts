// The pop-out file viewer's rules (Woody, 23 November 2026: "on the files can the
// app show the files so can check them at any point rather than having to
// download a zip just a thumbnail can click and it pops out?").
import test from "node:test";
import assert from "node:assert/strict";
import { fileBadge, filePreviewKind, inAppFileUrl } from "../shared/file-preview";

test("each file is shown by its stored type, else its name, else its address; never a page that could run", () => {
  assert.equal(filePreviewKind({ name: "passport.jpg" }), "image");
  assert.equal(filePreviewKind({ name: "IMG_0042.HEIC" }), "image");
  assert.equal(filePreviewKind({ name: "accounts.pdf" }), "pdf");
  assert.equal(filePreviewKind({ name: "scan", mime: "application/pdf" }), "pdf");
  assert.equal(filePreviewKind({ name: "notes.txt" }), "text");
  assert.equal(filePreviewKind({ name: "heads of terms.docx" }), "office");
  assert.equal(filePreviewKind({ name: "x", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "office");
  assert.equal(filePreviewKind({ name: "file", url: "/api/chat-media/kyc-ch-1.pdf" }), "pdf");
  assert.equal(filePreviewKind({ name: "file", mime: "application/octet-stream", url: "/uploads/a.png" }), "image");
  assert.equal(filePreviewKind({ name: "unknown.bin" }), "other");
  // An SVG, HTML or XML file is never drawn, whatever it is stored as.
  assert.equal(filePreviewKind({ name: "logo.svg", mime: "image/svg+xml" }), "other");
  assert.equal(filePreviewKind({ name: "page.html" }), "other");
  assert.equal(filePreviewKind({ name: "x", mime: "text/html" }), "other");
  assert.equal(filePreviewKind({ name: "data.xml" }), "other");
});

test("a tile's badge, and only this app's own addresses are fetched", () => {
  assert.equal(fileBadge({ name: "accounts.pdf" }), "PDF");
  assert.equal(fileBadge({ name: "x", url: "/uploads/a.docx?v=2" }), "DOCX");
  assert.equal(fileBadge({ name: "noext" }), null);
  assert.equal(inAppFileUrl("/api/chat-media/kyc-ch-1.pdf"), true);
  assert.equal(inAppFileUrl("/uploads/marketing-files/a.docx"), true);
  assert.equal(inAppFileUrl("//evil.example/a.pdf"), false);
  assert.equal(inAppFileUrl("https://example.com/a.pdf"), false);
  assert.equal(inAppFileUrl("/\\evil.example/a.pdf"), false);
  assert.equal(inAppFileUrl(null), false);
});
