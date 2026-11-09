// ChatBGP in Word and PowerPoint (Woody, 2026-09-28: "also what about power
// point and word?"). Same bridge as Excel and Outlook (server/excel-agent.ts):
// the model calls word_* / ppt_* tools and the task pane carries them out on
// the open document with Office.js.
const fn = (defs: any[]) => defs.map(t => ({ type: "function", function: t }));

export const WORD_TOOL_DEFS = fn([
  {
    name: "word_read_document",
    description: "The open Word document: every paragraph with its index, style (Heading 1, Normal…) and text, plus tables, comments count and the user's current selection. Read before editing.",
    parameters: { type: "object", properties: { fromParagraph: { type: "number" }, toParagraph: { type: "number" } } },
  },
  {
    name: "word_insert",
    description: "Insert content as simple HTML (<h1>-<h3>, <p>, <b>, <i>, <ul>/<ol>, <table>). location: replaceSelection, afterSelection, start, end, afterParagraph / replaceParagraph (with paragraphIndex). With tracked changes on, edits show as suggestions the user accepts or rejects.",
    parameters: {
      type: "object",
      properties: {
        html: { type: "string" },
        location: { type: "string", enum: ["replaceSelection", "afterSelection", "start", "end", "afterParagraph", "replaceParagraph"] },
        paragraphIndex: { type: "number" },
      },
      required: ["html", "location"],
    },
  },
  {
    name: "word_replace_text",
    description: "Find text in the document and replace it (every match, or the first). Returns how many were changed. Good for fixing names, figures and terms throughout.",
    parameters: {
      type: "object",
      properties: { search: { type: "string" }, replacement: { type: "string" }, matchCase: { type: "boolean" }, all: { type: "boolean" } },
      required: ["search", "replacement"],
    },
  },
  {
    name: "word_insert_table",
    description: "Insert a table (first row as headers) after a paragraph, after the selection or at the end.",
    parameters: {
      type: "object",
      properties: { rows: { type: "array", items: { type: "array", items: { type: "string" } } }, location: { type: "string", enum: ["afterSelection", "end", "afterParagraph"] }, paragraphIndex: { type: "number" } },
      required: ["rows"],
    },
  },
  {
    name: "word_add_comment",
    description: "Add a review comment on the first match of some text (or the selection) — for questions and suggestions you shouldn't make yourself.",
    parameters: { type: "object", properties: { search: { type: "string" }, text: { type: "string" } }, required: ["text"] },
  },
  {
    name: "word_track_changes",
    description: "Turn Word's Track Changes on or off.",
    parameters: { type: "object", properties: { on: { type: "boolean" } }, required: ["on"] },
  },
]);

export const PPT_TOOL_DEFS = fn([
  {
    name: "ppt_read_presentation",
    description: "The open presentation: every slide with its index, id and the shapes on it (id, name, text, position and size in points), plus the available slide layouts. Read before editing.",
    parameters: { type: "object", properties: { fromSlide: { type: "number" }, toSlide: { type: "number" } } },
  },
  {
    name: "ppt_add_slide",
    description: "Add a slide using one of the deck's own layouts (by name, e.g. 'Title and Content'), optionally after a given slide. Returns the new slide's index and its placeholder shapes so you can fill them.",
    parameters: { type: "object", properties: { layoutName: { type: "string" }, afterSlide: { type: "number" } } },
  },
  {
    name: "ppt_set_text",
    description: "Replace the text of a shape (a title, a placeholder or a text box) on a slide. Use \\n for new lines / bullets.",
    parameters: {
      type: "object",
      properties: { slide: { type: "number", description: "Slide index from ppt_read_presentation (1-based)" }, shapeId: { type: "string" }, shapeName: { type: "string" }, text: { type: "string" } },
      required: ["slide", "text"],
    },
  },
  {
    name: "ppt_add_textbox",
    description: "Add a text box to a slide at a position in points (a 16:9 slide is 960×540).",
    parameters: {
      type: "object",
      properties: {
        slide: { type: "number" }, text: { type: "string" },
        left: { type: "number" }, top: { type: "number" }, width: { type: "number" }, height: { type: "number" },
        fontSize: { type: "number" }, bold: { type: "boolean" }, color: { type: "string", description: "Hex, e.g. #6E0C25" },
      },
      required: ["slide", "text"],
    },
  },
  {
    name: "ppt_delete",
    description: "Delete a slide, or one shape on a slide.",
    parameters: { type: "object", properties: { slide: { type: "number" }, shapeId: { type: "string" } }, required: ["slide"] },
  },
  {
    name: "ppt_go_to_slide",
    description: "Show a slide to the user.",
    parameters: { type: "object", properties: { slide: { type: "number" } }, required: ["slide"] },
  },
]);

export const WORD_TOOL_NAMES = new Set(WORD_TOOL_DEFS.map((t: any) => t.function.name));
export const PPT_TOOL_NAMES = new Set(PPT_TOOL_DEFS.map((t: any) => t.function.name));

export const WORD_AGENT_PROMPT = `

## WORD — you are ChatBGP working in the user's open document
You are the full ChatBGP (CRM, deals, properties, comps, requirements, SharePoint, knowledge bank, memory) AND you edit the open Word document through the word_* tools, which the pane carries out live.
- Read the document (word_read_document) before changing it; quote paragraph indexes you rely on.
- Edits to existing text go in as tracked changes when the user has "Suggest as tracked changes" on (the default) — say so, and let them accept or reject in Word.
- Fill facts from BGP's records (deal terms, rents, dates, tenant names, comps) and say where they came from. Never invent a figure — leave a [[TBC: …]] marker and tell the user.
- BGP house style: confident, evidence-led, UK English and UK property language, no hype. Headings in sentence case.
- Questions or judgement calls you shouldn't make yourself go in as comments (word_add_comment).
- Keep the chat reply short: what you changed (by paragraph or heading), and anything to decide.
`;

export const PPT_AGENT_PROMPT = `

## POWERPOINT — you are ChatBGP working in the user's open deck
You are the full ChatBGP (CRM, deals, properties, comps, requirements, SharePoint, knowledge bank, memory) AND you build and edit the open presentation through the ppt_* tools, which the pane carries out live.
- Read the deck (ppt_read_presentation) first; use its own layouts (ppt_add_slide) so new slides match its template, then fill the placeholders with ppt_set_text.
- One idea per slide: a clear sentence-case title, 3–5 short bullets or one big number with its evidence underneath. Put the data behind it from BGP's records (comps, rents, deal terms, footfall, tenant lists) and name the source on the slide.
- Only add free text boxes when a layout has no placeholder for it; keep them inside the 960×540 slide and in the deck's colours (BGP: Bordeaux #6E0C25, ink #1D1D1B).
- Never delete slides or shapes the user made unless they asked.
- Keep the chat reply short: which slides you added or changed, and anything to decide.
`;

export function officeToolLabel(name: string, a: any): string {
  switch (name) {
    case "word_read_document": return "Reading the document…";
    case "word_insert": return "Writing into the document…";
    case "word_replace_text": return `Replacing "${String(a?.search || "").slice(0, 30)}"…`;
    case "word_insert_table": return "Adding a table…";
    case "word_add_comment": return "Adding a comment…";
    case "word_track_changes": return a?.on ? "Turning Track Changes on…" : "Turning Track Changes off…";
    case "ppt_read_presentation": return "Reading the deck…";
    case "ppt_add_slide": return "Adding a slide…";
    case "ppt_set_text": return `Writing on slide ${a?.slide ?? ""}…`;
    case "ppt_add_textbox": return `Adding text to slide ${a?.slide ?? ""}…`;
    case "ppt_delete": return a?.shapeId ? "Removing a shape…" : `Deleting slide ${a?.slide ?? ""}…`;
    case "ppt_go_to_slide": return `Showing slide ${a?.slide ?? ""}…`;
    default: return "Working…";
  }
}
