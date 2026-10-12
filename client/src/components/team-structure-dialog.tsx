import { useQuery, useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// The October 2026 team structure (Woody, 2026-10-12). Shows what moving
// people, properties, deals and WIP rows onto the new teams will change,
// then applies it — never automatically. Every old value is backed up.
type Plan = {
  userChanges: Array<{ id: string; name: string; note?: string; from: { team: string | null; additional_teams: string[] | null }; to: { team: string | null; additional_teams: string[] | null } }>;
  propChanges: Array<{ id: string; name: string; from: string[] | null; to: string[]; basis: string }>;
  dealChanges: Array<{ id: string; from: string[] | null; to: string[] }>;
  wipChanges: Array<{ id: string; from: string | null; to: string | null }>;
  newStaff?: Array<{ name: string; email: string; title: string; team: string | null }>;
  renames?: Array<{ id: string; from: string; to: string }>;
  profilesNeeded?: Array<{ id: string; name: string }>;
};
const teamsText = (team: string | null, more?: string[] | null) => [team, ...(more || [])].filter(Boolean).join(" + ") || "No team (sees all)";

export function TeamStructureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const preview = useQuery<{ applied: any; pending: Plan }>({
    queryKey: ["/api/admin/team-structure/preview"],
    enabled: open,
    staleTime: 0,
  });
  const apply = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/admin/team-structure/apply", { force: !!preview.data?.applied })).json(),
    onSuccess: (r: any) => {
      toast({ title: "New team structure applied", description: `${r.users} people, ${r.properties} properties, ${r.deals} deals, ${r.wip} WIP rows moved. Change any team on the deal or property.` });
      queryClient.invalidateQueries();
      onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't apply it", description: e?.message, variant: "destructive" }),
  });
  const plan = preview.data?.pending;
  const total = plan ? plan.userChanges.length + plan.propChanges.length + plan.dealChanges.length + plan.wipChanges.length + (plan.newStaff?.length || 0) + (plan.renames?.length || 0) + (plan.profilesNeeded?.length || 0) : 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[88dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New team structure</DialogTitle>
          <DialogDescription>
            Shopping Centre, London Estate, High Street and City replace the old leasing teams; Investment, Tenant Rep and Lease Advisory stay.
            People follow the One to Ones tab. Each property gets one team — a best guess from its deals' agents and its location — and so do its deals.
            Fee shares per agent and Xero are not touched. Old values are backed up.
          </DialogDescription>
        </DialogHeader>
        {preview.isLoading ? <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Working out the changes…</p>
          : preview.error ? <p className="text-sm text-destructive">{(preview.error as any)?.message}</p>
          : plan && (
            <div className="space-y-4 text-sm">
              {preview.data?.applied && <p className="text-xs text-muted-foreground">Applied {new Date(preview.data.applied.at).toLocaleString("en-GB")}. Anything below is still on an old team.</p>}
              <p className="tabular-nums">{plan.userChanges.length} people · {plan.propChanges.length} properties · {plan.dealChanges.length} deals · {plan.wipChanges.length} WIP rows to move</p>
              {(plan.newStaff?.length || plan.renames?.length || plan.profilesNeeded?.length) ? <section className="text-xs space-y-0.5">
                {plan.newStaff?.map(n => <p key={n.email}>New login and HR profile: <strong>{n.name}</strong> ({n.email}{n.team ? `, ${n.team}` : ""})</p>)}
                {plan.renames?.map(r => <p key={r.id}>Renamed: {r.from} → <strong>{r.to}</strong></p>)}
                {plan.profilesNeeded?.length ? <p>HR profiles added for: {plan.profilesNeeded.map(p => p.name).join(", ")}</p> : null}
              </section> : null}
              {plan.userChanges.length > 0 && <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">People</h3>
                <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>
                  {plan.userChanges.map(u => <tr key={u.id} className="border-t"><td className="py-1 pr-3">{u.name}</td><td className="py-1 pr-3 text-muted-foreground">{teamsText(u.from.team, u.from.additional_teams)}</td><td className="py-1 pr-3">→ {teamsText(u.to.team, u.to.additional_teams)}</td><td className="py-1 text-muted-foreground">{u.note || ""}</td></tr>)}
                </tbody></table></div>
              </section>}
              {plan.propChanges.length > 0 && <section>
                <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Properties</h3>
                <div className="overflow-x-auto"><table className="w-full text-xs"><tbody>
                  {plan.propChanges.map(p => <tr key={p.id} className="border-t"><td className="py-1 pr-3">{p.name}</td><td className="py-1 pr-3 text-muted-foreground">{(p.from || []).join(", ") || "—"}</td><td className="py-1 pr-3">→ {p.to.join(", ")}</td><td className="py-1 text-muted-foreground">{p.basis}</td></tr>)}
                </tbody></table></div>
              </section>}
            </div>
          )}
        <DialogFooter>
          <Button variant="outline" className="rounded-full" onClick={onClose}>Close</Button>
          <Button className="rounded-full" disabled={!plan || total === 0 || apply.isPending}
            onClick={() => { if (confirm(`Move ${total} records onto the new teams? Old values are backed up.`)) apply.mutate(); }}
            data-testid="button-apply-team-structure">
            {apply.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}Apply new teams
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
