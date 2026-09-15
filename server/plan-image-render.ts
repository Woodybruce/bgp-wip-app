import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const MAX_PLAN_PAGES = 10;
const MAX_PLAN_SIDE = 6000;
const PLAN_DPI = 300;

export function detectPlanLevelName(text: string): string | null {
  const lines = text.split(/\r?\n|\f/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const titleLines = lines.map(line => line.replace(/^(?:drawing\s+)?title\s*[:\-]\s*/i, ""));
  // Drawing titles take precedence over incidental notes about other floors.
  const site = titleLines.find(line => /^(?:(?:existing|proposed)\s+)?(?:site(?:\s+location)?|location)\s+plan$/i.test(line));
  if (site) return site;
  const names = titleLines.map(line => line.match(/^(?:(?:existing|proposed)\s+)?((?:Lower|Upper|Ground|First|Second|Third|Basement|Mezzanine|Restaurant|Leisure|Terrace)\s+(?:Level|Floor|Mall)|Level\s+\d+)(?:\s+Plan)?$/i)?.[1]).filter((name): name is string => Boolean(name));
  const unique = [...new Map(names.map(name => [name.toLowerCase(), name])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function originalPlanPdfKey(backgroundKey: unknown): string | null {
  if (typeof backgroundKey !== "string") return null;
  const match = backgroundKey.match(/^(evidence-plans\/[0-9a-f-]+\/pdf-[0-9a-f-]+)\/(?:page-\d+|crop-[0-9a-f-]+)\.png$/i);
  return match ? `${match[1]}/original.pdf` : null;
}

type RenderedPdfPlanPage = { buffer: Buffer; width: number; height: number; name: string | null; page: number };

// Plans need crisp vector linework and a recoverable source. Keep this
// separate from brochure thumbnails, which intentionally use smaller JPEGs.
export async function* renderEvidencePlanPdf(pdfBuffer: Buffer): AsyncGenerator<RenderedPdfPlanPage> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "evidence-plan-pdf-"));
  const source = path.join(directory, "original.pdf");
  try {
    await fs.writeFile(source, pdfBuffer);
    let info: string;
    try {
      ({ stdout: info } = await execFileAsync("pdfinfo", ["-f", "1", "-l", String(MAX_PLAN_PAGES), source], { timeout: 30_000 }));
    } catch {
      throw new Error("Couldn't read the PDF. Check that it opens correctly and isn't password protected.");
    }
    const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (!pageCount) throw new Error("The PDF has no readable pages.");
    if (pageCount > MAX_PLAN_PAGES) throw new Error(`A plan can contain up to ${MAX_PLAN_PAGES} pages. Split this PDF before uploading it.`);
    for (let page = 1; page <= pageCount; page++) {
      const size = info.match(new RegExp(`^Page\\s+${page}\\s+size:\\s+([\\d.]+)\\s+x\\s+([\\d.]+)\\s+pts`, "m"));
      if (!size) throw new Error(`Couldn't read the dimensions of PDF page ${page}.`);
      const widthPoints = Number(size[1]), heightPoints = Number(size[2]);
      if (!(widthPoints > 0 && heightPoints > 0)) throw new Error(`PDF page ${page} has invalid dimensions.`);
      const maxSide = Math.min(MAX_PLAN_SIDE, Math.ceil(Math.max(widthPoints, heightPoints) * PLAN_DPI / 72));
      const prefix = path.join(directory, `page-${page}`);
      try {
        await execFileAsync("pdftoppm", [
          "-png", "-singlefile", "-f", String(page), "-l", String(page),
          "-scale-to", String(maxSide), "-thinlinemode", "solid", "-aa", "yes", "-aaVector", "yes",
          source, prefix,
        ], { timeout: 60_000 });
      } catch {
        throw new Error(`Couldn't render PDF page ${page}. No replacement plan has been applied.`);
      }
      const buffer = await fs.readFile(`${prefix}.png`);
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height) throw new Error(`Couldn't read the rendered image for PDF page ${page}.`);
      let text = "";
      try {
        ({ stdout: text } = await execFileAsync("pdftotext", ["-layout", "-f", String(page), "-l", String(page), source, "-"], { timeout: 20_000 }));
      } catch { /* Scanned PDFs may have no extractable text. */ }
      yield { buffer, width: metadata.width, height: metadata.height, name: detectPlanLevelName(text), page };
      await fs.unlink(`${prefix}.png`);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
