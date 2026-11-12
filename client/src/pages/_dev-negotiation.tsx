// THROWAWAY test mount for the negotiation panel. Deleted before hand-over.
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NegotiationPanel, NegotiationSummary } from "@/components/unit-negotiation/negotiation-panel";

export default function DevNegotiation() {
  const q = new URLSearchParams(window.location.search);
  const offerId = q.get("offer") || "";
  const unitId = q.get("unit") || "";
  const inDialog = q.get("dialog") === "1";
  const [log, setLog] = useState<string[]>([]);
  const note = (line: string) => setLog(l => [...l, line]);
  const panel = (
    <NegotiationPanel offerId={offerId}
      onGenerateHots={q.get("hots") === "0" ? undefined : id => note(`generateHots:${id}`)}
      onMoveToNegotiating={q.get("move") === "0" ? undefined : () => note("moveToNegotiating")}
      onChanged={() => note("changed")} />
  );
  return (
    <div className="p-4 sm:p-6 space-y-4 min-w-0">
      <p className="text-xs text-muted-foreground" data-testid="dev-summary">Summary line: <NegotiationSummary unitId={unitId} offerId={offerId} /></p>
      {inDialog ? (
        <Dialog open>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Offers</DialogTitle>
              <DialogDescription>Test mount inside the offers dialog</DialogDescription>
            </DialogHeader>
            <div className="border rounded-lg p-3 text-sm space-y-3">{panel}</div>
          </DialogContent>
        </Dialog>
      ) : panel}
      <pre className="text-[11px] text-muted-foreground" data-testid="dev-log">{log.join("\n")}</pre>
    </div>
  );
}
