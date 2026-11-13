// Photos for comparables, straight out of the brochure (Jack, 2026-11-12:
// the 2–4 Bucknall Street comps page had a photo of every building but none
// were picked up). An agent's comps page is a grid of photo + building name;
// poppler's pdftohtml -xml gives every embedded picture and every line of
// text with its position, so each picture is paired with the name printed
// right above it (or, failing that, right below) — by layout, not by an AI
// guessing which building is which. Pages with a chart instead of photos, or
// a flattened scan, give no pictures and the comp asks for an upload.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

export interface PagePhoto { caption: string; buffer: Buffer; mimeType: string; box: { top: number; left: number; width: number; height: number } }

type Text = { top: number; left: number; width: number; height: number; size: number; text: string };

const decode = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => Number((tag.match(new RegExp(`\\b${name}="(-?[\\d.]+)"`)) || [])[1] ?? NaN);
// Table labels and figures are never a building's name.
const NOT_A_NAME = /^(?:(?:date(?: sold)?|status|tenure|size|wault|price(?: achieved)?|niy|cap(?:ital)? val(?:ue)?(?: psf)?|yield|rent|area|sq ?ft|freehold|leasehold|under offer|purchaser|buyer|vendor|seller|location|address|comments?)\b|q\.|£|\d[\d,.\s/%yrs]*$|[a-z]{3,9}[-\s']\d{2,4}$)/i;

/** Every photo on one page of a PDF with the building name printed beside it. */
export async function photosOnPage(pdfBuffer: Buffer, page: number): Promise<PagePhoto[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comp-photos-"));
  try {
    const pdfPath = path.join(dir, `${crypto.randomUUID()}.pdf`);
    fs.writeFileSync(pdfPath, pdfBuffer);
    await execFileAsync("pdftohtml", ["-xml", "-q", "-nodrm", "-f", String(page), "-l", String(page), pdfPath, path.join(dir, "out")], { timeout: 60_000 });
    const xml = fs.readFileSync(path.join(dir, "out.xml"), "utf8");
    const sizes = new Map<string, number>();
    for (const m of Array.from(xml.matchAll(/<fontspec\b[^>]*>/g))) {
      const id = (m[0].match(/\bid="([^"]+)"/) || [])[1];
      if (id) sizes.set(id, attr(m[0], "size"));
    }
    const texts: Text[] = [];
    for (const m of Array.from(xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g))) {
      const text = decode(m[2]);
      if (!text) continue;
      const font = (m[1].match(/\bfont="([^"]+)"/) || [])[1] || "";
      texts.push({ top: attr(m[1], "top"), left: attr(m[1], "left"), width: attr(m[1], "width"), height: attr(m[1], "height"), size: sizes.get(font) ?? 0, text });
    }
    const out: PagePhoto[] = [];
    for (const m of Array.from(xml.matchAll(/<image\b[^>]*>/g))) {
      const tag = m[0];
      const box = { top: attr(tag, "top"), left: attr(tag, "left"), width: attr(tag, "width"), height: attr(tag, "height") };
      // Logos, icons and rules are small; a building photo is not.
      if (!(box.width >= 120 && box.height >= 90)) continue;
      const src = (tag.match(/\bsrc="([^"]+)"/) || [])[1];
      if (!src || !fs.existsSync(src)) continue;
      const caption = captionFor(box, texts);
      if (!caption) continue;
      const buffer = fs.readFileSync(src);
      out.push({ caption, buffer, mimeType: /\.png$/i.test(src) ? "image/png" : "image/jpeg", box });
    }
    return out;
  } catch (e: any) {
    console.warn("[comp-photos] page read failed:", e?.message);
    return [];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The building name printed with the photo — above it (Bucknall) or below
 *  it (Cavendish House page 21, feedback #78). Both sides are read and the
 *  heading wins: the largest text that is not a table label, a figure, a
 *  footnote or a sentence; nearer breaks a tie. A heading may run over two
 *  lines. */
function captionFor(box: { top: number; left: number; width: number; height: number }, texts: Text[]): string | null {
  const overlaps = (t: Text) => t.left < box.left + box.width * 0.85 && t.left + t.width > box.left && t.left >= box.left - 30;
  const heading = (t: Text) => !NOT_A_NAME.test(t.text) && /[a-z]/i.test(t.text) && !/^\*/.test(t.text)
    && t.text.length <= 70 && !/[.!?:]\s*$/.test(t.text);
  const bottom = box.top + box.height;
  type Cand = { t: Text; side: "above" | "below"; gap: number };
  const cands: Cand[] = [];
  for (const t of texts) {
    if (!overlaps(t) || !heading(t)) continue;
    const above = box.top - (t.top + t.height);
    const below = t.top - bottom;
    if (above >= -4 && above < Math.max(90, box.height * 0.45)) cands.push({ t, side: "above", gap: above });
    else if (below >= -4 && below < 70) cands.push({ t, side: "below", gap: below });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => (b.t.size - a.t.size) || (a.gap - b.gap));
  const first = cands[0];
  const sameHeading = (x: Text, y: Text) => Math.abs(x.size - y.size) < 0.6 && Math.abs(x.left - y.left) < 40;
  const lines: Text[] = [first.t];
  const pool = cands.filter((c) => c.side === first.side && c.t !== first.t).map((c) => c.t);
  // The other lines of the same heading, directly above or below a line
  // already taken (line boxes often overlap by a few points).
  const touching = (a: Text, b: Text) => {
    const gap = a.top > b.top ? a.top - (b.top + b.height) : b.top - (a.top + a.height);
    return gap >= -Math.min(a.height, b.height) * 0.5 && gap < Math.max(a.height, b.height) * 0.8;
  };
  for (let added = true; added;) {
    added = false;
    for (const t of pool) {
      if (!lines.includes(t) && lines.some((l) => sameHeading(t, l) && touching(t, l))) { lines.push(t); added = true; }
    }
  }
  lines.sort((a, b) => a.top - b.top);
  const caption = lines.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim();
  // A building's name is short; a run of body text is not a caption.
  return caption.length >= 4 && caption.length <= 90 ? caption : null;
}

/** A brochure wherever it was saved: a chat upload, a property's brochures
 *  (property_brochures) or a tracker row's files (investment_marketing_files)
 *  — by storage key or file name, newest first — so comps filed without
 *  going through chat still get their photos. */
export async function findDocument(ref: string): Promise<{ data: Buffer; originalName: string } | null> {
  const name = String(ref || "").trim();
  if (!name) return null;
  const { chatMediaBuffer } = await import("./letting-tracker-chat");
  const chat = await chatMediaBuffer(name).catch(() => null);
  if (chat) return { data: chat.data, originalName: chat.originalName };
  const { pool } = await import("./db");
  const { getFile } = await import("./file-storage");
  const bare = name.replace(/^.*\//, "");
  const { rows } = await pool.query(
    `SELECT storage_key AS key, original_name AS name, created_at FROM property_brochures
      WHERE COALESCE(archived, false) = false AND (storage_key = $1 OR original_name = $1 OR original_name = $2)
     UNION ALL
     SELECT file_path AS key, file_name AS name, created_at FROM investment_marketing_files
      WHERE file_path = $1 OR file_name = $1 OR file_name = $2
     ORDER BY created_at DESC NULLS LAST LIMIT 1`,
    [name, bare],
  ).catch(() => ({ rows: [] as any[] }));
  if (!rows[0]) return null;
  const f = await getFile(rows[0].key).catch(() => null);
  return f ? { data: f.data, originalName: rows[0].name || f.originalName || bare } : null;
}

/** The photo whose caption names this building, if exactly one does. */
export async function photoForBuilding(pdfBuffer: Buffer, page: number, names: Array<string | null | undefined>, cache?: Map<string, PagePhoto[]>): Promise<PagePhoto | null> {
  const key = `${pdfBuffer.length}:${page}`;
  let photos = cache?.get(key);
  if (!photos) { photos = await photosOnPage(pdfBuffer, page); cache?.set(key, photos); }
  const { buildingMatches } = await import("./investment-sale-evidence");
  const hits = photos.filter((p) => buildingMatches(names, p.caption));
  return hits.length === 1 ? hits[0] : null;
}

/** The photos on a brochure page, paired with the comps already on file
 *  for the buildings they show (Jack, 2026-11-13: The Kodak page 27). Only
 *  the embedded photographs are used, never a crop of a table; no comp is
 *  created and no transaction fact changes. A building with no comp on
 *  file, or more than one different building matching, is reported. */
export async function photosForCompsOnPage(args: { document: string; page: number; apply: boolean; onlyIfNone?: boolean; userId?: string | null }) {
  const { pool } = await import("./db");
  const { sameBuilding, setCompPhoto } = await import("./investment-sale-evidence");
  const doc = await findDocument(args.document);
  if (!doc) return { ok: false, error: `"${args.document}" not found in chat uploads, property brochures or tracker files` };
  const cache = new Map<string, PagePhoto[]>();
  const photos = await photosOnPage(doc.data, args.page);
  cache.set(`${doc.data.length}:${args.page}`, photos);
  const out: Array<{ caption: string; comps: Array<{ id: string; name: string }>; result: string }> = [];
  for (const ph of photos) {
    const words = ph.caption.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !/^(street|road|square|place|house|building|wc\d|ec\d)$/.test(w)).slice(0, 4);
    const { rows } = words.length ? await pool.query(
      `SELECT id, property_name, address, property_id FROM investment_comps WHERE property_name ILIKE ANY($1::text[]) OR address ILIKE ANY($1::text[]) LIMIT 300`,
      [words.map((w) => `%${w}%`)],
    ) : { rows: [] as any[] };
    const comps = rows.filter((c: any) => sameBuilding([ph.caption], [c.property_name, c.address]));
    if (!comps.length) { out.push({ caption: ph.caption, comps: [], result: "no comp on file for this building" }); continue; }
    const done = new Set<string>();
    const results: string[] = [];
    for (const c of comps) {
      const key = c.property_id || c.id;
      if (done.has(key)) continue;
      done.add(key);
      if (!args.apply) { results.push(c.property_id ? "would pin (if the property has no photo)" : "would pin (a property record is made for the comp)"); continue; }
      const r = await setCompPhoto({ compId: c.id, pdfChatMediaFilename: args.document, page: args.page, onlyIfNone: args.onlyIfNone !== false, pageCache: cache, userId: args.userId || null })
        .catch((e: any) => ({ image: "none", note: e?.message || "failed" }));
      results.push(r.image === "pinned" ? "pinned" : r.image === "kept" ? "kept its existing photo" : r.note);
    }
    out.push({ caption: ph.caption, comps: comps.map((c: any) => ({ id: c.id, name: c.property_name })), result: results.join("; ") });
  }
  return { ok: true, applied: args.apply, document: doc.originalName, page: args.page, photosOnPage: photos.length, results: out };
}
