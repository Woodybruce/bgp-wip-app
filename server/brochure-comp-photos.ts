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

/** The name above the photo (a heading can run over two lines); else below. */
function captionFor(box: { top: number; left: number; width: number; height: number }, texts: Text[]): string | null {
  const overlaps = (t: Text) => t.left < box.left + box.width * 0.6 && t.left + t.width > box.left - 10 && t.left >= box.left - 30;
  const usable = texts.filter((t) => overlaps(t) && !NOT_A_NAME.test(t.text) && /[a-z]/i.test(t.text));
  const above = usable.filter((t) => t.top + t.height <= box.top + 4 && box.top - (t.top + t.height) < Math.max(90, box.height * 0.45))
    .sort((a, b) => b.top - a.top);
  let lines: Text[] = [];
  if (above.length) {
    // Nearest line, then the lines of the same heading directly above it.
    lines = [above[0]];
    for (const t of above.slice(1)) {
      const last = lines[lines.length - 1];
      if (Math.abs(t.size - last.size) < 0.6 && last.top - (t.top + t.height) < last.height * 0.8 && Math.abs(t.left - last.left) < 30) lines.push(t);
      else break;
    }
    lines.reverse();
  } else {
    const below = usable.filter((t) => t.top >= box.top + box.height - 4 && t.top - (box.top + box.height) < 60).sort((a, b) => a.top - b.top);
    if (below.length) lines = [below[0]];
  }
  const caption = lines.map((t) => t.text).join(" ").replace(/\s+/g, " ").trim();
  return caption.length >= 4 ? caption : null;
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
