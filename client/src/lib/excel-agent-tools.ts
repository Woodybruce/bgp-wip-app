// The task pane's half of ChatBGP-in-Excel (server/excel-agent.ts): each
// excel_* tool call from the model is carried out here with Office.js and
// the result goes back to the server. Every change records what it
// replaced so a whole round can be undone.
declare const Excel: any;

export interface UndoStep {
  kind: "cells" | "sheetCreated";
  sheet: string;
  address?: string;
  formulas?: any[][];
  numberFormat?: any[][];
}

const MAX_READ_CELLS = 6000;
const ERROR_VALUES = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!", "#SPILL!", "#CALC!", "#FIELD!", "#BLOCKED!", "#CONNECT!", "#BUSY!", "#UNKNOWN!"]);
const isError = (v: any) => typeof v === "string" && ERROR_VALUES.has(v);
const bareAddress = (address: string) => String(address || "").split("!").pop() || "";

function colName(n: number): string {
  let s = "";
  for (n = n + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
function topLeft(address: string): { row: number; col: number } {
  const m = bareAddress(address).replace(/\$/g, "").match(/^([A-Z]+)(\d+)/i);
  if (!m) return { row: 0, col: 0 };
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

function sheetOf(ctx: any, name: string) {
  return ctx.workbook.worksheets.getItem(name);
}

// Cells as compact lines: "B4: 1250 | =B2*B3" — values and formulas, skipping blanks.
function describeCells(address: string, values: any[][], formulas: any[][], formats?: any[][]) {
  const { row, col } = topLeft(address);
  const lines: string[] = [];
  let shown = 0;
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const v = values[r][c];
      const f = formulas?.[r]?.[c];
      if ((v === "" || v === null) && (f === "" || f === null || f === undefined)) continue;
      if (shown >= MAX_READ_CELLS) break;
      const addr = `${colName(col + c)}${row + r + 1}`;
      const hasFormula = typeof f === "string" && f.startsWith("=");
      const fmt = formats?.[r]?.[c] && formats[r][c] !== "General" ? ` [${formats[r][c]}]` : "";
      lines.push(`${addr}: ${JSON.stringify(v)}${hasFormula ? ` | ${f}` : ""}${fmt}`);
      shown++;
    }
  }
  const total = values.length * (values[0]?.length || 0);
  return { address, rows: values.length, columns: values[0]?.length || 0, cells: lines.join("\n"), truncated: shown >= MAX_READ_CELLS ? `Only the first ${MAX_READ_CELLS} non-empty cells of ${total} — read a smaller range for the rest.` : undefined };
}

function grid<T>(rows: number, cols: number, value: T): T[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => value));
}

async function snapshot(ctx: any, sheet: string, range: any): Promise<UndoStep> {
  range.load(["address", "formulas", "numberFormat"]);
  await ctx.sync();
  return { kind: "cells", sheet, address: bareAddress(range.address), formulas: range.formulas, numberFormat: range.numberFormat };
}

export async function undoSteps(steps: UndoStep[]): Promise<{ restored: number; failed: number }> {
  let restored = 0, failed = 0;
  for (const step of [...steps].reverse()) {
    try {
      await Excel.run(async (ctx: any) => {
        if (step.kind === "sheetCreated") {
          ctx.workbook.worksheets.getItem(step.sheet).delete();
        } else {
          const range = sheetOf(ctx, step.sheet).getRange(step.address);
          if (step.numberFormat) range.numberFormat = step.numberFormat;
          if (step.formulas) range.formulas = step.formulas;
        }
        await ctx.sync();
      });
      restored++;
    } catch { failed++; }
  }
  return { restored, failed };
}

const CHART_TYPES: Record<string, string> = {
  column: "ColumnClustered", bar: "BarClustered", line: "Line", pie: "Pie", scatter: "XYScatter", area: "Area", doughnut: "Doughnut",
};

export async function runExcelTool(name: string, args: any, undo: UndoStep[]): Promise<any> {
  try {
    return await Excel.run(async (ctx: any) => {
      const wb = ctx.workbook;
      switch (name) {
        case "excel_workbook_overview": {
          const sheets = wb.worksheets;
          sheets.load("items/name,items/visibility");
          const selection = wb.getSelectedRange();
          selection.load("address");
          const tables = wb.tables;
          tables.load("items/name");
          const names = wb.names;
          names.load("items/name,items/formula");
          await ctx.sync();
          const used = sheets.items.map((s: any) => { const u = s.getUsedRangeOrNullObject(true); u.load("address,rowCount,columnCount"); return u; });
          const panes = sheets.items.map((s: any) => { const p = s.freezePanes.getLocationOrNullObject(); p.load("address"); return p; });
          const tableRanges = tables.items.map((t: any) => { const r = t.getRange(); r.load("address"); return r; });
          await ctx.sync();
          return {
            sheets: sheets.items.map((s: any, i: number) => ({
              name: s.name, hidden: s.visibility !== "Visible",
              usedRange: used[i].isNullObject ? null : bareAddress(used[i].address),
              rows: used[i].isNullObject ? 0 : used[i].rowCount, columns: used[i].isNullObject ? 0 : used[i].columnCount,
              frozen: panes[i].isNullObject ? null : bareAddress(panes[i].address),
            })),
            tables: tables.items.map((t: any, i: number) => ({ name: t.name, range: tableRanges[i].address })),
            namedRanges: names.items.map((n: any) => ({ name: n.name, refersTo: n.formula })),
            selection: selection.address,
          };
        }
        case "excel_read_range": {
          const sheet = sheetOf(ctx, args.sheet);
          const range = args.range ? sheet.getRange(args.range) : sheet.getUsedRangeOrNullObject(true);
          range.load(["address", "values", "formulas", ...(args.includeFormats ? ["numberFormat"] : [])]);
          await ctx.sync();
          if (range.isNullObject) return { sheet: args.sheet, empty: true };
          const out: any = { sheet: args.sheet, ...describeCells(range.address, range.values, range.formulas, args.includeFormats ? range.numberFormat : undefined) };
          if (args.includeFormats) {
            const first = sheet.getRange(bareAddress(range.address));
            first.format.font.load("bold,color");
            first.format.fill.load("color");
            await ctx.sync();
            out.style = { bold: first.format.font.bold, fontColor: first.format.font.color, fill: first.format.fill.color };
          }
          return out;
        }
        case "excel_write_range": {
          const sheet = sheetOf(ctx, args.sheet);
          const rows: any[][] = Array.isArray(args.values) ? args.values.map((r: any) => Array.isArray(r) ? r : [r]) : [[args.values]];
          const width = Math.max(1, ...rows.map(r => r.length));
          const cells = rows.map(r => Array.from({ length: width }, (_, i) => {
            const v = r[i];
            if (v === null || v === undefined) return "";
            if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
            return v;
          }));
          const start = sheet.getRange(bareAddress(args.range).split(":")[0]);
          const target = start.getResizedRange(cells.length - 1, width - 1);
          undo.push(await snapshot(ctx, args.sheet, target));
          target.formulas = cells;
          if (args.numberFormat) target.numberFormat = grid(cells.length, width, args.numberFormat);
          target.load(["address", "values"]);
          await ctx.sync();
          const errors: string[] = [];
          const { row, col } = topLeft(target.address);
          target.values.forEach((r: any[], ri: number) => r.forEach((v: any, ci: number) => {
            if (isError(v)) errors.push(`${colName(col + ci)}${row + ri + 1}: ${v} (${cells[ri][ci]})`);
          }));
          return { written: target.address, cells: cells.length * width, results: describeCells(target.address, target.values, cells).cells.slice(0, 8000), errors };
        }
        case "excel_format_range": {
          const range = sheetOf(ctx, args.sheet).getRange(args.range);
          if (args.numberFormat) {
            range.load("rowCount,columnCount");
            undo.push(await snapshot(ctx, args.sheet, range));
            range.numberFormat = grid(range.rowCount, range.columnCount, args.numberFormat);
          }
          const f = range.format;
          if (typeof args.bold === "boolean") f.font.bold = args.bold;
          if (typeof args.italic === "boolean") f.font.italic = args.italic;
          if (args.fontColor) f.font.color = args.fontColor;
          if (args.fontSize) f.font.size = args.fontSize;
          if (args.fillColor) f.fill.color = args.fillColor;
          if (args.horizontalAlignment) f.horizontalAlignment = args.horizontalAlignment;
          if (typeof args.wrapText === "boolean") f.wrapText = args.wrapText;
          if (args.borders) {
            const edges = args.borders === "all" ? ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight", "InsideHorizontal", "InsideVertical"]
              : args.borders === "outline" ? ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight"]
              : args.borders === "bottom" ? ["EdgeBottom"] : [];
            if (args.borders === "none") for (const e of ["EdgeTop", "EdgeBottom", "EdgeLeft", "EdgeRight", "InsideHorizontal", "InsideVertical"]) f.borders.getItem(e).style = "None";
            for (const e of edges) { const b = f.borders.getItem(e); b.style = "Continuous"; b.color = "#C2BAA3"; }
          }
          if (args.columnWidth) f.columnWidth = args.columnWidth;
          if (args.autofitColumns) f.autofitColumns();
          if (args.merge) range.merge(false);
          await ctx.sync();
          return { formatted: args.range };
        }
        case "excel_sheet": {
          const sheets = wb.worksheets;
          if (args.op === "create") {
            const s = sheets.add(args.sheet);
            s.activate();
            await ctx.sync();
            undo.push({ kind: "sheetCreated", sheet: args.sheet });
            return { created: args.sheet };
          }
          const s = sheets.getItem(args.sheet);
          if (args.op === "rename") s.name = args.newName;
          else if (args.op === "delete") s.delete();
          else if (args.op === "activate") s.activate();
          else if (args.op === "copy") { const c = s.copy("End"); if (args.newName) c.name = args.newName; }
          await ctx.sync();
          return { done: args.op, sheet: args.sheet, ...(args.op === "delete" ? { note: "Deleting a sheet can't be undone from the pane." } : {}) };
        }
        case "excel_rows_columns": {
          const range = sheetOf(ctx, args.sheet).getRange(args.range);
          const isCols = /^[A-Z]+:[A-Z]+$/i.test(String(args.range).replace(/\$/g, ""));
          if (args.op === "insert") range.insert(isCols ? "Right" : "Down");
          else range.delete(isCols ? "Left" : "Up");
          await ctx.sync();
          return { done: args.op, range: args.range, note: "Row/column inserts and deletes can't be undone from the pane." };
        }
        case "excel_clear_range": {
          const range = sheetOf(ctx, args.sheet).getRange(args.range);
          undo.push(await snapshot(ctx, args.sheet, range));
          range.clear(args.what === "formats" ? "Formats" : args.what === "all" ? "All" : "Contents");
          await ctx.sync();
          return { cleared: args.range };
        }
        case "excel_find": {
          const q = String(args.query || "").toLowerCase();
          const sheets = wb.worksheets;
          sheets.load("items/name");
          await ctx.sync();
          const targets = sheets.items.filter((s: any) => !args.sheet || s.name === args.sheet);
          const used = targets.map((s: any) => { const u = s.getUsedRangeOrNullObject(true); u.load("address,values,formulas"); return u; });
          await ctx.sync();
          const matches: string[] = [];
          targets.forEach((s: any, i: number) => {
            const u = used[i];
            if (u.isNullObject) return;
            const { row, col } = topLeft(u.address);
            u.values.forEach((r: any[], ri: number) => r.forEach((v: any, ci: number) => {
              if (matches.length >= 100) return;
              const f = u.formulas[ri][ci];
              const hay = `${v}`.toLowerCase() + (args.inFormulas && typeof f === "string" ? ` ${f.toLowerCase()}` : "");
              if (q && hay.includes(q)) matches.push(`${s.name}!${colName(col + ci)}${row + ri + 1}: ${JSON.stringify(v)}${typeof f === "string" && f.startsWith("=") ? ` | ${f}` : ""}`);
            }));
          });
          return { matches, count: matches.length };
        }
        case "excel_trace": {
          const cell = sheetOf(ctx, args.sheet).getRange(args.cell);
          cell.load("formulas,values");
          await ctx.sync();
          try {
            const areas = args.direction === "dependents" ? cell.getDirectDependents() : cell.getDirectPrecedents();
            areas.areas.load("items/address");
            await ctx.sync();
            return { cell: `${args.sheet}!${args.cell}`, formula: cell.formulas[0][0], value: cell.values[0][0], [args.direction]: areas.areas.items.map((a: any) => a.address) };
          } catch {
            return { cell: `${args.sheet}!${args.cell}`, formula: cell.formulas[0][0], value: cell.values[0][0], note: "This Excel can't trace automatically — read the formula's references instead." };
          }
        }
        case "excel_check_errors": {
          const sheets = wb.worksheets;
          sheets.load("items/name");
          await ctx.sync();
          const targets = sheets.items.filter((s: any) => !args.sheet || s.name === args.sheet);
          const used = targets.map((s: any) => { const u = s.getUsedRangeOrNullObject(true); u.load("address,values,formulas"); return u; });
          await ctx.sync();
          const errors: string[] = [];
          targets.forEach((s: any, i: number) => {
            const u = used[i];
            if (u.isNullObject) return;
            const { row, col } = topLeft(u.address);
            u.values.forEach((r: any[], ri: number) => r.forEach((v: any, ci: number) => {
              if (errors.length < 200 && isError(v)) errors.push(`${s.name}!${colName(col + ci)}${row + ri + 1}: ${v} | ${u.formulas[ri][ci]}`);
            }));
          });
          return { errors, count: errors.length };
        }
        case "excel_create_table": {
          const t = sheetOf(ctx, args.sheet).tables.add(args.range, true);
          if (args.name) t.name = String(args.name).replace(/[^A-Za-z0-9_]/g, "_");
          if (args.style) t.style = args.style;
          await ctx.sync();
          return { table: args.name || "created", range: args.range };
        }
        case "excel_create_chart": {
          const sheet = sheetOf(ctx, args.sheet);
          const chart = sheet.charts.add(CHART_TYPES[args.type] || "ColumnClustered", sheet.getRange(args.dataRange), "Auto");
          if (args.title) chart.title.text = args.title;
          if (args.anchorCell) chart.setPosition(args.anchorCell);
          await ctx.sync();
          return { chart: args.type, data: args.dataRange };
        }
        case "excel_conditional_format": {
          const range = sheetOf(ctx, args.sheet).getRange(args.range);
          if (args.kind === "colorScale") {
            const cf = range.conditionalFormats.add("ColorScale");
            cf.colorScale.criteria = {
              minimum: { formula: null, type: "LowestValue", color: "#F8D7D2" },
              midpoint: { formula: "50", type: "Percentile", color: "#FCF8F4" },
              maximum: { formula: null, type: "HighestValue", color: "#CFE8D6" },
            };
          } else if (args.kind === "dataBar") {
            range.conditionalFormats.add("DataBar");
          } else if (args.kind === "textContains") {
            const cf = range.conditionalFormats.add("ContainsText");
            cf.textComparison.format.fill.color = args.fillColor || "#FCE3DD";
            if (args.fontColor) cf.textComparison.format.font.color = args.fontColor;
            cf.textComparison.rule = { operator: "Contains", text: String(args.text || "") };
          } else {
            const cf = range.conditionalFormats.add("CellValue");
            cf.cellValue.format.fill.color = args.fillColor || "#FCE3DD";
            if (args.fontColor) cf.cellValue.format.font.color = args.fontColor;
            cf.cellValue.rule = { formula1: String(args.value1 ?? "0"), ...(args.value2 !== undefined ? { formula2: String(args.value2) } : {}), operator: args.operator || "GreaterThan" };
          }
          await ctx.sync();
          return { conditionalFormat: args.kind, range: args.range };
        }
        case "excel_named_range": {
          const existing = wb.names.getItemOrNullObject(args.name);
          await ctx.sync();
          if (!existing.isNullObject) existing.delete();
          wb.names.add(args.name, sheetOf(ctx, args.sheet).getRange(args.range));
          await ctx.sync();
          return { name: args.name, refersTo: `${args.sheet}!${args.range}` };
        }
        case "excel_freeze_panes": {
          const panes = sheetOf(ctx, args.sheet).freezePanes;
          panes.unfreeze();
          const rows = Number(args.rows || 0), cols = Number(args.columns || 0);
          if (rows && cols) panes.freezeAt(sheetOf(ctx, args.sheet).getRangeByIndexes(0, 0, rows, cols));
          else if (rows) panes.freezeRows(rows);
          else if (cols) panes.freezeColumns(cols);
          await ctx.sync();
          return { frozen: { rows, columns: cols } };
        }
        case "excel_select": {
          const sheet = sheetOf(ctx, args.sheet);
          sheet.activate();
          sheet.getRange(args.range).select();
          await ctx.sync();
          return { selected: `${args.sheet}!${args.range}` };
        }
        default:
          return { error: `Unknown Excel tool ${name}` };
      }
    });
  } catch (e: any) {
    return { error: e?.message || String(e), code: e?.code };
  }
}

// [[Sheet!A1:B4]] references in a reply — shown as clickable chips.
export function cellRefs(text: string): Array<{ label: string; sheet: string; range: string }> {
  const out: Array<{ label: string; sheet: string; range: string }> = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\[\[([^\]!]+)!([A-Z$]+\d*(?::[A-Z$]+\d*)?)\]\]/gi)) {
    const sheet = m[1].replace(/^'|'$/g, "");
    const key = `${sheet}!${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: key, sheet, range: m[2] });
  }
  return out;
}

export async function selectRange(sheet: string, range: string) {
  await Excel.run(async (ctx: any) => {
    const s = ctx.workbook.worksheets.getItem(sheet);
    s.activate();
    s.getRange(range).select();
    await ctx.sync();
  });
}

export async function workbookName(): Promise<string> {
  try {
    const url = (window as any).Office?.context?.document?.url || "";
    const fromUrl = decodeURIComponent(String(url).split(/[\\/]/).pop() || "").split("?")[0];
    if (fromUrl) return fromUrl;
  } catch {}
  try {
    return await Excel.run(async (ctx: any) => {
      ctx.workbook.load("name");
      await ctx.sync();
      return ctx.workbook.name || "";
    });
  } catch { return ""; }
}
