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
import { Briefcase, FileSpreadsheet } from "lucide-react";

type Lens = "lettings" | "tenancy";

export function PropertyUnifiedSchedule({ propertyId }: { propertyId: string }) {
  // Remember the lens per property so jumping between properties
  // doesn't reset the user's preferred view.
  const lensKey = `unified-schedule-lens:${propertyId}`;
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
      <div className="flex items-center gap-1 text-[11px]">
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
          {lens === "lettings"
            ? "Voids + marketing focus. Toggle columns from the picker to surface more."
            : "Full rent roll — every column. Toggle off what you don't need."}
        </span>
      </div>

      {/* Re-mount the underlying board when the lens changes so its
          internal hiddenFields state re-initialises from the lens-
          specific localStorage. Saves a more invasive refactor. */}
      <PropertyTenancySchedule key={lens} propertyId={propertyId} lens={lens} />
    </div>
  );
}
