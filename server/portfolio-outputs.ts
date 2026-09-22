// ─────────────────────────────────────────────────────────────────────────
// Combined portfolio outputs — Excel workbook + Why Buy summary PDF.
//
// Both build FRESH from the headline data we already extract per run
// (getPortfolioWithRuns → each asset's Stage 6 business-plan numbers),
// rather than fetching+merging each run's individual artifact. The
// individual files live on ephemeral disk / SharePoint, which makes
// after-the-fact merging unreliable; building from the extracted data is
// durable and always reflects the current enabled set. Each per-asset
// row/page links out to that run's full Why Buy deck for the detail.
//
// Output bytes are saved to file_storage (durable Postgres blob) and
// served via /api/portfolios/files/:key.
// ─────────────────────────────────────────────────────────────────────────

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { saveFile } from "./file-storage";
import { getPortfolioWithRuns } from "./portfolios";

const money = (p: number | null | undefined) =>
  p == null ? "—" : `£${Math.round(p).toLocaleString("en-GB")}`;
const pct = (d: number | null | undefined) => (d == null ? "—" : `${(d * 100).toFixed(2)}%`);
const mult = (d: number | null | undefined) => (d == null ? "—" : `${d.toFixed(2)}x`);

export async function generatePortfolioExcel(portfolioId: string): Promise<{ url: string; filename: string }> {
  const data = await getPortfolioWithRuns(portfolioId);
  if (!data) throw new Error("Portfolio not found");
  const rows = data.items.filter(i => i.enabled);

  const wb = new ExcelJS.Workbook();
  wb.creator = "BGP Dashboard";
  wb.created = new Date();
  const ws = wb.addWorksheet("Portfolio Summary", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = [
    { header: "Property", key: "address", width: 38 },
    { header: "Strategy", key: "strategy", width: 26 },
    { header: "Purchase Price", key: "price", width: 16, style: { numFmt: "£#,##0" } },
    { header: "NIY", key: "niy", width: 10, style: { numFmt: "0.00%" } },
    { header: "Rent PA", key: "rent", width: 14, style: { numFmt: "£#,##0" } },
    { header: "Exit Price", key: "exit", width: 16, style: { numFmt: "£#,##0" } },
    { header: "Exit Yield", key: "exitYield", width: 11, style: { numFmt: "0.00%" } },
    { header: "Target IRR", key: "irr", width: 11, style: { numFmt: "0.00%" } },
    { header: "MOIC", key: "moic", width: 10, style: { numFmt: '0.00"x"' } },
    { header: "Hold (yrs)", key: "hold", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

  for (const r of rows) {
    ws.addRow({
      address: r.address,
      strategy: r.strategy || "",
      price: r.targetPurchasePrice ?? null,
      niy: r.targetNIY ?? null,
      rent: r.rentPA ?? null,
      exit: r.exitPrice ?? null,
      exitYield: r.exitYield ?? null,
      irr: r.targetIRR ?? null,
      moic: r.targetMOIC ?? null,
      hold: r.holdPeriodYrs ?? null,
    });
  }

  // Totals row — uses the same blended logic as the dashboard.
  const t = data.totals;
  const totalRow = ws.addRow({
    address: `PORTFOLIO (${t.assetCount} assets)`,
    strategy: "",
    price: t.totalPurchasePrice ?? null,
    niy: t.blendedNIY ?? null,
    rent: t.totalRentPA ?? null,
    exit: t.totalExitPrice ?? null,
    exitYield: t.blendedExitYield ?? null,
    irr: null,
    moic: null,
    hold: null,
  });
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: "double" } };

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const safeName = (data.portfolio.name || "portfolio").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const filename = `portfolio-${safeName}-${Date.now()}.xlsx`;
  const key = `portfolio-outputs/${filename}`;
  await saveFile(key, buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename);
  return { url: `/api/portfolios/files/${filename}`, filename };
}

export async function generatePortfolioWhyBuy(portfolioId: string): Promise<{ url: string; filename: string }> {
  const data = await getPortfolioWithRuns(portfolioId);
  if (!data) throw new Error("Portfolio not found");
  const rows = data.items.filter(i => i.enabled);
  const t = data.totals;

  const buf: Buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const INK = "#1F2937";
    const MUTED = "#6B7280";
    const ACCENT = "#B45309";

    // ── Cover ──
    doc.fillColor(ACCENT).fontSize(11).text("BGP — PORTFOLIO BRIEFING", { characterSpacing: 1 });
    doc.moveDown(0.5);
    doc.fillColor(INK).fontSize(28).text(data.portfolio.name, { lineGap: 2 });
    doc.moveDown(0.4);
    doc.fillColor(MUTED).fontSize(11).text(`${t.assetCount} asset${t.assetCount === 1 ? "" : "s"} · generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
    doc.moveDown(1.2);

    // Portfolio headline metrics box
    const metric = (label: string, value: string) => {
      doc.fillColor(MUTED).fontSize(9).text(label.toUpperCase(), { characterSpacing: 0.5, continued: false });
      doc.fillColor(INK).fontSize(18).text(value);
      doc.moveDown(0.6);
    };
    doc.moveDown(0.5);
    metric("Total purchase price", money(t.totalPurchasePrice));
    metric("Total rent PA", money(t.totalRentPA));
    metric("Blended net initial yield", pct(t.blendedNIY));
    metric("Total exit value", money(t.totalExitPrice));
    metric("Blended exit yield", pct(t.blendedExitYield));

    // ── One section per asset ──
    for (const r of rows) {
      doc.addPage();
      doc.fillColor(ACCENT).fontSize(10).text("ASSET", { characterSpacing: 1 });
      doc.moveDown(0.3);
      doc.fillColor(INK).fontSize(20).text(r.address);
      doc.fillColor(MUTED).fontSize(10).text(`${r.postcode || ""}${r.strategy ? ` · ${r.strategy}` : ""}`);
      doc.moveDown(1);

      const line = (label: string, value: string) => {
        const y = doc.y;
        doc.fillColor(MUTED).fontSize(10).text(label, 50, y, { width: 200 });
        doc.fillColor(INK).fontSize(11).text(value, 250, y, { width: 250 });
        doc.moveDown(0.6);
      };
      line("Purchase price", money(r.targetPurchasePrice));
      line("Net initial yield", pct(r.targetNIY));
      line("Rent PA", money(r.rentPA));
      line("Exit price", money(r.exitPrice));
      line("Exit yield", pct(r.exitYield));
      line("Target IRR", pct(r.targetIRR));
      line("Target MOIC", mult(r.targetMOIC));
      line("Hold period", r.holdPeriodYrs != null ? `${r.holdPeriodYrs} yrs` : "—");

      if (r.keyRisks.length) {
        doc.moveDown(0.8);
        doc.fillColor(ACCENT).fontSize(10).text("KEY RISKS", { characterSpacing: 1 });
        doc.moveDown(0.3);
        for (const risk of r.keyRisks) {
          doc.fillColor(INK).fontSize(10).text(`•  ${risk}`, { width: 480 });
          doc.moveDown(0.2);
        }
      }

      if (r.whyBuyUrl) {
        doc.moveDown(1);
        doc.fillColor(ACCENT).fontSize(9).text("Full Why Buy deck →", { link: r.whyBuyUrl, underline: true });
      }
    }

    doc.end();
  });

  const safeName = (data.portfolio.name || "portfolio").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const filename = `portfolio-why-buy-${safeName}-${Date.now()}.pdf`;
  const key = `portfolio-outputs/${filename}`;
  await saveFile(key, buf, "application/pdf", filename);
  return { url: `/api/portfolios/files/${filename}`, filename };
}
