import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { CrmEngagementPanel } from "@/components/crm-engagement/overview";

// The Brand CRM inside Brand Intelligence (/brands?tab=crm). The view is in
// the address (?view=targets|diary|strategies) so a link opens the right one.
// Strategies and events is BGP's own planning: staff only, and the server
// refuses it to every client login.
type BrandCrmView = "targets" | "diary" | "strategies";
const VIEWS: Array<{ key: BrandCrmView; label: string; staffOnly?: boolean }> = [
  { key: "targets", label: "Targets" },
  { key: "diary", label: "Diary" },
  { key: "strategies", label: "Strategies and events", staffOnly: true },
];

export function BrandCrmTab({ staff }: { staff: boolean }) {
  const search = useSearch();
  const views = VIEWS.filter(view => staff || !view.staffOnly);
  const fromAddress = (): BrandCrmView => {
    const requested = new URLSearchParams(search).get("view");
    return views.find(view => view.key === requested)?.key || "targets";
  };
  const [view, setView] = useState<BrandCrmView>(fromAddress);
  useEffect(() => { setView(fromAddress()); }, [search, staff]);
  const chooseView = (next: BrandCrmView) => {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };
  return (
    <div className="space-y-4" data-testid="brand-crm-tab">
      <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0">
        {views.map(item => (
          <Pill key={item.key} active={view === item.key} onClick={() => chooseView(item.key)} data-testid={`brand-crm-view-${item.key}`}>
            {item.label}
          </Pill>
        ))}
      </div>
      {view === "targets" && (
        <Card className="p-4" data-testid="brand-crm-targets-placeholder">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Targets</h3>
          <p className="text-sm text-muted-foreground mt-2">Each brand against the schemes and units we want it in, with the stage it has reached. Not built yet.</p>
        </Card>
      )}
      {view === "diary" && (
        <Card className="p-4" data-testid="brand-crm-diary-placeholder">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Diary</h3>
          <p className="text-sm text-muted-foreground mt-2">One dated list of brand actions, viewings and items waiting on someone. Not built yet.</p>
        </Card>
      )}
      {view === "strategies" && staff && <CrmEngagementPanel kind="brand" />}
    </div>
  );
}
