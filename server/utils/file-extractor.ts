import fs from "node:fs";
import path from "node:path";
import mammoth from "mammoth";

export async function extractTextFromFile(filePath: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();

  try {
    switch (ext) {
      case ".txt":
      case ".md":
      case ".csv":
      case ".json":
      case ".xml":
      case ".html":
      case ".htm":
        return await fs.promises.readFile(filePath, "utf-8");

      case ".doc": {
        const WordExtractor = (await import("word-extractor")).default;
        const extractor = new WordExtractor();
        const doc = await extractor.extract(filePath);
        return doc.getBody() || "";
      }

      case ".docx":
        const docResult = await mammoth.extractRawText({ path: filePath });
        return docResult.value;

      case ".xlsx":
      case ".xls": {
        const XLSX = await import("xlsx");
        const readFn = XLSX.readFile || XLSX.default?.readFile;
        const utilsRef = XLSX.utils || XLSX.default?.utils;
        if (!readFn || !utilsRef) throw new Error("XLSX module not available");
        let workbook: any;
        try {
          workbook = readFn(filePath);
        } catch (xlsErr: any) {
          if (xlsErr?.message?.includes("password")) {
            return "";
          }
          throw xlsErr;
        }
        let xlsxContent = "";
        for (const sheetName of workbook.SheetNames) {
          xlsxContent += `\n=== Sheet: ${sheetName} ===\n`;
          const sheet = workbook.Sheets[sheetName];
          xlsxContent += utilsRef.sheet_to_csv(sheet, { blankrows: false });
        }
        return xlsxContent;
      }

      case ".pdf": {
        const { PDFParse } = await import("pdf-parse");
        const pdfBuffer = await fs.promises.readFile(filePath);
        const parser = new (PDFParse as any)(new Uint8Array(pdfBuffer));
        let text = "";
        try {
          const data = await parser.getText();
          text = typeof data === "string" ? data : (data as any).text || String(data);
        } catch (pdfErr: any) {
          // Malformed or image-only PDFs — treat as no extractable text rather
          // than blowing up the whole indexing job. Common on scanned forms.
          const msg = pdfErr?.message || String(pdfErr);
          if (!/InvalidPDFException|Invalid PDF|password|encrypted/i.test(msg)) {
            throw pdfErr;
          }
          console.warn(`[FileExtractor] pdf-parse couldn't read "${originalName}": ${msg}`);
        } finally {
          try { parser.destroy(); } catch {}
        }
        // Scanned / image-only PDFs leave an empty (or near-empty) text layer.
        // Fall back to Azure OCR, mirroring server/archivist.ts. Guarded so it
        // no-ops gracefully (returns "") when OCR isn't configured.
        if (!text || text.trim().length < 50) {
          try {
            const { isOcrConfigured, ocrPdfBuffer } = await import("../ocr");
            if (isOcrConfigured()) {
              const ocrText = await ocrPdfBuffer(pdfBuffer, originalName);
              if (ocrText && ocrText.trim().length >= 50) {
                console.log(`[FileExtractor] OCR recovered ${ocrText.trim().length} chars from "${originalName}"`);
                return ocrText;
              }
            }
          } catch (ocrErr: any) {
            console.warn(`[FileExtractor] OCR fallback failed for "${originalName}": ${ocrErr?.message || ocrErr}`);
          }
        }
        return text;
      }

      case ".pptx": {
        const buffer = await fs.promises.readFile(filePath);
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(buffer);
        const slideFiles = Object.keys(zip.files)
          .filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/))
          .sort((a, b) => parseInt(a.match(/(\d+)/)![1], 10) - parseInt(b.match(/(\d+)/)![1], 10));
        const runText = (frag: string) => (frag.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || []).map(m => m.replace(/<[^>]+>/g, "")).join(" ").trim();
        const out: string[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const xml = await zip.files[slideFiles[i]].async("text");
          // Pull tables out first as markdown so their structure survives —
          // flattening every run into one line loses the rows/columns.
          const tableBlocks: string[] = [];
          for (const tbl of xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || []) {
            const rows: string[] = [];
            for (const tr of tbl.match(/<a:tr[\s\S]*?<\/a:tr>/g) || []) {
              const cells = (tr.match(/<a:tc>[\s\S]*?<\/a:tc>/g) || []).map(runText);
              if (cells.some(c => c)) rows.push("| " + cells.join(" | ") + " |");
            }
            if (rows.length) tableBlocks.push("[table]\n" + rows.join("\n"));
          }
          const slideText = runText(xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, ""));
          if (!slideText && !tableBlocks.length) continue;
          const parts = [`--- Slide ${i + 1} ---`];
          if (slideText) parts.push(slideText);
          if (tableBlocks.length) parts.push(...tableBlocks);
          out.push(parts.join("\n"));
        }
        return out.join("\n");
      }

      default:
        const content = await fs.promises.readFile(filePath, "utf-8");
        if (content.includes("\0") || content.includes("\ufffd")) {
          throw new Error(`Cannot extract text from binary file type: ${ext}`);
        }
        return content;
    }
  } catch (error: any) {
    console.warn(`[FileExtractor] Error extracting ${ext} from ${originalName}: ${error?.message || error}`);
    throw new Error(`Failed to extract text from ${originalName}: ${error.message}`);
  }
}
