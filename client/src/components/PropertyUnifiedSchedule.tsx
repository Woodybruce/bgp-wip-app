// ─────────────────────────────────────────────────────────────────────────
// Unified Schedule — one board, two lenses (Lettings vs Tenancy).
//
// Collapses the old Leasing Schedule + Tenancy Schedule panels into a
// single component on the property detail page. Same underlying data
// (tenancy_schedule_units), same edits, two column presets:
//
//   • Lettings lens — leasing-team focus. Hides institutional fields
//     (Lease Details, NOI, Shortfalls, Areas breakdown). Mirrors what
//     the old standalone Leasing Schedule panel surfaced.
//   • Tenancy lens — institutional / rent roll focus. Shows everything
//     (default Tenancy Schedule behaviour).
//
// Each lens has its own localStorage so column-visibility toggles in
// one don't disturb the other. Per-property rollout — gated on
// crm_properties.unified_schedule so we can test on Bluewater before
// the firm-wide flip.
// ─────────────────────────────────────────────────────────────────────────
import { useState, useEffect } from "react";
import { PropertyTenancySchedule } from "@/components/PropertyTenancySchedule";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, FileSpreadsheet } from "lucide-react";

type Lens = "lettings" | "tenancy";

export function PropertyUnifiedSchedule({ propertyId }: { propertyId: string }) {
  // Remember the lens per property so jumping between properties
  // doesn't reset the user's preferred view.
  const lensKey = `unified-schedule-lens:${propertyId}`;
  // Client logins get a fuller "what is this board" explainer instead of
  // the staff column-picker hint.
  const { data: schedUser } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const isClientSched = !schedUser || schedUser.role === "Client" || !!schedUser.companyScopeId;
  const [lens, setLens] = useState<Lens>(() => {
    try {
      const stored = localStorage.getItem(lensKey);
      return stored === "tenancy" ? "tenancy" : "lettings";
    } catch {
      return "lettings";
    }
  });

  useEffect(() => {
    try { localStorage.setItem(lensKey, lens); } catch {}
  }, [lens, lensKey]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-[11px] flex-wrap">
        {/* Visible build marker — internal deploy check only, hidden from
            client logins so it doesn't show in a client demo. */}
        {!isClientSched && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[9px] font-semibold uppercase tracking-wider mr-2">
            ✦ Unified Schedule
          </span>
        )}
        <span className="text-muted-foreground mr-2">View:</span>
        <button
          type="button"
          onClick={() => setLens("lettings")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
            lens === "lettings"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          data-testid="schedule-lens-lettings"
        >
          <Briefcase className="w-3 h-3" /> Lettings
        </button>
        <button
          type="button"
          onClick={() => setLens("tenancy")}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors ${
            lens === "tenancy"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
          data-testid="schedule-lens-tenancy"
        >
          <FileSpreadsheet className="w-3 h-3" /> Tenancy
        </button>
        <span className="text-[10px] text-muted-foreground ml-3">
          {isClientSched
            ? (lens === "lettings"
              ? "Vacant units and marketing status at this property. Live deals are worked in the Letting Tracker; brand strategy sits on the Leasing Schedule."
              : "The master rent roll — every unit with tenant, rent and lease dates. Changes here flow through to the Leasing Schedule and Letting Tracker.")
            : (lens === "lettings"
              ? "Voids + marketing focus. Toggle columns from the picker to surface more."
              : "Full rent roll — every column. Toggle off what you don't need.")}
        </span>
      </div>

      {/* Re-mount the underlying board when the lens changes so its
          internal hiddenFields state re-initialises from the lens-
          specific localStorage. Saves a more invasive refactor. */}
      {/* Clients get the same live board as staff — vacant rows visible and
          the tenancy → Letting Tracker one-click included ("client does as
          much as the agent"). Their writes are scope-checked server-side. */}
      <PropertyTenancySchedule key={lens} propertyId={propertyId} lens={lens} />
    </div>
  );
}
