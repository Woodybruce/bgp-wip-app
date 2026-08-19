import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Store } from "lucide-react";
import { TrackerSummary } from "@/components/tracker-summary";

// Thin wrapper over the canonical TrackerSummary (Woody, 2026-08-03). The
// old widget was a separate implementation counting retired statuses
// ("Under Offer", "Let"), so its numbers could disagree with the tracker.
export function AvailableUnitsWidget() {
  const { data: favoriteIds = [] } = useQuery<string[]>({ queryKey: ["/api/favorite-instructions"] });
  return (
    <Card data-testid="available-units-widget">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Store className="w-4 h-4 text-muted-foreground" />
          Letting Tracker
        </CardTitle>
      </CardHeader>
      <CardContent>
        <TrackerSummary variant="card" tall propertyIds={favoriteIds.length ? favoriteIds : undefined} />
      </CardContent>
    </Card>
  );
}
