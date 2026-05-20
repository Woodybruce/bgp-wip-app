// CV renderer — BGP-house-style A4 portrait PDF + parallel Word doc.
//
// Both formats share the same data shape (see CvData below) so a single
// fetch from /api/hr/cv/:userId feeds either output. Layout cribbed from
// the why-buy renderer (fonts, BGP slate accent line, serif headlines)
// so team CVs and investment memos read as one suite.
import PDFDocument from "pdfkit";
import fs from "fs";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
} from "docx";

const BGP_SLATE = "#1F2937";
const BGP_ACCENT = "#0F4C75";
const BGP_MUTED = "#6B7280";

export interface CvData {
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  bgpStartYear: number | null;
  tenureLabel: string | null;
  education: string | null;
  ricsPathway: string | null;
  ricsNumber: string | null;
  apcStatus: string | null;          // only "completed" surfaces ("MRICS"); in-progress is personal
  linkedinUrl: string | null;
  summary: string | null;            // personal statement (cv_summary)
  specialisms: string[];
  notableClients: string[];
  careerHistory: Array<{ role: string; employer: string; startYear?: number; endYear?: number }>;
  notableDeals: Array<{ name: string; description?: string; year?: number }>;
  photoBuffer: Buffer | null;        // resolved by the route — PNG/JPEG
}

export async function renderCvPdf(cv: CvData): Promise<Buffer> {
  const pageW = 595;  // A4 portrait
  const pageH = 842;
  const leftM = 50;
  const rightM = 50;
  const topM = 50;
  const bottomM = 40;
  const usableW = pageW - leftM - rightM;

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margins: { top: topM, bottom: bottomM, left: leftM, right: rightM },
    info: {
      Title: `${cv.name} — CV`,
      Author: "Bruce Gillingham Pollard",
      Creator: "BGP Dashboard",
    },
    bufferPages: true,
  });

  const linuxSans = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";
  const linuxSansBold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const linuxSerifBold = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf";
  if (process.platform !== "linux" || !fs.existsSync(linuxSans)) {
    doc.registerFont("Body", "Helvetica");
    doc.registerFont("Body-Bold", "Helvetica-Bold");
    doc.registerFont("Headline", "Times-Bold");
  } else {
    doc.registerFont("Body", linuxSans);
    doc.registerFont("Body-Bold", linuxSansBold);
    doc.registerFont("Headline", fs.existsSync(linuxSerifBold) ? linuxSerifBold : linuxSansBold);
  }

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  // ── Header: photo (left) + name/title/contact (right) ───────────────────
  const photoSize = 90;
  let textX = leftM;
  if (cv.photoBuffer) {
    try {
      doc.image(cv.photoBuffer, leftM, topM, { width: photoSize, height: photoSize, fit: [photoSize, photoSize] });
      textX = leftM + photoSize + 18;
    } catch {
      // image bytes unreadable — fall through to text-only header
    }
  }
  doc.font("Headline").fontSize(22).fillColor(BGP_SLATE)
    .text(cv.name, textX, topM, { width: usableW - (textX - leftM), lineBreak: false });
  if (cv.title) {
    doc.font("Body").fontSize(12).fillColor(BGP_ACCENT)
      .text(cv.title, textX, topM + 28, { width: usableW - (textX - leftM), lineBreak: false });
  }
  const contactBits = [
    cv.email,
    cv.phone,
    cv.linkedinUrl ? cv.linkedinUrl.replace(/^https?:\/\//, "") : null,
  ].filter(Boolean).join("  ·  ");
  if (contactBits) {
    doc.font("Body").fontSize(9).fillColor(BGP_MUTED)
      .text(contactBits, textX, topM + 48, { width: usableW - (textX - leftM), lineBreak: false });
  }
  if (cv.tenureLabel) {
    doc.font("Body").fontSize(9).fillColor(BGP_MUTED)
      .text(`Bruce Gillingham Pollard · ${cv.tenureLabel}`, textX, topM + 62, { width: usableW - (textX - leftM), lineBreak: false });
  }

  let y = topM + Math.max(photoSize, 90) + 18;
  doc.moveTo(leftM, y).lineTo(pageW - rightM, y).strokeColor(BGP_ACCENT).lineWidth(1.2).stroke();
  y += 16;

  // ── Section helpers ──────────────────────────────────────────────────────
  function section(title: string) {
    doc.font("Body-Bold").fontSize(10).fillColor(BGP_ACCENT)
      .text(title.toUpperCase(), leftM, y, { characterSpacing: 1.2, lineBreak: false });
    y += 16;
  }
  function body(text: string, opts: { italic?: boolean } = {}) {
    doc.font("Body").fontSize(10).fillColor(BGP_SLATE)
      .text(text, leftM, y, { width: usableW, oblique: opts.italic });
    y = doc.y + 8;
  }
  function bullets(items: string[]) {
    if (items.length === 0) return;
    for (const it of items) {
      doc.font("Body").fontSize(10).fillColor(BGP_SLATE)
        .text(`• ${it}`, leftM + 8, y, { width: usableW - 8 });
      y = doc.y + 2;
    }
    y += 6;
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  if (cv.summary) {
    section("Profile");
    body(cv.summary);
  }

  if (cv.specialisms.length > 0) {
    section("Specialisms");
    bullets(cv.specialisms);
  }

  if (cv.notableDeals.length > 0) {
    section("Notable BGP deals");
    bullets(cv.notableDeals.map(d => {
      const tail = [d.year, d.description].filter(Boolean).join(" · ");
      return tail ? `${d.name} — ${tail}` : d.name;
    }));
  }

  if (cv.notableClients.length > 0) {
    section("Clients");
    body(cv.notableClients.join(" · "));
  }

  if (cv.careerHistory.length > 0) {
    section("Career history");
    for (const c of cv.careerHistory) {
      const years = c.startYear ? `${c.startYear}${c.endYear ? `–${c.endYear}` : c.startYear ? "–present" : ""}` : "";
      doc.font("Body-Bold").fontSize(10).fillColor(BGP_SLATE)
        .text(`${c.role}${c.employer ? `, ${c.employer}` : ""}`, leftM, y, { width: usableW - 80, continued: false });
      if (years) {
        doc.font("Body").fontSize(9).fillColor(BGP_MUTED)
          .text(years, pageW - rightM - 80, y, { width: 80, align: "right", lineBreak: false });
      }
      y = doc.y + 8;
    }
  }

  if (cv.education || cv.ricsNumber || cv.ricsPathway || cv.apcStatus === "completed") {
    section("Qualifications");
    if (cv.education) body(cv.education);
    const ricsBits: string[] = [];
    if (cv.apcStatus === "completed") ricsBits.push("MRICS");
    if (cv.ricsPathway) ricsBits.push(cv.ricsPathway);
    if (cv.ricsNumber) ricsBits.push(`Member ${cv.ricsNumber}`);
    if (ricsBits.length) body(ricsBits.join(" · "));
  }

  // Footer
  doc.font("Body").fontSize(7).fillColor(BGP_MUTED)
    .text(`Bruce Gillingham Pollard · First Floor, 55 Wells Street, London W1T 3PT · brucegillinghampollard.com`,
      leftM, pageH - 28, { width: usableW, align: "center", lineBreak: false });

  doc.end();
  return new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function renderCvDocx(cv: CvData): Promise<Buffer> {
  const children: any[] = [];

  // Name + title row (with optional photo). docx ImageRun expects width/height.
  if (cv.photoBuffer) {
    try {
      children.push(new Paragraph({
        children: [new ImageRun({ data: cv.photoBuffer as any, transformation: { width: 96, height: 96 }, type: "png" })],
      }));
    } catch { /* skip image if buffer unreadable */ }
  }
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: cv.name, bold: true, size: 44 })],
  }));
  if (cv.title) {
    children.push(new Paragraph({
      children: [new TextRun({ text: cv.title, color: "0F4C75", size: 24 })],
    }));
  }
  const contactBits = [cv.email, cv.phone, cv.linkedinUrl].filter(Boolean).join("  ·  ");
  if (contactBits) {
    children.push(new Paragraph({
      children: [new TextRun({ text: contactBits, size: 18, color: "6B7280" })],
    }));
  }
  if (cv.tenureLabel) {
    children.push(new Paragraph({
      children: [new TextRun({ text: `Bruce Gillingham Pollard · ${cv.tenureLabel}`, size: 18, color: "6B7280" })],
    }));
  }
  children.push(new Paragraph({ children: [new TextRun({ text: " " })] }));

  function section(title: string) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: title.toUpperCase(), bold: true, color: "0F4C75", size: 22 })],
    }));
  }
  function paragraph(t: string) {
    children.push(new Paragraph({ children: [new TextRun({ text: t, size: 20 })] }));
  }
  function bullet(t: string) {
    children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: t, size: 20 })] }));
  }

  if (cv.summary) {
    section("Profile");
    paragraph(cv.summary);
  }
  if (cv.specialisms.length) {
    section("Specialisms");
    cv.specialisms.forEach(bullet);
  }
  if (cv.notableDeals.length) {
    section("Notable BGP deals");
    for (const d of cv.notableDeals) {
      const tail = [d.year, d.description].filter(Boolean).join(" · ");
      bullet(tail ? `${d.name} — ${tail}` : d.name);
    }
  }
  if (cv.notableClients.length) {
    section("Clients");
    paragraph(cv.notableClients.join(" · "));
  }
  if (cv.careerHistory.length) {
    section("Career history");
    for (const c of cv.careerHistory) {
      const years = c.startYear ? `${c.startYear}${c.endYear ? `–${c.endYear}` : "–present"}` : "";
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${c.role}${c.employer ? `, ${c.employer}` : ""}`, bold: true, size: 20 }),
          ...(years ? [new TextRun({ text: `   ${years}`, color: "6B7280", size: 18 })] : []),
        ],
      }));
    }
  }
  if (cv.education || cv.ricsNumber || cv.ricsPathway || cv.apcStatus === "completed") {
    section("Qualifications");
    if (cv.education) paragraph(cv.education);
    const ricsBits: string[] = [];
    if (cv.apcStatus === "completed") ricsBits.push("MRICS");
    if (cv.ricsPathway) ricsBits.push(cv.ricsPathway);
    if (cv.ricsNumber) ricsBits.push(`Member ${cv.ricsNumber}`);
    if (ricsBits.length) paragraph(ricsBits.join(" · "));
  }

  const document = new Document({
    creator: "BGP Dashboard",
    title: `${cv.name} — CV`,
    sections: [{ properties: {}, children }],
  });
  return Packer.toBuffer(document);
}
