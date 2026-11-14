import { Link } from "wouter";
import { CompanyLogoImg } from "@/pages/properties";
import { cn } from "@/lib/utils";

// One way to draw a company on a row (consistency review, 2026-11-14): its
// logo (initials when there is none), its name, a link to its page when the
// caller has an id for it, and an optional role ("Tenant", "Landlord",
// "Agent"). The server decides who may open a company: pass `id` only when
// the reply carried one, never a guess from the name.
export function CompanyChip({ id, name, domain, role, size = 18, className, testId, title }: {
  id?: string | null;
  name: string | null | undefined;
  domain?: string | null;
  role?: string | null;
  size?: number;
  className?: string;
  testId?: string;
  title?: string;
}) {
  if (!name) return null;
  const label = <span className="truncate">{name}</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0 max-w-full align-middle", className)} data-testid={testId} title={title || name}>
      <CompanyLogoImg domain={domain || null} name={name} size={size} />
      {id
        ? <Link href={`/companies/${encodeURIComponent(id)}`} className="min-w-0 truncate hover:underline" onClick={e => e.stopPropagation()}>{label}</Link>
        : <span className="min-w-0 truncate">{label}</span>}
      {role ? <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] font-semibold text-muted-foreground">{role}</span> : null}
    </span>
  );
}
