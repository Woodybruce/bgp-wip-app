import { Link } from "wouter";

export interface ContactImportResult {
  inserted: number;
  insertedHere: number;
  insertedElsewhere: number;
  existing: number;
  skipped: number;
  requested: number;
  results: { name: string; status: "inserted" | "existing" | "skipped"; contactId?: string; companyId?: string; companyName?: string; reason?: string }[];
}

export function ContactImportResults({ result, error }: { result?: ContactImportResult; error?: string }) {
  if (error) return <p role="alert" className="text-sm text-destructive">Contacts could not refresh: {error}</p>;
  if (!result) return null;
  const details = result.results.filter(row => row.reason || row.status === "skipped" || row.status === "inserted");
  const reviewCount = result.skipped + result.results.filter(row => row.status === "existing" && row.reason).length;
  return <div className="rounded-lg border border-border bg-card p-3 text-sm space-y-2" data-testid="contact-import-results">
    <p role="status">
      <span className="font-mono tabular-nums">{result.insertedHere}</span> added here · <span className="font-mono tabular-nums">{result.insertedElsewhere}</span> added under their employer · <span className="font-mono tabular-nums">{result.existing}</span> already in CRM · <span className="font-mono tabular-nums">{reviewCount}</span> need review
    </p>
    <p className="text-[11px] text-muted-foreground">People are attached to their recorded employer. Finding someone from this brand page does not establish that they work for or represent this brand.</p>
    {details.length > 0 && <details>
      <summary className="cursor-pointer min-h-11 flex items-center text-sm font-medium">Show import details</summary>
      <div className="max-h-64 overflow-y-auto divide-y divide-border">
        {details.map((row, index) => <div key={`${row.contactId || row.name}-${index}`} className="py-2 space-y-1">
          {row.contactId ? <Link href={`/contacts/${row.contactId}`} className="inline-flex items-center min-h-11 font-medium hover:underline">{row.name}</Link> : <p className="font-medium">{row.name}</p>}
          {row.companyId && <p><span className="text-muted-foreground">Employer: </span><Link href={`/companies/${row.companyId}`} className="inline-flex min-h-11 items-center hover:underline">{row.companyName}</Link></p>}
          <p className="text-[11px] text-muted-foreground">{row.reason || (row.status === "inserted" ? "Contact added." : "Existing contact kept.")}</p>
        </div>)}
      </div>
    </details>}
  </div>;
}
