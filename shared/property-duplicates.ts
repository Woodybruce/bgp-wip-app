// Which records sharing a property name are one place, and which to keep
// (server/property-duplicates.ts, Settings → Data Health). Pure, tested in
// server/property-duplicates.test.ts.

export type DuplicateRecordFacts = {
  id: string; address: unknown; postcode: string | null; hasLandlord: boolean; createdAt: string | null;
  sharedCentrePage: boolean; deals: number; scheduleRows: number; trackerUnits: number;
};

export type DuplicateRecord = DuplicateRecordFacts & { place: string | null; placeKey: string | null };

export type DuplicateGroup = {
  name: string; ids: string[]; count: number; records: DuplicateRecord[];
  samePlace: boolean; why: string | null;
};

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function addressText(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === "string") return address.trim() || null;
  if (typeof address !== "object") return null;
  const a = address as Record<string, unknown>;
  const pick = ["formatted", "address", "line", "line1", "street"].map(k => a[k]).find(v => typeof v === "string" && v.trim());
  return pick ? String(pick).trim() : null;
}

export function recordPostcode(r: { address: unknown; postcode: string | null }): string | null {
  const a = r.address && typeof r.address === "object" ? (r.address as Record<string, unknown>) : {};
  for (const v of [r.postcode, a.postcode, addressText(r.address)]) {
    const m = typeof v === "string" ? v.toUpperCase().match(POSTCODE) : null;
    if (m) return `${m[1]}${m[2]}`;
  }
  return null;
}

const plain = (s: string) => s.toLowerCase().replace(/\b(uk|united kingdom|london)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const links = (r: DuplicateRecordFacts) => r.deals + r.scheduleRows + r.trackerUnits;

export function describeDuplicateGroup(name: string, facts: DuplicateRecordFacts[]): DuplicateGroup {
  const records: DuplicateRecord[] = facts.map(f => {
    const place = addressText(f.address);
    const pc = recordPostcode(f);
    return { ...f, place, placeKey: pc ?? (place ? plain(place) : null) };
  });
  records.sort((a, b) => links(b) - links(a) || Number(b.hasLandlord) - Number(a.hasLandlord)
    || String(a.createdAt || "9999").localeCompare(String(b.createdAt || "9999")) || a.id.localeCompare(b.id));
  const postcodes = new Set(records.map(r => recordPostcode(r)).filter(Boolean));
  const places = new Set(records.filter(r => !recordPostcode(r) && r.place).map(r => plain(r.place!)));
  let why: string | null = null;
  if (records.some(r => r.sharedCentrePage)) why = "One is a shared benchmark centre page";
  else if (postcodes.size > 1) why = "Different postcodes";
  else if (postcodes.size === 0 && places.size > 1) why = "Different addresses";
  return { name, ids: records.map(r => r.id), count: records.length, records, samePlace: !why, why };
}
