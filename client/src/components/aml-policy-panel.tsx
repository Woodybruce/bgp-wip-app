// BGP's AML policy on the AML dashboard (Woody, 19 November 2026: "can you
// consider these and add into the AML as required", then "can we have that
// as a download"): the Nominated Officer and the Deputies (more than one
// since 20 November 2026), the policy and the risk assessment to download,
// and how the app applies them. BGP staff only (the feed, server/aml-policy.ts,
// refuses anyone else); an admin sets the officers. The rules are
// shared/aml-policy.ts.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Loader2, ShieldCheck, UserCog, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { amlOfficerLabel } from "@shared/aml-policy";

interface PolicyFeed {
  documents: Array<{ key: string; title: string; issue: number; date: string; url: string; onFile: boolean; replaced?: boolean }>;
  officers: { nominated: { id: string | null; name: string | null } | null; deputies: Array<{ id: string | null; name: string | null }> };
  maxDeputies: number;
  policyNames: { nominated: string; deputies: string[] };
  canEdit: boolean;
  recheckYears: { simplified: number; standard: number; enhanced: number };
  lettingMonthlyRent: number;
  fatfAsOf: string;
  isOfficer?: boolean;
  // In-house enhanced due diligence (21 November 2026): the officers switch it.
  inHouseEdd?: { on: boolean; by: string | null; at: string | null };
}

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*)"(,.*)?\}$/, "$1");
const andList = (names: readonly string[]): string => names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

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
          <DialogDescription>The policy (Issue 4) names {feed.policyNames.nominated} as Nominated Officer and {andList(feed.policyNames.deputies)} as Deputies. The Nominated Officer and each Deputy decide: enhanced parties, red flags set aside and parties marked Not required.</DialogDescription>
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

// Enhanced due diligence is BGP's own: KYC4U is no longer used (Woody,
// 23 November 2026). Its past checks stay on record.
function InHouseEddLine() {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-testid="aml-in-house-edd">
      <span className="text-muted-foreground">Enhanced due diligence:</span>
      <span className="text-foreground font-medium" data-testid="aml-in-house-edd-state">done by BGP's officers</span>
      <span className="text-muted-foreground">KYC4U is no longer used (23 November 2026); its past checks stay on record.</span>
    </div>
  );
}

/** Enhanced checks are always the officers' (KYC4U is no longer used). */
export function useAmlInHouse(): boolean {
  return true;
}

/** "AML Officer (Jack)": who a red flag is raised with (Jack, 23 November 2026). */
export function useAmlOfficerLabel(): string {
  const { data } = useQuery<{ officers?: { nominated?: { name: string | null } | null } }>({ queryKey: ["/api/aml-policy"], staleTime: 60_000 });
  return amlOfficerLabel(data?.officers?.nominated?.name);
}

export function AmlPolicyPanel() {
  const { toast } = useToast();
  const { data: feed } = useQuery<PolicyFeed>({ queryKey: ["/api/aml-policy"] });
  // The Policy pill of the AML page (22 November 2026: the policy came off the
  // checks table, which gets the room): the officers, the in-house switch, the
  // documents and how the app applies the policy.
  const [editing, setEditing] = useState(false);
  const fromPolicy = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/aml-policy/officers/from-policy", {})).json(),
    onSuccess: (r: any) => {
      refreshOfficers();
      toast({ title: "Officers set", description: `Nominated Officer ${r?.nominated || ""}${r?.deputies?.length ? `, ${r.deputies.length === 1 ? "Deputy" : "Deputies"} ${andList(r.deputies)}` : ""}.${r?.deputiesMissing?.length ? ` No single login matched ${andList(r.deputiesMissing)}: choose them by hand.` : ""}` });
    },
    onError: (e: any) => toast({ title: "Not set", description: plain(e), variant: "destructive" }),
  });
  if (!feed) return null;
  const { nominated } = feed.officers;
  const deputies = (feed.officers.deputies || []).map(d => d.name).filter((x): x is string => !!x);
  const deputyLine = andList(deputies);
  return (
    <>
      <div className="max-w-3xl space-y-4 text-sm" data-testid="aml-policy-panel">
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Officers</h3>
          <p>
            {nominated
              ? <>Nominated Officer <span className="font-medium">{nominated.name}</span>{deputies.length ? <>. {deputies.length === 1 ? "Deputy" : "Deputies"} <span className="font-medium">{deputyLine}</span>.</> : <>. No Deputy.</>}</>
              : <span className="text-amber-700 dark:text-amber-300">No Nominated Officer set: admins decide until one is.</span>}
          </p>
          {feed.canEdit && (
            <div className="flex flex-wrap gap-1.5">
              {/* First set-up only: once set, Change is the way (the server refuses it too). */}
              {!nominated && (
                <Button type="button" variant="outline" size="sm" className="h-auto min-h-7 py-1 text-xs whitespace-normal text-left" disabled={fromPolicy.isPending} onClick={() => fromPolicy.mutate()} data-testid="aml-officers-from-policy">
                  {fromPolicy.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 shrink-0 animate-spin" /> : <UserCog className="w-3.5 h-3.5 mr-1 shrink-0" />}Use the policy's officers ({andList([feed.policyNames.nominated, ...feed.policyNames.deputies])})
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)} data-testid="aml-officers-change">Change</Button>
            </div>
          )}
        </section>
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enhanced checks</h3>
          <InHouseEddLine />
        </section>
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documents</h3>
          <div className="flex flex-wrap gap-1.5">
            {feed.documents.filter(d => !d.replaced).map(d => (
              <Button key={d.key} type="button" variant="outline" size="sm" className="h-auto min-h-7 py-1 text-xs whitespace-normal text-left" disabled={!d.onFile}
                onClick={() => download(d.url, `${d.title}, Issue ${d.issue}.docx`).catch(e => toast({ title: "Not downloaded", description: plain(e), variant: "destructive" }))}
                data-testid={`aml-policy-download-${d.key}`}>
                <Download className="w-3.5 h-3.5 mr-1 shrink-0" />{d.title}, Issue {d.issue}
              </Button>
            ))}
          </div>
          {feed.documents.some(d => d.replaced) && (
            <p className="text-xs text-muted-foreground" data-testid="aml-policy-earlier">
              Earlier issues, kept for five years:{" "}
              {feed.documents.filter(d => d.replaced).map((d, i) => (
                <span key={d.key}>{i ? ", " : ""}
                  <button type="button" className="underline underline-offset-2 hover:text-foreground disabled:no-underline" disabled={!d.onFile}
                    onClick={() => download(d.url, `${d.title}, Issue ${d.issue}.docx`).catch(e => toast({ title: "Not downloaded", description: plain(e), variant: "destructive" }))}
                    data-testid={`aml-policy-download-${d.key}`}>{d.title}, Issue {d.issue}</button>
                </span>
              ))}
            </p>
          )}
        </section>
        <section className="space-y-1.5" data-testid="aml-policy-how">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How the app applies it</h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-4" data-testid="aml-policy-rules">
            <li><span className="text-foreground">Simplified</span>: a listed company (no owners to verify), an FCA-authorised fund (owners still identified), or a UK public body recorded on the party (no owners to verify). The party's box says so in green and drafts the note of reasons to save on the transaction. Never with a PEP, ownership beyond one UK company or any higher-risk factor; a company owned by a listed one is standard.</li>
            <li><span className="text-foreground">Standard</span>: no higher-risk factor. Owners identified and verified. Signed off by an agent on the transaction or an officer.</li>
            <li><span className="text-foreground">Enhanced</span>: a red flag or a higher-risk factor. Signed off by the Nominated Officer or a Deputy, with a note of what was checked.</li>
            <li>Approvals last {feed.recheckYears.standard} years ({feed.recheckYears.enhanced} for enhanced).</li>
            <li>Lettings under £{feed.lettingMonthlyRent.toLocaleString("en-GB")} a month: sanctions checks only.</li>
            <li>Landlord or seller before marketing; tenant or buyer from Heads of Terms; all checks done before exchange or completion. A transaction moved to Exchanged or Completed with checks outstanding emails the officers.</li>
            <li>No transaction done with the other side: an officer can mark it Not required. On a joint instruction the counterparty is always checked.</li>
            <li>Restaurants, bars and pubs, and a super-prime sale, are factors to weigh. High-risk countries follow FATF's lists of {feed.fatfAsOf}.</li>
          </ul>
        </section>
      </div>
      {editing && <OfficersDialog feed={feed} onClose={() => setEditing(false)} />}
    </>
  );
}
