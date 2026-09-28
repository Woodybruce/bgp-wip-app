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
// Nandos") goes when the rest is the tenant (Woody, 2026-09-28).
const TITLE_STOPWORDS = new Set(["the", "and", "of", "at", "on", "in"]);
export function stripPropertyFromTitle(title: string, propName: string, propAddress?: string | null, tenantName?: string | null): string {
  // The title is itself a short form of the property ("Brent Cross") — keep it.
  if (propName.trim().toLowerCase().startsWith(title.trim().toLowerCase())) return title;
  const norm = (v: string) => v.toLowerCase().replace(/[’']/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
  const significant = (n: string) => n.split(" ").some(w => /[a-z]{3,}/.test(w) && !TITLE_STOPWORDS.has(w));
  const prop = norm(propName);
  const addr = ` ${norm(propAddress || "")} `;
  const isProp = (seg: string) => {
    const n = norm(seg);
    return !!n && !!prop && significant(n) && (n === prop || prop.startsWith(`${n} `) || n.startsWith(`${prop} `));
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
    for (const m of t.matchAll(/\s*[–—|·]\s*|\s+-\s*|\s*-\s+|\s*[,:]\s+/g)) {
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
        const rest = seg.replace(re, "").trim();
        if (rest && rest !== seg.trim()) return rest;
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
      while (j < segs.length - 1 && isPlace(segs[j].text)) j++;
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
  return result;
}
