// Brand tidy (Woody, 2026-11-11; "dont archive just delete them or hide",
// 2026-11-12): the admin's preview-then-apply sweep that hides brands with
// no BGP or client activity, and the hidden list with Unhide and, for
// brands nothing at all points at, Delete for good.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Report {
  totalBrands: number; alreadyArchived: number; keep: number; archive: number; unhide: number; deletable: number;
  signals: Record<string, { label: string; count: number; unavailable?: boolean; deleteOnly?: boolean }>;
  failedSignals: string[];
  contactsOnlyArchived: number;
  archiveSample: Array<{ id: string; name: string; companyType: string | null; contacts: number }>;
}

export function invalidateBrandLists() {
  for (const key of ["/api/crm/companies", "/api/brands/hub", "/api/brands/explorer-flags", "/api/admin/brand-relevance", "/api/admin/brand-relevance/archived"]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

// apiRequest errors read "409: {"error":"…"}"; show the sentence.
const errorText = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.slice(m.indexOf("{"))).error || m; } catch { return m; } };

export function BrandTidyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="brand-tidy-open"><EyeOff className="w-3 h-3 mr-1" /> Tidy brands</Button>
      {open && <BrandTidyDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function BrandTidyDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<Report>({ queryKey: ["/api/admin/brand-relevance"], staleTime: 0 });
  const [confirm, setConfirm] = useState("");
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/brand-relevance/apply", {})).json(),
    onSuccess: (r: any) => {
      toast({ title: `${r?.archived ?? 0} brands hidden${r?.unhidden ? `, ${r.unhidden} brought back` : ""}`, description: "Hidden brands are out of the directory. Unhide or delete them from the Hidden pill." });
      invalidateBrandLists(); onClose();
    },
    onError: (e: any) => toast({ title: "Nothing was changed", description: errorText(e), variant: "destructive" }),
  });
  const blocked = !!data?.failedSignals?.length;
  const nothingToDo = !!data && data.archive === 0 && data.unhide === 0;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Tidy brands</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          A brand stays when anything ties it to BGP's or a client's work: a tenancy or a name on a schedule, a deal, a unit target or agreed brief, a requirement, a logged interaction, an offer or viewing, a hunter flag or pipeline stage, a client's own directory, a CRM plan, a Landsec brand case, a current agent representation, KYC work, or it was added in the last 90 days. Everything else is hidden from Brand Explorer, the hub, search and client logins. The record, its deals and tenancies stay, any brand can be unhidden, and adding a hidden brand again brings the old record back.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Checking every brand…</p>}
        {error && <p className="text-sm text-muted-foreground">The check failed. {errorText(error)}</p>}
        {data && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Brands" value={data.totalBrands - data.alreadyArchived} />
              <Stat label="Keep" value={data.keep} />
              <Stat label="Hide" value={data.archive} tone="amber" />
            </div>
            {blocked && (
              <p className="rounded-md border border-amber-500/50 px-2 py-1.5 text-xs" role="status" data-testid="brand-tidy-blocked">
                {data.failedSignals.length === 1 ? "One check" : `${data.failedSignals.length} checks`} could not be made ({data.failedSignals.join("; ")}). Brands tied to that work cannot be told apart, so hiding is switched off until the check runs.
              </p>
            )}
            {data.unhide > 0 && <p className="text-xs text-muted-foreground">{data.unhide.toLocaleString("en-GB")} brand{data.unhide === 1 ? "" : "s"} hidden by an earlier tidy now {data.unhide === 1 ? "has" : "have"} a tie to live work and will be brought back.</p>}
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Why brands are kept</p>
              <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                {Object.entries(data.signals).filter(([, s]) => !s.deleteOnly).map(([k, s]) => (
                  <li key={k} className="flex justify-between gap-2"><span>{s.label}</span><span className="tabular-nums text-muted-foreground">{s.unavailable ? "not checked" : s.count.toLocaleString("en-GB")}</span></li>
                ))}
              </ul>
            </div>
            {data.archive > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Would be hidden{data.archiveSample.length < data.archive ? ` (first ${data.archiveSample.length} of ${data.archive})` : ""} · {data.contactsOnlyArchived} of these have contacts but no activity
                </p>
                <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                  {data.archiveSample.map(b => (
                    <div key={b.id} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
                      <Link href={`/companies/${b.id}`} className="truncate hover:underline">{b.name}</Link>
                      <span className="text-muted-foreground shrink-0">{(b.companyType || "").replace(/^Tenant - /, "")}{b.contacts ? ` · ${b.contacts} contacts` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              {data.archive > 0 && !blocked && <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={`Type ${data.archive} to confirm`} className="h-8 text-sm max-w-[12rem]" data-testid="brand-tidy-confirm" />}
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={blocked || nothingToDo || (data.archive > 0 && confirm.trim() !== String(data.archive)) || apply.isPending} onClick={() => apply.mutate()} data-testid="brand-tidy-apply">
                {apply.isPending ? "Hiding…" : data.archive > 0 ? `Hide ${data.archive} brands` : data.unhide > 0 ? `Bring back ${data.unhide}` : "Nothing to hide"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" }) {
  return (
    <div className={`rounded-md border px-2 py-1.5 ${tone === "amber" ? "border-amber-500/50" : ""}`}>
      <p className="text-base font-bold tabular-nums leading-tight">{value.toLocaleString("en-GB")}</p>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}

interface HiddenBrand { id: string; name: string; companyType: string | null; archivedAt: string; reason: string | null; deletable: boolean }

// The hidden list, shown in place of the brand grid under the Hidden pill.
export function HiddenBrands() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { data, isLoading } = useQuery<{ total: number; deletable: number; failedSignals: string[]; brands: HiddenBrand[] }>({
    queryKey: ["/api/admin/brand-relevance/archived", q],
    queryFn: async () => (await apiRequest("GET", `/api/admin/brand-relevance/archived?q=${encodeURIComponent(q)}`)).json(),
    staleTime: 30 * 1000,
  });
  const restore = useMutation({
    mutationFn: async (body: { id?: string; all?: boolean }) => (await apiRequest("POST", "/api/admin/brand-relevance/restore", body)).json(),
    onSuccess: (r: any) => { toast({ title: r?.restored > 1 ? `${r.restored} brands unhidden` : "Brand unhidden" }); invalidateBrandLists(); },
    onError: (e: any) => toast({ title: "Not unhidden", description: errorText(e), variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async (body: { id?: string; all?: boolean }) => (await apiRequest("POST", "/api/admin/brand-relevance/delete", body)).json(),
    onSuccess: (r: any) => {
      toast({ title: `${r?.deleted ?? 0} brand${r?.deleted === 1 ? "" : "s"} deleted`, description: r?.skipped ? `${r.skipped} skipped: something now points at them.` : undefined });
      setDeleteOpen(false); setConfirm(""); invalidateBrandLists();
    },
    onError: (e: any) => toast({ title: "Nothing was deleted", description: errorText(e), variant: "destructive" }),
  });
  const busy = restore.isPending || remove.isPending;
  return (
    <div className="space-y-2" data-testid="hidden-brands">
      <div className="flex items-center gap-2 flex-wrap">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search hidden brands…" className="h-8 text-sm max-w-xs" />
        <span className="text-xs text-muted-foreground">{data ? `${data.total.toLocaleString("en-GB")} hidden${q ? `, ${data.brands.length}${data.brands.length === 500 ? "+" : ""} match` : ""}` : isLoading ? "Loading…" : ""}</span>
        {data && data.total > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => { if (window.confirm(`Unhide all ${data.total} hidden brands?`)) restore.mutate({ all: true }); }} data-testid="brand-unhide-all"><RotateCcw className="w-3 h-3 mr-1" /> Unhide all</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy || data.deletable === 0} onClick={() => setDeleteOpen(true)} data-testid="brand-delete-open"><Trash2 className="w-3 h-3 mr-1" /> Delete {data.deletable.toLocaleString("en-GB")} for good</Button>
          </div>
        )}
      </div>
      {data && data.failedSignals.length > 0 && <p className="text-xs text-muted-foreground" role="status">Delete is switched off: {data.failedSignals.length === 1 ? "one check" : `${data.failedSignals.length} checks`} could not be made ({data.failedSignals.join("; ")}).</p>}
      <div className="rounded-md border divide-y">
        {data?.brands.map(b => (
          <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
            <div className="min-w-0">
              <Link href={`/companies/${b.id}`} className="font-medium hover:underline truncate block">{b.name}</Link>
              <p className="text-[11px] text-muted-foreground truncate">{(b.companyType || "").replace(/^Tenant - /, "")}{b.reason ? ` · ${b.reason}` : ""}{b.deletable ? "" : " · kept on file (has contacts, history or links)"}</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => restore.mutate({ id: b.id })} data-testid={`brand-unhide-${b.id}`}><RotateCcw className="w-3 h-3 mr-1" /> Unhide</Button>
              {b.deletable && <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} aria-label={`Delete ${b.name} for good`} onClick={() => { if (window.confirm(`Delete ${b.name} for good? This cannot be undone.`)) remove.mutate({ id: b.id }); }} data-testid={`brand-delete-${b.id}`}><Trash2 className="w-3 h-3" /></Button>}
            </div>
          </div>
        ))}
        {data && data.brands.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No hidden brands{q ? " match" : ""}.</p>}
      </div>
      {deleteOpen && data && (
        <Dialog open onOpenChange={o => { if (!o) { setDeleteOpen(false); setConfirm(""); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Delete hidden brands for good</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">
              {data.deletable.toLocaleString("en-GB")} of the {data.total.toLocaleString("en-GB")} hidden brands have nothing pointing at them: no deal, tenancy, target, name on a schedule or brief, contact, property link, requirement, interaction or KYC file. Those are deleted and cannot be brought back. The other hidden brands stay hidden and on file.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={`Type ${data.deletable} to confirm`} className="h-8 text-sm max-w-[12rem]" data-testid="brand-delete-confirm" />
              <Button variant="outline" size="sm" onClick={() => { setDeleteOpen(false); setConfirm(""); }}>Cancel</Button>
              <Button size="sm" variant="destructive" disabled={confirm.trim() !== String(data.deletable) || remove.isPending} onClick={() => remove.mutate({ all: true })} data-testid="brand-delete-apply">{remove.isPending ? "Deleting…" : `Delete ${data.deletable}`}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
