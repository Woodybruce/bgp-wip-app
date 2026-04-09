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
        const data = await parser.getText();
        const text = typeof data === "string" ? data : (data as any).text || String(data);
        try { parser.destroy(); } catch {}
        return text;
      }

      case ".pptx": {
        const buffer = await fs.promises.readFile(filePath);
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(buffer);
        let pptxText = "";
        const slideFiles = Object.keys(zip.files).filter(f => f.match(/^ppt\/slides\/slide\d+\.xml$/)).sort();
        for (const slideFile of slideFiles) {
          const xml = await zip.files[slideFile].async("text");
          const textMatches = xml.match(/<a:t[^>]*>([^<]*)<\/a:t>/g) || [];
          const slideText = textMatches.map(m => m.replace(/<[^>]+>/g, "")).join(" ");
          if (slideText.trim()) pptxText += slideText + "\n";
        }
        return pptxText;
      }

      default:
        const content = await fs.promises.readFile(filePath, "utf-8");
        if (content.includes("\0") || content.includes("\ufffd")) {
          throw new Error(`Cannot extract text from binary file type: ${ext}`);
        }
        return content;
    }
  } catch (error: any) {
    console.error(`[FileExtractor] Error extracting ${ext} file:`, error);
    throw new Error(`Failed to extract text from ${originalName}: ${error.message}`);
  }
}
