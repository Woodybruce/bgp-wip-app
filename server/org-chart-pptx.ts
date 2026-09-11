// Org chart → editable PowerPoint. Renders a role hierarchy as the classic
// connected-boxes tree (boxes + elbow connector lines), which generate_pptx's
// table-based slides can't do. Every box is a real shape and every name a real
// text box, so the chart stays fully editable in PowerPoint.
import PptxGenJSImport from "pptxgenjs";
import { fixPptxSchemaViolations } from "./pptx-rectify";
const PptxGenJS: any = (PptxGenJSImport as any)?.default || PptxGenJSImport;

export interface OrgNode {
  name: string;          // person or role holder ("Woody", "TBC")
  role?: string;         // function/title ("Managing Director", "Finance")
  support?: string[];    // supporting team names listed under the lead
  children?: OrgNode[];
}

const W = 13.33, H = 7.5, MX = 0.5;
const CW = W - MX * 2;
const DARK = "232323", MUTE = "777777", LINE = "9A9A9A", PAPER = "FFFFFF";

const clean = (v: any): string =>
  String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]/g, "").trim();

interface Placed { node: OrgNode; depth: number; x: number; w: number; h: number; y: number; children: Placed[] }

function leafUnits(n: OrgNode): number {
  if (!n.children?.length) return 1;
  return n.children.reduce((a, c) => a + leafUnits(c), 0);
}
function depthOf(n: OrgNode): number {
  if (!n.children?.length) return 1;
  return 1 + Math.max(...n.children.map(depthOf));
}

export async function buildOrgChartPptx(opts: { title: string; tree: OrgNode; notes?: string[] }): Promise<Buffer> {
  const p = new PptxGenJS();
  p.layout = "LAYOUT_WIDE";
  p.author = "Bruce Gillingham Pollard";
  p.company = "Bruce Gillingham Pollard";
  p.title = clean(opts.title) || "Organisation Chart";

  const s = p.addSlide();
  s.addText("BRUCE GILLINGHAM POLLARD", { x: MX, y: 0.22, w: 6, h: 0.3, fontSize: 11, color: MUTE, fontFace: "Calibri", bold: true, charSpacing: 2 });
  s.addText(clean(opts.title) || "Organisation Chart", { x: MX, y: 0.5, w: CW, h: 0.55, fontSize: 24, color: DARK, fontFace: "Calibri", bold: true });

  const units = Math.max(leafUnits(opts.tree), 1);
  const depth = Math.max(depthOf(opts.tree), 1);
  const gapX = units > 8 ? 0.12 : 0.25;
  const boxW = Math.max(0.9, Math.min(2.4, (CW - (units - 1) * gapX) / units));
  const nameSize = boxW < 1.3 ? 9 : boxW < 1.8 ? 10.5 : 12;
  const roleSize = boxW < 1.3 ? 7 : 8;

  const hasNotes = !!opts.notes?.length;
  const top = 1.25, bottom = hasNotes ? H - 1.15 : H - 0.35;
  // Per-level box height sized to the densest node in that level.
  const levels: OrgNode[][] = [];
  (function walk(n: OrgNode, d: number) { (levels[d] ||= []).push(n); n.children?.forEach((c) => walk(c, d + 1)); })(opts.tree, 0);
  const levelH = levels.map((ns) => {
    const sup = Math.max(...ns.map((n) => n.support?.length || 0));
    const role = ns.some((n) => n.role) ? 0.22 : 0;
    return Math.min(0.42 + role + sup * 0.17, (bottom - top) / depth - 0.35);
  });
  const usedH = levelH.reduce((a, b) => a + b, 0);
  const vGap = depth > 1 ? Math.max(0.25, (bottom - top - usedH) / (depth - 1)) : 0;
  const levelY: number[] = [];
  { let y = top; for (let d = 0; d < depth; d++) { levelY[d] = y; y += levelH[d] + vGap; } }

  // Assign x positions: leaves sequentially, parents centred over their children.
  let cursor = MX + (CW - (units * boxW + (units - 1) * gapX)) / 2;
  function place(n: OrgNode, d: number): Placed {
    const kids = (n.children || []).map((c) => place(c, d + 1));
    let x: number;
    if (!kids.length) { x = cursor; cursor += boxW + gapX; }
    else x = (kids[0].x + kids[kids.length - 1].x) / 2;
    return { node: n, depth: d, x, w: boxW, h: levelH[d], y: levelY[d], children: kids };
  }
  const root = place(opts.tree, 0);

  const all: Placed[] = [];
  (function collect(pl: Placed) { all.push(pl); pl.children.forEach(collect); })(root);

  // Connectors first so boxes draw over the line ends.
  for (const pl of all) {
    if (!pl.children.length) continue;
    const px = pl.x + pl.w / 2, py = pl.y + pl.h;
    const busY = pl.children[0].y - Math.min(vGap, 0.35) / 2;
    s.addShape("line" as any, { x: px, y: py, w: 0, h: busY - py, line: { color: LINE, width: 1 } });
    const firstX = pl.children[0].x + boxW / 2, lastX = pl.children[pl.children.length - 1].x + boxW / 2;
    if (pl.children.length > 1) s.addShape("line" as any, { x: firstX, y: busY, w: lastX - firstX, h: 0, line: { color: LINE, width: 1 } });
    for (const c of pl.children) {
      const cx = c.x + boxW / 2;
      s.addShape("line" as any, { x: cx, y: busY, w: 0, h: c.y - busY, line: { color: LINE, width: 1 } });
    }
  }

  for (const pl of all) {
    const isRoot = pl.depth === 0;
    s.addShape("roundRect" as any, { x: pl.x, y: pl.y, w: pl.w, h: pl.h, rectRadius: 0.05,
      fill: { color: isRoot ? DARK : PAPER }, line: { color: DARK, width: isRoot ? 0 : 1 } });
    // One text frame per box; every paragraph is a single run (pPr-safe).
    const paras: any[] = [{ text: clean(pl.node.name) || "TBC", options: { bold: true, fontSize: nameSize, color: isRoot ? PAPER : DARK, breakLine: true } }];
    if (pl.node.role) paras.push({ text: clean(pl.node.role), options: { italic: true, fontSize: roleSize, color: isRoot ? "CCCCCC" : MUTE, breakLine: true } });
    for (const sup of pl.node.support || []) {
      const t = clean(sup); if (t) paras.push({ text: t, options: { fontSize: roleSize, color: isRoot ? "CCCCCC" : MUTE, breakLine: true } });
    }
    s.addText(paras, { x: pl.x + 0.04, y: pl.y + 0.03, w: pl.w - 0.08, h: pl.h - 0.06, align: "center", valign: "middle", fontFace: "Calibri" });
  }

  if (hasNotes) {
    const noteParas = (opts.notes || []).map((n) => ({ text: clean(n), options: { bullet: true, fontSize: 9, color: MUTE, breakLine: true } }));
    s.addText(noteParas, { x: MX, y: H - 1.0, w: CW, h: 0.85, valign: "top", fontFace: "Calibri" });
  }

  return fixPptxSchemaViolations((await p.write({ outputType: "nodebuffer" })) as Buffer);
}
