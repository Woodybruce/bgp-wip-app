import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// Surfaces an "Update available" prompt when a new build has installed and is
// waiting. Nothing reloads until the user taps "Update now" — this is what
// stops people getting kicked out of the app mid-task. The actual SW handoff
// lives in index.html (window.__bgpApplyUpdate / the 'bgp:update-available'
// event); this component is purely the UI.
export function UpdatePrompt() {
  const [show, setShow] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    const onUpdate = () => setShow(true);
    window.addEventListener("bgp:update-available", onUpdate);
    // The SW may have announced before React mounted.
    if ((window as any).__bgpUpdateReady) setShow(true);
    return () => window.removeEventListener("bgp:update-available", onUpdate);
  }, []);

  if (!show) return null;

  const applyUpdate = () => {
    setApplying(true);
    const apply = (window as any).__bgpApplyUpdate;
    if (typeof apply === "function") {
      apply();
    } else {
      window.location.reload();
    }
  };

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[120] w-[calc(100vw-1.5rem)] max-w-sm"
      style={{ bottom: "calc(4.25rem + env(safe-area-inset-bottom))" }}
      data-testid="banner-update-available"
    >
      <div className="flex items-center gap-3 rounded-xl border bg-background shadow-lg px-4 py-3">
        <RefreshCw className="w-5 h-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-tight">Update available</p>
          <p className="text-xs text-muted-foreground leading-tight mt-0.5">
            A new version is ready when you are.
          </p>
        </div>
        <Button
          size="sm"
          onClick={applyUpdate}
          disabled={applying}
          className="shrink-0"
          data-testid="button-apply-update"
        >
          {applying ? "Updating…" : "Update now"}
        </Button>
        <button
          onClick={() => setShow(false)}
          className="shrink-0 text-muted-foreground hover:text-foreground p-1 -mr-1"
          aria-label="Dismiss update"
          data-testid="button-dismiss-update"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
