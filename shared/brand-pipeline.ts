// Brand site pipeline: the pure rules.
//
// Two public sources name an operator months before the press does: planning
// applications (shopfront, signage, change of use) and job adverts by town.
// This file decides which planning record and which advert count for a brand,
// and where each one is. No network, no database: server/brand-pipeline.ts
// does the fetching and the storage.
//
// Register text and advert text are data. Nothing here acts on what they say.

export const PLANNING_WINDOW_DAYS = 365;
export const JOBS_WINDOW_DAYS = 60;
export const TOO_COMMON_REASON = "name too common to search";

export const DEFAULT_SECTOR_WORDS = [
  "restaurant", "cafe", "bakery", "store", "shop", "pharmacy", "gym", "bar",
  "pub", "hotel", "cinema", "salon", "kiosk", "drive-thru",
];

export type PipelineKind = "planning" | "job_new_opening" | "job_property_role";

export interface PipelineItem {
  kind: PipelineKind;
  title: string;
  town: string | null;
  authority: string | null;
  address: string | null;
  date: string | null;
  url: string | null;
  state?: string | null;
}

export interface PipelineSummary {
  checkedAt: string | null;
  planning: PipelineItem[];
  jobs: PipelineItem[];
  jobsConfigured: boolean;
  jobsTotal: number | null;
  jobTowns: { town: string; adverts: number }[];
  planningSkipped: string | null;
}

// A row as it is stored: the item, its key in the source and a little detail.
export interface PipelineRow extends PipelineItem {
  key: string;
  detail: Record<string, unknown>;
}

export interface PlanningRecord {
  name?: string | null;
  uid?: string | null;
  address?: string | null;
  postcode?: string | null;
  description?: string | null;
  start_date?: string | null;
  area_name?: string | null;
  app_type?: string | null;
  app_state?: string | null;
  link?: string | null;
}

export interface JobAdvert {
  id?: string | number | null;
  title?: string | null;
  description?: string | null;
  created?: string | null;
  redirect_url?: string | null;
  company?: { display_name?: string | null } | null;
  location?: { display_name?: string | null; area?: unknown } | null;
}

export interface NameRule {
  names: string[];
  sectorWords?: string[];
  now?: Date;
}

// ─── Names ───────────────────────────────────────────────────────────────

// Lower case, no accents, no apostrophes or quote marks ("Gail's" = "Gails" =
// "GAIL’s"), everything else that is not a letter or digit becomes a space.
export function normText(s: unknown): string {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['‘’‚‛ʼ`´"“”]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(s: unknown): string[] {
  const t = normText(s);
  return t ? t.split(" ") : [];
}

// Single dictionary words (and two phrases) that a full text search of the
// planning register cannot tell from ordinary English. Leading "The" is
// ignored here, so "The Range" is "range".
const COMMON_NAMES = new Set([
  "next", "boots", "reserved", "mango", "office", "leon", "wasabi", "joe",
  "honest", "space", "mint", "oak", "jigsaw", "monsoon", "oasis", "coast",
  "whistles", "gap", "evans", "burton", "dune", "three", "ee", "o2", "cook",
  "paul", "tortilla", "cote", "bills", "apple", "orange", "shell", "subway",
  "iceland", "range", "works", "giraffe", "ask", "quiz", "revolution", "toast",
  "weekday", "tiger", "rituals", "browns", "gym", "new look",
]);
// Four letters or fewer, but nobody writes them by accident.
const SHORT_NAMES_SEARCHED = new Set(["pret", "itsu"]);

export function nameTooCommon(name: string): boolean {
  const t = words(name);
  if (!t.length) return true;
  const bare = t.length > 1 && t[0] === "the" ? t.slice(1) : t;
  if (COMMON_NAMES.has(bare.join(" "))) return true;
  return t.length === 1 && t[0].length <= 4 && !SHORT_NAMES_SEARCHED.has(t[0]);
}

const LEGAL_WORDS = new Set(["ltd", "limited", "plc", "uk", "llp"]);

// A company name without its legal tail: "Greggs PLC" = "greggs",
// "Boots UK Limited" = "boots".
export function normCompany(s: unknown): string {
  const t = words(s);
  while (t.length > 1 && LEGAL_WORDS.has(t[t.length - 1])) t.pop();
  return t.join(" ");
}

// The brand's name first, then its other names, without legal tails or
// repeats, at most `max`.
export function brandNames(name: unknown, others: unknown, max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v !== "string") return;
    const clean = v.replace(/\s+/g, " ").trim();
    const key = normCompany(clean);
    if (!key || seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push(clean);
  };
  add(name);
  if (Array.isArray(others)) {
    for (const o of others) add(typeof o === "string" ? o : (o as any)?.name);
  }
  return out;
}

// ─── Planning ────────────────────────────────────────────────────────────

interface Tok { norm: string; capital: boolean }

// The description as words, remembering which were written with a capital.
function tokens(text: unknown): Tok[] {
  const raw = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['‘’‚‛ʼ`´"“”]/g, "")
    .replace(/&/g, " and ");
  const out: Tok[] = [];
  for (const m of raw.matchAll(/[A-Za-z0-9]+/g)) {
    out.push({ norm: m[0].toLowerCase(), capital: /^[A-Z]/.test(m[0]) });
  }
  return out;
}

// The works a new occupier applies for. A word that only says there is a
// shop ("a Greggs shop", "the premises", "pavement licence") is not enough:
// on the live register those were works at shops the brand already trades
// from (a staff toilet, a licence renewal), not new sites.
const COMMERCIAL = new RegExp(
  "\\b(" + [
    "shopfronts?", "shop fronts?", "fascias?", "signage", "signs?", "lettering",
    "advertisements?", "adverts?", "change of use", "use class",
    "class e", "class a1", "class a3", "a1", "a3", "sui generis",
    "takeaway",
    "fit out", "fitout", "fitting out", "extraction", "extract", "flues?",
    "drive thru", "drive through", "kiosks?", "occupation by", "occupied by", "occupation",
    "food to go", "hot food", "premises licen[cs]e",
  ].join("|") + ")\\b",
);

// The brand as the last or the neighbouring occupier, or as the shop that is
// already there: not a site it is taking.
const NOT_ARRIVING = new RegExp(
  "(?:^| )(?:former|formerly|ex|previously|vacant|existing|old|opposite|above|beside|adjoining|neighbouring"
  + "|adjacent to|next to|rear of|side of"
  + "|(?:previously|formerly|last|currently) (?:occupied|used|known|trading|let) (?:by|as|to))$",
);

function sectorSequences(sectorWords?: string[]): string[][] {
  return (sectorWords ?? DEFAULT_SECTOR_WORDS).map((w) => words(w)).filter((w) => w.length > 0);
}

function followedBy(toks: Tok[], at: number, seqs: string[][]): boolean {
  return seqs.some((seq) => seq.every((w, k) => {
    const got = toks[at + k]?.norm;
    // The last word may be plural: "Leon restaurants".
    return got === w || (k === seq.length - 1 && got === w + "s");
  }));
}

export type PlanningVerdict =
  | { counts: true }
  | { counts: false; reason: "no date" | "older than 12 months" | "brand not named in the description" | "brand named only as a former, existing or neighbouring occupier" | "not about commercial premises" };

function withinDays(dateText: unknown, days: number, now: Date): "ok" | "none" | "old" {
  const day = typeof dateText === "string" ? dateText.slice(0, 10) : "";
  const t = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(day + "T00:00:00Z") : NaN;
  if (!Number.isFinite(t)) return "none";
  const age = (now.getTime() - t) / 86400000;
  // A day's grace for a record dated "today" in another time zone.
  if (age < -1) return "none";
  return age <= days ? "ok" : "old";
}

export function planningVerdict(rec: PlanningRecord, rule: NameRule): PlanningVerdict {
  const now = rule.now ?? new Date();
  const dated = withinDays(rec.start_date, PLANNING_WINDOW_DAYS, now);
  if (dated === "none") return { counts: false, reason: "no date" };
  if (dated === "old") return { counts: false, reason: "older than 12 months" };

  const toks = tokens(rec.description);
  const seqs = sectorSequences(rule.sectorWords);
  let named = false;
  let onlyAsNeighbour = false;
  for (const name of rule.names) {
    const want = words(name);
    if (!want.length) continue;
    const common = nameTooCommon(name);
    for (let i = 0; i + want.length <= toks.length; i++) {
      if (!want.every((w, k) => toks[i + k].norm === w)) continue;
      const before = toks.slice(Math.max(0, i - 4), i).map((t) => t.norm).join(" ");
      if (NOT_ARRIVING.test(before)) { onlyAsNeighbour = true; continue; }
      // A common word counts only as a name: written with a capital and
      // followed straight away by a sector word ("Next store").
      if (common && !(toks[i].capital && followedBy(toks, i + want.length, seqs))) continue;
      named = true;
      break;
    }
    if (named) break;
  }
  if (!named) {
    return { counts: false, reason: onlyAsNeighbour ? "brand named only as a former, existing or neighbouring occupier" : "brand not named in the description" };
  }
  const about = normText(rec.description);
  if (!COMMERCIAL.test(about) || /\b(renewal of|pavement licen[cs]e|tables and chairs)\b/.test(about)) return { counts: false, reason: "not about commercial premises" };
  return { counts: true };
}

export function planningRecordCounts(rec: PlanningRecord, rule: NameRule): boolean {
  return planningVerdict(rec, rule).counts;
}

// The name to send to the register's full text search, or why not.
export function planningSearchTerm(names: string[]): { search: string } | { skip: string } {
  const name = names[0];
  if (!name || nameTooCommon(name)) return { skip: TOO_COMMON_REASON };
  const search = name.replace(/[‘’‛ʼ`´]/g, "'").replace(/\s+/g, " ").trim().slice(0, 80);
  return { search };
}

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

export function postcodeOf(...texts: unknown[]): string | null {
  for (const t of texts) {
    const m = typeof t === "string" ? t.match(POSTCODE) : null;
    if (m) return `${m[1]} ${m[2]}`.toUpperCase();
  }
  return null;
}

const COUNTIES = new Set([
  "bedfordshire", "berkshire", "buckinghamshire", "cambridgeshire", "cheshire", "cornwall", "cumbria",
  "derbyshire", "devon", "dorset", "county durham", "durham", "east sussex", "essex", "gloucestershire",
  "greater london", "greater manchester", "hampshire", "herefordshire", "hertfordshire", "isle of wight",
  "kent", "lancashire", "leicestershire", "lincolnshire", "merseyside", "middlesex", "norfolk",
  "north yorkshire", "northamptonshire", "northumberland", "nottinghamshire", "oxfordshire", "rutland",
  "shropshire", "somerset", "south yorkshire", "staffordshire", "suffolk", "surrey", "tyne and wear",
  "warwickshire", "west midlands", "west sussex", "west yorkshire", "wiltshire", "worcestershire",
  "east yorkshire", "east riding of yorkshire", "north somerset", "north lanarkshire", "south lanarkshire",
  "fife", "lothian", "midlothian", "east lothian", "west lothian", "highland", "aberdeenshire", "ayrshire",
  "north ayrshire", "south ayrshire", "east ayrshire", "renfrewshire", "east renfrewshire", "dunbartonshire",
  "perthshire", "stirlingshire", "lanarkshire", "angus", "moray", "scottish borders", "gwent", "gwynedd",
  "powys", "dyfed", "clwyd", "glamorgan", "mid glamorgan", "south glamorgan", "west glamorgan",
  "pembrokeshire", "carmarthenshire", "ceredigion", "flintshire", "denbighshire", "monmouthshire",
  "england", "scotland", "wales", "uk", "united kingdom", "avon", "cleveland", "humberside",
]);

// Words a town does not come after without a break: the end of a street or a
// building name.
const PLACE_ENDS = new Set([
  "street", "road", "rd", "lane", "avenue", "ave", "way", "square", "place", "parade", "hill", "row",
  "walk", "gate", "centre", "center", "park", "mall", "arcade", "broadway", "market", "boulevard", "drive",
  "close", "court", "crescent", "terrace", "quay", "green", "estate", "station", "services", "house",
  "building", "buildings", "farm", "hospital", "airport", "precinct", "quarter", "wharf", "yard", "mews",
  "gardens", "grove", "circus", "bridge", "passage", "promenade", "embankment", "retail", "shopping", "floor",
]);
const NOT_A_TOWN = new Set([
  "land", "at", "of", "rear", "unit", "units", "ground", "first", "second", "the", "and", "adjacent",
  "former", "site", "shop", "store", "to", "on", "in",
]);

const bare = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");

// Where a planning record is. The post town when the end of the address
// makes it plain; the planning authority otherwise. Deliberately cautious.
export function planningTown(address: unknown, areaName: unknown): string | null {
  const authority = typeof areaName === "string" && areaName.trim() ? areaName.trim() : null;
  let a = typeof address === "string" ? address : "";
  a = a.replace(new RegExp(POSTCODE.source, "gi"), " ").replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*$/, " ").replace(/[\s,.]+$/, "");
  const segs = a.split(",").map((s) => s.trim()).filter(Boolean);
  while (segs.length && COUNTIES.has(normText(segs[segs.length - 1]))) segs.pop();
  let tail = (segs[segs.length - 1] ?? "").split(/\s+/).filter(Boolean);
  // A county written after the town with no comma: "Winchester Hampshire".
  for (let n = 4; n >= 1; n--) {
    if (tail.length > n && COUNTIES.has(normText(tail.slice(-n).join(" ")))) { tail = tail.slice(0, -n); break; }
  }
  let cand: string[];
  const ownSegment = segs.length > 1 && tail.length <= 3 && !tail.some((w) => /\d/.test(w))
    && !PLACE_ENDS.has(bare(tail[tail.length - 1] ?? ""));
  if (ownSegment) {
    // "..., Bury St Edmunds": the town has the last part to itself.
    cand = tail;
  } else {
    // No commas: the town is whatever follows the street or the building.
    let cut = -1;
    tail.forEach((w, i) => {
      const b = bare(w);
      const prev = i > 0 ? bare(tail[i - 1]) : "";
      // "High St" ends a street; "St Albans" and "Bury St Edmunds" do not.
      const streetSt = b === "st" && i > 0 && !!prev && prev !== "bury" && prev !== "st" && !PLACE_ENDS.has(prev) && !/\d/.test(tail[i - 1]);
      if (/\d/.test(w) || PLACE_ENDS.has(b) || streetSt) cut = i;
    });
    cand = tail.slice(cut + 1);
    // Two words with no comma could be a village and its post town, or the
    // end of the street name ("London Road North Lowestoft"): cannot tell.
    if (cand.length > 1 && cand[0].toLowerCase() !== "london") cand = [];
  }
  if (cand.length > 1 && cand[0].toLowerCase() === "london") cand = ["London"];
  const plain = cand.length >= 1 && cand.length <= 3
    && cand.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w))
    && !NOT_A_TOWN.has(cand[0].toLowerCase()) && !NOT_A_TOWN.has(cand[cand.length - 1].toLowerCase());
  if (!plain) return authority;
  const town = cand.join(" ");
  // An address typed in capitals reads better as a name.
  return town === town.toUpperCase() ? town.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase()) : town;
}

// One site, however many applications: the postcode, else the address.
export function planningSiteKey(address: unknown, postcode?: unknown): string {
  const pc = postcodeOf(postcode, address);
  return pc ? pc.replace(/\s+/g, "") : normText(address);
}

function httpUrl(u: unknown): string | null {
  return typeof u === "string" && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}

function clip(s: unknown, max: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// The records that count for a brand, newest first, one per application.
export function planningRowsFrom(records: unknown, rule: NameRule): PipelineRow[] {
  const out: PipelineRow[] = [];
  const seen = new Set<string>();
  for (const rec of Array.isArray(records) ? (records as PlanningRecord[]) : []) {
    if (!rec || typeof rec !== "object") continue;
    if (!planningRecordCounts(rec, rule)) continue;
    const address = clip(rec.address, 300) || null;
    const authority = clip(rec.area_name, 120) || null;
    const date = String(rec.start_date).slice(0, 10);
    const key = clip(rec.name, 200) || clip([authority, rec.uid].filter(Boolean).join("/"), 200) || `${date}|${normText(address)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const postcode = postcodeOf(rec.postcode, rec.address);
    out.push({
      kind: "planning",
      key,
      title: clip(rec.description, 400),
      town: planningTown(rec.address, rec.area_name),
      authority,
      address,
      date,
      url: httpUrl(rec.link) ?? (rec.name ? `https://www.planit.org.uk/planapplic/${encodeURI(String(rec.name))}` : null),
      state: clip(rec.app_state, 60) || null,
      detail: { state: clip(rec.app_state, 60) || null, type: clip(rec.app_type, 60) || null, postcode, site: planningSiteKey(rec.address, rec.postcode) },
    });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ─── Job adverts ─────────────────────────────────────────────────────────

// The advertiser is the brand: the same name, or (for a name that is not a
// common word) the name with one sector word after it, "GAIL's Bakery".
export function advertCompanyMatches(displayName: unknown, rule: NameRule): boolean {
  const c = normCompany(displayName);
  if (!c) return false;
  const seqs = sectorSequences(rule.sectorWords);
  for (const name of rule.names) {
    const n = normCompany(name);
    if (!n) continue;
    if (c === n) return true;
    if (nameTooCommon(name) || !c.startsWith(n + " ")) continue;
    const rest = c.slice(n.length + 1).split(" ");
    if (seqs.some((seq) => seq.length === rest.length && seq.every((w, k) => rest[k] === w || (k === seq.length - 1 && rest[k] === w + "s")))) return true;
  }
  return false;
}

export type AdvertClass = "new_opening" | "property_role" | "other";

const PROPERTY_TITLE = /\b(acquisitions?|estates? (manager|surveyor|director)|property (manager|director|surveyor)|head of (property|estates?)|real estate|store development)\b/;
// Recruitment and marketing use the same word for something else.
const NOT_PROPERTY = /\b(talent|customer|client|data|user|guest) acquisitions?\b/g;
// Singular on purpose: "new restaurants opening across the UK" is in every
// advert of a growing brand and says nothing about this job.
const NEW_OPENING = /\b(new openings?|opening soon|new site|new store|new restaurant|new bakery|launch team|pre opening|preopening)\b/;
const OPENING_IN = /\bopening\s+in\s+(?:the\s+)?[A-Z][a-z]/;

export function classifyAdvert(title: unknown, description: unknown): AdvertClass {
  // A property job first: its advert often talks about new sites too.
  if (PROPERTY_TITLE.test(normText(title).replace(NOT_PROPERTY, " "))) return "property_role";
  const both = `${String(title ?? "")} . ${String(description ?? "")}`;
  if (NEW_OPENING.test(normText(both)) || OPENING_IN.test(both)) return "new_opening";
  return "other";
}

const NOT_A_PLACE = new Set(["uk", "united kingdom", "gb", "great britain", "england", "scotland", "wales", "northern ireland"]);

export function advertTown(location: JobAdvert["location"]): string | null {
  const area = Array.isArray(location?.area) ? location!.area.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
  for (const cand of [area[area.length - 1], location?.display_name]) {
    const t = typeof cand === "string" ? clip(cand, 120) : "";
    if (t && !NOT_A_PLACE.has(t.toLowerCase())) return t;
  }
  return null;
}

export interface JobsRead {
  rows: PipelineRow[];                              // new openings and property roles only
  total: number;                                    // every advert that is the brand's
  byTown: { town: string; adverts: number }[];      // most adverts first
}

// What one page of adverts says about a brand. `response` is whatever the
// jobs API sent: nothing about its shape is assumed.
export function jobRowsFrom(response: unknown, rule: NameRule): JobsRead {
  const now = rule.now ?? new Date();
  const results: JobAdvert[] = Array.isArray((response as any)?.results) ? (response as any).results : [];
  const rows: PipelineRow[] = [];
  const towns = new Map<string, number>();
  const seen = new Set<string>();
  let kept = 0;
  let asked = 0;
  for (const ad of results) {
    if (!ad || typeof ad !== "object") continue;
    asked++;
    if (!advertCompanyMatches(ad.company?.display_name, rule)) continue;
    // An advert with no date is kept: the search already asked for recent ones.
    if (withinDays(ad.created, JOBS_WINDOW_DAYS, now) === "old") continue;
    const title = clip(ad.title, 200);
    const town = advertTown(ad.location);
    const date = typeof ad.created === "string" && /^\d{4}-\d{2}-\d{2}/.test(ad.created) ? ad.created.slice(0, 10) : null;
    const key = ad.id != null && String(ad.id).trim() ? clip(ad.id, 100) : `${normText(title)}|${normText(town)}|${date ?? ""}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    kept++;
    if (town) towns.set(town, (towns.get(town) ?? 0) + 1);
    const cls = classifyAdvert(ad.title, ad.description);
    if (cls === "other") continue;
    rows.push({
      kind: cls === "new_opening" ? "job_new_opening" : "job_property_role",
      key,
      title,
      town,
      authority: null,
      address: clip(ad.location?.display_name, 200) || null,
      date,
      url: httpUrl(ad.redirect_url),
      detail: { company: clip(ad.company?.display_name, 120) || null },
    });
  }
  // When every advert on the page is the brand's, the API's own count is the
  // number live; otherwise the page holds other firms too and we count ours.
  const count = Number((response as any)?.count);
  const total = asked > 0 && kept === asked && Number.isFinite(count) && count > kept ? Math.floor(count) : kept;
  const byTown = [...towns.entries()].map(([town, adverts]) => ({ town, adverts }))
    .sort((a, b) => b.adverts - a.adverts || a.town.localeCompare(b.town));
  rows.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return { rows, total, byTown };
}
