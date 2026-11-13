// The deals list on a brand's page (Deals & space): the 20 most recent deals
// the brand is a party to, with its role, the property and unit, the stage and
// the last update, each linking to the deal. The rows come from the brand
// profile (`dealList`), already limited on the server to what the viewer may
// see, with no fee or team. A wide card draws a table; a narrow one (a phone,
// or the desktop with the chat panel open) draws the card list.
import { Link } from "wouter";
import { DEAL_STATUS_LABELS, legacyToCode } from "@shared/deal-status";
import { dealStagePillClass } from "@/components/brand-crm/scheme-plan-card";
import { gbDate } from "@/lib/format";
import { BrandCard, BrandQuietLine, ShowAll, brandCardAction, brandQuietLink, useCap } from "./brand-card";

export interface BrandDealRow {
  id: string;
  deal_ref: number | null;
  name: string;
  deal_type: string | null;
  status: string | null;
  role: "tenant" | "landlord" | "vendor" | "purchaser" | null;
  property_id: string | null;
  property_name: string | null;
  unit_name: string | null;
  updated_at: string | null;
}
export interface BrandDealListData { rows: BrandDealRow[]; total: number; live: number; completed: number }

const ROLE_LABEL: Record<string, string> = { tenant: "Tenant", landlord: "Landlord", vendor: "Vendor", purchaser: "Purchaser" };
const DEALS_CAP = 8;

const fullDate = (iso: string | null) => iso ? gbDate(iso, { day: "numeric", month: "short", year: "numeric" }) : "";
function lastUpdate(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return fullDate(iso);
}

function StageChip({ status }: { status: string | null }) {
  const code = legacyToCode(status);
  if (!code) return <span className="text-muted-foreground">—</span>;
  // The same pill, in the same tone, as the stage on the Schemes and units card.
  return <span className={dealStagePillClass(code)}>{DEAL_STATUS_LABELS[code]}</span>;
}

export function BrandDealsCard({ list, staff, knownEmpty = true, dealsHref, unitLabel, cap: capRows = DEALS_CAP }: {
  // The phone shows five, then "Show all".
  cap?: number;
  list: BrandDealListData | null | undefined;
  // BGP staff get the quiet line when there are no deals, and the link to the
  // Deals board; a client login gets neither.
  staff: boolean;
  // False when the page's own deal counts say there are deals but the list
  // came back empty (it failed to load): then nothing is claimed.
  knownEmpty?: boolean;
  dealsHref: string;
  unitLabel?: (unit: string, property: string | null) => string | null;
}) {
  const rows = list?.rows || [];
  const total = Math.max(list?.total || 0, rows.length);
  const cap = useCap(rows, capRows);
  if (rows.length === 0) {
    return staff && knownEmpty ? (
      <BrandQuietLine testId="brand-deals-empty">
        No deals recorded with this brand yet · <Link href={dealsHref} className={brandQuietLink}>Add to deal</Link>
      </BrandQuietLine>
    ) : null;
  }
  const unitOf = (d: BrandDealRow) => d.unit_name ? (unitLabel?.(d.unit_name, d.property_name) || d.unit_name) : null;
  const newest = rows[0]?.updated_at;
  const summary = <>
    <span className="font-mono tabular-nums">{list!.live}</span> live · <span className="font-mono tabular-nums">{list!.completed}</span> completed
    {newest && <> · last update {lastUpdate(newest)}</>}
  </>;
  const refLine = (d: BrandDealRow) => [d.deal_ref != null ? `#${d.deal_ref}` : null, d.deal_type].filter(Boolean).join(" · ");
  return (
    <BrandCard title="Deals" count={total} summary={summary} testId="brand-deals-card" className="[container-type:inline-size]"
      action={staff ? <Link href={dealsHref} className={brandCardAction} data-testid="link-brand-deals-board">Open in Deals</Link> : undefined}>
      {/* One line per deal, the size of the landlord page's deals table: the
          name (cut with an ellipsis, the full name on hover), its Ref and type
          on a small second line. */}
      <div className="hidden [@container(min-width:560px)]:block overflow-x-auto">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col /><col className="w-[6rem]" /><col className="w-[32%]" /><col className="w-[8rem]" /><col className="w-[6.5rem]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/40">
              <th className="py-1 pr-4 font-semibold">Deal</th>
              <th className="py-1 pr-4 font-semibold">Role</th>
              <th className="py-1 pr-4 font-semibold">Property / unit</th>
              <th className="py-1 pr-4 font-semibold">Stage</th>
              <th className="py-1 font-semibold text-right">Updated</th>
            </tr>
          </thead>
          <tbody>
            {cap.shown.map(d => {
              const unit = unitOf(d);
              return (
                <tr key={d.id} className="align-top border-b border-border/20 last:border-0 hover:bg-muted/40" data-testid={`brand-deal-row-${d.id}`}>
                  <td className="py-1.5 pr-4">
                    <Link href={`/deals?id=${d.id}`} className="block truncate text-[13px] font-medium text-foreground hover:text-primary hover:underline" title={d.name || "Deal"}>{d.name || "Deal"}</Link>
                    {refLine(d) && <span className="block truncate text-[11px] text-muted-foreground tabular-nums">{refLine(d)}</span>}
                  </td>
                  <td className="py-1.5 pr-4 text-muted-foreground whitespace-nowrap">{d.role ? ROLE_LABEL[d.role] : "—"}</td>
                  <td className="py-1.5 pr-4">
                    {d.property_name
                      ? (d.property_id ? <Link href={`/properties/${d.property_id}`} className="block truncate text-[13px] hover:underline" title={d.property_name}>{d.property_name}</Link> : <span className="block truncate text-[13px]" title={d.property_name}>{d.property_name}</span>)
                      : <span className="text-muted-foreground">—</span>}
                    {unit && <span className="block truncate text-[11px] text-muted-foreground" title={unit}>{unit}</span>}
                  </td>
                  <td className="py-1.5 pr-4"><StageChip status={d.status} /></td>
                  <td className="py-1.5 text-right text-muted-foreground tabular-nums whitespace-nowrap" title={fullDate(d.updated_at)}>{lastUpdate(d.updated_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* A narrow card (a phone, or the desktop beside an open chat): plain
          divided rows, as the Viewings card draws them. The deal's name in ink,
          the stage on its right, one grey line of detail; the whole row opens
          the deal. */}
      <div className="[@container(min-width:560px)]:hidden divide-y divide-border/40">
        {cap.shown.map(d => {
          const detail = [d.role ? ROLE_LABEL[d.role] : null, refLine(d) || null, d.property_name, unitOf(d), lastUpdate(d.updated_at)].filter(Boolean).join(" · ");
          return (
            <Link key={d.id} href={`/deals?id=${d.id}`} className="block py-2 first:pt-0 last:pb-0 min-w-0" data-testid={`brand-deal-card-${d.id}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-sm font-medium text-foreground break-words">{d.name || "Deal"}</span>
                <span className="shrink-0"><StageChip status={d.status} /></span>
              </span>
              <span className="block text-[11px] text-muted-foreground break-words" title={fullDate(d.updated_at)}>{detail}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3">
        {cap.over && (total > rows.length && !cap.open ? (
          // More deals than the list holds: say so, so "all" is not read as the total.
          <button type="button" onClick={cap.toggle} className="mt-1.5 text-xs text-primary hover:underline" aria-expanded={false} data-testid="button-brand-deals-all">
            Show the <span className="font-mono tabular-nums">{rows.length}</span> most recent
          </button>
        ) : <ShowAll total={rows.length} open={cap.open} onToggle={cap.toggle} testId="button-brand-deals-all" />)}
        {total > rows.length && (!cap.over || cap.open) && (
          <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="brand-deals-more">
            The <span className="font-mono tabular-nums">{rows.length}</span> most recent of <span className="font-mono tabular-nums">{total.toLocaleString("en-GB")}</span>
          </p>
        )}
      </div>
    </BrandCard>
  );
}
