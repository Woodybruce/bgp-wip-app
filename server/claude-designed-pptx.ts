// ─────────────────────────────────────────────────────────────────────────
// Claude-designed PowerPoint — the editable sibling of claude-designed-pdf.
//
// Same brief, same house-style preferences, same BGP palette — but instead
// of HTML→PDF, Claude produces a structured slide SPEC (JSON) and a pure
// pptxgenjs renderer lays it out with real, editable text boxes. The team
// gets two options of one document: the locked designed PDF for sending,
// and this .pptx master for editing. Layout archetypes are deliberately
// fixed (cover / kpis / two-col / table / facts / closing) so the output
// is dependable and everything stays inside the slide.
//
// Google Static Maps in the spec are fetched server-side with the real API
// key and embedded as image data (the model writes keyless URLs — same
// contract as the PDF pipeline's inlineGoogleStaticMaps).
// ─────────────────────────────────────────────────────────────────────────
import * as fs from "fs";
import * as path from "path";
import crypto from "crypto";
import { saveFile } from "./file-storage";
import { preferencesPromptFor } from "./document-preferences";

// Green house palette — mirrors why-buy-pptx.ts / document-templates.ts.
const GREEN = "2E5E3F", GOLD = "C4A35A", DARK = "232323";
const PANEL = "EFEDE6", MUTE = "5A6468", HAIR = "D7DAD3", WHITE = "FFFFFF", INK = "232323", LIGHT = "E7E5DF";
const SERIF = "Georgia", SANS = "Calibri";
const M = 0.5, CW = 13.33 - M * 2;

interface SpecKpi { label: string; value: string }
interface SpecFact { label: string; value: string }
interface SpecSlide {
  kind: "kpis" | "two_col" | "table" | "facts" | "closing";
  label?: string;
  heading: string;
  paragraph?: string;
  kpis?: SpecKpi[];
  leftTitle?: string;
  leftBullets?: string[];
  rightTitle?: string;
  rightBullets?: string[];
  columns?: string[];
  rows?: string[][];
  facts?: SpecFact[];
  calloutTitle?: string;
  callout?: string;
  mapImageUrl?: string;
}
interface DeckSpec {
  title: string;
  subtitle?: string;
  thesis?: string;
  preparedFor?: string;
  coverKpis?: SpecKpi[];
  slides: SpecSlide[];
}

const SPEC_PROMPT = `You are structuring a polished investor/client deck for Bruce Gillingham Pollard (BGP), a UK commercial property advisor. Turn the brief into a slide SPEC — a JSON object the deterministic renderer lays out in BGP house style.

Return ONLY a JSON object, no markdown fences, no commentary:
{
  "title": string,                       // cover headline (property / subject name)
  "subtitle": string,                    // one line under it (address / context)
  "thesis": string?,                     // italic one-liner selling the idea
  "preparedFor": string?,
  "coverKpis": [{"label": string, "value": string}],   // up to 5 headline numbers
  "slides": [                            // 3 to 8 content slides
    {
      "kind": "kpis" | "two_col" | "table" | "facts" | "closing",
      "label": string,                   // small uppercase eyebrow, e.g. "THE CASE"
      "heading": string,
      "paragraph": string?,              // optional intro under the heading (≤ 320 chars)
      "kpis": [{"label","value"}]?,      // kind=kpis — up to 5 stat tiles
      "leftTitle": string?, "leftBullets": [string]?,   // kind=two_col — ≤ 6 bullets/side, ≤ 140 chars each
      "rightTitle": string?, "rightBullets": [string]?,
      "columns": [string]?, "rows": [[string]]?,        // kind=table — ≤ 6 columns, ≤ 9 rows
      "facts": [{"label","value"}]?,     // kind=facts — ≤ 10 label/value rows
      "calloutTitle": string?, "callout": string?,      // bottom accent panel (≤ 260 chars)
      "mapImageUrl": string?             // Google Static Maps URL — maptype=hybrid, NO key parameter (the server injects it); only when locations matter
    }
  ]
}

Rules:
- Every content item must fit its slide — the budgets above are hard caps, trim rather than overflow.
- Numbers carry the story: prefer a kpis or facts slide over prose. Keep prose tight and factual.
- Use a closing slide last (next steps / asks as leftBullets, contact line as callout).
- British English, £ figures, no invented data — only what the brief supports.`;

function logoPath(): string | null {
  const p = path.join(process.cwd(), "server", "assets", "branding", "BGP_WhiteWordmark_trimmed.png");
  return fs.existsSync(p) ? p : null;
}

// Same key-injection + hybrid-default contract as the PDF pipeline.
async function fetchStaticMapData(rawUrl: string): Promise<string | null> {
  try {
    const u = new URL(rawUrl.replace(/&amp;/g, "&"));
    if (!/maps\.googleapis\.com/.test(u.hostname)) return null;
    const key = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
    if (key) u.searchParams.set("key", key);
    if (!u.searchParams.get("maptype")) u.searchParams.set("maptype", "hybrid");
    const resp = await fetch(u.toString(), { signal: AbortSignal.timeout(20000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const mime = resp.headers.get("content-type")?.split(";")[0] || "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function specFromClaude(prompt: string): Promise<DeckSpec> {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY
    ? process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
    : undefined;
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  const { DESIGN_MODEL } = await import("./doc-engine");
  const model: string = DESIGN_MODEL;
  const params: any = { model, max_tokens: 8000, messages: [{ role: "user", content: prompt }] };
  const isFable = model.startsWith("claude-fable");
  if (isFable) {
    params.betas = ["server-side-fallback-2026-06-01"];
    params.fallbacks = [{ model: "claude-opus-4-8" }];
  }
  const msg: any = isFable ? await (client as any).beta.messages.create(params) : await client.messages.create(params);
  if (msg?.stop_reason === "refusal") throw new Error("Design model declined the request (safety refusal)");
  const raw: string = (msg?.content || []).find((b: any) => b.type === "text")?.text || "";
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Design model returned no JSON spec");
  const spec = JSON.parse(raw.slice(start, end + 1)) as DeckSpec;
  if (!spec.title || !Array.isArray(spec.slides) || spec.slides.length === 0) {
    throw new Error("Spec missing title or slides");
  }
  return spec;
}

export async function renderDeckSpecToPptx(spec: DeckSpec): Promise<Buffer> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.author = "Bruce Gillingham Pollard";
  pptx.company = "Bruce Gillingham Pollard";
  pptx.title = spec.title;
  pptx.layout = "LAYOUT_WIDE";
  const R = pptx.ShapeType.rect;
  const logo = logoPath();

  const header = (s: any, label: string, heading: string) => {
    s.background = { color: WHITE };
    s.addShape(R, { x: 0, y: 0, w: 13.33, h: 1.05, fill: { color: GREEN } });
    s.addShape(R, { x: 0, y: 1.05, w: 13.33, h: 0.05, fill: { color: GOLD } });
    if (logo) s.addImage({ path: logo, x: 11.85, y: 0.32, w: 1.0, h: 0.35 });
    s.addText((label || "BGP").toUpperCase(), { x: M, y: 0.18, w: 9, h: 0.28, fontFace: SANS, fontSize: 10, color: GOLD, charSpacing: 3 });
    s.addText(heading, { x: M, y: 0.46, w: 10.4, h: 0.5, fontFace: SERIF, fontSize: 23, color: WHITE });
  };
  const bullets = (s: any, items: string[], x: number, y: number, w: number, h: number, fs = 13) =>
    items.length && s.addText(items.slice(0, 6).map((t) => ({ text: String(t), options: { bullet: { characterCode: "2014" }, fontFace: SANS, fontSize: fs, color: INK, paraSpaceAfter: 6 } })),
      { x, y, w, h, valign: "top", lineSpacingMultiple: 1.1 });
  const factRows = (s: any, rows: SpecFact[], x: number, y: number, w: number, step = 0.46, fs = 13) =>
    rows.forEach((f, i) => {
      const yy = y + i * step;
      s.addText(String(f.label || "").toUpperCase(), { x, y: yy, w: w * 0.42, h: step, fontFace: SANS, fontSize: 9.5, color: MUTE, charSpacing: 0.6, valign: "middle" });
      s.addText(String(f.value || ""), { x: x + w * 0.42, y: yy, w: w * 0.58, h: step, fontFace: SANS, fontSize: fs, color: INK, bold: true, valign: "middle" });
    });
  const sub = (s: any, t: string, x: number, y: number, color = GOLD) =>
    t && s.addText(t.toUpperCase(), { x, y, w: 6, h: 0.3, fontFace: SANS, fontSize: 11, color, bold: true, charSpacing: 1.5 });
  const calloutPanel = (s: any, title: string | undefined, text: string) => {
    s.addShape(R, { x: M, y: 5.35, w: CW, h: 1.35, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
    sub(s, title || "In short", M + 0.2, 5.48, GREEN);
    s.addText(text, { x: M + 0.2, y: 5.82, w: CW - 0.4, h: 0.8, fontFace: SANS, fontSize: 12.5, color: MUTE, valign: "top", lineSpacingMultiple: 1.2 });
  };

  // COVER
  let s = pptx.addSlide();
  s.background = { color: DARK };
  s.addShape(R, { x: 0, y: 4.5, w: 13.33, h: 3.0, fill: { color: GREEN } });
  s.addShape(R, { x: 0, y: 4.5, w: 13.33, h: 0.06, fill: { color: GOLD } });
  if (logo) s.addImage({ path: logo, x: 10.35, y: 0.5, w: 2.45, h: 0.86 });
  s.addShape(R, { x: M, y: 1.85, w: 1.7, h: 0.06, fill: { color: GOLD } });
  s.addText("BRUCE GILLINGHAM POLLARD", { x: M, y: 2.0, w: 9, h: 0.4, fontFace: SANS, fontSize: 14, color: GOLD, charSpacing: 5 });
  s.addText(spec.title, { x: M - 0.03, y: 2.4, w: 12.2, h: 0.95, fontFace: SERIF, fontSize: 40, color: WHITE });
  if (spec.subtitle) s.addText(spec.subtitle, { x: M, y: 3.32, w: 12, h: 0.4, fontFace: SANS, fontSize: 18, color: LIGHT });
  if (spec.thesis) s.addText(spec.thesis, { x: M, y: 3.78, w: 12.2, h: 0.5, fontFace: SERIF, fontSize: 15, italic: true, color: GOLD });
  (spec.coverKpis || []).slice(0, 5).forEach((f, i) => {
    const n = Math.min((spec.coverKpis || []).length, 5), x = M + i * (CW / n);
    s.addText(String(f.label || "").toUpperCase(), { x, y: 4.9, w: CW / n - 0.15, h: 0.28, fontFace: SANS, fontSize: 9.5, color: GOLD, charSpacing: 2 });
    s.addText(String(f.value || ""), { x, y: 5.18, w: CW / n - 0.15, h: 0.5, fontFace: SERIF, fontSize: 22, color: WHITE });
  });
  if (spec.preparedFor) s.addText(spec.preparedFor.toUpperCase(), { x: M, y: 6.7, w: 11, h: 0.3, fontFace: SANS, fontSize: 10, color: LIGHT, charSpacing: 3 });

  // CONTENT SLIDES
  for (const slide of spec.slides.slice(0, 8)) {
    s = pptx.addSlide();
    header(s, slide.label || "", slide.heading || "");
    let y = 1.3;
    // Map on the right half when supplied — content packs into the left.
    const mapData = slide.mapImageUrl && slide.kind !== "table" ? await fetchStaticMapData(slide.mapImageUrl) : null;
    const contentW = mapData ? CW / 2 - 0.2 : CW;
    if (mapData) {
      s.addImage({ data: mapData, x: M + CW / 2, y: 1.3, w: CW / 2 - 0.2, h: 3.9 });
      s.addText("Imagery © Google", { x: M + CW / 2, y: 5.22, w: CW / 2 - 0.2, h: 0.25, fontFace: SANS, fontSize: 8, color: MUTE, align: "right" });
    }
    if (slide.paragraph) {
      s.addText(slide.paragraph, { x: M, y, w: contentW, h: 0.85, fontFace: SANS, fontSize: 13.5, color: INK, lineSpacingMultiple: 1.18, valign: "top" });
      y += 1.0;
    }
    if (slide.kind === "kpis") {
      const kpis = (slide.kpis || []).slice(0, 5);
      kpis.forEach((k, i) => {
        const n = kpis.length || 1, w = (contentW - 0.6) / n, x = M + i * (w + 0.15);
        s.addShape(R, { x, y, w, h: 1.3, fill: { color: PANEL }, line: { color: HAIR, width: 1 } });
        s.addText(String(k.value || ""), { x, y: y + 0.12, w, h: 0.7, fontFace: SERIF, fontSize: 25, color: GREEN, align: "center" });
        s.addText(String(k.label || "").toUpperCase(), { x, y: y + 0.88, w, h: 0.32, fontFace: SANS, fontSize: 9, color: MUTE, align: "center", charSpacing: 1 });
      });
      y += 1.55;
      if (slide.leftBullets?.length) bullets(s, slide.leftBullets, M, y, contentW, 5.1 - y);
    } else if (slide.kind === "two_col") {
      const colW = mapData ? contentW : CW / 2 - 0.2;
      sub(s, slide.leftTitle || "", M, y);
      bullets(s, slide.leftBullets || [], M, y + 0.32, colW, 4.9 - y);
      if (!mapData) {
        sub(s, slide.rightTitle || "", M + CW / 2, y);
        bullets(s, slide.rightBullets || [], M + CW / 2, y + 0.32, CW / 2 - 0.2, 4.9 - y);
      } else if (slide.rightBullets?.length) {
        // Map occupies the right — fold right-column content under the left.
        bullets(s, slide.rightBullets, M, y + 2.4, colW, 2.4);
      }
    } else if (slide.kind === "table") {
      const cols = (slide.columns || []).slice(0, 6);
      const rows = (slide.rows || []).slice(0, 9).map(r => r.slice(0, cols.length));
      if (cols.length && rows.length) {
        const head = cols.map((t) => ({ text: String(t), options: { fill: { color: GREEN }, color: WHITE, bold: true, fontFace: SANS, fontSize: 12, valign: "middle" } }));
        const body = rows.map((r, ri) => r.map((v) => ({ text: String(v ?? ""), options: { fill: { color: ri % 2 ? "F2F0E8" : WHITE }, color: INK, fontFace: SANS, fontSize: 11.5, valign: "middle" } })));
        s.addTable([head, ...body] as any, { x: M, y, w: CW, rowH: 0.42, border: { type: "solid", color: HAIR, pt: 1 }, valign: "middle" });
      }
    } else if (slide.kind === "facts") {
      const rows = (slide.facts || []).slice(0, 10);
      const half = Math.ceil(rows.length / 2);
      if (mapData) {
        factRows(s, rows.slice(0, 8), M, y, contentW);
      } else {
        factRows(s, rows.slice(0, half), M, y, CW / 2);
        factRows(s, rows.slice(half), M + CW / 2 + 0.2, y, CW / 2 - 0.2);
      }
    } else { // closing
      sub(s, slide.leftTitle || "Next steps", M, y);
      bullets(s, slide.leftBullets || [], M, y + 0.32, contentW, 3.4);
    }
    if (slide.callout) calloutPanel(s, slide.calloutTitle, slide.callout);
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return out as Buffer;
}

export interface DesignedPptxArgs {
  title: string;
  brief: string;
  scope?: string;
  additionalInstructions?: string;
}

export async function generateClaudeDesignedPptx(args: DesignedPptxArgs): Promise<
  { success: true; title: string; downloadUrl: string; chatMediaFilename: string; downloadMarkdown: string; message: string } | { error: string }
> {
  if (!args.title || !args.brief) return { error: "title and brief are required" };
  const scope = args.scope || "why_buy";
  const housePrefs = await preferencesPromptFor(scope).catch(() => "");
  const prompt = [
    SPEC_PROMPT,
    housePrefs ? `\n${housePrefs}` : "",
    args.additionalInstructions ? `\nAdditional notes:\n${args.additionalInstructions}` : "",
    `\n--- BRIEF ---\n\n${args.brief}`,
  ].join("");

  const spec = await specFromClaude(prompt);
  const buf = await renderDeckSpecToPptx(spec);

  const safeTitle = args.title.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 80) || "BGP_Deck";
  const storageFilename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeTitle}.pptx`;
  const displayName = `${args.title}.pptx`;
  await saveFile(`chat-media/${storageFilename}`, buf, "application/vnd.openxmlformats-officedocument.presentationml.presentation", displayName);
  const downloadUrl = `/api/chat-media/${storageFilename}`;
  return {
    success: true,
    title: args.title,
    downloadUrl,
    chatMediaFilename: storageFilename,
    downloadMarkdown: `[Download ${displayName}](${downloadUrl})`,
    message: `Editable PowerPoint "${args.title}" generated (BGP house style, ${spec.slides.length + 1} slides).`,
  };
}
