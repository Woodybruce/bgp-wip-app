import { useEffect, useRef } from "react";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/presets/preset-sheets-core";
import sheetsCoreEnUS from "@univerjs/presets/preset-sheets-core/locales/en-US";
import type {
  FUniver,
  ICellData,
  IColumnData,
  IObjectArrayPrimitiveType,
  IObjectMatrixPrimitiveType,
  IStyleData,
  IWorkbookData,
  Univer,
} from "@univerjs/presets";
import "@univerjs/presets/lib/styles/preset-sheets-core.css";

/** One cell as served by the models `/cells` endpoint (SheetJS-shaped). */
export interface SheetCellPayload {
  v: unknown;
  f?: string;
  t?: string;
  w?: string;
  s?: { numFmt?: string } | null;
}

/** One worksheet as served by the models `/cells` endpoint. */
export interface SheetPayload {
  totalRows: number;
  totalCols: number;
  rows: (SheetCellPayload | null)[][];
  merges: { r: number; c: number; rs: number; cs: number }[];
  colWidths?: number[];
  inputCells: string[];
  outputCells: string[];
}

export interface WorkbookPayload {
  sheetNames: string[];
  sheets: Record<string, SheetPayload>;
}

export interface CellEdit {
  sheet: string;
  cell: string;
  value: string;
}

export interface UniverSpreadsheetProps {
  workbookName: string;
  payload: WorkbookPayload;
  /** sheetName → cellRef ("H7") → format hint ("percent" | "number0" | "number2") */
  formatHints: Record<string, Record<string, string>>;
  editable?: boolean;
  onCellEdit?: (edit: CellEdit) => void;
  /**
   * Optional bulk variant of `onCellEdit`: one call per user mutation carrying every
   * affected cell (a 20×10 paste arrives as a single call with 200 edits). When omitted,
   * the batch is fanned out into sequential `onCellEdit` calls, so existing parents keep working.
   */
  onCellsEdit?: (edits: CellEdit[]) => void;
  onActiveSheetChange?: (sheetName: string) => void;
}

const FORMAT_PATTERNS: Record<string, string> = {
  percent: "0.0%",
  number0: "#,##0",
  number2: "#,##0.00",
};

const INPUT_BG = "#dbeafe";
const OUTPUT_BG = "#dcfce7";

/**
 * The single mutation every user value-write funnels through in Univer 0.17.0 — typing
 * (editor commit → `sheet.command.set-range-values`), Ctrl+V paste (clipboard service
 * `syncExecuteCommand`s it with no options), fill-drag (`sheet.command.auto-fill`), and
 * Delete/Backspace (`sheet.command.clear-selection-content`) all execute it.
 */
const SET_RANGE_VALUES_MUTATION_ID = "sheet.mutation.set-range-values";

/**
 * `SetRangeValuesMutation.params.trigger` values that mark style/metadata-only writes,
 * not value edits (the same list sheets-formula uses to ignore non-value mutations).
 */
const NON_VALUE_TRIGGERS = new Set([
  "sheet.command.set-style",
  "sheet.command.set-border",
  "sheet.command.clear-selection-format",
  "sheet.command.set-range-custom-metadata",
]);

/** Shape of `sheet.mutation.set-range-values` params (`ICommandEvent.params` is `any` in the facade, so narrow it here). */
interface SetRangeValuesParams {
  unitId?: string;
  subUnitId?: string;
  trigger?: string;
  cellValue?: Record<number, Record<number, ICellData | null> | null>;
}

/**
 * Convert one `set-range-values` cell entry to the `CellEdit.value` contract:
 * `""` for cleared, "=…" for formulas, otherwise the stringified raw value.
 * Returns `undefined` for style-only entries (`{ s: … }` with no value keys), which
 * carry no value change and must not be reported.
 */
function mutationCellToEditValue(cell: ICellData | null): string | undefined {
  if (cell === null) return ""; // cleared, style not retained
  if (typeof cell.f === "string" && cell.f !== "") return cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
  if (cell.v !== undefined && cell.v !== null) return String(cell.v);
  if (cell.p) {
    const dataStream = cell.p.body?.dataStream;
    return typeof dataStream === "string" ? dataStream.replace(/[\r\n]+$/, "") : "";
  }
  // Explicit clear that keeps the cell style: `{ v: null, f: null, p: null, s: … }`.
  if ("v" in cell || "f" in cell || "p" in cell) return "";
  return undefined;
}

let unitCounter = 0;

function colLetter(c: number): string {
  let s = "";
  let n = c;
  while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
  return s;
}

function toUniverCell(
  cell: SheetCellPayload,
  cellRef: string,
  hints: Record<string, string>,
  inputSet: Set<string>,
  outputSet: Set<string>
): ICellData | null {
  const out: ICellData = {};
  if (cell.f) out.f = cell.f.startsWith("=") ? cell.f : `=${cell.f}`;
  const v = cell.v;
  if (typeof v === "number" || typeof v === "boolean") out.v = v;
  else if (typeof v === "string" && v !== "") out.v = v;

  const numFmt = hints[cellRef] ? FORMAT_PATTERNS[hints[cellRef]] : cell.s?.numFmt || undefined;
  const bg = inputSet.has(cellRef) ? INPUT_BG : outputSet.has(cellRef) ? OUTPUT_BG : undefined;
  if (numFmt || bg) {
    const style: IStyleData = {};
    if (numFmt) style.n = { pattern: numFmt };
    if (bg) style.bg = { rgb: bg };
    out.s = style;
  }

  if (out.f === undefined && out.v === undefined && out.s === undefined) return null;
  return out;
}

function sheetColumnCount(sheet: SheetPayload): number {
  let cols = sheet.totalCols || 0;
  for (const row of sheet.rows) cols = Math.max(cols, row.length);
  return Math.max(cols, 1);
}

function buildSnapshot(
  workbookName: string,
  payload: WorkbookPayload,
  formatHints: Record<string, Record<string, string>>
): IWorkbookData {
  const sheets: IWorkbookData["sheets"] = {};

  payload.sheetNames.forEach((sheetName, index) => {
    const id = `sheet-${index}`;
    const sheet = payload.sheets[sheetName];
    if (!sheet) {
      sheets[id] = { id, name: sheetName, rowCount: 100, columnCount: 20, cellData: {} };
      return;
    }

    const hints = formatHints[sheetName] || {};
    const inputSet = new Set(sheet.inputCells);
    const outputSet = new Set(sheet.outputCells);
    const cellData: IObjectMatrixPrimitiveType<ICellData> = {};
    sheet.rows.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const converted = toUniverCell(cell, `${colLetter(c)}${r + 1}`, hints, inputSet, outputSet);
        if (converted) (cellData[r] ||= {})[c] = converted;
      });
    });

    const columnData: IObjectArrayPrimitiveType<Partial<IColumnData>> = {};
    sheet.colWidths?.forEach((w, c) => {
      if (w > 0) columnData[c] = { w };
    });

    sheets[id] = {
      id,
      name: sheetName,
      cellData,
      mergeData: sheet.merges.map((m) => ({
        startRow: m.r,
        startColumn: m.c,
        endRow: m.r + m.rs - 1,
        endColumn: m.c + m.cs - 1,
      })),
      rowCount: Math.max(sheet.rows.length, 1),
      columnCount: sheetColumnCount(sheet),
      columnData,
      defaultColumnWidth: 88,
      defaultRowHeight: 24,
    };
  });

  unitCounter += 1;
  return {
    id: `model-workbook-${Date.now()}-${unitCounter}`,
    name: workbookName,
    appVersion: "0.17.0",
    locale: LocaleType.EN_US,
    styles: {},
    sheetOrder: payload.sheetNames.map((_, i) => `sheet-${i}`),
    sheets,
  };
}

/** Dense rectangle of cell data used for in-place refreshes after a server round-trip. */
function buildCellMatrix(
  sheet: SheetPayload,
  hints: Record<string, string>
): ICellData[][] {
  const rows = Math.max(sheet.rows.length, 1);
  const cols = sheetColumnCount(sheet);
  const inputSet = new Set(sheet.inputCells);
  const outputSet = new Set(sheet.outputCells);
  const matrix: ICellData[][] = [];
  for (let r = 0; r < rows; r++) {
    const outRow: ICellData[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = sheet.rows[r]?.[c];
      // `v: null` (not `{}`) so a cell the server cleared after the round-trip is wiped
      // in place instead of retaining its stale value.
      outRow.push((cell && toUniverCell(cell, `${colLetter(c)}${r + 1}`, hints, inputSet, outputSet)) || { v: null });
    }
    matrix.push(outRow);
  }
  return matrix;
}

export default function UniverSpreadsheet({
  workbookName,
  payload,
  formatHints,
  editable,
  onCellEdit,
  onCellsEdit,
  onActiveSheetChange,
}: UniverSpreadsheetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<Univer | null>(null);
  const univerAPIRef = useRef<FUniver | null>(null);
  const workbookIdRef = useRef<string | null>(null);
  const initialisedRef = useRef(false);

  // Latest-value refs so Univer event handlers (registered once at mount) never go stale.
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const onCellEditRef = useRef(onCellEdit);
  onCellEditRef.current = onCellEdit;
  const onCellsEditRef = useRef(onCellsEdit);
  onCellsEditRef.current = onCellsEdit;
  const onActiveSheetChangeRef = useRef(onActiveSheetChange);
  onActiveSheetChangeRef.current = onActiveSheetChange;
  const payloadRef = useRef(payload);
  const formatHintsRef = useRef(formatHints);
  // Set while this component writes server data into the grid (initial load + refresh
  // `setValues`), so those programmatic writes are not echoed back as user edits.
  const applyingRemoteRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS) },
      darkMode: false,
      presets: [
        UniverSheetsCorePreset({
          container: containerRef.current,
          header: false,
          toolbar: false,
          formulaBar: true,
          footer: { sheetBar: true, statisticBar: true, menus: false, zoomSlider: true },
        }),
      ],
    });
    univerRef.current = univer;
    univerAPIRef.current = univerAPI;

    applyingRemoteRef.current = true;
    let workbook;
    try {
      workbook = univerAPI.createWorkbook(
        buildSnapshot(workbookName, payloadRef.current, formatHintsRef.current)
      );
    } finally {
      applyingRemoteRef.current = false;
    }
    workbookIdRef.current = workbook.getId();
    workbook.setEditable(editableRef.current === true);

    const disposers = [
      // Edit capture at the mutation layer: unlike SheetEditEnded this also fires for
      // paste, fill-drag, Delete/Backspace, and undo/redo — all of which commit through
      // `sheet.mutation.set-range-values`. It replaces the old SheetEditEnded listener,
      // which covered only typing and would now double-report it.
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
        if (!editableRef.current) return;
        if (applyingRemoteRef.current) return;
        if (event.id !== SET_RANGE_VALUES_MUTATION_ID) return;
        const options = event.options;
        // `fromFormula`: the formula engine's own writebacks (array-formula spills, image
        // formulas) also use this mutation — never user edits. The rest are defensive
        // (collab / changeset replay are not in use here, but must not be reported).
        if (options?.fromFormula || options?.fromCollab || options?.fromSync || options?.fromChangeset) return;
        const params = event.params as SetRangeValuesParams | undefined;
        if (!params || params.unitId !== workbookIdRef.current || !params.subUnitId) return;
        if (params.trigger && NON_VALUE_TRIGGERS.has(params.trigger)) return;
        if (!params.cellValue) return;
        const worksheet = univerAPI.getWorkbook(params.unitId)?.getSheetBySheetId(params.subUnitId);
        if (!worksheet) return;
        const sheetName = worksheet.getSheetName();
        const edits: CellEdit[] = [];
        for (const [rowKey, rowValue] of Object.entries(params.cellValue)) {
          if (!rowValue) continue;
          const row = Number(rowKey);
          for (const [colKey, cell] of Object.entries(rowValue)) {
            const value = mutationCellToEditValue(cell);
            if (value === undefined) continue;
            edits.push({ sheet: sheetName, cell: `${colLetter(Number(colKey))}${row + 1}`, value });
          }
        }
        if (edits.length === 0) return;
        if (onCellsEditRef.current) onCellsEditRef.current(edits);
        else if (onCellEditRef.current) for (const edit of edits) onCellEditRef.current(edit);
      }),
      univerAPI.addEvent(univerAPI.Event.ActiveSheetChanged, (params) => {
        onActiveSheetChangeRef.current?.(params.activeSheet.getSheetName());
      }),
    ];

    initialisedRef.current = true;
    return () => {
      disposers.forEach((d) => d.dispose());
      initialisedRef.current = false;
      workbookIdRef.current = null;
      univerAPIRef.current = null;
      univerRef.current = null;
      univer.dispose();
    };
    // Univer instance lives for the component's lifetime; data flows in via the refresh effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh path: after an edit POST or a Design Assistant change the parent refetches and
  // passes a new payload object. Same sheet set → update values in place (keeps scroll/selection);
  // different sheets → rebuild the workbook unit.
  useEffect(() => {
    if (!initialisedRef.current) {
      payloadRef.current = payload;
      formatHintsRef.current = formatHints;
      return;
    }
    const prev = payloadRef.current;
    if (prev === payload && formatHintsRef.current === formatHints) return;

    const univerAPI = univerAPIRef.current;
    const workbookId = workbookIdRef.current;
    if (!univerAPI || !workbookId) return;

    const sameSheets =
      prev.sheetNames.length === payload.sheetNames.length &&
      prev.sheetNames.every((s, i) => s === payload.sheetNames[i]);

    if (!sameSheets) {
      applyingRemoteRef.current = true;
      try {
        univerAPI.disposeUnit(workbookId);
        const workbook = univerAPI.createWorkbook(buildSnapshot(workbookName, payload, formatHints));
        workbookIdRef.current = workbook.getId();
        workbook.setEditable(editableRef.current !== false);
      } finally {
        applyingRemoteRef.current = false;
      }
    } else {
      const workbook = univerAPI.getWorkbook(workbookId);
      if (workbook) {
        applyingRemoteRef.current = true;
        try {
          for (const sheetName of payload.sheetNames) {
            const sheet = payload.sheets[sheetName];
            const worksheet = workbook.getSheetByName(sheetName);
            if (!sheet || !worksheet) continue;
            worksheet
              .getRange(0, 0, Math.max(sheet.rows.length, 1), sheetColumnCount(sheet))
              .setValues(buildCellMatrix(sheet, formatHints[sheetName] || {}));
          }
        } finally {
          applyingRemoteRef.current = false;
        }
      }
    }

    payloadRef.current = payload;
    formatHintsRef.current = formatHints;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, formatHints]);

  return <div ref={containerRef} className="h-full w-full" data-testid="univer-spreadsheet" />;
}
