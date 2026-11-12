// THROWAWAY test mount for the Heads of Terms workspace. Deleted before hand-over.
import { useState } from "react";
import { HotsWorkspaceDialog } from "@/components/unit-hots/hots-workspace";

export default function DevHots() {
  const q = new URLSearchParams(window.location.search);
  const unitId = q.get("unit") || "";
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog(l => [...l, line]);
  return (
    <div className="p-4 sm:p-6 space-y-4 min-w-0">
      <button type="button" className="underline text-sm" onClick={() => setOpen(true)} data-testid="dev-open">Open Heads of Terms</button>
      <HotsWorkspaceDialog
        unit={unitId ? { id: unitId, unitName: q.get("name") || "Unit", propertyId: null } : null}
        open={open}
        onClose={() => { setOpen(false); note("closed"); }}
        onOpenOffers={q.get("offers") === "0" ? undefined : () => note("openOffers")}
        onChanged={() => note("changed")}
      />
      <pre className="text-[11px] text-muted-foreground" data-testid="dev-log">{log.join("\n")}</pre>
    </div>
  );
}
