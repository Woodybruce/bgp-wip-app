// Small shared pieces of the client Agents page (docs/DESIGN.md: token
// colours, 11px metadata, mono counts, tables on desktop, cards on phones).
import { useState } from "react";
import { Link } from "wouter";
import { Mail, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ClientAgentBrand } from "@shared/client-agent-directory";

export const TH = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
export const TD = "px-3 py-2 align-top text-sm";
export const CHIP = "inline-flex max-w-full items-center rounded-full border border-border bg-background px-2 py-0.5 text-xs leading-tight";
const LINK = "underline decoration-border underline-offset-2 hover:decoration-foreground";

export function Count({ n }: { n: number }) {
  return <span className="font-mono tabular-nums">{n.toLocaleString()}</span>;
}

export function SectionHeading({ title, count, noun, description, testId }: {
  title: string; count: number; noun: [string, string]; description: string; testId: string;
}) {
  return (
    <div className="space-y-0.5">
      <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold" data-testid={`${testId}-heading`}>
        {title}
        <span className="text-xs font-normal text-muted-foreground" data-testid={`${testId}-count`}>
          <Count n={count} /> {count === 1 ? noun[0] : noun[1]}
        </span>
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function TableShell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card" data-testid={testId}>
      <table className="w-full min-w-[860px] table-fixed border-collapse">{children}</table>
    </div>
  );
}

export function EmailLink({ email, phone = false }: { email: string | null; phone?: boolean }) {
  if (!email) return null;
  return (
    <a href={`mailto:${email}`} className={cn("inline-flex max-w-full items-center gap-1.5", LINK, phone && "min-h-11")}>
      {phone && <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      {/* Break at the @ first; only split a word when the column is narrower than either half. */}
      <span className="[overflow-wrap:break-word] min-w-0">{email.includes("@") ? <>{email.slice(0, email.indexOf("@"))}<wbr />{email.slice(email.indexOf("@"))}</> : email}</span>
    </a>
  );
}

export function PhoneLink({ number, phone = false }: { number: string | null; phone?: boolean }) {
  if (!number) return null;
  // "+44 (0)7738 448 338" dials as +447738448338: the bracketed trunk 0 is
  // not part of an international number.
  const dial = (number.trim().startsWith("+") ? number.replace(/\(\s*0\s*\)/, "") : number).replace(/[^\d+]/g, "");
  return (
    <a href={`tel:${dial}`} className={cn("inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap", LINK, phone && "min-h-11")}>
      {phone && <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      {number}
    </a>
  );
}

export const NotRecorded = ({ children = "Not recorded" }: { children?: React.ReactNode }) => (
  <span className="text-[11px] text-muted-foreground">{children}</span>
);

// Scheme or property names as one compact line of text; the chosen scheme
// is picked out in bold.
export function NameChips({ names, active, empty = "—" }: { names: { key: string; name: string }[]; active?: string | null; empty?: string }) {
  if (names.length === 0) return <span className="text-[11px] text-muted-foreground">{empty}</span>;
  return (
    <span className="block text-xs leading-5 text-muted-foreground">
      {names.map((n, i) => (
        <span key={n.key}>
          <span className={cn(active === n.key ? "font-semibold text-foreground" : active ? "" : "text-foreground")}>{n.name}</span>
          {i < names.length - 1 && ", "}
        </span>
      ))}
    </span>
  );
}

// Brand chips that open the brand page. Every brand here is in the viewer's
// Brand Directory, so the page is one they may open.
export function BrandChips({ brands, limit = 6, expanded = false }: { brands: ClientAgentBrand[]; limit?: number; expanded?: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const open = showAll || expanded || brands.length <= limit;
  const shown = open ? brands : brands.slice(0, limit);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map(brand => (
        <Link key={brand.brandId} href={`/companies/${brand.brandId}`} className={cn(CHIP, "hover:bg-muted")} data-testid={`client-agent-brand-${brand.brandId}`}>
          <span className="truncate">{brand.brandName}</span>
        </Link>
      ))}
      {brands.length > limit && !expanded && (
        <button type="button" data-no-min-touch className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground" onClick={() => setShowAll(!showAll)} aria-expanded={open}>
          {showAll ? "Show fewer" : <>+<Count n={brands.length - limit} /> more</>}
        </button>
      )}
    </span>
  );
}

export function ShowAllButton({ open, total, noun, onToggle, testId }: {
  open: boolean; total: number; noun: string; onToggle: () => void; testId: string;
}) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onToggle} aria-expanded={open} data-testid={testId}>
      <span>{open ? `Show fewer ${noun}` : <>Show all <Count n={total} /> {noun}</>}</span>
    </Button>
  );
}

export function PersonAvatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("");
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground" aria-hidden="true">
      {photoUrl && !failed
        ? <img src={photoUrl} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
        : initials}
    </span>
  );
}
