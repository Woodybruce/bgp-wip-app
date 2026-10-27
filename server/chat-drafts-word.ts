import { AlignmentType, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType, type IRunOptions } from "docx";
import { exportRichTextText, parseRichText, safeExportUrl } from "../shared/chat-rich-text";

// The shared parser returns Marked's GFM tokens, including two app-specific
// inline tokens. These are the fields used by the native Word renderer.
type WordToken = {
  type: string; text?: string; raw?: string; href?: string; tokens?: WordToken[]; depth?: number;
  name?: string; ordered?: boolean; start?: number; items?: WordToken[];
  checked?: boolean; task?: boolean; header?: { text: string; tokens: WordToken[] }[];
  rows?: { text: string; tokens: WordToken[] }[][]; align?: ("left" | "center" | "right" | null)[];
};
const cleanText = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "");
type WordInline = TextRun | ExternalHyperlink;

function inlineRuns(tokens: WordToken[], style: IRunOptions = {}): WordInline[] {
  return tokens.flatMap<WordInline>(token => {
    if (token.type === "br") return [new TextRun({ ...style, break: 1 })];
    const next = { ...style };
    if (token.type === "strong") next.bold = true;
    if (token.type === "em") next.italics = true;
    if (token.type === "del") next.strike = true;
    if (token.type === "codespan") next.font = "Consolas";
    if (token.type === "link") {
      const url = safeExportUrl(token.href ?? "");
      const children = inlineRuns(token.tokens?.length ? token.tokens : [{ type: "text", text: token.text }],
        url ? { ...next, style: "Hyperlink" } : next);
      return url ? [new ExternalHyperlink({ link: url, children })] : children;
    }
    if (token.tokens?.length) return inlineRuns(token.tokens, next);
    // Internal references, downloads and images are labels, not private storage
    // URLs or remote media. Raw HTML becomes ordinary literal Word text.
    const text = token.type === "bgp_tag" ? token.name : token.text ?? token.raw;
    return text ? [new TextRun({ ...next, text: cleanText(exportRichTextText(text, token.type !== "codespan")) })] : [];
  });
}

/** Real OOXML, built from the same parsed Markdown used by the chat/email. */
export async function createChatDraftWord(subject: string, markdown: string): Promise<Buffer> {
  const tokens = parseRichText(markdown) as unknown as WordToken[];
  const numbering: any[] = [];
  let listCounter = 0;
  const paragraph = (runs: WordInline[], extra: any = {}) => new Paragraph({
    children: runs.length ? runs : [new TextRun("")], spacing: { after: 140, line: 276 }, ...extra,
  });
  const render = (blocks: WordToken[], indent = 0): (Paragraph | Table)[] => {
    const children: (Paragraph | Table)[] = [];
    for (const block of blocks) {
      if (block.type === "space" || block.type === "def") continue;
      if (block.type === "table" && block.header) {
        const cols = Math.max(1, block.header.length);
        const row = (cells: { text: string; tokens: WordToken[] }[], header = false) => new TableRow({
          tableHeader: header,
          children: Array.from({ length: cols }, (_, i) => new TableCell({
            width: { size: 100 / cols, type: WidthType.PERCENTAGE },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            shading: header ? { fill: "F0F1F3", type: ShadingType.CLEAR } : undefined,
            children: [paragraph(inlineRuns(cells[i]?.tokens ?? [{ type: "text", text: cells[i]?.text ?? "" }], { bold: header, size: 20 }), {
              spacing: { after: 40, line: 240 },
              alignment: block.align?.[i] === "right" ? AlignmentType.RIGHT : block.align?.[i] === "center" ? AlignmentType.CENTER : AlignmentType.LEFT,
            })],
          })),
        });
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [row(block.header, true), ...(block.rows ?? []).map(cells => row(cells))] }));
        children.push(paragraph([]));
      } else if (block.type === "heading") {
        const depth = Math.min(6, Math.max(1, block.depth ?? 1));
        const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3,
          HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][depth - 1];
        children.push(paragraph(inlineRuns(block.tokens ?? [{ type: "text", text: block.text }], { bold: true }), {
          heading, keepNext: true, spacing: { before: 240, after: 120 },
        }));
      } else if (block.type === "list") {
        const reference = `draft-list-${++listCounter}`;
        if (block.ordered) numbering.push({ reference, levels: Array.from({ length: 9 }, (_, level) => ({
          level, format: LevelFormat.DECIMAL, text: `%${level + 1}.`, start: Number(block.start) || 1,
          alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 240 } } },
        })) });
        for (const item of block.items ?? []) {
          const itemBlocks = item.tokens ?? [{ type: "text", text: item.text }];
          let first = true;
          for (const itemBlock of itemBlocks) {
            if (itemBlock.type === "list") { children.push(...render([itemBlock], indent + 1)); continue; }
            if (itemBlock.type === "space") continue;
            if (itemBlock.type === "table" || itemBlock.type === "blockquote" || itemBlock.type === "code") {
              children.push(...render([itemBlock], indent + 1)); continue;
            }
            const runs = inlineRuns(itemBlock.tokens ?? [{ type: "text", text: itemBlock.text }]);
            if (item.task && first) runs.unshift(new TextRun(item.checked ? "☑ " : "☐ "));
            const listOptions = first ? block.ordered ? { numbering: { reference, level: Math.min(indent, 8) } }
              : { bullet: { level: Math.min(indent, 8) } } : { indent: { left: 360 * (indent + 1) } };
            children.push(paragraph(runs, listOptions));
            first = false;
          }
        }
      } else if (block.type === "blockquote") {
        children.push(...render(block.tokens ?? [], indent + 1));
      } else if (block.type === "code") {
        const lines = exportRichTextText(block.text ?? "", false).split("\n");
        children.push(paragraph(lines.map((text, i) => new TextRun({ text: cleanText(text), font: "Consolas", size: 19, ...(i ? { break: 1 } : {}) })), {
          shading: { fill: "F5F5F5" }, indent: { left: 160, right: 160 },
        }));
      } else if (block.type === "hr") {
        children.push(paragraph([], { border: { bottom: { style: "single", size: 4, color: "CCCCCC" } } }));
      } else {
        children.push(paragraph(inlineRuns(block.tokens ?? [block]), indent ? { indent: { left: 360 * indent } } : {}));
      }
    }
    return children;
  };
  const safeSubject = cleanText(exportRichTextText(subject, false));
  const children = [paragraph([new TextRun({ text: safeSubject, size: 36, bold: true })], {
    heading: HeadingLevel.TITLE, keepNext: true, spacing: { after: 280 },
  }), ...render(tokens)];
  const document = new Document({
    creator: "ChatBGP", title: safeSubject,
    styles: { default: { document: { run: { font: "Calibri", size: 22, color: "232323" } } } },
    numbering: { config: numbering },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 },
      margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  });
  return Packer.toBuffer(document);
}
