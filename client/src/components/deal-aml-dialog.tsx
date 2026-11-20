// The deal's AML box in a window (Jack, 2026-11-20: "For investment, when a
// deal moves into 'solicitors' I should then ask for all the relevant AML /
// KYC information that Woody has set up. Also there should be an option add
// it on the properties page"). It is the deal page's own Parties & AML card
// (`DealAmlStatusCard`): each party's company that signs, who to ask, the
// people to check, the checks before asking, Send client checks, the KYC4U
// request and the officers' decisions. Opened by the Investment Tracker when a
// deal moves to Solicitors, and by the AML pill on a property page. Opening it
// reads the deal's AML status, which starts BGP's checks before asking for a
// party not checked in 30 days, as opening the deal page's Parties & AML pill
// does: so it opens only when a person asks or moves a deal to Solicitors.
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DealAmlStatusCard } from "@/components/deal-aml-status";
import { ExternalLink } from "lucide-react";

export type AmlDialogDeal = { id: string; name?: string | null; dealRef?: number | string | null; status?: string | null };

export function DealAmlDialog({ deal, reason, onClose }: {
  deal: AmlDialogDeal | null;
  /** "solicitors": opened because the deal has just moved to Solicitors. */
  reason?: "solicitors" | "property";
  onClose: () => void;
}) {
  return (
    <Dialog open={!!deal} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="deal-aml-dialog">
        {deal && (<>
          <DialogHeader>
            <DialogTitle>
              {reason === "solicitors" ? "At Solicitors: start the AML checks" : "AML and KYC"}
              <span className="block text-sm font-normal text-muted-foreground mt-0.5">
                {deal.dealRef != null ? `#${deal.dealRef} ` : ""}{deal.name || "Deal"}
              </span>
            </DialogTitle>
            <DialogDescription>
              For each party: set the company that signs and who to ask, add the owners' contact details, then send the client checks
              or the KYC4U request. Nothing is sent until you press a button. You can come back to it from the deal's Parties &amp; AML.
            </DialogDescription>
          </DialogHeader>
          <DealAmlStatusCard dealId={deal.id} dealStatus={deal.status} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/deals/${deal.id}?section=parties`} data-testid="deal-aml-dialog-open-deal">
                <ExternalLink className="w-3.5 h-3.5 mr-1" />Open the deal
              </Link>
            </Button>
            <Button size="sm" onClick={onClose} data-testid="deal-aml-dialog-done">Done</Button>
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
