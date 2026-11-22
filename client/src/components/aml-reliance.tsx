// Relying on another firm's checks (Woody, 21 November 2026: MLR 2017 reg 39,
// "Yes go ahead"). The Nominated Officer or a Deputy records, for a party on
// this deal, the firm whose customer due diligence BGP relies on, with the
// regulation's conditions confirmed one by one and the firm's letter or email.
// While it stands the people to check owe nothing and the sign-off needs no
// note. The rule is shared/aml-reliance.ts; the routes server/deal-party-aml.ts.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Handshake, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";
import { RELIANCE_FIRM_KINDS, RELIANCE_TERMS, relianceInput, type PartyReliance, type RelianceFirmKind } from "@shared/aml-reliance";

const refresh = (dealId: string) => {
  queryClient.invalidateQueries({ queryKey: ["/api/aml/deal", dealId, "client-checks"] });
  queryClient.invalidateQueries({ queryKey: ["/api/kyc/deal", dealId, "status"] });
  queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard"] });
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

/** The reliance standing on a party, with Withdraw for the officers. */
export function RelianceCard({ dealId, role, reliance, canDecide }: {
  dealId: string; role: string; reliance: PartyReliance & { words: string }; canDecide: boolean;
}) {
  const { toast } = useToast();
  const withdraw = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/parties/${role}/reliance/${reliance.id}/withdraw`, {})).json(),
    onSuccess: () => { refresh(dealId); toast({ title: "Reliance withdrawn", description: "The client checks are needed again." }); },
    onError: (e: any) => toast({ title: "Not withdrawn", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="rounded border border-violet-200 bg-violet-50/60 px-2.5 py-1.5 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100" data-testid={`reliance-card-${role}`}>
      <p className="font-medium">{reliance.words}</p>
      <p className="mt-0.5">{reliance.note}</p>
      <p className="mt-0.5 opacity-80">
        Recorded by {reliance.by} on {day(reliance.at)}{reliance.contact ? ` · contact at the firm: ${reliance.contact}` : ""}
        {reliance.documents ? ` · ${reliance.documents === 1 ? "the firm's letter is" : `${reliance.documents} files are`} on the KYC record` : ""}.
        {" "}BGP stays responsible, and can ask the firm for copies of its documents at once.
        {canDecide && (
          <button type="button" data-no-min-touch className="ml-1.5 underline underline-offset-2" disabled={withdraw.isPending} onClick={() => withdraw.mutate()} data-testid={`reliance-withdraw-${role}`}>
            Withdraw
          </button>
        )}
      </p>
    </div>
  );
}

/**
 * The joint agent agreed to the reliance terms on its page (22 November 2026):
 * the officers record the reliance with that agreement as the firm's letter
 * (a PDF the server makes), what it says filled in.
 */
export interface JointRelianceSource { ref: string; firm: string; supervisor: string; registration: string | null; contact: string | null; agreedOn: string }

export function JointRelianceButton({ dealId, role, partyName, joint, gaps = [] }: { dealId: string; role: string; partyName: string; joint: JointRelianceSource; gaps?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant={gaps.length ? "outline" : "default"} className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`joint-reliance-record-${role}`}>
        <Handshake className="w-3.5 h-3.5 mr-1" />{gaps.length ? "Record the reliance anyway" : "Record the reliance"}
      </Button>
      {open && <RelianceDialog dealId={dealId} role={role} partyName={partyName} joint={joint} gaps={gaps} onClose={() => setOpen(false)} />}
    </>
  );
}

// An officer recording the reliance with gaps in the joint agent's files says how they checked them by hand.
const BY_HAND_MIN = 20;

/** The officers' button and form. */
export function RelianceButton({ dealId, role, partyName }: { dealId: string; role: string; partyName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(true)} data-testid={`reliance-open-${role}`}>
        <Handshake className="w-3.5 h-3.5 mr-1" />Rely on another firm's checks
      </Button>
      {open && <RelianceDialog dealId={dealId} role={role} partyName={partyName} onClose={() => setOpen(false)} />}
    </>
  );
}

const CONFIRMS: Array<{ key: "agreed" | "informationHeld" | "copiesOnRequest" | "equivalent"; words: string; abroadOnly?: boolean }> = [
  { key: "agreed", words: "The firm agreed in writing to BGP relying on its checks." },
  { key: "informationHeld", words: "BGP has from the firm who the customer is, its beneficial owners and anyone acting for it." },
  { key: "copiesOnRequest", words: "The firm will give copies of its identity documents immediately on request, and keep them for five years." },
  { key: "equivalent", words: "The firm is under money laundering rules and supervision equivalent to the UK's.", abroadOnly: true },
];

function RelianceDialog({ dealId, role, partyName, joint, gaps = [], onClose }: { dealId: string; role: string; partyName: string; joint?: JointRelianceSource; gaps?: string[]; onClose: () => void }) {
  const [byHand, setByHand] = useState("");
  const { toast } = useToast();
  const [firm, setFirm] = useState(joint?.firm || "");
  const [kind, setKind] = useState<RelianceFirmKind>(joint ? "estate_agent" : "solicitor");
  const [where, setWhere] = useState<"uk" | "abroad">("uk");
  const [country, setCountry] = useState("");
  const [regulator, setRegulator] = useState(joint?.supervisor || "");
  const [regulatorRef, setRegulatorRef] = useState(joint?.registration || "");
  const [contact, setContact] = useState(joint?.contact || "");
  const [agreedOn, setAgreedOn] = useState(joint?.agreedOn || "");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<File[]>([]);
  const fields = { firm, kind, where, country, regulator, regulatorRef, contact, agreedOn, note, ...confirmed };
  const checked = relianceInput(fields);
  const missing = !checked.ok ? checked.message : !files.length && !joint ? "Add the firm's letter or email agreeing to it (a PDF of the email is fine)."
    : gaps.length && byHand.trim().length < BY_HAND_MIN ? "Their files leave gaps: say how you checked them by hand, or ask them for what's missing first." : null;
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === "boolean" ? String(v) : v);
      if (joint) fd.append("jointRef", joint.ref);
      if (gaps.length) fd.append("checkedByHand", byHand.trim());
      for (const f of files) fd.append("files", f);
      const res = await fetch(`/api/deals/${dealId}/parties/${role}/reliance`, { method: "POST", body: fd, credentials: "include", headers: getAuthHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "It could not be recorded.");
      return body;
    },
    onSuccess: (r: any) => { refresh(dealId); queryClient.invalidateQueries({ queryKey: ["/api/deals", dealId, "joint-agent-checks"] }); toast({ title: "Reliance recorded", description: r?.words }); onClose(); },
    onError: (e: any) => toast({ title: "Not recorded", description: String(e?.message || e), variant: "destructive" }),
  });
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="reliance-dialog">
        <DialogHeader>
          <DialogTitle>{partyName}: rely on another firm's checks</DialogTitle>
          <DialogDescription>
            When another regulated firm on this deal (the client's solicitors, say) has checked the customer and agrees to BGP relying on its checks (MLR 2017 reg 39). The client checks are then not needed. Only the Nominated Officer or a Deputy records it.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground" data-testid="reliance-terms">
          {RELIANCE_TERMS.map(t => <li key={t}>{t}</li>)}
        </ul>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="reliance-firm">The firm</Label>
              <Input id="reliance-firm" value={firm} onChange={e => setFirm(e.target.value)} maxLength={160} placeholder="Smith & Co LLP" data-testid="reliance-firm" />
            </div>
            <div className="space-y-1.5">
              <Label>What it is</Label>
              <Select value={kind} onValueChange={v => setKind(v as RelianceFirmKind)}>
                <SelectTrigger data-testid="reliance-kind"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RELIANCE_FIRM_KINDS).map(([k, w]) => <SelectItem key={k} value={k}>{w}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Where it is</Label>
              <Select value={where} onValueChange={v => setWhere(v as "uk" | "abroad")}>
                <SelectTrigger data-testid="reliance-where"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="uk">In the UK</SelectItem><SelectItem value="abroad">Abroad</SelectItem></SelectContent>
              </Select>
            </div>
            {where === "abroad" && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="reliance-country">Country</Label>
                <Input id="reliance-country" value={country} onChange={e => setCountry(e.target.value)} maxLength={60} data-testid="reliance-country" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reliance-regulator">Its anti-money laundering supervisor</Label>
              <Input id="reliance-regulator" value={regulator} onChange={e => setRegulator(e.target.value)} maxLength={80} placeholder="SRA, FCA, ICAEW or HMRC" data-testid="reliance-regulator" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reliance-ref">Its number there (optional)</Label>
              <Input id="reliance-ref" value={regulatorRef} onChange={e => setRegulatorRef(e.target.value)} maxLength={40} placeholder="123456" data-testid="reliance-ref" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reliance-contact">Contact at the firm (optional)</Label>
              <Input id="reliance-contact" value={contact} onChange={e => setContact(e.target.value)} maxLength={160} data-testid="reliance-contact" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reliance-agreed">The day it agreed</Label>
              <Input id="reliance-agreed" type="date" value={agreedOn} onChange={e => setAgreedOn(e.target.value)} data-testid="reliance-agreed" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reliance-note">What the firm checked, and who it covers</Label>
            <Textarea id="reliance-note" value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1500}
              placeholder="For example: the buyer's solicitors identified and verified the company, its two directors and its owner, and hold the documents" data-testid="reliance-note" />
          </div>
          <div className="space-y-1.5" data-testid="reliance-confirms">
            {CONFIRMS.filter(c => !c.abroadOnly || where === "abroad").map(c => (
              <label key={c.key} className="flex items-start gap-2 text-xs">
                <Checkbox checked={!!confirmed[c.key]} onCheckedChange={v => setConfirmed(s => ({ ...s, [c.key]: v === true }))} data-testid={`reliance-confirm-${c.key}`} />
                <span>{c.words}</span>
              </label>
            ))}
          </div>
          {gaps.length > 0 && (
            <div className="space-y-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" data-testid="reliance-joint-gaps">
              <p className="font-medium">Their files do not cover everything BGP needs to rely on them (MLR 2017 reg 39(2)(a)):</p>
              <ul className="list-disc pl-4">{gaps.map(g => <li key={g}>{g}</li>)}</ul>
              <Label htmlFor="reliance-by-hand" className="text-[11px]">How you checked these by hand</Label>
              <Textarea id="reliance-by-hand" value={byHand} onChange={e => setByHand(e.target.value)} rows={2} maxLength={1000}
                placeholder="For example: their CDD summary names both owners and says each was verified; we hold their dates of birth" data-testid="reliance-by-hand" />
            </div>
          )}
          {joint && (
            <p className="rounded border border-violet-200 bg-violet-50/60 px-2 py-1.5 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100" data-testid="reliance-joint-source">
              {joint.contact || joint.firm} agreed to the terms on BGP's page on {day(joint.agreedOn)} (ref {joint.ref}). That agreement is filed as a PDF on the party's KYC record as the firm's agreement in writing. Tick each line only once you have checked what they sent.
            </p>
          )}
          <div className="space-y-1.5">
            <Label className="block">{joint ? "Anything else from the firm (optional)" : "The firm's letter or email agreeing to it"}</Label>
            <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,.doc,.docx" onChange={e => setFiles(Array.from(e.target.files || []).slice(0, 10))} data-testid="reliance-files" className="text-xs" />
            <p className="text-[11px] text-muted-foreground">Filed on the party's KYC record.</p>
          </div>
          {missing && <p className="text-[11px] text-muted-foreground" data-testid="reliance-missing">{missing}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!!missing || save.isPending} onClick={() => save.mutate()} data-testid="reliance-save">
            {save.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}Record it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
