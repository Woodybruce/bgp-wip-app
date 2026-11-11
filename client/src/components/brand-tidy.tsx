// Brand tidy (Woody, 2026-11-11): the admin's preview-then-apply sweep that
// archives brands with no BGP or client activity, and the archived list
// with Restore — "ok if we have to re-add".
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Archive, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Report {
  totalBrands: number; alreadyArchived: number; keep: number; archive: number;
  signals: Record<string, { label: string; count: number; unavailable?: boolean }>;
  contactsOnlyArchived: number;
  archiveSample: Array<{ id: string; name: string; companyType: string | null; contacts: number }>;
}

export function invalidateBrandLists() {
  for (const key of ["/api/crm/companies", "/api/brands/hub", "/api/brands/explorer-flags", "/api/admin/brand-relevance", "/api/admin/brand-relevance/archived"]) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function BrandTidyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="brand-tidy-open"><Archive className="w-3 h-3 mr-1" /> Tidy brands</Button>
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
    onSuccess: (r: any) => { toast({ title: `${r?.archived ?? 0} brands archived`, description: "They are out of the directory; restore any from the Archived pill." }); invalidateBrandLists(); onClose(); },
    onError: (e: any) => toast({ title: "Not applied", description: e?.message, variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Tidy brands</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          A brand stays when anything ties it to BGP's or a client's work: a tenancy, a deal, a unit target, a requirement, a logged interaction, an offer or viewing, a hunter flag or pipeline stage, a client's own directory, a CRM plan, a Landsec brand case, a current agent representation, or it was added in the last 90 days. Everything else is archived: out of Brand Explorer, the hub, search and the client slice, but the record, its deals and tenancies stay, and any brand can be restored.
        </p>
        {isLoading && <p className="text-sm text-muted-foreground">Checking every brand…</p>}
        {error && <p className="text-sm text-muted-foreground">The check failed. {(error as any)?.message || ""}</p>}
        {data && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="Brands" value={data.totalBrands - data.alreadyArchived} />
              <Stat label="Keep" value={data.keep} />
              <Stat label="Archive" value={data.archive} tone="amber" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Why brands are kept</p>
              <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                {Object.entries(data.signals).map(([k, s]) => (
                  <li key={k} className="flex justify-between gap-2"><span>{s.label}</span><span className="tabular-nums text-muted-foreground">{s.unavailable ? "n/a" : s.count.toLocaleString("en-GB")}</span></li>
                ))}
              </ul>
            </div>
            {data.archive > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Would be archived{data.archiveSample.length < data.archive ? ` (first ${data.archiveSample.length} of ${data.archive})` : ""} · {data.contactsOnlyArchived} of these have contacts but no activity
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
              {data.archive > 0 && <Input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={`Type ${data.archive} to confirm`} className="h-8 text-sm max-w-[12rem]" data-testid="brand-tidy-confirm" />}
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={data.archive === 0 || confirm.trim() !== String(data.archive) || apply.isPending} onClick={() => apply.mutate()} data-testid="brand-tidy-apply">
                {apply.isPending ? "Archiving…" : `Archive ${data.archive} brands`}
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

// The archived list, shown in place of the brand grid under the Archived pill.
export function ArchivedBrands() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery<{ brands: Array<{ id: string; name: string; companyType: string | null; archivedAt: string; reason: string | null }> }>({
    queryKey: ["/api/admin/brand-relevance/archived", q],
    queryFn: async () => (await apiRequest("GET", `/api/admin/brand-relevance/archived?q=${encodeURIComponent(q)}`)).json(),
    staleTime: 30 * 1000,
  });
  const restore = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", "/api/admin/brand-relevance/restore", { id })).json(),
    onSuccess: () => { toast({ title: "Brand restored" }); invalidateBrandLists(); },
    onError: (e: any) => toast({ title: "Not restored", description: e?.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-2" data-testid="archived-brands">
      <div className="flex items-center gap-2 flex-wrap">
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search archived brands…" className="h-8 text-sm max-w-xs" />
        <span className="text-xs text-muted-foreground">{data ? `${data.brands.length}${data.brands.length === 500 ? "+" : ""} archived` : isLoading ? "Loading…" : ""}</span>
      </div>
      <div className="rounded-md border divide-y">
        {data?.brands.map(b => (
          <div key={b.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
            <div className="min-w-0">
              <Link href={`/companies/${b.id}`} className="font-medium hover:underline truncate block">{b.name}</Link>
              <p className="text-[11px] text-muted-foreground truncate">{(b.companyType || "").replace(/^Tenant - /, "")}{b.reason ? ` · ${b.reason}` : ""}</p>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" disabled={restore.isPending} onClick={() => restore.mutate(b.id)} data-testid={`brand-restore-${b.id}`}><RotateCcw className="w-3 h-3 mr-1" /> Restore</Button>
          </div>
        ))}
        {data && data.brands.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">No archived brands{q ? " match" : ""}.</p>}
      </div>
    </div>
  );
}
