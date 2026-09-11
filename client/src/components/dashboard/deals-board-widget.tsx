import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Handshake } from "lucide-react";
import { DealsSummary } from "@/components/deals-summary";

// Deals twin of AvailableUnitsWidget — the canonical DealsSummary card
// scoped to your starred instructions (whole book when nothing is starred).
export function DealsBoardWidget() {
  const { data: favoriteIds = [] } = useQuery<string[]>({ queryKey: ["/api/favorite-instructions"] });
  return (
    <Card data-testid="deals-board-widget">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Handshake className="w-4 h-4 text-muted-foreground" />
          Deals Board
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DealsSummary variant="card" propertyIds={favoriteIds.length ? favoriteIds : undefined} />
      </CardContent>
    </Card>
  );
}
