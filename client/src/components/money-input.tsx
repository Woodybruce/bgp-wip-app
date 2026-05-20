/**
 * MoneyInput — a text-mode input that displays UK-formatted currency
 * (£1,234,567) but emits a plain number to its onChange.
 *
 * Why a custom component:
 *   - HTML `<input type="number">` doesn't render thousands separators.
 *     UK salary / fee fields look weird at "£245000" — needs commas.
 *   - This wrapper keeps the underlying value as a number for parents
 *     to do maths with, while showing a formatted string in the input.
 *   - Format on blur (commit), accept lax input while typing.
 *
 * Drop-in replacement for `<Input type="number" value={n} onChange=…>`
 * in places where the value is a £ amount.
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: number | null | undefined;
  onCommit: (value: number | null) => void;     // fired on blur / Enter, after parsing
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  prefix?: string;                                // default "£"
  allowNegative?: boolean;
  testId?: string;
}

function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString("en-GB", { maximumFractionDigits: 0 });
}

function parseMoney(s: string, allowNegative: boolean): number | null {
  if (!s) return null;
  // Strip everything except digits, decimal point, minus sign.
  const cleaned = s.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return null;
  if (n < 0 && !allowNegative) return Math.abs(n);
  return Math.round(n);
}

export function MoneyInput({
  value,
  onCommit,
  placeholder,
  className,
  disabled,
  prefix = "£",
  allowNegative = false,
  testId,
}: Props) {
  const [text, setText] = useState<string>(() => formatMoney(value));
  const [focused, setFocused] = useState(false);

  // Sync external value changes into our display when not focused.
  useEffect(() => {
    if (!focused) setText(formatMoney(value));
  }, [value, focused]);

  return (
    <div className="relative">
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">
        {prefix}
      </span>
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        onFocus={() => {
          setFocused(true);
          // Show the raw number while editing so commas don't fight the cursor.
          if (value !== null && value !== undefined && Number.isFinite(value)) {
            setText(String(Math.round(value)));
          }
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = parseMoney(text, allowNegative);
          setText(formatMoney(parsed));
          onCommit(parsed);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn("pl-7", className)}
        data-testid={testId}
      />
    </div>
  );
}
