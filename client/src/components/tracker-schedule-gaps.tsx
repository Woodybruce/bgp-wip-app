// Letting Tracker units not on their property's tenancy schedule (Woody,
// 2026-11-23). Admin only: Preview lists them, Apply adds the ticked ones as
// vacant schedule rows tied to their tracker unit and transaction by id
// (server/tracker-to-schedule.ts). A unit whose letting was withdrawn starts
// unticked: it may be one to delete from the tracker instead.
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

type Gap = {
  trackerId: string; unit: string; sqft: number | null; propertyId: string; propertyName: string;
  marketingStatus: string | null; dealId: string | null; dealRef: number | string | null; dealStatus: string | null; suggested: boolean;
};

export function TrackerScheduleGapsPanel() {
  const { toast } = useToast();
  const [preview, setPreview] = useState<{ previewedAt: string; units: Gap[] } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const byProperty = useMemo(() => {
    const groups = new Map<string, { name: string; units: Gap[] }>();
    for (const u of preview?.units || []) {
      const g = groups.get(u.propertyId) || { name: u.propertyName, units: [] };
      g.units.push(u);
      groups.set(u.propertyId, g);
    }
    return [...groups.entries()];
  }, [preview]);

  const run = async () => {
    setBusy("preview"); setResult(null);
    try {
      const r = await (await apiRequest("GET", "/api/admin/tracker-schedule-gaps")).json();
      setPreview(r);
      setTicked(new Set((r.units as Gap[]).filter(u => u.suggested).map(u => u.trackerId)));
      setWord("");
    } catch (e: any) {
      toast({ title: "Preview failed", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const apply = async () => {
    if (!preview) return;
    setBusy("apply");
    try {
      const r = await (await apiRequest("POST", "/api/admin/tracker-schedule-gaps/apply", { ids: [...ticked], previewedAt: preview.previewedAt })).json();
      setResult(`Added ${r.added} to the tenancy schedule${r.already ? `, ${r.already} already there` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`);
      setPreview(null); setTicked(new Set()); setWord("");
    } catch (e: any) {
      toast({ title: "Apply failed", description: String(e?.message || "").replace(/^\d{3}:\s*/, ""), variant: "destructive" });
    } finally { setBusy(null); }
  };

  const toggle = (id: string) => setTicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="tracker-schedule-gaps">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Letting Tracker units not on the tenancy schedule</p>
          <p className="text-xs text-muted-foreground">Each ticked unit becomes a vacant row on its property's schedule, linked to its tracker unit and transaction. Withdrawn lettings start unticked.</p>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={busy !== null} data-testid="tracker-schedule-gaps-preview">
          {busy === "preview" ? "Reading…" : "Preview"}
        </Button>
      </div>
      {result && <p className="text-xs" data-testid="tracker-schedule-gaps-result">{result}</p>}
      {preview && (preview.units.length === 0 ? (
        <p className="text-xs text-muted-foreground">Every Letting Tracker unit is on its tenancy schedule.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>{preview.units.length} units on {byProperty.length} properties · {ticked.size} ticked</span>
            <button type="button" className="underline" onClick={() => setTicked(new Set(preview.units.map(u => u.trackerId)))}>Tick all</button>
            <button type="button" className="underline" onClick={() => setTicked(new Set())}>Clear</button>
          </div>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {byProperty.map(([propertyId, g]) => (
              <div key={propertyId}>
                <Link href={`/properties/${propertyId}?section=units`} className="text-xs font-medium text-primary hover:underline">{g.name}</Link>
                <ul className="mt-0.5 space-y-0.5">
                  {g.units.map(u => (
                    <li key={u.trackerId} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={ticked.has(u.trackerId)} onChange={() => toggle(u.trackerId)} aria-label={`Add ${u.unit}`} />
                      <span className="min-w-0 flex-1 truncate" title={u.unit}>{u.unit}{u.sqft ? ` · ${Math.round(u.sqft).toLocaleString("en-GB")} sq ft` : ""}</span>
                      <span className="text-muted-foreground">{u.dealStatus || u.marketingStatus || "No transaction"}</span>
                      {u.dealId && <Link href={`/deals/${u.dealId}`} className="text-primary hover:underline">{u.dealRef ? `#${u.dealRef}` : "Transaction"}</Link>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={word} onChange={e => setWord(e.target.value)} placeholder="Type APPLY" className="h-8 w-32 text-xs" aria-label="Type APPLY to confirm" />
            <Button size="sm" onClick={apply} disabled={busy !== null || word !== "APPLY" || ticked.size === 0} data-testid="tracker-schedule-gaps-apply">
              {busy === "apply" ? "Adding…" : `Add ${ticked.size} to the schedule`}
            </Button>
          </div>
        </>
      ))}
    </div>
  );
}
