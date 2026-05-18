export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return `£${value.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Convert any of (Date | timestamp string | "YYYY-MM-DD") into a
// "YYYY-MM-DD" string suitable for an HTML <input type="date">.
// Critically, does NOT do `new Date(s).toISOString().slice(0,10)` —
// that converts to UTC and shifts a day for any UK timestamp set
// after midnight UTC during BST. Instead:
//   * if the input already looks like "YYYY-MM-DD..." we trust it
//     (server-stored date-only fields)
//   * otherwise we use the LOCAL date components so a 23:00 UK
//     timestamp stays on its UK date, not its UTC date
export function toDateInputValue(v: string | Date | null | undefined): string {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = typeof v === "string" ? new Date(v) : v;
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
