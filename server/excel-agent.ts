// ChatBGP in Excel as a real agent (Woody, 2026-09-28: "no way near as good
// as Claude Fable … needs to be, but with the super power of the app and
// memory"). The model drives the open workbook through tools — read, write
// whole ranges, format, sheets, tables, charts, find, trace, error checks —
// that the task pane carries out with Office.js mid-answer, the same way the
// Claude add-in works. Each Excel tool call goes down the SSE stream as
// {excelTool}; the pane runs it and POSTs the result to
// /api/chatbgp/excel-tool-result, which resumes the loop.
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { pool } from "./db";

const cellValue = { anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" }] };

export const EXCEL_TOOL_DEFS: any[] = [
  {
    name: "excel_workbook_overview",
    description: "Structure of the open workbook: every sheet with its used range, tables, named ranges, frozen panes, and the user's current selection. Call first on a new task.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "excel_read_range",
    description: "Read cells from the open workbook. Returns values AND formulas (and number formats when asked) for every cell, row by row with addresses. Omit range to read the sheet's whole used range. Always read before you write into or reference an area.",
    parameters: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        range: { type: "string", description: "A1 range, e.g. A1:H40. Omit for the used range." },
        includeFormats: { type: "boolean", description: "Also return number formats, bold and fill colour." },
      },
      required: ["sheet"],
    },
  },
  {
    name: "excel_write_range",
    description: "Write a block of cells in one call. values is a 2D array (rows × columns) starting at the top-left cell of range; strings beginning with = are written as formulas. Returns the calculated results and any error cells (#REF!, #DIV/0!, #NAME? …) so you can fix them. Prefer one call per logical block over many single cells.",
    parameters: {
      type: "object",
      properties: {
        sheet: { type: "string" },
        range: { type: "string", description: "Top-left cell (e.g. B4) or the full target range." },
        values: { type: "array", items: { type: "array", items: cellValue } },
        numberFormat: { type: "string", description: "Optional number format applied to the whole block, e.g. '£#,##0' or '0.00%'." },
      },
      required: ["sheet", "range", "values"],
    },
  },
  {
    name: "excel_format_range",
    description: "Format cells: number format, bold/italic, font colour/size, fill colour, alignment, wrap, borders, column width / autofit, merge.",
    parameters: {
      type: "object",
      properties: {
        sheet: { type: "string" }, range: { type: "string" },
        numberFormat: { type: "string" }, bold: { type: "boolean" }, italic: { type: "boolean" },
        fontColor: { type: "string", description: "Hex, e.g. #6E0C25" }, fillColor: { type: "string" }, fontSize: { type: "number" },
        horizontalAlignment: { type: "string", enum: ["Left", "Center", "Right"] },
        wrapText: { type: "boolean" },
        borders: { type: "string", enum: ["all", "outline", "bottom", "none"] },
        columnWidth: { type: "number", description: "Points" }, autofitColumns: { type: "boolean" },
        merge: { type: "boolean" },
      },
      required: ["sheet", "range"],
    },
  },
  {
    name: "excel_sheet",
    description: "Create, rename, delete, copy or activate a worksheet.",
    parameters: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["create", "rename", "delete", "copy", "activate"] },
        sheet: { type: "string" }, newName: { type: "string" },
      },
      required: ["op", "sheet"],
    },
  },
  {
    name: "excel_rows_columns",
    description: "Insert or delete whole rows or columns, e.g. range '5:7' (rows) or 'C:D' (columns). Formulas elsewhere adjust as Excel does.",
    parameters: {
      type: "object",
      properties: { sheet: { type: "string" }, range: { type: "string" }, op: { type: "string", enum: ["insert", "delete"] } },
      required: ["sheet", "range", "op"],
    },
  },
  {
    name: "excel_clear_range",
    description: "Clear contents, formats or both from a range.",
    parameters: {
      type: "object",
      properties: { sheet: { type: "string" }, range: { type: "string" }, what: { type: "string", enum: ["contents", "formats", "all"] } },
      required: ["sheet", "range"],
    },
  },
  {
    name: "excel_find",
    description: "Search the workbook for text, numbers or formula fragments. Returns matching cell addresses with their values (up to 100).",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, sheet: { type: "string", description: "Limit to one sheet" }, inFormulas: { type: "boolean" } },
      required: ["query"],
    },
  },
  {
    name: "excel_trace",
    description: "Trace a cell's precedents (cells its formula uses) or dependents (cells that use it), across sheets. Use to explain or audit a model before changing it.",
    parameters: {
      type: "object",
      properties: { sheet: { type: "string" }, cell: { type: "string" }, direction: { type: "string", enum: ["precedents", "dependents"] } },
      required: ["sheet", "cell", "direction"],
    },
  },
  {
    name: "excel_check_errors",
    description: "Scan the workbook (or one sheet) for error cells — #REF!, #DIV/0!, #VALUE!, #NAME?, #N/A, #NUM!, #SPILL! — with their formulas. Run after building or changing a model.",
    parameters: { type: "object", properties: { sheet: { type: "string" } } },
  },
  {
    name: "excel_create_table",
    description: "Turn a range with headers into an Excel table (filters, banding).",
    parameters: {
      type: "object",
      properties: { sheet: { type: "string" }, range: { type: "string" }, name: { type: "string" }, style: { type: "string", description: "e.g. TableStyleMedium2" } },
      required: ["sheet", "range"],
    },
  },
  {
    name: "excel_create_chart",
    description: "Add a chart from a data range (first row/column as labels).",
    parameters: {
      type: "object",
      properties: {
        sheet: { type: "string" }, dataRange: { type: "string" },
        type: { type: "string", enum: ["column", "bar", "line", "pie", "scatter", "area", "doughnut"] },
        title: { type: "string" }, anchorCell: { type: "string", description: "Top-left cell to place the chart" },
      },
      required: ["sheet", "dataRange", "type"],
    },
  },
  {
    name: "excel_conditional_format",
    description: "Add conditional formatting: colour scale, data bars, or highlight cells matching a rule (greater than / less than / between / equal to / contains text).",
    parameters: {
      type: "object",
      properties: {
        sheet: { type: "string" }, range: { type: "string" },
        kind: { type: "string", enum: ["colorScale", "dataBar", "cellValue", "textContains"] },
        operator: { type: "string", enum: ["GreaterThan", "LessThan", "Between", "EqualTo", "NotEqualTo", "GreaterThanOrEqual", "LessThanOrEqual"] },
        value1: { type: "string" }, value2: { type: "string" }, text: { type: "string" },
        fillColor: { type: "string" }, fontColor: { type: "string" },
      },
      required: ["sheet", "range", "kind"],
    },
  },
  {
    name: "excel_named_range",
    description: "Create or update a workbook named range (for assumptions etc.).",
    parameters: { type: "object", properties: { name: { type: "string" }, sheet: { type: "string" }, range: { type: "string" } }, required: ["name", "sheet", "range"] },
  },
  {
    name: "excel_freeze_panes",
    description: "Freeze the top rows and/or left columns of a sheet (0 to unfreeze).",
    parameters: { type: "object", properties: { sheet: { type: "string" }, rows: { type: "number" }, columns: { type: "number" } }, required: ["sheet"] },
  },
  {
    name: "excel_select",
    description: "Select a range and scroll to it so the user sees what you are talking about.",
    parameters: { type: "object", properties: { sheet: { type: "string" }, range: { type: "string" } }, required: ["sheet", "range"] },
  },
].map(t => ({ type: "function", function: t }));

export const EXCEL_TOOL_NAMES = new Set(EXCEL_TOOL_DEFS.map((t: any) => t.function.name));

export const EXCEL_AGENT_PROMPT = `

## EXCEL — you are ChatBGP working inside the user's open workbook
You are the full ChatBGP (every BGP tool: CRM, deals, properties, comps, SharePoint, knowledge bank, email, memory) AND you drive the open workbook directly through the excel_* tools. The task pane carries each tool call out live in Excel and hands you the result — work like a senior analyst sitting at the user's keyboard.

How to work:
- Start a new task with excel_workbook_overview, then excel_read_range the areas involved. Never guess an address, a label or what a formula does — read it.
- Change the workbook yourself with the tools. Write whole blocks with excel_write_range (2D arrays, formulas as "=..."), then format them. Never hand the user formulas to paste, and never emit JSON action blocks.
- Build models the way a good modeller does: inputs/assumptions in one clearly labelled block (blue font for hard-coded inputs), calculations referencing them by cell (no hard-coded numbers in formulas), outputs summarised; consistent formulas across rows; £ and % number formats; totals that tie.
- After writing formulas, check the returned results. If any cell errors, or excel_check_errors finds errors, fix them before you reply.
- Explaining or auditing: use excel_trace and excel_read_range, and walk through the logic with real addresses and values.
- Bring in BGP data whenever it helps: comps, deal terms, rents, tenant covenants, requirements, pathway data — pull it with your BGP tools and write it into the sheet with its source noted.
- Destructive changes (deleting sheets, rows or columns, overwriting a block of existing inputs) need a one-line confirmation from the user first unless they asked for exactly that. The user can undo each round of changes from the pane.
- Cite the cells you changed as [[Sheet!A1:B4]] — they become clickable. UK English, UK number formatting.
`;

// How every Office pane talks (Woody, 2026-09-28: "I don't think all this
// back end explanation is the same as normal Claude?"). Claude's own Office
// add-ins report the outcome in plain words and keep the working out of sight.
export const OFFICE_VOICE = `
## How to talk to the user
They are property people, not spreadsheet or software engineers. Reply the way Claude's own Office add-ins do:
- Don't announce what you're about to do — just do it, then report.
- Lead with the result in one or two plain sentences about THEIR content (people, teams, rents, deals), e.g. "Will's now in London Estate, High Street and City on every tab."
- If several things changed, add at most 3–4 short bullets. No headings, no essays.
- Never explain the mechanics unless asked: no function or formula names, spills, cached values, recalculation, error codes, tool names, versions of Excel, or counts of cells you read or wrote.
- If you had to change how the file works, say it in one plain sentence with the practical effect ("these tabs won't update by themselves now — ask me when the roster changes").
- Ask one question at most, only when you're genuinely stuck, and put it last. Offer a numbered choice only when the decision really matters.
- Keep it under about 80 words unless they asked for a review or an explanation.
`;

// ── Tool bridge ───────────────────────────────────────────────────────────
type Pending = { resolve: (r: any) => void; timer: NodeJS.Timeout };
const runs = new Map<string, { userId: string; calls: Map<string, Pending> }>();

export function openExcelRun(userId: string): string {
  const runId = crypto.randomUUID();
  runs.set(runId, { userId, calls: new Map() });
  return runId;
}

export function closeExcelRun(runId: string) {
  const run = runs.get(runId);
  if (!run) return;
  for (const p of run.calls.values()) { clearTimeout(p.timer); p.resolve({ error: "The chat ended before Excel replied." }); }
  runs.delete(runId);
}

export function callExcelTool(runId: string, send: (payload: any) => void, name: string, args: any, timeoutMs = 120_000): Promise<any> {
  const run = runs.get(runId);
  if (!run) return Promise.resolve({ error: "Excel session closed." });
  const callId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      run.calls.delete(callId);
      resolve({ error: "Excel didn't answer within two minutes — the task pane may have been closed." });
    }, timeoutMs);
    run.calls.set(callId, { resolve, timer });
    send({ excelTool: { runId, callId, name, args } });
  });
}

export function registerExcelAgentRoutes(app: Express, requireAuth: any) {
  app.post("/api/chatbgp/excel-tool-result", requireAuth, (req: Request, res: Response) => {
    const { runId, callId, result } = req.body || {};
    const run = runs.get(String(runId || ""));
    const userId = req.session.userId || (req as any).tokenUserId;
    if (!run || run.userId !== userId) return res.status(404).json({ message: "No such Excel run" });
    const pending = run.calls.get(String(callId || ""));
    if (!pending) return res.status(404).json({ message: "No such call" });
    clearTimeout(pending.timer);
    run.calls.delete(String(callId));
    pending.resolve(result ?? { error: "Empty result" });
    res.json({ ok: true });
  });

  // Each workbook's conversation, so reopening the file picks up where you
  // left off (and search_chat_history-style recall works per workbook).
  app.get("/api/chatbgp/excel-session", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || (req as any).tokenUserId;
      const key = workbookKey(String(req.query.workbook || ""));
      if (!key) return res.json({ messages: [] });
      const r = await pool.query(`SELECT messages, updated_at FROM excel_sessions WHERE user_id = $1 AND workbook_key = $2`, [userId, key]);
      res.json({ messages: r.rows[0]?.messages || [], updatedAt: r.rows[0]?.updated_at || null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
  app.delete("/api/chatbgp/excel-session", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.session.userId || (req as any).tokenUserId;
      await pool.query(`DELETE FROM excel_sessions WHERE user_id = $1 AND workbook_key = $2`, [userId, workbookKey(String(req.query.workbook || ""))]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

export const workbookKey = (name: string) => name.trim().toLowerCase().replace(/\.(xlsx|xlsm|xls|xlsb|csv)$/i, "").slice(0, 300);

export async function saveExcelSession(userId: string, workbook: string, messages: Array<{ role: string; content: string }>) {
  const key = workbookKey(workbook);
  if (!key) return;
  const kept = messages.filter(m => typeof m.content === "string" && m.content.trim()).slice(-60)
    .map(m => ({ role: m.role, content: m.content.slice(0, 20000) }));
  await pool.query(
    `INSERT INTO excel_sessions (user_id, workbook_key, workbook_name, messages, updated_at) VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (user_id, workbook_key) DO UPDATE SET messages = EXCLUDED.messages, workbook_name = EXCLUDED.workbook_name, updated_at = NOW()`,
    [userId, key, workbook.slice(0, 300), JSON.stringify(kept)]);
}

// Earlier conversations on this workbook, summarised for the system prompt
// when the pane starts fresh (a new device, or after Clear).
export async function workbookHistoryContext(userId: string, workbook: string): Promise<string> {
  const key = workbookKey(workbook);
  if (!key) return "";
  const r = await pool.query(`SELECT messages, updated_at FROM excel_sessions WHERE user_id = $1 AND workbook_key = $2`, [userId, key]).catch(() => ({ rows: [] as any[] }));
  const msgs: any[] = r.rows[0]?.messages || [];
  if (!msgs.length) return "";
  const lines = msgs.slice(-12).map((m: any) => `${m.role === "user" ? "User" : "You"}: ${String(m.content).replace(/\s+/g, " ").slice(0, 400)}`);
  return `\n\n## Earlier work on this workbook (${new Date(r.rows[0].updated_at).toLocaleDateString("en-GB")})\n${lines.join("\n")}\n`;
}
