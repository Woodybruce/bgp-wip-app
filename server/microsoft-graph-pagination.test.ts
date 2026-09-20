/**
 * microsoft-graph-pagination.test.ts — Graph listing pagination + upload
 * destination resolution.
 *
 * Covers the two SharePoint fixes: (A) drive-item children listings must
 * follow `@odata.nextLink` until exhausted (bounded by a page cap), and
 * (B) an upload with a selected folder but missing drive/item IDs must be a
 * clear 4xx, never a silent fall-back to the SharePoint root.
 *
 * Run with: node --import tsx --test server/microsoft-graph-pagination.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRAPH_LIST_PAGE_CAP,
  listAllChildren,
  resolveUploadDestination,
  type GraphChildrenPage,
} from "./microsoft-graph-pagination";

function stubFetch(pages: GraphChildrenPage[]) {
  const calls: string[] = [];
  const fetchPage = async (url: string): Promise<GraphChildrenPage> => {
    calls.push(url);
    const page = pages[calls.length - 1];
    if (!page) throw new Error(`unexpected fetch: ${url}`);
    return page;
  };
  return { calls, fetchPage };
}

describe("listAllChildren", () => {
  it("returns a single page unchanged when there is no nextLink", async () => {
    const { calls, fetchPage } = stubFetch([{ value: [{ id: "1" }, { id: "2" }] }]);
    const items = await listAllChildren(fetchPage, "https://graph/first");
    assert.deepEqual(items, [{ id: "1" }, { id: "2" }]);
    assert.equal(calls.length, 1);
  });

  it("accumulates across multiple pages until nextLink is exhausted", async () => {
    const { calls, fetchPage } = stubFetch([
      { value: [{ id: "1" }], "@odata.nextLink": "https://graph/page2" },
      { value: [{ id: "2" }, { id: "3" }], "@odata.nextLink": "https://graph/page3" },
      { value: [{ id: "4" }] },
    ]);
    const items = await listAllChildren(fetchPage, "https://graph/page1");
    assert.deepEqual(items.map((i: any) => i.id), ["1", "2", "3", "4"]);
    assert.deepEqual(calls, ["https://graph/page1", "https://graph/page2", "https://graph/page3"]);
  });

  it("treats a missing value array as an empty page and keeps following nextLink", async () => {
    const { fetchPage } = stubFetch([
      { "@odata.nextLink": "https://graph/page2" },
      { value: [{ id: "x" }] },
    ]);
    const items = await listAllChildren(fetchPage, "https://graph/page1");
    assert.deepEqual(items, [{ id: "x" }]);
  });

  it("stops at the page cap and returns what it has", async () => {
    const cap = 3;
    const pages: GraphChildrenPage[] = Array.from({ length: 10 }, (_, i) => ({
      value: [{ id: String(i) }],
      "@odata.nextLink": `https://graph/page${i + 2}`,
    }));
    const { calls, fetchPage } = stubFetch(pages);
    const items = await listAllChildren(fetchPage, "https://graph/page1", cap);
    assert.equal(calls.length, cap);
    assert.equal(items.length, cap);
  });

  it("default cap is the sane 50-page bound", () => {
    assert.equal(GRAPH_LIST_PAGE_CAP, 50);
  });

  it("propagates a fetch error from a later page", async () => {
    let n = 0;
    const fetchPage = async (): Promise<GraphChildrenPage> => {
      n++;
      if (n === 2) throw new Error("Graph API error: 500");
      return { value: [{ id: "1" }], "@odata.nextLink": "https://graph/page2" };
    };
    await assert.rejects(() => listAllChildren(fetchPage, "https://graph/page1"), /Graph API error: 500/);
  });
});

describe("resolveUploadDestination", () => {
  it("selected folder with both IDs targets that folder", () => {
    assert.deepEqual(
      resolveUploadDestination({ driveId: "d1", folderId: "i9" }),
      { kind: "folder", driveId: "d1", folderId: "i9" },
    );
  });

  it("selected folder without a drive ID is a 400 error, never root", () => {
    const dest = resolveUploadDestination({ folderId: "i9" });
    assert.equal(dest.kind, "error");
    if (dest.kind === "error") {
      assert.equal(dest.status, 400);
      assert.match(dest.message, /drive ID is missing/);
    }
  });

  it("selected folder without a drive ID stays an error even if a path was also sent", () => {
    const dest = resolveUploadDestination({ folderId: "i9", folderPath: "BGP share drive/Team/Prop" });
    assert.equal(dest.kind, "error");
  });

  it("no folder selected but a path sent targets that path", () => {
    assert.deepEqual(
      resolveUploadDestination({ folderPath: "BGP share drive/London Retail/Bluewater" }),
      { kind: "path", driveId: undefined, folderPath: "BGP share drive/London Retail/Bluewater" },
    );
  });

  it("path targeting keeps an accompanying drive ID", () => {
    assert.deepEqual(
      resolveUploadDestination({ driveId: "d1", folderPath: "a/b" }),
      { kind: "path", driveId: "d1", folderPath: "a/b" },
    );
  });

  it("a drive with no folder keeps the existing drive-root behaviour", () => {
    assert.deepEqual(resolveUploadDestination({ driveId: "d1" }), { kind: "drive-root", driveId: "d1" });
  });

  it("nothing selected keeps the existing default (BGP share drive root)", () => {
    assert.deepEqual(resolveUploadDestination({}), { kind: "default" });
    assert.deepEqual(resolveUploadDestination({ driveId: "", folderId: "", folderPath: "" }), { kind: "default" });
    assert.deepEqual(resolveUploadDestination({ folderPath: "   " }), { kind: "default" });
  });
});
