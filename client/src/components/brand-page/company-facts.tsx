// Company facts on a brand's Company checks card: a few lines on the
// collapsed card and the full list behind Show more. Both are worked out by
// shared/company-facts.ts from the stored Companies House record and the
// covenant report the card has already loaded. Presentational only: no
// request is made here.
import { companyFacts } from "@shared/company-facts";

type Props = { company: Parameters<typeof companyFacts>[0]; report?: Parameters<typeof companyFacts>[1] };
const warnClass = "text-amber-700 dark:text-amber-400";

export function CompanyFactsSummary({ company, report }: Props) {
  const { summary } = companyFacts(company, report);
  if (!summary.length) return null;
  return (
    <div className="space-y-0.5" data-testid="brand-checks-facts-summary">
      {summary.map(line => (
        <p key={line.key} className={`text-xs leading-snug tabular-nums break-words ${line.warn ? warnClass : "text-muted-foreground"}`}>{line.text}</p>
      ))}
    </div>
  );
}

export function CompanyFactsRows({ company, report, headingClass }: Props & { headingClass: string }) {
  const { rows } = companyFacts(company, report);
  if (!rows.length) return null;
  return (
    <section className="border-t border-border pt-3 space-y-2" aria-label="Company facts" data-testid="brand-checks-facts">
      <h3 className={headingClass}>Company facts</h3>
      <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        {rows.map(row => (
          <div key={row.key} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className={`tabular-nums break-words ${row.warn ? warnClass : "text-foreground"}`}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
