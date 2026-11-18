// The Super Brand star: BGP's own choice of prime expansion targets (Woody,
// 2026-11-17: "super brand lets have those as VIP CRM brands ... prime
// targets for expansion via our choice ... they get the CRM VIP treatment
// and massive focus"). Stored as the brand's hunter_flag, which the screens
// called a Hunter pick until then. BGP staff press the star; every other
// login sees the badge only. Starring a brand that is on no running CRM
// strategy opens Start strategy, the CRM's kick-off, where nothing is saved
// until a person ticks it.
import { useState } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StartStrategyDialog } from "@/components/crm-engagement/start-strategy";
import { useEngagement } from "@/components/company-page/company-kind-page";
import { landlordEngagementView } from "@shared/landlord-engagement-view";

export const SUPER_BRAND_HELP = "Super Brand: one of BGP's own chosen expansion targets. In the CRM it is listed first, sits on the Watch list and is checked every week for new sites, planning and news.";

export function SuperBrandBadge({ className = "" }: { className?: string }) {
  return (
    <Badge className={`bg-amber-50 text-amber-800 border-amber-200 text-[11px] ${className}`} title={SUPER_BRAND_HELP} data-testid="super-brand-badge">
      <Star className="w-3 h-3 mr-0.5 fill-amber-400 text-amber-500" />Super Brand
    </Badge>
  );
}

// Everything that lists or counts Super Brands reads again.
export function refreshSuperBrands(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: query => {
      const key = String(query.queryKey[0] ?? "");
      return key.startsWith("/api/brand") || key.startsWith("/api/crm/hub") || key === "/api/crm/engagement";
    },
  });
}

export function useSuperBrandSetter(companyId: string, companyName: string, onStarred?: () => void) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (on: boolean) => (await apiRequest("POST", `/api/brands/${encodeURIComponent(companyId)}/super-brand`, { on })).json() as Promise<{ superBrand: boolean }>,
    onSuccess: result => {
      void refreshSuperBrands(queryClient);
      toast({ title: result.superBrand ? `${companyName} is a Super Brand` : `${companyName} is no longer a Super Brand` });
      if (result.superBrand) onStarred?.();
    },
    onError: (error: any) => toast({ title: "The star could not be changed", description: error?.message, variant: "destructive" }),
  });
}

// The brand page's star for BGP staff, beside its other actions.
export function SuperBrandStar({ companyId, companyName, on }: { companyId: string; companyName: string; on: boolean }) {
  const [, navigate] = useLocation();
  const [kickoff, setKickoff] = useState(false);
  const engagement = useEngagement(companyId);
  const onStrategy = engagement.data ? landlordEngagementView(engagement.data, companyId).strategies.length > 0 : null;
  const set = useSuperBrandSetter(companyId, companyName, () => { if (onStrategy === false) setKickoff(true); });
  return <>
    <Button
      variant="outline" size="sm" aria-pressed={on} disabled={set.isPending}
      className={on ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-100" : ""}
      onClick={() => set.mutate(!on)}
      title={on ? `${SUPER_BRAND_HELP} Press to take the star off.` : `Make ${companyName} a Super Brand. ${SUPER_BRAND_HELP}`}
      data-testid="button-super-brand"
    >
      <Star className={on ? "fill-amber-400 text-amber-500" : ""} />{on ? "Super Brand" : "Make Super Brand"}
    </Button>
    {kickoff && (
      <StartStrategyDialog
        company={{ id: companyId, name: companyName }}
        onClose={() => setKickoff(false)}
        onStarted={strategyId => navigate(`/contacts?tab=overview&strategy=${encodeURIComponent(strategyId)}`)}
      />
    )}
  </>;
}
