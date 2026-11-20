// BGP's AML policy on the AML dashboard (Woody, 19 November 2026: "can you
// consider these and add into the AML as required", then "can we have that
// as a download"): the Nominated Officer and the Deputies (more than one
// since 20 November 2026), the policy and the risk assessment to download,
// and how the app applies them. BGP staff only (the feed, server/aml-policy.ts,
// refuses anyone else); an admin sets the officers. The rules are
// shared/aml-policy.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Download, Loader2, ShieldCheck, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";

interface PolicyFeed {
  documents: Array<{ key: string; title: string; issue: number; date: string; url: string; onFile: boolean }>;
  officers: { nominated: { id: string | null; name: string | null } | null; deputies: Array<{ id: string | null; name: string | null }> };
  maxDeputies: number;
  policyNames: { nominated: string; deputy: string };
  canEdit: boolean;
  recheckYears: { simplified: number; standard: number; enhanced: number };
  lettingMonthlyRent: number;
  fatfAsOf: string;
}

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");

function refreshOfficers() {
  queryClient.invalidateQueries({ queryKey: ["/api/aml-policy"] });
  queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "") === "/api/kyc/deal" });
}

// Downloads through fetch, so a token-signed session works as a cookie one does.
async function download(url: string, fallbackName: string) {
  const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
  if (!res.ok) throw new Error(res.status === 404 ? "That document is not on file." : "The document could not be downloaded.");
  const blob = await res.blob();
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") || "")?.[1];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name ? decodeURIComponent(name) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

function OfficersDialog({ feed, onClose }: { feed: PolicyFeed; onClose: () => void }) {
  const { toast } = useToast();
  const { data: users } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const staff = (Array.isArray(users) ? users : (users as any)?.users || [])
    .filter((u: any) => u?.id && u.isActive !== false && /@brucegillinghampollard\.com$/i.test(String(u.email || "")))
    .sort((a: any, b: any) => String(a.name || "").localeCompare(String(b.name || "")));
  const nameOf = (id: string) => staff.find((u: any) => String(u.id) === id)?.name || feed.officers.deputies.find(d => d.id === id)?.name || "Someone";
  const [nominatedId, setNominated] = useState(feed.officers.nominated?.id || "");
  const [deputyIds, setDeputies] = useState<string[]>(feed.officers.deputies.map(d => d.id).filter((x): x is string => !!x));
  const max = feed.maxDeputies || 3;
  const addable = staff.filter((u: any) => String(u.id) !== nominatedId && !deputyIds.includes(String(u.id)));
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/aml-policy/officers", { nominatedId, deputyIds: deputyIds.filter(id => id !== nominatedId) })).json(),
    onSuccess: () => { refreshOfficers(); toast({ title: "Officers saved" }); onClose(); },
    onError: (e: any) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="aml-officers-dialog">
        <DialogHeader>
          <DialogTitle>AML officers</DialogTitle>
          <DialogDescription>The policy (Issue 2) names {feed.policyNames.nominated} as Nominated Officer and {feed.policyNames.deputy} as Deputy. The Nominated Officer and each Deputy decide: enhanced parties, KYC4U's results, red flags set aside and parties marked Not required.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nominated Officer (MLRO)</Label>
            <Select value={nominatedId} onValueChange={v => { setNominated(v); setDeputies(d => d.filter(id => id !== v)); }}>
              <SelectTrigger data-testid="aml-officer-nominated"><SelectValue placeholder="Choose" /></SelectTrigger>
              <SelectContent>{staff.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Deputy Nominated Officers</Label>
            {deputyIds.length > 0 ? (
              <ul className="space-y-1" data-testid="aml-officer-deputies">
                {deputyIds.map(id => (
                  <li key={id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm" data-testid={`aml-officer-deputy-${id}`}>
                    <span>{nameOf(id)}</span>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${nameOf(id)}`} onClick={() => setDeputies(d => d.filter(x => x !== id))} data-testid={`aml-officer-deputy-remove-${id}`}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">No Deputy yet.</p>}
            {deputyIds.length < max && (
              <Select value="" onValueChange={v => { if (v) setDeputies(d => d.includes(v) ? d : [...d, v]); }}>
                <SelectTrigger data-testid="aml-officer-deputy"><SelectValue placeholder="Add a Deputy" /></SelectTrigger>
                <SelectContent>{addable.map((u: any) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!nominatedId || save.isPending} onClick={() => save.mutate()} data-testid="aml-officers-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AmlPolicyPanel() {
  const { toast } = useToast();
  const { data: feed } = useQuery<PolicyFeed>({ queryKey: ["/api/aml-policy"] });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const fromPolicy = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-policy/officers/from-policy", {})).json(),
    onSuccess: (r: any) => {
      refreshOfficers();
      toast({ title: "Officers set", description: `Nominated Officer ${r?.nominated || ""}${r?.deputies?.length ? `, Deputy ${r.deputies.join(", ")}` : ""}.${r?.deputyMissing ? " No single login matched the Deputy: choose them by hand." : ""}` });
    },
    onError: (e: any) => toast({ title: "Not set", description: plain(e), variant: "destructive" }),
  });
  if (!feed) return null;
  const { nominated } = feed.officers;
  const deputies = (feed.officers.deputies || []).map(d => d.name).filter((x): x is string => !!x);
  const deputyLine = deputies.length < 2 ? deputies.join("") : `${deputies.slice(0, -1).join(", ")} and ${deputies[deputies.length - 1]}`;
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2 text-sm" data-testid="aml-policy-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5 font-medium"><ShieldCheck className="w-4 h-4 text-muted-foreground" />BGP's AML policy</div>
        <div className="text-muted-foreground" data-testid="aml-policy-officers">
          {nominated
            ? <>Nominated Officer <span className="text-foreground">{nominated.name}</span>{deputies.length ? <> · {deputies.length === 1 ? "Deputy" : "Deputies"} <span className="text-foreground">{deputyLine}</span></> : <> · no Deputy set</>}</>
            : <span className="text-amber-700 dark:text-amber-300">No Nominated Officer set: admins decide until one is.</span>}
        </div>
        {feed.canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {/* First set-up only: once set, Change is the way (the server refuses it too). */}
            {!nominated && (
              <Button type="button" variant="outline" size="sm" className="h-auto min-h-7 py-1 text-xs whitespace-normal text-left" disabled={fromPolicy.isPending} onClick={() => fromPolicy.mutate()} data-testid="aml-officers-from-policy">
                {fromPolicy.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 shrink-0 animate-spin" /> : <UserCog className="w-3.5 h-3.5 mr-1 shrink-0" />}Use the policy's officers ({feed.policyNames.nominated} and {feed.policyNames.deputy})
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="aml-officers-change">Change</Button>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 md:ml-auto">
          {feed.documents.map(d => (
            <Button key={d.key} type="button" variant="outline" size="sm" className="h-auto min-h-7 py-1 text-xs whitespace-normal text-left" disabled={!d.onFile}
              onClick={() => download(d.url, `${d.title}.docx`).catch(e => toast({ title: "Not downloaded", description: plain(e), variant: "destructive" }))}
              data-testid={`aml-policy-download-${d.key}`}>
              <Download className="w-3.5 h-3.5 mr-1 shrink-0" />{d.title}, Issue {d.issue}
            </Button>
          ))}
        </div>
      </div>
      <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(o => !o)} data-testid="aml-policy-how">
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}How the app applies it
      </button>
      {open && (
        <ul className="grid gap-x-6 gap-y-1.5 text-xs text-muted-foreground md:grid-cols-2 list-disc pl-4" data-testid="aml-policy-rules">
          <li><span className="text-foreground">Simplified</span>: a company listed on a regulated market, an FCA-authorised fund or a UK public body. No beneficial owners to verify.</li>
          <li><span className="text-foreground">Standard</span>: no higher-risk factor. The beneficial owners are identified and verified. Signed off by an agent on the deal, the Nominated Officer or the Deputy.</li>
          <li><span className="text-foreground">Enhanced</span>: a red flag or a higher-risk factor in the policy (a public role, sanctions, adverse media, a trust, an unregulated pooled fund, a high-risk or golden-visa country, a higher-risk sector, a super-prime sale). It goes to KYC4U, and the Nominated Officer or the Deputy adds KYC4U's result.</li>
          <li>Approvals last {feed.recheckYears.standard} years for simplified and standard, and {feed.recheckYears.enhanced} year for enhanced.</li>
          <li>Lettings under £{feed.lettingMonthlyRent.toLocaleString("en-GB")} a month need sanctions checks only: the owners screened, no client documents.</li>
          <li>A landlord or seller is checked before marketing, a tenant or buyer from Heads of Terms, and all of them before exchange or completion. A deal that exchanges or completes with checks outstanding still moves, and the officers are emailed.</li>
          <li>The other side of a deal a joint agent negotiated, or where no deal was done, can be marked Not required by the Nominated Officer or the Deputy.</li>
          <li>Restaurants, bars and pubs are a factor to weigh, not enhanced by themselves. High-risk countries follow FATF's lists of {feed.fatfAsOf}.</li>
        </ul>
      )}
      {editing && <OfficersDialog feed={feed} onClose={() => setEditing(false)} />}
    </div>
  );
}
