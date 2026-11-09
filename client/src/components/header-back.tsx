// App-wide Back button in the top bar (Woody, 2026-09-23: "need back
// buttons" — the Letting Tracker opened from a brand's "Pitch property"
// had no way back). Shows once you've moved within the app this session;
// detail pages that carry their own Back (brand, property, deal, contact)
// don't get a second one.
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";

const OWN_BACK = /^\/(companies|properties|deals|contacts|brands)\/[^/]+/;
const trail: string[] = [];

export function HeaderBack() {
  const [location] = useLocation();
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    const here = location.split("?")[0];
    if (trail.length >= 2 && trail[trail.length - 2] === here) trail.pop();
    else if (trail[trail.length - 1] !== here) trail.push(here);
    if (trail.length > 50) trail.splice(0, trail.length - 50);
    setDepth(trail.length);
  }, [location]);
  if (depth < 2 || OWN_BACK.test(location)) return null;
  return (
    <button
      type="button"
      onClick={() => window.history.back()}
      className="inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
      data-testid="header-back"
      title="Back to the previous page"
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      Back
    </button>
  );
}
