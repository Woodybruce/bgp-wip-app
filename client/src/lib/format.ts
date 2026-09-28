// en-GB writes September as "Sept" in short-month formats; everything else
// in the app reads "Sep" (Woody, 2026-09-28).
export function gbDate(date: string | number | Date, opts: Intl.DateTimeFormatOptions): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleDateString("en-GB", opts).replace(/\bSept\b/g, "Sep");
}

// Planning / use codes read as words — display only, stored values are
// unchanged: "E" → "Class E", legacy "A1 Food" → "Food retail", and one
// spelling of "Mixed Use" (Woody, 2026-09-28).
export function useClassLabel(v: string | null | undefined): string {
  const t = (v || "").trim();
  if (!t) return "";
  if (/^mixed[\s-]?use$/i.test(t)) return "Mixed Use";
  if (t === "A1 Food") return "Food retail";
  if (/^[A-GR]\d?(\([a-z]\d?\))?$/.test(t)) return `Class ${t}`;
  return t;
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return gbDate(d, { day: "numeric", month: "short", year: "numeric" });
}

// Accepts strings too — Drizzle `numeric` columns arrive as strings over
// JSON, and String.prototype.toLocaleString silently ignores the options
// (rendering "£1500000" with no separators).
export function formatCurrency(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (isNaN(n)) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Convert any of (Date | timestamp string | "YYYY-MM-DD") into a
// "YYYY-MM-DD" string suitable for an HTML <input type="date">.
// Critically, does NOT do `new Date(s).toISOString().slice(0,10)` —
// that converts to UTC and shifts a day for any UK timestamp set
// after midnight UTC during BST. Instead:
//   * if the input already looks like "YYYY-MM-DD..." we trust it
//     (server-stored date-only fields)
//   * otherwise we use the LOCAL date components so a 23:00 UK
//     timestamp stays on its UK date, not its UTC date
export function toDateInputValue(v: string | Date | null | undefined): string {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = typeof v === "string" ? new Date(v) : v;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Drop the property from a deal title when the card subtitle already shows
// it. First by separator-delimited segment (– — - | : , ·): a segment that is
// the property (or its leading words — "Kings Road" under "Kings Road Park")
// goes along with any trailing town after it, so "Pret A Manger – Gunwharf
// Quays, Portsmouth" → "Pret A Manger"; a leading/trailing segment that is a
// town in the property's address goes too ("Cardiff - Starbucks Hays" →
// "Starbucks Hays"). Then by the property's leading words at either end with
// no separator ("10 Piccadilly Time Out Market" under "10 Piccadilly"). Never
// strips to empty (Woody, 2026-09-27). A leading centre code ("XYRK -
// Nandos") goes when the rest is the tenant (Woody, 2026-09-28). A title that
// is nothing but the property ("35 Dover St" under "35 Dover St") shows the
// tenant instead, and misspelt long words still match the property
// ("Pultney" ≈ "Pulteney") (Woody, 2026-09-28).
const TITLE_STOPWORDS = new Set(["the", "and", "of", "at", "on", "in"]);
const STREET_ABBR: Record<string, string> = { st: "street", rd: "road", ave: "avenue", av: "avenue", sq: "square", pl: "place", ln: "lane", tce: "terrace", cres: "crescent", gdns: "gardens", ct: "court", dr: "drive" };
const STREET_WORDS = new Set([...Object.values(STREET_ABBR), "row", "hill", "mews", "yard", "walk", "way", "parade", "grove"]);
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export function stripPropertyFromTitle(title: string, propName: string, propAddress?: string | null, tenantName?: string | null): string {
  const tenantLabel = (tenantName || "").trim();
  const useTenant = /[a-z]{2,}/i.test(tenantLabel) && !/^(n\/?a|none|tbc|unknown)$/i.test(tenantLabel);
  // The title is itself a short form of the property ("Brent Cross") — keep
  // it, unless there's a tenant to name the deal by.
  if (propName.trim().toLowerCase().startsWith(title.trim().toLowerCase())) return useTenant ? tenantLabel : title;
  const norm = (v: string) => v.toLowerCase().replace(/[’']/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "")
    .split(" ").map(w => STREET_ABBR[w] || w).join(" ");
  const significant = (n: string) => n.split(" ").some(w => /[a-z]{3,}/.test(w) && !TITLE_STOPWORDS.has(w));
  // "62, 64 & 66/66A Pimlico Road" and "50 Sloane Street" compare on the
  // street, without the building numbers.
  const dropNumbers = (n: string) => n.replace(/^(?:\d+[a-z]?\s+|and\s+)+/, "");
  const prop = norm(propName);
  const propStreet = dropNumbers(prop);
  const addr = ` ${norm(propAddress || "")} `;
  // Long title words within two edits of a property word read as that word
  // ("Charring" → "charing", "Pultney" → "pulteney").
  const propWords = [...new Set(`${prop} ${addr}`.split(" ").filter(w => w.length >= 6))];
  const fuzz = (n: string) => n.split(" ").map(w => w.length < 6 || propWords.includes(w) ? w : (propWords.find(p => editDistance(w, p) <= 2) || w)).join(" ");
  const isProp = (seg: string) => {
    const n = fuzz(norm(seg));
    if (!n || !prop || !significant(n)) return false;
    if (n === prop || prop.startsWith(`${n} `) || n.startsWith(`${prop} `)) return true;
    const s = dropNumbers(n);
    if (!s || !significant(s) || !propStreet) return false;
    // "Sloane Street" under "50 Sloane Street", "Pulteney Street" under
    // "29 Great Pulteney Street", "62, 64 & 66/66A Pimlico Road" under
    // "Pimlico Rd, London SW1".
    return s === propStreet || propStreet.startsWith(`${s} `)
      || (s.includes(" ") && STREET_WORDS.has(s.split(" ").pop()!) && propStreet.endsWith(` ${s}`));
  };
  // A segment that repeats part of the property ("London E14" after
  // "Canary Wharf Estate") goes with it.
  const inProp = (seg: string) => {
    const n = fuzz(norm(seg));
    return !!n && ` ${prop} `.includes(` ${n} `);
  };
  const isPlace = (seg: string) => {
    const n = norm(seg);
    return !!n && significant(n) && n.split(" ").length <= 3 && addr.includes(` ${n} `);
  };
  const trimSep = (v: string) => v.replace(/^[\s–—\-|,:·]+|[\s–—\-|,:·]+$/g, "");
  // `comma` marks a segment that follows ", " — the "Property, Town" form.
  const split = (t: string) => {
    const out: { text: string; start: number; end: number; comma: boolean }[] = [];
    let last = 0;
    let comma = false;
    // No split inside a number list ("62, 64 & 66/66A").
    for (const m of t.matchAll(/\s*[–—|·]\s*|\s+-\s*|\s*-\s+|\s*(?:(?<!\d)[,:]\s+|[,:]\s+(?![\s\d]))/g)) {
      // Nor inside a number range ("25 - 26 St Christophers Place").
      if (m[0].includes("-") && /\d$/.test(t.slice(0, m.index)) && /^\d/.test(t.slice(m.index! + m[0].length))) continue;
      out.push({ text: t.slice(last, m.index), start: last, end: m.index!, comma });
      last = m.index! + m[0].length;
      comma = m[0].trim() === ",";
    }
    out.push({ text: t.slice(last), start: last, end: t.length, comma });
    return out;
  };
  // The property's leading words at either end of one segment, with no
  // separator: "10 Piccadilly Time Out Market", "The Blue Lagoon Bluewater".
  const words = propName.trim().split(/\s+/).filter(Boolean);
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripEnds = (seg: string) => {
    for (let k = words.length; k >= 1; k--) {
      const head = words.slice(0, k);
      if (!head.some(w => /[a-z]{3,}/i.test(w) && !TITLE_STOPWORDS.has(w.toLowerCase()))) continue;
      const prefix = head.map(esc).join("\\s+");
      for (const re of [new RegExp(`^\\s*${prefix}\\s+`, "i"), new RegExp(`\\s+${prefix}\\s*$`, "i")]) {
        const rest = trimSep(seg.replace(re, "")).trim();
        // Whole words of the property only — "30 Davies St" under "30 Davies
        // Street" must not leave "St" (Woody, 2026-09-28).
        const first = norm(rest.split(/\s+/)[0] || "");
        if (rest && rest !== seg.trim() && !STREET_WORDS.has(first)) return rest;
      }
    }
    return seg;
  };
  let base = title;
  const segs = split(title);
  if (segs.length > 1) {
    let rest: string | null = null;
    const i = segs.findIndex(sg => isProp(sg.text));
    if (i > 0) {
      // Keep what follows the property unless it's its town ("…, Portsmouth").
      const after = segs.slice(i + 1).filter(sg => !sg.comma && !isPlace(sg.text)).map(sg => trimSep(sg.text).trim()).filter(Boolean);
      rest = [title.slice(0, segs[i].start), ...after].map(v => trimSep(v).trim()).filter(Boolean).join(" – ");
    } else if (i === 0) {
      let j = 1;
      while (j < segs.length - 1 && (isPlace(segs[j].text) || inProp(segs[j].text))) j++;
      rest = title.slice(segs[j].start);
    } else if (isPlace(segs[0].text)) rest = title.slice(segs[1].start);
    else if (isPlace(segs[segs.length - 1].text)) rest = title.slice(0, segs[segs.length - 1].start);
    const out = rest == null ? "" : trimSep(rest).trim();
    if (out) base = out;
  }
  const parts = split(base);
  const rebuilt = parts.map((sg, idx) => (idx ? base.slice(parts[idx - 1].end, sg.start) : "") + stripEnds(sg.text)).join("").trim();
  const result = rebuilt || base;
  const code = result.match(/^([A-Z]{2,5})\s*[–—\-|:·]\s*(.+)$/);
  const tenant = norm(tenantName || "");
  if (code && tenant && norm(code[2]).startsWith(tenant)) return code[2].trim();
  // Nothing left but the property ("62, 64 & 66/66A Pimlico Road – 62, 64 &
  // 66/66A Pimlico Road") — the tenant names the deal.
  // Different building numbers are a different address ("10-12 Chiltern
  // Street" under "23-25 Chiltern Street") — keep those.
  const nums = (v: string) => norm(v).split(" ").filter(w => /^\d+[a-z]?$/.test(w));
  const clash = (v: string) => { const a = nums(v), b = nums(propName); return a.length > 0 && b.length > 0 && !a.some(x => b.includes(x)); };
  if (useTenant && !clash(title) && split(result).every(sg => !trimSep(sg.text).trim() || isProp(sg.text) || inProp(sg.text) || isPlace(sg.text))) return tenantLabel;
  return result;
}

// One deal title for the deal page header, breadcrumb, side panel and Quick
// Access. The property is always shown beside it, so it's stripped — but a
// bare "Unit 3" never identifies the deal: a unit takes its tenant
// ("Nando's · Unit 3"), else the full deal name stays (Woody, 2026-09-28).
export function dealDisplayTitle(d: { name?: string | null; propertyName?: string | null; propertyAddress?: string | null; tenantName?: string | null; unitName?: string | null; isInvestment?: boolean }): string {
  const full = d.name || d.propertyName || "Untitled Deal";
  if (d.isInvestment) return d.propertyName || full;
  const tenant = (d.tenantName || "").trim();
  const unit = (d.unitName || "").trim();
  if (unit && tenant) return `${tenant} · ${unit}`;
  const stripped = d.name && d.propertyName ? stripPropertyFromTitle(d.name, d.propertyName, d.propertyAddress, tenant || null) : full;
  // "Unit 10 (split)" is still bare; "unit 3" reads "Unit 3" beside the
  // tenant (Woody, 2026-09-28).
  const bare = /^(?:(?:unit|shop|suite|kiosk|store|lot|pitch)\s*)?[a-z]{0,2}\s*\d+[a-z]?(?:\s*\([^)]*\))?$/i.test(stripped.trim())
    || (!!unit && stripped.trim().toLowerCase() === unit.toLowerCase());
  const cap = (v: string) => v.trim().replace(/^[a-z]/, c => c.toUpperCase());
  if (bare) return tenant ? `${tenant} · ${cap(stripped)}` : full;
  // The property itself carries the unit ("South Molton - unit 3") and the
  // title is just the property — keep the unit beside the tenant.
  const unitTail = (d.propertyName || "").match(/[\s–—\-|,:·]+((?:unit|shop|suite|kiosk|store|lot|pitch)\s*[a-z]{0,2}\s*\d+[a-z]?)\s*$/i);
  if (tenant && stripped === tenant && unitTail && (d.name || "").toLowerCase().includes(unitTail[1].toLowerCase())) return `${tenant} · ${cap(unitTail[1])}`;
  return stripped;
}
