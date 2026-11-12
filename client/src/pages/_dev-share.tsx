// Throwaway test page for the unit share dialog. Deleted before hand-over.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { UnitShareDialog } from "@/components/unit-share-dialog";

export default function DevShare() {
  const q = new URLSearchParams(window.location.search);
  const unit = { id: q.get("unit") || "", unitName: q.get("name") || "Test unit", propertyId: q.get("property") };
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)} data-testid="dev-open-share">Share with a brand</Button>
      <UnitShareDialog unit={unit.id ? unit : null} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
