// The letting's dialogs on the deal page: the same ones the Letting Tracker
// and the Landsec unit page open, given the deal's tracker unit. They open
// only when a person asks: reading some of them writes (the checklist starts
// itself, an offer's negotiation writes its first round). The unit's own
// dialogs (Heads of Terms, checklist, recommendation, brief) are offered only
// while the deal is the unit's current letting; an offer's negotiation opens
// on any of the deal's offers.
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, invalidateDealCaches, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { HotsWorkspaceDialog } from "@/components/unit-hots/hots-workspace";
import { DealChecklistDialog } from "@/components/deal-checklist/deal-checklist-dialog";
import { RecommendationDialog } from "@/components/unit-recommendation/recommendation-workspace";
import { UnitBriefDialog } from "@/components/unit-brief-dialog";
import { NegotiationPanel } from "@/components/unit-negotiation/negotiation-panel";
import { refreshWaitingOn } from "@/components/landsec/deal-clock";
import type { DealLettingSummary } from "@shared/deal-page";
import { dealPageKey, dealTimelineKey, type LettingDialog } from "./use-deal-page";

export function LettingDialogs({ dealId, letting, dialog, setDialog }: {
  dealId: string; letting: DealLettingSummary | null; dialog: LettingDialog | null; setDialog: (d: LettingDialog | null) => void;
}) {
  const { toast } = useToast();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: dealPageKey(dealId) });
    queryClient.invalidateQueries({ queryKey: dealTimelineKey(dealId) });
  };
  const close = () => { setDialog(null); refresh(); refreshWaitingOn(); invalidateDealCaches(dealId); };
  const toNegotiating = useMutation({
    mutationFn: async () => (await apiRequest("PATCH", `/api/available-units/${letting!.trackerId}`, { marketingStatus: "NEG" })).json(),
    onSuccess: () => { invalidateDealCaches(dealId); refresh(); },
    onError: (e: any) => toast({ title: "The deal was not moved to Negotiating", description: e?.message, variant: "destructive" }),
  });
  if (!letting) return null;
  const unit = { id: letting.trackerId, unitName: letting.unitName, propertyId: letting.propertyId || "" };
  const live = letting.current;
  return (
    <>
      <HotsWorkspaceDialog unit={live ? unit : null} open={live && dialog?.to === "hots"} onClose={close} />
      <RecommendationDialog unit={live ? unit : null} open={live && dialog?.to === "recommendation"} onClose={close} onOpenHots={() => setDialog({ to: "hots" })} />
      <DealChecklistDialog unit={live ? unit : null} open={live && dialog?.to === "checklist"} onClose={close} onChanged={refresh} />
      <UnitBriefDialog unit={live ? unit : null} open={live && dialog?.to === "brief"} onClose={close} />
      <Dialog open={dialog?.to === "offer"} onOpenChange={o => { if (!o) close(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="deal-negotiation-dialog">
          <DialogHeader>
            <DialogTitle>Negotiation</DialogTitle>
            <DialogDescription>Every position on this offer, from the first offer to agreed terms.</DialogDescription>
          </DialogHeader>
          {dialog?.to === "offer" && (
            <NegotiationPanel
              offerId={dialog.offerId}
              onChanged={refresh}
              onMoveToNegotiating={live ? () => toNegotiating.mutate() : undefined}
              onGenerateHots={live ? () => setDialog({ to: "hots" }) : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
