// The Brand CRM's "Schemes and units" card as it sits on a brand's own page.
// The card belongs to the Brand CRM (components/brand-crm) and is drawn the
// same wherever it is mounted; this is only its place on the page:
//  - its title takes the small uppercase card title every other card on the
//    page has, and "+ Scheme" reads as the page's text-link action;
//  - on the phone its lines are plain divided rows, the first three show, and
//    the rest (with "Asked for, no target yet") open with one "Show all":
//    nine boxed lines made the Overview 4,900px long.
// It restyles by the card's own test ids and changes nothing the card says.
import { useCallback, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BrandPlan } from "@shared/brand-stage";

const PHONE_ROWS = 3;

// Written out in full: the stylesheet is built from the class names found in the source.
const TITLE = [
  "[&_[data-testid=scheme-plan-card]_h3]:gap-1.5 [&_[data-testid=scheme-plan-card]_h3]:text-xs [&_[data-testid=scheme-plan-card]_h3]:uppercase",
  "[&_[data-testid=scheme-plan-card]_h3]:tracking-wider [&_[data-testid=scheme-plan-card]_h3]:text-muted-foreground",
  "[&_[data-testid=scheme-plan-card]_h3>svg]:h-3.5 [&_[data-testid=scheme-plan-card]_h3>svg]:w-3.5 [&_[data-testid=scheme-plan-card]_h3>svg]:text-muted-foreground",
  "[&_[data-testid=scheme-plan-headline]]:text-xs",
  "[&_[data-testid=scheme-plan-add]]:h-auto [&_[data-testid=scheme-plan-add]]:gap-0 [&_[data-testid=scheme-plan-add]]:border-0 [&_[data-testid=scheme-plan-add]]:bg-transparent [&_[data-testid=scheme-plan-add]]:p-0",
  "[&_[data-testid=scheme-plan-add]]:text-[11px] [&_[data-testid=scheme-plan-add]]:font-normal [&_[data-testid=scheme-plan-add]]:text-primary [&_[data-testid=scheme-plan-add]]:shadow-none",
  "[&_[data-testid=scheme-plan-add]:hover]:bg-transparent [&_[data-testid=scheme-plan-add]:hover]:underline",
  "[&_[data-testid=scheme-plan-add]_svg]:mr-0.5 [&_[data-testid=scheme-plan-add]_svg]:h-3 [&_[data-testid=scheme-plan-add]_svg]:w-3",
].join(" ");
const PHONE_ROWS_PLAIN = [
  "[&_[data-testid=scheme-plan-list]>*]:!mt-0 [&_[data-testid=scheme-plan-list]>*]:rounded-none [&_[data-testid=scheme-plan-list]>*]:border-0 [&_[data-testid=scheme-plan-list]>*]:border-b",
  "[&_[data-testid=scheme-plan-list]>*]:px-0 [&_[data-testid=scheme-plan-list]>*]:py-2.5",
  "[&_[data-testid=scheme-plan-list]>*:first-child]:pt-0 [&_[data-testid=scheme-plan-list]>*:last-child]:border-b-0 [&_[data-testid=scheme-plan-list]>*:last-child]:pb-0",
].join(" ");
const PHONE_CAPPED = "[&_[data-testid=scheme-plan-list]>*:nth-child(n+4)]:hidden [&_[data-testid=scheme-plan-asked]]:hidden";

export function SchemePlanSlot({ companyId, client, phone = false, children }: { companyId: string; client: boolean; phone?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Reads the plan the card has loaded, straight from the cache (same key).
  // It is not a query of its own, so the card's request and its refusal
  // handling stay the only ones.
  const queryClient = useQueryClient();
  const base = client ? "/api/landsec/brand-crm/plan" : "/api/brand-crm/plan";
  const subscribe = useCallback((changed: () => void) => queryClient.getQueryCache().subscribe(changed), [queryClient]);
  const plan = useSyncExternalStore(subscribe, () => queryClient.getQueryData<BrandPlan | null>([base, companyId]));
  const rows = plan?.rows?.length ?? 0;
  const asked = plan?.askedNoTarget?.length ?? 0;
  const canOpen = phone && (rows > PHONE_ROWS || asked > 0);
  return (
    <div className={`min-w-0 empty:hidden ${TITLE} ${phone ? `space-y-1 ${PHONE_ROWS_PLAIN} ${open ? "" : PHONE_CAPPED}` : ""}`} data-testid="brand-scheme-plan-slot">
      {children}
      {canOpen && (
        <button type="button" className="px-1 text-xs text-primary hover:underline" aria-expanded={open} onClick={() => setOpen(value => !value)} data-testid="button-scheme-plan-all">
          {open ? "Show fewer"
            : rows > PHONE_ROWS ? <>Show all <span className="font-mono tabular-nums">{rows}</span> schemes and units</>
            : <>Show <span className="font-mono tabular-nums">{asked}</span> place{asked === 1 ? "" : "s"} asked for with no target</>}
        </button>
      )}
    </div>
  );
}
