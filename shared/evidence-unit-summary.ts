/** Evidence remains an observation of a transaction, separate from current lease facts. */
export interface EvidenceSummaryEntry {
  id: string;
  unit_id: string | null;
  transaction_date?: string | null;
  created_at?: string | null;
  headline_rent?: string | number | null;
  size_sqft?: string | number | null;
}

export function evidenceHasNumber(value: unknown): value is string | number {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== ""))
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function evidenceDate(value: string | null | undefined): number {
  if (!value) return -Infinity;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

/** Keep a summary from one entry; never combine figures from different transactions. */
export function orderedUnitEvidence<T extends EvidenceSummaryEntry>(entries: T[], unitId: string): T[] {
  const compareDates = (left: number, right: number) => left === right ? 0 : left > right ? -1 : 1;
  return entries.filter(entry => entry.unit_id === unitId).sort((a, b) =>
    compareDates(evidenceDate(a.transaction_date), evidenceDate(b.transaction_date))
    || compareDates(evidenceDate(a.created_at), evidenceDate(b.created_at))
    || a.id.localeCompare(b.id));
}

export function evidenceSummaryIsFuture(entry: EvidenceSummaryEntry, today?: string): boolean {
  // Calendar dates use the user's local day, avoiding a midnight UTC shift.
  const now = new Date();
  const day = today || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const transactionDay = entry.transaction_date?.slice(0, 10);
  return !!transactionDay && Number.isFinite(evidenceDate(transactionDay))
    && Number.isFinite(evidenceDate(day)) && transactionDay > day;
}

/** Called only after the user chooses fields to review in the existing unit editor. */
export function evidenceUnitFactDraft(entry: EvidenceSummaryEntry, selected: { size: boolean; passingRent: boolean }): { sqft?: string; passingRent?: string } {
  const draft: { sqft?: string; passingRent?: string } = {};
  if (selected.size && evidenceHasNumber(entry.size_sqft)) draft.sqft = String(entry.size_sqft).trim();
  if (selected.passingRent && evidenceHasNumber(entry.headline_rent)) draft.passingRent = String(entry.headline_rent).trim();
  // Transaction date and term are not evidence of expiry, break or review dates.
  return draft;
}
