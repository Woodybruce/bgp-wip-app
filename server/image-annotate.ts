/**
 * Deterministic drawing annotation — back-end for ChatBGP's `annotate_image`.
 *
 * Woody, 2026-09-21: "Can you mark the uses on the plans? And then add the
 * areas on the plans?" ChatBGP tried the AI image editor and rightly refused
 * to ship the result: generative editors regenerate the sheet at ~1–1.5k px
 * and redraw the linework, so title blocks and grid references come back
 * garbled. This module composites crisp labels, legend and area boxes onto
 * the ORIGINAL pixels at native resolution with a 2D canvas — no model in
 * the loop, nothing under the labels is touched.
 *
 * Sources: an Image Studio original, a chat upload (PNG/JPG or a PDF page
 * rendered at 200 dpi), an https image/PDF, or an RBKC register drawing.
 * Text renders with the Liberation Sans TTFs that pdfjs-dist ships, so the
 * output is identical on Railway (no system fonts) and locally.
 */
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { getFile, saveFile, findChatMediaByOriginalName } from "./file-storage";
import { rasterisePdfPageBuffer } from "./pdf-raster";

const BORDEAUX = "#6E0C25";
const INK = "#1D1D1B";
const WHITE = "#FFFFFF";
const BLUSH = "#E4D8D3";
const SQM_TO_SQFT = 10.7639;

export interface AnnotateLabel {
  text: string;
  /** fractions of the image, origin top-left */
  x: number; y: number;
  size?: "sm" | "md" | "lg" | "xl";
  align?: "center" | "left";
  colour?: "ink" | "bordeaux" | "white";
  /** default true — white rounded plate behind the text so it reads over hatching */
  plate?: boolean;
}
export interface AnnotateBox {
  x: number; y: number;
  /** fraction of image width; default sized to content, max 0.4 */
  w?: number;
  title?: string;
  lines: string[];
  size?: "sm" | "md" | "lg";
  anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}
export interface AnnotateLegend {
  x: number; y: number;
  title?: string;
  items: Array<{ colour: string; label: string }>;
  anchor?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
}
export interface AnnotateArgs {
  source: { imageStudioId?: string; chatMediaFilename?: string; url?: string };
  page?: number;
  labels?: AnnotateLabel[];
  boxes?: AnnotateBox[];
  legend?: AnnotateLegend;
  /** PDF drawings only: measure the tinted fill regions and label each with its area (needs the drawn scale). */
  autoAreaLabels?: boolean;
  /** Names for the auto area labels, keyed by fill colour hex (e.g. {"#aaddd6":"Retail / restaurant"}). */
  areaNames?: Record<string, string>;
  fileName?: string;
  output?: "png" | "pdf" | "both";
  /** Internal (tests): return the PNG bytes instead of saving to chat-media. */
  _returnBuffer?: boolean;
}

type FontKit = { regular: string; bold: string };
let fontsReady: FontKit | null = null;
async function ensureFonts(): Promise<FontKit> {
  if (fontsReady) return fontsReady;
  const { GlobalFonts } = await import("@napi-rs/canvas") as any;
  const dir = path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts");
  const reg = path.join(dir, "LiberationSans-Regular.ttf");
  const bold = path.join(dir, "LiberationSans-Bold.ttf");
  let regular = "sans-serif", strong = "sans-serif";
  try {
    if (fs.existsSync(reg)) { GlobalFonts.registerFromPath(reg, "BGPSans"); regular = "BGPSans"; }
    if (fs.existsSync(bold)) { GlobalFonts.registerFromPath(bold, "BGPSansBold"); strong = "BGPSansBold"; }
  } catch (e: any) { console.warn(`[annotate] font registration failed: ${e?.message}`); }
  fontsReady = { regular, bold: strong };
  return fontsReady;
}

async function loadSource(args: AnnotateArgs): Promise<{ image: Buffer; mime: string; pdf?: Buffer; name: string; page?: number }> {
  const src = (args.source || {}) as AnnotateArgs["source"] & { _bytes?: Buffer; _mime?: string; _name?: string };
  let bytes: Buffer | null = null; let name = "image"; let mime = "image/png";
  if (src._bytes) {
    // Internal (tests): bytes supplied directly, no storage round-trip.
    bytes = src._bytes; mime = src._mime || "application/pdf"; name = src._name || name;
  } else if (src.imageStudioId) {
    const { pool } = await import("./db");
    const { readPersistedImage } = await import("./image-studio");
    const r = await pool.query("SELECT local_path, mime_type, file_name FROM image_studio_images WHERE id = $1", [src.imageStudioId]);
    if (!r.rows[0]) throw new Error("Image not found in Image Studio");
    bytes = await readPersistedImage(r.rows[0].local_path);
    if (!bytes) throw new Error("The Image Studio original is missing from storage — re-capture the page first");
    mime = r.rows[0].mime_type || "image/png"; name = r.rows[0].file_name || name;
  } else if (src.chatMediaFilename || (src.url && /chat-media/.test(src.url))) {
    const bare = String(src.chatMediaFilename || src.url).replace(/^.*\/api\/chat-media\//, "").replace(/^chat-media\//, "").trim();
    const f = (await getFile(`chat-media/${bare}`)) || (await findChatMediaByOriginalName(bare));
    if (!f) throw new Error(`Chat upload not found: ${bare}`);
    bytes = f.data; mime = f.contentType || mime; name = f.originalName || bare;
  } else if (src.url) {
    const { isRbkcPublisherDocUrl, downloadRbkcPublisherUrl } = await import("./rbkc-planning");
    if (isRbkcPublisherDocUrl(src.url)) {
      bytes = await downloadRbkcPublisherUrl(src.url);
      if (!bytes) throw new Error("Couldn't fetch that drawing from the RBKC register — list the documents again and retry");
      mime = "application/pdf"; name = "rbkc-drawing.pdf";
    } else {
      if (!/^https:\/\//i.test(src.url)) throw new Error("url must be https://, a chat-media path or an RBKC register link");
      const res = await fetch(src.url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
      bytes = Buffer.from(await res.arrayBuffer()); mime = res.headers.get("content-type")?.split(";")[0] || mime; name = src.url.split("/").pop() || name;
    }
  } else throw new Error("Provide source.imageStudioId, source.chatMediaFilename or source.url");

  if (mime.includes("pdf") || bytes.subarray(0, 4).toString("latin1") === "%PDF") {
    const page = Math.max(1, Math.floor(args.page || 1));
    const r = await rasterisePdfPageBuffer(bytes, page, { targetDpi: 200, maxSide: 7000, format: "png" });
    return { image: r.buffer, mime: "image/png", pdf: bytes, name: name.replace(/\.pdf$/i, ""), page };
  }
  return { image: bytes, mime, name: name.replace(/\.(png|jpe?g|webp)$/i, "") };
}

function fontPx(size: string | undefined, width: number, base = 0.014): number {
  const mult = size === "sm" ? 0.72 : size === "lg" ? 1.45 : size === "xl" ? 2.1 : 1;
  return Math.max(12, Math.round(width * base * mult));
}

function wrap(ctx: any, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(text).split(/\n/)) {
    const words = para.split(/\s+/).filter(Boolean); let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
    }
    out.push(cur);
  }
  return out;
}

function roundRect(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

function anchored(x: number, y: number, w: number, h: number, anchor: string | undefined, W: number, H: number) {
  let px = x * W, py = y * H;
  if (anchor?.includes("right")) px -= w;
  if (anchor?.includes("bottom")) py -= h;
  return { px: Math.max(0, Math.min(W - w, px)), py: Math.max(0, Math.min(H - h, py)) };
}

export async function annotateImage(args: AnnotateArgs): Promise<any> {
  const { image, pdf, name, page } = await loadSource(args);
  const fonts = await ensureFonts();
  const { createCanvas, loadImage } = await import("@napi-rs/canvas") as any;
  const img = await loadImage(image);
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H); const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const placed: any[] = [];
  const notes: string[] = [];
  const pad = Math.round(W * 0.006);

  const drawLabel = (l: AnnotateLabel) => {
    const px = fontPx(l.size, W);
    ctx.font = `${px}px ${fonts.bold}`;
    ctx.textBaseline = "middle";
    const lines = wrap(ctx, l.text, W * 0.38);
    const lineH = px * 1.22;
    const tw = Math.max(...lines.map((s) => ctx.measureText(s).width));
    const bw = tw + pad * 2.2, bh = lineH * lines.length + pad * 1.4;
    const cx = l.x * W, cy = l.y * H;
    const bx = l.align === "left" ? cx : cx - bw / 2, by = cy - bh / 2;
    if (l.plate !== false) {
      ctx.fillStyle = "rgba(255,255,255,0.92)"; roundRect(ctx, bx, by, bw, bh, pad); ctx.fill();
      ctx.lineWidth = Math.max(1, W * 0.0008); ctx.strokeStyle = l.colour === "white" ? INK : BORDEAUX; ctx.stroke();
    }
    ctx.fillStyle = l.colour === "bordeaux" ? BORDEAUX : l.colour === "white" ? WHITE : INK;
    ctx.textAlign = l.align === "left" ? "left" : "center";
    lines.forEach((s, i) => ctx.fillText(s, l.align === "left" ? bx + pad * 1.1 : cx, by + pad * 0.7 + lineH * (i + 0.5)));
    placed.push({ type: "label", text: l.text, x: l.x, y: l.y });
  };

  const drawBox = (b: AnnotateBox) => {
    const px = fontPx(b.size, W, 0.012);
    const titlePx = Math.round(px * 1.15);
    const maxW = (b.w ? b.w * W : W * 0.32) - pad * 2.4;
    ctx.font = `${px}px ${fonts.regular}`;
    const bodyLines = b.lines.flatMap((s) => wrap(ctx, s, maxW));
    const lineH = px * 1.35;
    ctx.font = `${titlePx}px ${fonts.bold}`;
    const titleLines = b.title ? wrap(ctx, b.title, maxW) : [];
    const contentW = Math.max(
      ...titleLines.map((s) => { ctx.font = `${titlePx}px ${fonts.bold}`; return ctx.measureText(s).width; }),
      ...bodyLines.map((s) => { ctx.font = `${px}px ${fonts.regular}`; return ctx.measureText(s).width; }),
      px * 6,
    );
    const bw = (b.w ? b.w * W : contentW + pad * 2.4);
    const bh = pad * 2.2 + titleLines.length * titlePx * 1.3 + (titleLines.length ? pad * 0.9 : 0) + bodyLines.length * lineH;
    const { px: bx, py: by } = anchored(b.x, b.y, bw, bh, b.anchor, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.96)"; roundRect(ctx, bx, by, bw, bh, pad); ctx.fill();
    ctx.lineWidth = Math.max(1.5, W * 0.0012); ctx.strokeStyle = BORDEAUX; ctx.stroke();
    // bordeaux top rule, house style
    ctx.fillStyle = BORDEAUX; ctx.fillRect(bx, by, bw, Math.max(3, W * 0.0018));
    let y = by + pad * 1.4;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.font = `${titlePx}px ${fonts.bold}`; ctx.fillStyle = BORDEAUX;
    for (const s of titleLines) { ctx.fillText(s, bx + pad * 1.2, y); y += titlePx * 1.3; }
    if (titleLines.length) { ctx.fillStyle = BLUSH; ctx.fillRect(bx + pad * 1.2, y + pad * 0.2, bw - pad * 2.4, Math.max(1, W * 0.0006)); y += pad * 0.9; }
    ctx.font = `${px}px ${fonts.regular}`; ctx.fillStyle = INK;
    for (const s of bodyLines) { ctx.fillText(s, bx + pad * 1.2, y); y += lineH; }
    placed.push({ type: "box", title: b.title, lines: b.lines.length, x: b.x, y: b.y });
  };

  const drawLegend = (lg: AnnotateLegend) => {
    const px = fontPx("md", W, 0.011);
    const sw = px * 1.2;
    ctx.font = `${px}px ${fonts.regular}`;
    const labelW = Math.max(...lg.items.map((it) => ctx.measureText(it.label).width), lg.title ? (ctx.font = `${Math.round(px * 1.1)}px ${fonts.bold}`, ctx.measureText(lg.title).width) : 0);
    const bw = sw + pad * 1.2 + labelW + pad * 2.6;
    const rowH = px * 1.6;
    const bh = pad * 2 + (lg.title ? px * 1.5 + pad * 0.6 : 0) + rowH * lg.items.length;
    const { px: bx, py: by } = anchored(lg.x, lg.y, bw, bh, lg.anchor, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.96)"; roundRect(ctx, bx, by, bw, bh, pad); ctx.fill();
    ctx.lineWidth = Math.max(1, W * 0.0008); ctx.strokeStyle = BORDEAUX; ctx.stroke();
    let y = by + pad;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    if (lg.title) { ctx.font = `${Math.round(px * 1.1)}px ${fonts.bold}`; ctx.fillStyle = BORDEAUX; ctx.fillText(lg.title, bx + pad * 1.3, y); y += px * 1.5 + pad * 0.6; }
    ctx.font = `${px}px ${fonts.regular}`;
    for (const it of lg.items) {
      ctx.fillStyle = it.colour; ctx.fillRect(bx + pad * 1.3, y + (rowH - sw) / 2, sw, sw);
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(bx + pad * 1.3, y + (rowH - sw) / 2, sw, sw);
      ctx.fillStyle = INK; ctx.fillText(it.label, bx + pad * 1.3 + sw + pad * 1.2, y + (rowH - px) / 2);
      y += rowH;
    }
    placed.push({ type: "legend", items: lg.items.length, x: lg.x, y: lg.y });
  };

  // ── Auto area labels from the drawn scale (PDF sources only) ─────────
  let measured: any | undefined;
  if (args.autoAreaLabels) {
    if (!pdf) notes.push("autoAreaLabels needs a PDF source (the drawn scale and fills come from the vector sheet); skipped for a raster image.");
    else {
      const { measurePlanFromBuffer } = await import("./plan-measure");
      const m = await measurePlanFromBuffer(pdf, `${name}.pdf`, { source: {}, page: page || 1, fills: true });
      measured = { scale: m.scale?.stated, title: m.title, drawingNumber: m.drawingNumber, regions: (m.fillRegions || []).filter((f: any) => !f.inTitleStrip && f.sqm && f.sqm >= 5) };
      if (!m.calibration) notes.push("No drawn scale on the sheet — area labels skipped. Pass the areas as labels/boxes instead, or give measure_plan a scale.");
      else {
        const legendItems: Array<{ colour: string; label: string }> = [];
        const biggest = Math.max(...measured.regions.map((r: any) => r.sqm));
        const skipped: string[] = [];
        // Labels sit on the centroid of each region's main polygon (a point
        // on the fill, not the bbox centre) and are nudged down when they
        // would overlap an earlier label.
        const taken: Array<{ x: number; y: number; w: number; h: number }> = [];
        const size = measured.regions.length > 2 ? "md" : "lg";
        const approxH = (fontPx(size, W) * 1.22 * 2 + pad * 1.4) / H;
        const approxW = 0.16;
        for (const r of measured.regions) {
          const nm = args.areaNames?.[r.colour] || args.areaNames?.[r.colour.toUpperCase()] || "";
          // Unnamed slivers (< 8% of the main region) are key swatches or
          // overlays, not demise — leave them off the sheet, list them in output.
          if (!nm && r.sqm < biggest * 0.08) { skipped.push(`${r.colour} ${Math.round(r.sqm)} m²`); continue; }
          let cx = r.centroidFraction?.x ?? (r.bboxFraction.x + r.bboxFraction.w / 2);
          let cy = r.centroidFraction?.y ?? (r.bboxFraction.y + r.bboxFraction.h / 2);
          for (let tries = 0; tries < 8; tries++) {
            const clash = taken.find((t) => Math.abs(t.x - cx) < (t.w + approxW) / 2 && Math.abs(t.y - cy) < (t.h + approxH) / 2);
            if (!clash) break;
            cy = clash.y + (clash.h + approxH) / 2 + 0.004;
          }
          taken.push({ x: cx, y: cy, w: approxW, h: approxH });
          drawLabel({ text: `${nm ? nm + "\n" : ""}${Math.round(r.sqm).toLocaleString("en-GB")} m²  ·  ${Math.round(r.sqft).toLocaleString("en-GB")} sq ft`, x: cx, y: cy, size });
          legendItems.push({ colour: r.colour, label: `${nm || "Shaded area"} — ${Math.round(r.sqm).toLocaleString("en-GB")} m² / ${Math.round(r.sqft).toLocaleString("en-GB")} sq ft` });
        }
        if (!args.legend && legendItems.length) drawLegend({ x: 0.012, y: 0.988, anchor: "bottom-left", title: `${m.title || "Areas"} · scaled from ${m.scale?.stated || "the drawing"} · approximate`, items: legendItems });
        if (skipped.length) notes.push(`Small unnamed tints left unlabelled (key swatches / overlays): ${skipped.join(", ")} — give them a name in areaNames if they are real areas.`);
        notes.push("Area labels sit on each region's main polygon; pass explicit labels with x/y to move any. Keep boxes/legends out of the title strip (x > 0.78) unless you mean to cover it.");
      }
    }
  }

  for (const l of args.labels || []) drawLabel(l);
  for (const b of args.boxes || []) drawBox(b);
  if (args.legend) drawLegend(args.legend);

  // ── Save ──────────────────────────────────────────────────────────────
  const png: Buffer = canvas.toBuffer("image/png");
  if (args._returnBuffer) return { width: W, height: H, placed, notes, measured, png };
  const safe =(args.fileName || `${name}${page ? ` p${page}` : ""} annotated`).replace(/[^a-zA-Z0-9-_ .()]/g, "").trim().replace(/\s+/g, "_").slice(0, 70) || "annotated";
  const stamp = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const out: any = { width: W, height: H, placed, notes, ...(measured ? { measured } : {}) };
  const want = args.output || "png";
  if (want !== "pdf") {
    const f = `${stamp}-${safe}.png`;
    await saveFile(`chat-media/${f}`, png, "image/png", `${safe}.png`);
    out.downloadUrl = `/api/chat-media/${f}`; out.chatMediaFilename = f;
  }
  if (want !== "png") {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    // Page sized to the image at 200 dpi → an A1 render comes back as A1.
    const ptW = (W / 200) * 72, ptH = (H / 200) * 72;
    const pg = doc.addPage([ptW, ptH]);
    const emb = await doc.embedPng(png);
    pg.drawImage(emb, { x: 0, y: 0, width: ptW, height: ptH });
    const bytes = Buffer.from(await doc.save());
    const f = `${stamp}-${safe}.pdf`;
    await saveFile(`chat-media/${f}`, bytes, "application/pdf", `${safe}.pdf`);
    out.pdfDownloadUrl = `/api/chat-media/${f}`; out.pdfChatMediaFilename = f;
  }
  out.message = `Annotated at native ${W}×${H} — labels composited over the original pixels, nothing redrawn. Give the user the download link${out.pdfDownloadUrl ? "s" : ""} and describe what was placed.`;
  return out;
}
