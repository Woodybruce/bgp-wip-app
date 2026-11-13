// App-wide Back button in the top bar (Woody, 2026-09-23: "need back
// buttons" — the Letting Tracker opened from a brand's "Pitch property"
// had no way back). Shows once there is a screen before this one in the
// app; detail pages that carry their own Back (brand, property, deal,
// contact) don't get a second one. The list tabs under /deals (Letting
// Tracker, Properties, the WIP report) have none of their own, so they keep it.
import { useLocation, useSearch } from "wouter";
import { ArrowLeft } from "lucide-react";
import { canGoBackInApp, isDealPage, useGoBack } from "@/lib/go-back";

const OWN_BACK = /^\/(companies|properties|contacts)\/[^/]+/;

export function HeaderBack() {
  const [location] = useLocation();
  useSearch();
  const goBack = useGoBack();
  if (!canGoBackInApp() || OWN_BACK.test(location) || isDealPage(location)) return null;
  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
      data-testid="header-back"
      title="Back to the previous page"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Back
    </button>
  );
}
