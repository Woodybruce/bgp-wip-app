import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NONE = "__none__";

// Month + year dropdowns. `<input type="month">` isn't supported in Safari or
// Firefox, which fall back to a free-text box that mangles typed dates.
// value / onChange use "YYYY-MM" ("" when cleared); onChange fires only once
// both halves are picked, or when either is cleared.
export function MonthYearSelect({ value, onChange, className, triggerClassName }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  triggerClassName?: string;
}) {
  const [year, setYear] = useState(value ? value.slice(0, 4) : "");
  const [month, setMonth] = useState(value ? value.slice(5, 7) : "");
  useEffect(() => {
    setYear(value ? value.slice(0, 4) : "");
    setMonth(value ? value.slice(5, 7) : "");
  }, [value]);

  const thisYear = new Date().getFullYear();
  const years: string[] = [];
  for (let y = 2026; y <= thisYear + 8; y++) years.push(String(y));
  if (year && !years.includes(year)) years.unshift(year);

  const commit = (m: string, y: string) => {
    setMonth(m);
    setYear(y);
    if (m && y) onChange(`${y}-${m}`);
    else if (value) onChange("");
  };

  return (
    <div className={`grid grid-cols-[3fr_2fr] gap-2 min-w-0 ${className || ""}`}>
      <Select value={month || NONE} onValueChange={v => commit(v === NONE ? "" : v, year)}>
        <SelectTrigger className={triggerClassName} data-testid="select-month"><SelectValue placeholder="Month" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Month</SelectItem>
          {MONTHS.map((name, i) => {
            const m = String(i + 1).padStart(2, "0");
            return <SelectItem key={m} value={m}>{name}</SelectItem>;
          })}
        </SelectContent>
      </Select>
      <Select value={year || NONE} onValueChange={v => commit(month, v === NONE ? "" : v)}>
        <SelectTrigger className={triggerClassName} data-testid="select-year"><SelectValue placeholder="Year" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Year</SelectItem>
          {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
