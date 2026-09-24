// Brands whose official website the overnight sweep couldn't prove — a live
// worklist anyone on the team can clear (Woody, 2026-09-24: "make that list
// available ... so I can get someone else to click", and ticks on the old
// snapshot "keep reappearing"). Confirm writes the brand's identity exactly
// like the Confirm official website box on the brand page; Dismiss sets a
// closed / not-a-brand record aside so later sweeps leave it alone.
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Globe, Search, X } from "lucide-react";

type Row = { id: string; name: string; company_type: string | null; saved_website: string | null; reason: string | null; suggestion: string | null; verdict: any };
type SweepResponse = { sweep: { status: string; finishedAt?: string } | null; verifiedBrands: number; unknownCount: number; unknown: Row[] };

const GROUPS: Array<[string, string, string]> = [
  ["confirm", "Looks right", "The saved site is almost certainly theirs; the automatic proof failed on a technicality."],
  ["found", "Likely site found", "No website saved — we found a probable one."],
  ["alt", "Better site found", "The saved site didn't prove out and a likely replacement was found."],
  ["dead", "Saved site is dead", "The domain no longer exists. Enter the current site, or dismiss if the brand has closed."],
  ["wrong", "Different business", "The saved domain belongs to someone else."],
  ["unnamed", "Doesn't name the brand", "The page loads but never clearly names the brand — often a group or holding site."],
  ["blocked", "Blocks checks", "Bot protection stopped the automatic check. A quick look and confirm fixes these."],
  ["none", "Nothing found", "No credible website found. Add it if you know it."],
];

export function websiteCheckGroup(row: Pick<Row, "saved_website" | "reason" | "verdict">): string {
  const reason = row.reason || "";
  const verdict = row.verdict || {};
  if (!row.saved_website) return reason.startsWith("Found ") ? "found" : "none";
  if (reason.includes("no longer exists")) return "dead";
  if (reason.includes("could be read") || reason.includes("readable")) return "blocked";
  if (verdict.decision === "no_match" || verdict.relationship === "unrelated") return "wrong";
  if (verdict.decision === "verified") return "confirm";
  if (reason.startsWith("Found ")) return "alt";
  return "unnamed";
}

const host = (value: string | null) => (value || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();

function WebsiteRow({ row, group }: { row: Row; group: string }) {
  const { toast } = useToast();
  const [other, setOther] = useState("");
  const [editing, setEditing] = useState(false);
  const saved = host(row.saved_website);
  const likely = host(row.suggestion);
  const done = () => queryClient.invalidateQueries({ queryKey: ["/api/brand/website-sweep"] });
  const confirm = useMutation({
    mutationFn: async (domain: string) => (await apiRequest("POST", `/api/brand/${row.id}/identity`, { domain })).json(),
    onSuccess: (_out, domain) => { toast({ title: `${row.name} confirmed`, description: domain }); done(); },
    onError: (e: Error) => toast({ title: "Couldn't confirm", description: e.message, variant: "destructive" }),
  });
  const dismiss = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/brand/website-sweep/dismiss", { companyId: row.id })).json(),
    onSuccess: () => { toast({ title: `${row.name} dismissed` }); done(); },
    onError: (e: Error) => toast({ title: "Couldn't dismiss", description: e.message, variant: "destructive" }),
  });
  const busy = confirm.isPending || dismiss.isPending;
  // "Looks right" means the SAVED site checked out — confirming it is the main action.
  const savedFirst = group === "confirm" || !likely || likely === saved;
  return (
    <li className="px-3 py-2.5 border-t border-border first:border-t-0 flex flex-col md:flex-row md:items-center gap-2" data-testid={`website-check-row-${row.id}`}>
      <div className="min-w-0 flex-1">
        <Link href={`/companies/${row.id}`} className="font-medium hover:underline">{row.name}</Link>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          {row.company_type && <span>{row.company_type.replace(/^Tenant - /, "")}</span>}
          {saved && <span>Saved <a href={`https://${saved}`} target="_blank" rel="noreferrer" className="font-mono text-foreground hover:underline">{saved}</a></span>}
          {likely && likely !== saved && <span>Likely <a href={`https://${likely}`} target="_blank" rel="noreferrer" className="font-mono text-emerald-700 hover:underline">{likely}</a></span>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        {saved && savedFirst && <Button size="sm" disabled={busy} onClick={() => confirm.mutate(saved)} data-testid="website-check-confirm-saved"><Check className="w-3.5 h-3.5" />Confirm {saved}</Button>}
        {likely && likely !== saved && <Button size="sm" variant={savedFirst ? "outline" : "default"} disabled={busy} onClick={() => confirm.mutate(likely)} data-testid="website-check-confirm-likely"><Check className="w-3.5 h-3.5" />{savedFirst ? `Use ${likely}` : `Confirm ${likely}`}</Button>}
        {saved && !savedFirst && <Button size="sm" variant="outline" disabled={busy} onClick={() => confirm.mutate(saved)} data-testid="website-check-confirm-saved"><Check className="w-3.5 h-3.5" />Keep saved</Button>}
        {editing ? (
          <form className="flex items-center gap-1.5" onSubmit={e => { e.preventDefault(); if (other.trim()) confirm.mutate(other.trim()); }}>
            <Input autoFocus value={other} onChange={e => setOther(e.target.value)} placeholder="brand.com" className="h-8 w-40" aria-label={`Website for ${row.name}`} />
            <Button size="sm" type="submit" disabled={busy || !other.trim()}>Save</Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}><Globe className="w-3.5 h-3.5" />Other site</Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss.mutate()} title="Closed, not a brand, or doesn't need a website" data-testid="website-check-dismiss"><X className="w-3.5 h-3.5" />Dismiss</Button>
      </div>
    </li>
  );
}

export default function WebsiteCheckPage() {
  const [active, setActive] = useState<string>("all");
  const [search, setSearch] = useState("");
  const { data, isLoading, isError } = useQuery<SweepResponse>({ queryKey: ["/api/brand/website-sweep"], staleTime: 30_000 });
  const rows = useMemo(() => (data?.unknown || []).map(row => ({ ...row, group: websiteCheckGroup(row) })), [data]);
  const counts = useMemo(() => Object.fromEntries(GROUPS.map(([key]) => [key, rows.filter(row => row.group === key).length])), [rows]);
  const q = search.trim().toLowerCase();
  const visible = rows.filter(row => (active === "all" || row.group === active)
    && (!q || row.name.toLowerCase().includes(q) || host(row.saved_website).includes(q) || host(row.suggestion).includes(q)));
  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1100px] mx-auto" data-testid="page-website-check">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Brand websites to confirm</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {data ? <><span className="font-mono tabular-nums text-foreground">{data.verifiedBrands.toLocaleString("en-GB")}</span> confirmed · <span className="font-mono tabular-nums text-foreground">{rows.length}</span> left. Confirm the right site or dismiss — each brand drops off as soon as it's done.</> : "Brands the overnight check couldn't prove a website for."}
        </p>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search a brand or website" aria-label="Search brands" />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <Pill active={active === "all"} onClick={() => setActive("all")}>All <span className="ml-1 font-mono tabular-nums">{rows.length}</span></Pill>
        {GROUPS.map(([key, label]) => counts[key] ? <Pill key={key} active={active === key} onClick={() => setActive(key)}>{label} <span className="ml-1 font-mono tabular-nums">{counts[key]}</span></Pill> : null)}
      </div>
      {isLoading ? <Skeleton className="h-64 w-full" /> : isError ? <p className="text-sm text-muted-foreground">The website list is available in the staff view.</p> : (
        <div className="space-y-6">
          {GROUPS.filter(([key]) => active === "all" || active === key).map(([key, label, help]) => {
            const group = visible.filter(row => row.group === key);
            if (!group.length) return null;
            return (
              <section key={key} className="space-y-2">
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label} <span className="font-mono tabular-nums">{group.length}</span></h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{help}</p>
                </div>
                <ul className="rounded-xl border border-border bg-card">{group.map(row => <WebsiteRow key={row.id} row={row} group={key} />)}</ul>
              </section>
            );
          })}
          {!visible.length && <p className="text-sm text-muted-foreground">{rows.length ? "No brands match that search." : "Every brand has a confirmed website."}</p>}
        </div>
      )}
    </div>
  );
}
