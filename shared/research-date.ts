// When a piece of investment research was published (Jack, 2026-11-17: "my
// most recent (by date published) ... the latest publications sit at the
// top"). Rules only. The order of trust: a day or month in the file name, the
// date the PDF was made (passed in as `pdfDate`), a quarter, half or year in
// the name, a month on the report's first page, else nothing (the caller
// uses the upload date). Tests: server/research-sector.test.ts.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

type Found = { date: Date; exact: boolean };

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));
const year = (s: string) => { const n = Number(s); return n < 100 ? 2000 + n : n; };

function sane(d: Date, today: Date): Date | null {
  if (isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 2000) return null;
  if (d.getTime() > today.getTime() + 45 * 86_400_000) return null;
  return d;
}

function clean(s: string): string {
  return s.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_+]+/g, " ").toLowerCase();
}

// A day or a month: 2026-11-03, 20261103, 03.11.2026, 3 Nov 2026, Nov 2026, Nov-26.
function exactDate(t: string, today: Date): Date | null {
  let m = t.match(/(?<!\d)(20\d\d)[-. ]?(0[1-9]|1[0-2])[-. ]?(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (m) { const d = sane(utc(+m[1], +m[2] - 1, +m[3]), today); if (d) return d; }
  m = t.match(/(?<!\d)(0?[1-9]|[12]\d|3[01])[-./](0?[1-9]|1[0-2])[-./](20\d\d)(?!\d)/);
  if (m) { const d = sane(utc(+m[3], +m[2] - 1, +m[1]), today); if (d) return d; }
  m = t.match(new RegExp(`(?<![a-z])(?:(\\d{1,2})(?:st|nd|rd|th)?[ -])?${MON}[ ,.'-]*(20\\d\\d|\\d\\d)(?!\\d)`));
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3));
    const d = sane(utc(year(m[3]), mon, m[1] ? +m[1] : 1), today);
    if (d) return d;
  }
  m = t.match(/(?<!\d)(20\d\d)[-. ](0[1-9]|1[0-2])(?![\d.-])/);
  if (m) { const d = sane(utc(+m[1], +m[2] - 1), today); if (d) return d; }
  return null;
}

// A quarter, a half or a bare year: Q3 2026, 2026 Q3, Q3-26, H1 2026, 2026.
function roughDate(t: string, today: Date): Date | null {
  let m = t.match(/\bq([1-4])[ -]?(20\d\d|\d\d)(?!\d)/) || t.match(/(?<!\d)(20\d\d)[ -]?q([1-4])\b/);
  if (m) {
    const [q, y] = /^q/.test(m[0]) ? [+m[1], year(m[2])] : [+m[2], +m[1]];
    const d = sane(utc(y, q * 3 - 1), today) || sane(utc(y, q * 3 - 3), today);
    if (d) return d;
  }
  m = t.match(/\bh([12])[ -]?(20\d\d|\d\d)(?!\d)/) || t.match(/(?<!\d)(20\d\d)[ -]?h([12])\b/);
  if (m) {
    const [h, y] = /^h/.test(m[0]) ? [+m[1], year(m[2])] : [+m[2], +m[1]];
    const d = sane(utc(y, h === 1 ? 5 : 11), today) || sane(utc(y, h === 1 ? 0 : 6), today);
    if (d) return d;
  }
  m = t.match(/(?<!\d)(20[0-3]\d)(?!\d)/);
  if (m) return sane(utc(+m[1], 0), today);
  return null;
}

export function researchPublishedOn(
  fileName: string,
  text?: string | null,
  pdfDate?: Date | null,
  today: Date = new Date(),
): Date | null {
  const name = clean(fileName || "");
  const fromName = exactDate(name, today);
  if (fromName) return fromName;
  if (pdfDate) { const d = sane(pdfDate, today); if (d) return d; }
  const rough = roughDate(name, today);
  if (rough) return rough;
  const cover = String(text || "").slice(0, 1500).toLowerCase();
  return exactDate(cover, today) || roughDate(cover, today);
}

// pdfinfo's "CreationDate:   Tue Nov  3 10:12:00 2026 GMT" line.
export function pdfInfoDate(info: string): Date | null {
  const line = info.match(/^CreationDate:\s*(.+)$/m)?.[1]?.trim();
  if (!line) return null;
  const d = new Date(line.replace(/\s+[A-Z]{2,5}$/, ""));
  return isNaN(d.getTime()) ? null : d;
}
