import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Pill } from "@/components/ui/pill";
import { PlanBoard } from "./plan-board";
import { Diary } from "./diary";

// The Brand CRM inside Brands (/brands?tab=crm). The view is in the address
// (?view=targets|diary) so a link opens the right one.
// For BGP staff it is Targets only (Woody, 2026-11-16): the CRM page holds
// the diary (/contacts?tab=diary) and the strategies and events
// (/contacts?tab=overview) for every kind of company, brands included, so an
// old ?view=diary or ?view=strategies link is sent there. Landsec logins keep
// Targets and Diary; the joint agent's /landsec/brand-crm is this tab too.
type BrandCrmView = "targets" | "diary";
const VIEWS: Array<{ key: BrandCrmView; label: string; clientOnly?: boolean }> = [
  { key: "targets", label: "Targets" },
  { key: "diary", label: "Diary", clientOnly: true },
];

// Where an old staff link to the Brand CRM's diary or strategies goes now,
// with the company and the record it named.
export function brandCrmMovedHref(view: string | null, params: URLSearchParams): string | null {
  if (view === "diary") return "/contacts?tab=diary";
  if (view !== "strategies") return null;
  const next = new URLSearchParams({ tab: "overview" });
  for (const key of ["company", "event", "strategy", "action"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return `/contacts?${next.toString()}`;
}

export function BrandCrmTab({ staff }: { staff: boolean }) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const views = VIEWS.filter(view => !staff || !view.clientOnly);
  const params = new URLSearchParams(search);
  const moved = staff ? brandCrmMovedHref(params.get("view"), params) : null;
  useEffect(() => { if (moved) navigate(moved, { replace: true }); }, [moved, navigate]);
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
  if (moved) return null;
  return (
    <div className="space-y-4" data-testid="brand-crm-tab">
      {views.length > 1 ? (
        <div className="flex gap-1.5 flex-nowrap overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0 [&>*]:shrink-0">
          {views.map(item => (
            <Pill key={item.key} active={view === item.key} onClick={() => chooseView(item.key)} data-testid={`brand-crm-view-${item.key}`}>
              {item.label}
            </Pill>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="brand-crm-moved">
          The brands' diary, strategies and events are on the CRM page:{" "}
          <Link href="/contacts?tab=diary" className="text-primary hover:underline" data-testid="link-brand-crm-diary">Diary</Link>
          {" · "}
          <Link href="/contacts?tab=overview" className="text-primary hover:underline" data-testid="link-brand-crm-overview">Strategies and events</Link>
        </p>
      )}
      {view === "targets" && <PlanBoard staff={staff} />}
      {view === "diary" && !staff && <Diary staff={staff} />}
    </div>
  );
}
