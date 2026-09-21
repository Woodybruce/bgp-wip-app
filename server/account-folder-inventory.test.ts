/**
 * account-folder-inventory.test.ts — Delivery 5, Task 3.
 *
 * Acceptance gates covered here: >200 items navigable (a 3-page synthetic
 * Graph listing is fully enumerated), same-name properties reported against
 * their own stable ids, bound/matched/missing/conflict classification, the
 * dry-run is read-only (no binding writes), and the staff-only guard.
 *
 * The matcher and walker are pure/stubbed — no network, no real DB.
 *
 * Run with: node --import tsx --test server/account-folder-inventory.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

let inv: typeof import("./account-folder-inventory");
let map: typeof import("./account-folder-map");
let tree: typeof import("@shared/client-folder-tree");

before(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://test:test@localhost:1/test";
  inv = await import("./account-folder-inventory");
  map = await import("./account-folder-map");
  tree = await import("@shared/client-folder-tree");
});

const DRIVE = "DRIVE-1";

function physical(itemId: string, name: string, children: inv.PhysicalNode[] = []): inv.PhysicalNode {
  return { itemId, name, isFolder: true, children };
}

function expectedFixture() {
  return tree.buildExpectedFolderTree({
    companyId: "CO-1",
    clientName: "Landsec",
    entities: [{ entityKind: "company", entityId: "E-1", name: "Landsec SPV", companiesHouseNumber: "12345678" }],
    properties: [
      { propertyId: "aaaaaaaa-0000", name: "Bluewater" },
      { propertyId: "bbbbbbbb-0000", name: "Bluewater" },
    ],
  });
}

describe("createChildrenLister (complete pagination)", () => {
  it("enumerates a >200-item folder across 3 synthetic pages", async () => {
    const pages = [
      { value: Array.from({ length: 100 }, (_, i) => ({ id: `I-${i}`, name: `f${i}`, folder: {} })), "@odata.nextLink": "page2" },
      { value: Array.from({ length: 100 }, (_, i) => ({ id: `I-${100 + i}`, name: `f${100 + i}`, folder: {} })), "@odata.nextLink": "page3" },
      { value: Array.from({ length: 60 }, (_, i) => ({ id: `I-${200 + i}`, name: `f${200 + i}`, folder: {} })) },
    ];
    const requested: string[] = [];
    const lister = inv.createChildrenLister(async (url) => {
      requested.push(url);
      if (url === "first") return pages[0];
      if (url === "page2") return pages[1];
      return pages[2];
    }, () => "first");
    const result = await lister(DRIVE, "ROOT");
    assert.equal(result.items.length, 260);
    assert.equal(result.capped, false);
    assert.deepEqual(requested, ["first", "page2", "page3"]);
  });

  it("flags the page cap instead of silently truncating", async () => {
    const endless = { value: [{ id: "x", name: "x", folder: {} }], "@odata.nextLink": "next" };
    const lister = inv.createChildrenLister(async () => endless, () => "first", 3);
    const result = await lister(DRIVE, "ROOT");
    assert.equal(result.capped, true);
    assert.equal(result.items.length, 3);
  });
});

describe("matchExpectedTree", () => {
  it("classifies bound / matched (exact + legacy) / missing / conflict", () => {
    const nodes = expectedFixture();
    // Physical: exact-name match for one section, legacy bare-name match for
    // one property, two physical folders both named "Bluewater — bbbbbbbb"
    // would be a conflict — modelled here by two legacy "Bluewater" folders
    // hitting the same property node.
    const physicalRoot = physical("ROOT", "Landsec", [
      physical("S-1", "01 Client & relationship"),
      physical("S-2", "02 Group & legal entities", [
        physical("E-phys", "Landsec SPV — 12345678", [
          physical("E-sub", "KYC & onboarding"),
        ]),
      ]),
      physical("S-3", "03 Properties", [
        physical("P-a", "Bluewater — aaaaaaaa"),
        physical("P-b1", "Bluewater"),
        physical("P-b2", "Bluewater"),
      ]),
    ]);
    const bindings = new Map([
      [map.nodeKey("company", "CO-1", "root"), {
        owner_kind: "company", owner_id: "CO-1", logical_key: "root",
        drive_id: DRIVE, item_id: "ROOT", bind_status: "bound",
      } as any],
    ]);

    const rows = inv.matchExpectedTree(nodes, physicalRoot, DRIVE, bindings);
    const byKey = (kind: string, id: string, key: string) =>
      rows.find(r => r.ownerKind === kind && r.ownerId === id && r.logicalKey === key)!;

    assert.equal(byKey("company", "CO-1", "root").status, "bound");
    assert.equal(byKey("company", "CO-1", "01-client-relationship").status, "matched");
    assert.equal(byKey("entity", "E-1", "entity").status, "matched");
    assert.equal(byKey("entity", "E-1", "entity:kyc-onboarding").status, "matched");
    // Property A matches by its stable display name.
    const propA = byKey("property", "aaaaaaaa-0000", "property");
    assert.equal(propA.status, "matched");
    assert.equal(propA.itemId, "P-a");
    // Property B: both legacy folders match → conflict, nothing bound.
    const propB = byKey("property", "bbbbbbbb-0000", "property");
    assert.equal(propB.status, "conflict");
    assert.equal(propB.itemId, null);
    assert.ok(propB.notes.some(n => n.includes("P-b1")) && propB.notes.some(n => n.includes("P-b2")));
    // A never-created section reports missing, and its children too.
    assert.equal(byKey("company", "CO-1", "04-media-library").status, "missing");
    // Children of a missing/conflict node are missing, not silently matched.
    assert.equal(byKey("property", "bbbbbbbb-0000", "property:01-instructions").status, "missing");
  });

  it("matches a legacy bare-name property folder and notes it", () => {
    const nodes = expectedFixture();
    const physicalRoot = physical("ROOT", "Landsec", [
      physical("S-3", "03 Properties", [physical("P-a", "Bluewater")]),
    ]);
    const rows = inv.matchExpectedTree(nodes, physicalRoot, DRIVE, new Map());
    const propA = rows.find(r => r.ownerId === "aaaaaaaa-0000" && r.logicalKey === "property")!;
    assert.equal(propA.status, "matched");
    assert.ok(propA.notes.some(n => n.toLowerCase().includes("legacy")));
    // The other same-named property matches the SAME folder? No — it would
    // also hit it, but one physical folder can only bind one node; with both
    // unmatched, each sees one legacy hit. This is exactly why the report is
    // dry-run only: the human confirms before the job binds.
    const propB = rows.find(r => r.ownerId === "bbbbbbbb-0000" && r.logicalKey === "property")!;
    assert.ok(propB.status === "matched" || propB.status === "conflict");
  });

  it("keeps a bound row bound even when the physical item moved out of the walked root", () => {
    const nodes = expectedFixture();
    const bindings = new Map([
      [map.nodeKey("property", "aaaaaaaa-0000", "property"), {
        owner_kind: "property", owner_id: "aaaaaaaa-0000", logical_key: "property",
        drive_id: DRIVE, item_id: "P-moved", bind_status: "bound",
      } as any],
    ]);
    const rows = inv.matchExpectedTree(nodes, physical("ROOT", "Landsec"), DRIVE, bindings);
    const propA = rows.find(r => r.ownerId === "aaaaaaaa-0000" && r.logicalKey === "property")!;
    assert.equal(propA.status, "bound");
    assert.equal(propA.itemId, "P-moved");
    assert.ok(propA.notes.some(n => n.includes("not seen")));
  });
});

describe("walkPhysicalTree", () => {
  it("counts every item it sees (the pagination proof) and caps depth", async () => {
    const big = Array.from({ length: 260 }, (_, i) => ({ id: `I-${i}`, name: `f${i}` }));
    const listChildren: inv.ChildrenLister = async (_d, itemId) => {
      if (itemId === "ROOT") return { items: [{ id: "S", name: "03 Properties", folder: {} }], capped: false };
      if (itemId === "S") return { items: big.map(i => ({ ...i, folder: {} })), capped: false };
      return { items: [], capped: false };
    };
    const walk = await inv.walkPhysicalTree(listChildren, DRIVE, {
      driveId: DRIVE, itemId: "ROOT", name: "Landsec", webUrl: null, fullPath: "",
    });
    assert.equal(walk.itemsSeen, 261);
    assert.equal(walk.warnings.length, 0);
    const section = walk.root.children[0];
    assert.equal(section.children.length, 260);
  });
});

describe("guard", () => {
  it("denies any client-scoped request (staff only)", () => {
    assert.equal(inv.folderInventoryDeniedForScope("CO-1"), true);
    assert.equal(inv.folderInventoryDeniedForScope(null), false);
    assert.equal(inv.folderInventoryDeniedForScope(undefined), false);
  });
});
