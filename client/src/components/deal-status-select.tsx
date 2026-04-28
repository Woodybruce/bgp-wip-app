import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DealStatusCode,
  DEAL_STATUS_LABELS,
  LETTING_STATUSES,
  INVESTMENT_STATUSES,
  WIP_STATUSES,
  DEAL_PAGE_STATUSES,
  SYSTEM_SET_STATUSES,
  legacyToCode,
} from "@shared/deal-status";

type Context = "letting" | "investment" | "wip" | "deal";

const CONTEXT_OPTIONS: Record<Context, DealStatusCode[]> = {
  letting: LETTING_STATUSES,
  investment: INVESTMENT_STATUSES,
  wip: WIP_STATUSES,
  deal: DEAL_PAGE_STATUSES,
};

interface DealStatusSelectProps {
  value: string | null | undefined;
  onChange: (next: DealStatusCode) => void;
  context: Context;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}

export function DealStatusSelect({
  value,
  onChange,
  context,
  disabled,
  placeholder = "Select status",
  className,
  testId,
}: DealStatusSelectProps) {
  const options = CONTEXT_OPTIONS[context];
  // Coerce legacy strings to canonical codes so the dropdown always matches a real option
  const canonical = legacyToCode(value);

  return (
    <Select
      value={canonical ?? undefined}
      onValueChange={(v) => onChange(v as DealStatusCode)}
      disabled={disabled}
    >
      <SelectTrigger className={className} data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((code) => {
          const isSystemSet = SYSTEM_SET_STATUSES.includes(code);
          return (
            <SelectItem
              key={code}
              value={code}
              disabled={isSystemSet}
              title={isSystemSet ? "Set automatically when a Xero invoice syncs" : undefined}
            >
              {DEAL_STATUS_LABELS[code]}
              {isSystemSet ? " (auto)" : ""}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
