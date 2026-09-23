import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

export type EvidenceWorkbookCandidate = {
  sheetName: string;
  unitRef: string | null;
  tenant: string | null;
  transactionType: string | null;
  transactionDate: string | null;
  sizeSqft: number | null;
  zoneA: number | null;
  itza: number | null;
  headlineRent: number | null;
  netEffective: number | null;
  term: string | null;
  concession: string | null;
  notes: string | null;
};

type Field = Exclude<keyof EvidenceWorkbookCandidate, "sheetName">;
const fieldLabels: Record<Field, string> = {
  unitRef: "unit reference", tenant: "tenant", transactionType: "transaction type",
  transactionDate: "transaction date", sizeSqft: "area in sq ft", zoneA: "Zone A rate",
  itza: "ITZA", headlineRent: "headline rent", netEffective: "net rent",
  term: "lease term", concession: "concessions", notes: "notes",
};
const numericFields = new Set<Field>(["sizeSqft", "zoneA", "itza", "headlineRent", "netEffective"]);
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_COLUMNS = 256;
const MAX_SHEETS = 20;
const MAX_CELLS = 50000;

function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/£/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function labelField(value: string): Field | null {
  const label = normaliseLabel(value);
  const aliases: [Field, RegExp][] = [
    ["unitRef", /^(unit|unit ref|unit reference|unit no|unit number|premises ref)$/],
    ["tenant", /^(tenant|tenant name|occupier|occupier name|trading name)$/],
    ["transactionType", /^(transaction|transaction type|type of transaction|deal type)$/],
    ["transactionDate", /^(transaction date|date of transaction|evidence date|commencement date|lease start date)$/],
    ["sizeSqft", /^(gia|nia|gross internal area|net internal area|total area|size|size sqft|size sq ft|area sqft|area sq ft)(?: sqft| sq ft| square feet)?$/],
    ["itza", /^(itza|itza area|area itza|total itza)(?: sqft| sq ft| square feet)?$/],
    ["zoneA", /^(zone a rate|zone a psf|zone a rent psf|zone a rent|psf itza|rate psf itza|rent psf itza|itza rate|itza psf)$/],
    ["headlineRent", /^(base headline rent|headline rent|base rent|annual headline rent|headline rent pa|headline rent p a)$/],
    ["netEffective", /^(net rent|net effective|net effective rent|net rent pa|net effective rent pa|net rent p a|net effective rent p a)$/],
    ["term", /^(term|lease term|proposed term)$/],
    ["concession", /^(incentive|incentives|concession|concessions|rent free|rent free period)$/],
    ["notes", /^(notes|comments|remarks)$/],
  ];
  return aliases.find(([, expression]) => expression.test(label))?.[0] ?? null;
}

function textValue(cell: XLSX.CellObject): string | null {
  if (cell.t === "e" || cell.v === undefined || cell.v === null) return null;
  if (typeof cell.v !== "string" && typeof cell.v !== "number") return null;
  return String(cell.v).trim().slice(0, 4000) || null;
}

function numericValue(cell: XLSX.CellObject): number | null {
  if (cell.t === "e" || cell.t === "z" || cell.t === "b" || cell.t === "d" || /%/.test(String(cell.z || ""))) return null;
  if (typeof cell.v === "number") return Number.isFinite(cell.v) && cell.v >= 0 ? cell.v : null;
  if (typeof cell.v !== "string") return null;
  const value = cell.v.trim().replace(/^£\s*/, "").replace(/\s*(?:p\.?a\.?|per annum|psf|sq\.?\s*ft\.?|sqft|square feet)\s*$/i, "").trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function dateValue(cell: XLSX.CellObject): string | null {
  if (cell.t === "d" && cell.v instanceof Date && Number.isFinite(cell.v.getTime())) {
    return cell.v.toISOString().slice(0, 10);
  }
  if (typeof cell.v !== "string") return null;
  const value = cell.v.trim();
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const uk = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  const named = value.match(/^(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : uk ? [Number(uk[3]), Number(uk[2]), Number(uk[1])]
      : named ? [Number(named[3]), months.indexOf(named[2].slice(0, 3).toLowerCase()) + 1, Number(named[1])] : null;
  if (!parts) return null;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? date.toISOString().slice(0, 10) : null;
}

function emptyCandidate(sheetName: string): EvidenceWorkbookCandidate {
  return { sheetName, unitRef: null, tenant: null, transactionType: null, transactionDate: null,
    sizeSqft: null, zoneA: null, itza: null, headlineRent: null, netEffective: null,
    term: null, concession: null, notes: null };
}

function validateContainer(buffer: Buffer, fileName: string): void {
  if (!/\.(xls|xlsx)$/i.test(fileName)) throw new Error("Upload an Excel .xls or .xlsx workbook.");
  if (buffer.length === 0 || buffer.length > MAX_BYTES) throw new Error("The Excel workbook must be between 1 byte and 20 MB.");
  const isOle = buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"));
  const isZip = buffer.subarray(0, 4).equals(Buffer.from("504b0304", "hex"));
  if (!isOle && !isZip) throw new Error("This file is not a supported Excel workbook.");
  if (isZip) {
    let entries;
    try { entries = new AdmZip(buffer).getEntries(); }
    catch { throw new Error("The Excel workbook is damaged or unreadable."); }
    if (!entries.some(entry => entry.entryName === "xl/workbook.xml")) throw new Error("This file is not an Excel .xlsx workbook.");
    if (entries.length > 2048 || entries.reduce((sum, entry) => sum + entry.header.size, 0) > 50 * 1024 * 1024) {
      throw new Error("The Excel workbook is too large to read safely. Upload a smaller TAS workbook.");
    }
    if (entries.some(entry => /(?:vbaProject\.bin|macrosheets\/)/i.test(entry.entryName))) {
      throw new Error("Macro-enabled workbooks are not supported. Save a copy without macros.");
    }
  }
}

/** Reads saved values only. It never evaluates formulas or changes an existing unit. */
export function parseEvidenceWorkbook(buffer: Buffer, fileName: string): {
  candidates: EvidenceWorkbookCandidate[];
  warnings: string[];
} {
  validateContainer(buffer, fileName);
  // SheetJS attaches cursor helpers to its input Buffer; keep the uploaded source intact.
  const readerBuffer = Buffer.from(buffer);
  let workbook: XLSX.WorkBook;
  try {
    const metadata = XLSX.read(readerBuffer, { type: "buffer", bookSheets: true });
    if (!metadata.SheetNames?.length || metadata.SheetNames.length > MAX_SHEETS) {
      throw new Error(`A TAS workbook must contain between 1 and ${MAX_SHEETS} sheets.`);
    }
    workbook = XLSX.read(readerBuffer, { type: "buffer", cellDates: true, cellNF: true, cellFormula: true,
      cellHTML: false, cellText: false, sheetStubs: true, bookVBA: true, sheetRows: MAX_ROWS + 1 });
  } catch (error) {
    throw new Error(`Could not read the Excel workbook: ${error instanceof Error ? error.message : "invalid file"}`);
  }
  if (workbook.vbaraw) throw new Error("Macro-enabled workbooks are not supported. Save a copy without macros.");
  const warnings = new Set<string>();
  const candidates: EvidenceWorkbookCandidate[] = [];
  let populatedCells = 0;
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    if (String(sheet["!type"] || "") === "macro") throw new Error("Macro sheets are not supported.");
    const reference = sheet["!fullref"] || sheet["!ref"];
    if (!reference) continue;
    const range = XLSX.utils.decode_range(reference);
    if (range.e.r >= MAX_ROWS || range.e.c >= MAX_COLUMNS || range.s.r < 0 || range.s.c < 0) {
      throw new Error(`Sheet "${name}" exceeds the supported ${MAX_ROWS}-row / ${MAX_COLUMNS}-column TAS size.`);
    }
    const cells = Object.entries(sheet).filter(([address, cell]) => !address.startsWith("!") && cell && (cell.v !== undefined || cell.f));
    populatedCells += cells.length;
    if (populatedCells > MAX_CELLS) throw new Error("The Excel workbook contains too many populated cells. Upload a smaller TAS workbook.");
    if (!cells.some(([, cell]) => cell.f || (cell.v !== null && String(cell.v).trim()))) continue;
    const candidate = emptyCandidate(name);
    const values = new Map<Field, Array<string | number>>();
    const record = (field: Field, value: string | number | null) => {
      if (value !== null) values.set(field, [...(values.get(field) || []), value]);
    };
    const present = (cell: XLSX.CellObject | undefined) => cell && (cell.f || (cell.v !== undefined && cell.v !== null && String(cell.v).trim()));
    for (const [address, cell] of cells) {
      if (typeof cell.v !== "string" || cell.f) continue;
      const field = labelField(cell.v);
      if (!field) {
        const title = cell.v.trim().match(/^unit\s+(.+?)(?:\s+[-–—]\s+(.+))?$/i);
        if (title && title[1].length <= 40 && /^[a-z0-9 /&,.-]+$/i.test(title[1]) && (/\d/.test(title[1]) || /^[a-z]{1,2}$/i.test(title[1]))) {
          record("unitRef", title[1].trim());
          if (title[2]) record("tenant", title[2].trim());
        }
        continue;
      }
      const position = XLSX.utils.decode_cell(address);
      let valueCell: XLSX.CellObject | undefined;
      let valueAddress = "";
      // Values may be separated from their label by empty cells in a formatted TAS.
      for (let offset = 1; offset <= 4 && position.c + offset <= range.e.c; offset++) {
        const target = XLSX.utils.encode_cell({ r: position.r, c: position.c + offset });
        if (present(sheet[target])) { valueCell = sheet[target]; valueAddress = target; break; }
      }
      // Some TAS forms put the rate before the "psf ITZA" suffix.
      if (field === "zoneA" && (!valueCell || labelField(String(valueCell.v ?? "")))) {
        const target = XLSX.utils.encode_cell({ r: position.r, c: Math.max(0, position.c - 1) });
        if (position.c > 0 && present(sheet[target])) { valueCell = sheet[target]; valueAddress = target; }
      }
      if (!valueCell) {
        const target = XLSX.utils.encode_cell({ r: position.r + 1, c: position.c });
        if (position.r < range.e.r && present(sheet[target])) { valueCell = sheet[target]; valueAddress = target; }
      }
      if (!valueCell || (typeof valueCell.v === "string" && labelField(valueCell.v))) continue;
      if (valueCell.f && (valueCell.v === undefined || valueCell.v === null || valueCell.v === "" || valueCell.t === "e" || valueCell.t === "z")) {
        warnings.add(`${name}!${valueAddress}: ${fieldLabels[field]} has no saved calculation result. Open and save the workbook in Excel, or enter this value manually.`);
        continue;
      }
      const value = numericFields.has(field) ? numericValue(valueCell)
        : field === "transactionDate" ? dateValue(valueCell) : textValue(valueCell);
      if (value === null) {
        warnings.add(`${name}!${valueAddress}: ${fieldLabels[field]} could not be read reliably. Check or enter this value manually.`);
      } else {
        record(field, field === "unitRef" && typeof value === "string" ? value.replace(/^unit\s+/i, "").trim() : value);
        if (numericFields.has(field)) {
          const valuePosition = XLSX.utils.decode_cell(valueAddress);
          const annotation = sheet[XLSX.utils.encode_cell({ r: valuePosition.r, c: valuePosition.c + 1 })];
          if (annotation && !annotation.f && typeof annotation.v === "string" && /^\s*\(.+\)\s*$/.test(annotation.v)) {
            record("notes", `${cell.v.trim().replace(/:$/, "")}: ${annotation.v.trim()}`);
          }
        }
      }
    }
    for (const [field, found] of values) {
      const unique = [...new Set(found)];
      if (field === "notes") candidate.notes = unique.join("\n").slice(0, 4000);
      else if (unique.length === 1) (candidate as Record<Field, string | number | null>)[field] = unique[0];
      else warnings.add(`${name}: conflicting ${fieldLabels[field]} values were found. Choose the correct value manually.`);
    }
    if (![...values.values()].some(found => found.length)) {
      warnings.add(`${name}: no recognised TAS fields were found. Keep the document and enter the evidence manually.`);
    }
    candidates.push(candidate);
  }
  if (!candidates.length) {
    candidates.push(emptyCandidate(workbook.SheetNames[0]));
    warnings.add("The workbook has no populated sheets. Keep the document and enter the evidence manually.");
  }
  warnings.add("Values reflect the last saved version of the workbook. Check the unit reference and figures before saving.");
  return { candidates, warnings: [...warnings] };
}
