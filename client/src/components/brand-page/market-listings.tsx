// A brand's market listings on its own page (decision 7 of the requirements
// board review, 19 November 2026): PIPnet and Requirement List listings that
// nobody at BGP has confirmed, labelled as market listings with their listing
// date ("Older" once PIPnet has not listed one for six months), each opening
// its panel on the board, with Confirm. The server sends them to BGP staff
// only (`marketListings` on the brand profile); confirming one goes through
// the requirements centre's still-live route, which is BGP staff only too.
import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmHowDialog } from "@/components/requirements-board/confirm-how-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatSizeList } from "@/lib/format-size";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface BrandMarketListing {
  id: string;
  name: string | null;
  use: string[] | null;
  size: string[] | null;
  requirement_locations: string[] | null;
  /** "listed on PIPnet 3 Sep" */
  date_label: string;
  list: "market" | "older";
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function BrandMarketListings({ companyId, listings, heading, phone = false }: {
  companyId: string;
  listings: BrandMarketListing[];
  heading?: React.ReactNode;
  phone?: boolean;
}) {
  const { toast } = useToast();
  const [asking, setAsking] = useState<BrandMarketListing | null>(null);
  const confirm = useMutation({
    mutationFn: ({ id, how }: { id: string; how?: string }) =>
      apiRequest("POST", `/api/requirement-centre/requirements/${id}/still-live`, how ? { how } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/requirements-leasing"] });
      toast({ title: "Confirmed", description: "Recorded as confirmed by you today: it is now one of BGP's requirements." });
    },
    onError: (e: any) => toast({ title: "Couldn't confirm", description: e.message, variant: "destructive" }),
  });
  if (!listings.length) return null;
  return (
    <div data-testid="brand-market-listings">
      {heading}
      <div className={phone ? "divide-y divide-border" : "space-y-0.5"}>
        {listings.map(l => {
          const size = l.size?.length ? formatSizeList(l.size) : null;
          const use = l.use?.[0] || null;
          const places = l.requirement_locations?.length ? l.requirement_locations.join(", ") : null;
          const when = `${l.list === "older" ? "Older · " : ""}${capital(l.date_label)}`;
          return (
            <div key={l.id} className={phone ? "flex items-center gap-2 py-2" : "flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-muted/50"} data-testid={`brand-market-listing-${l.id}`}>
              <Link href={`/requirements?requirementId=${encodeURIComponent(l.id)}`} className={phone ? "min-w-0 flex-1 text-sm" : "flex min-w-0 flex-1 items-center gap-1.5"}>
                {phone ? <>
                  <p className="truncate font-medium">{[size, use, places].filter(Boolean).join(" · ") || l.name || "Listing"}</p>
                  <p className="text-[11px] text-muted-foreground">{when}</p>
                </> : <>
                  {use && <Badge variant="outline" className="shrink-0 text-[11px]">{use}</Badge>}
                  {size && <span className="shrink-0 font-medium">{size}</span>}
                  {places && <span className="truncate text-muted-foreground">{places}</span>}
                  {!use && !size && !places && <span className="truncate font-medium">{l.name || "Listing"}</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{when}</span>
                </>}
              </Link>
              <Button size="sm" variant="outline" className={phone ? "h-9 shrink-0 gap-1 px-3 text-xs" : "h-6 shrink-0 gap-1 px-1.5 text-[11px]"}
                disabled={confirm.isPending} onClick={() => setAsking(l)} data-testid={`brand-market-listing-confirm-${l.id}`}>
                <Check className="h-3 w-3" />Confirm
              </Button>
            </div>
          );
        })}
      </div>
      <ConfirmHowDialog name={asking ? asking.name || "this listing" : null} open={!!asking} onClose={() => setAsking(null)}
        onConfirm={how => { if (asking) confirm.mutate({ id: asking.id, how }); setAsking(null); }} />
    </div>
  );
}
