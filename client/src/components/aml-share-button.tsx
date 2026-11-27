// Send a party's KYC documents on to another agent for their own checks
// (Jack, 27 November 2026: "How can I make it so that I can send it on to the
// vendors agent for their checks?"). The officers only: the server
// (server/aml-share.ts) refuses anyone else and decides what may be sent. No
// form element: this opens inside the transaction's AML box.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface PackView {
  partyName: string;
  recipients: Array<{ label: string; firm: string | null; name: string | null; email: string | null }>;
  documents: Array<{ id: string; type: string; name: string; at: string | null; size: number | null; statement: string; ticked: boolean }>;
  linkDays: number;
  sent: Array<{ toEmail: string; toName: string | null; firm: string | null; files: number; by: string | null; at: string; expiresAt: string; downloads: number; attached: boolean }>;
}

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*?)"(,.*)?\}$/, "$1");
const day = (v: string) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function AmlShareButton({ dealId, role, partyName }: { dealId: string; role: string; partyName?: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [toEmail, setToEmail] = useState("");
  const [toName, setToName] = useState("");
  const [firm, setFirm] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/deals/${dealId}/parties/${role}/share-pack`;
  const q = useQuery<PackView>({ queryKey: [url], enabled: open });

  useEffect(() => {
    if (!q.data || !open) return;
    setTicked(new Set(q.data.documents.filter(d => d.ticked).map(d => d.id)));
  }, [q.data, open]);

  const pick = (r: PackView["recipients"][number]) => {
    setToEmail(r.email || "");
    setToName(r.name || "");
    setFirm(r.firm || "");
  };
  const toggle = (id: string) => setTicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const send = async () => {
    setBusy(true);
    try {
      const res = await apiRequest("POST", url, { toEmail, toName, firm, note, documentIds: [...ticked] });
      const out = await res.json();
      toast({
        title: `Sent to ${toName || toEmail}`,
        description: `${out.files} files${out.attached ? ", attached" : ", by download link (too large to attach)"}. The link works for ${q.data?.linkDays ?? 14} days.${out.left?.length ? ` Not included: ${out.left.join("; ")}.` : ""}`,
      });
      setNote("");
      await qc.invalidateQueries({ queryKey: [url] });
    } catch (e) {
      toast({ title: "Not sent", description: plain(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const docs = q.data?.documents || [];
  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`aml-share-${role}`}>
        <Send className="w-3.5 h-3.5 mr-1" />Send to their agent
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto" data-testid={`aml-share-dialog-${role}`}>
          <DialogHeader>
            <DialogTitle>Send {q.data?.partyName || partyName || "this party"}'s KYC documents</DialogTitle>
            <DialogDescription>
              For another agent's own checks. A cover sheet says how we hold each document and that BGP is not agreeing reliance. Our own notes, screening and red flags are never included.
            </DialogDescription>
          </DialogHeader>
          {q.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading the documents…</div>
            : q.isError ? <p className="text-sm text-destructive">{plain(q.error)}</p>
            : (
              <div className="space-y-4 text-sm">
                <div className="space-y-2">
                  <div className="font-medium">Who to</div>
                  {q.data!.recipients.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {q.data!.recipients.map((r, i) => (
                        <Button key={i} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => pick(r)} data-testid={`aml-share-recipient-${i}`}>
                          {r.label}: {r.name || r.firm || "no name"}{r.email ? "" : " (no email held)"}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="Email address" type="email" data-testid="aml-share-email" />
                    <Input value={toName} onChange={e => setToName(e.target.value)} placeholder="Their name" data-testid="aml-share-name" />
                    <Input value={firm} onChange={e => setFirm(e.target.value)} placeholder="Their firm" data-testid="aml-share-firm" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="font-medium">What to send ({ticked.size} of {docs.length})</div>
                  {docs.length === 0 ? <p className="text-muted-foreground">Nothing on this party's KYC record can be sent yet.</p> : (
                    <div className="divide-y rounded-md border">
                      {docs.map(d => (
                        <label key={d.id} className="flex cursor-pointer items-start gap-2 p-2" data-testid={`aml-share-doc-${d.id}`}>
                          <Checkbox checked={ticked.has(d.id)} onCheckedChange={() => toggle(d.id)} className="mt-0.5" />
                          <span className="min-w-0">
                            <span className="block break-words">{d.type}: {d.name}</span>
                            <span className="block text-xs text-muted-foreground">{d.statement}</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="A note to go in the email and on the cover sheet (optional)" rows={2} data-testid="aml-share-note" />
                {q.data!.sent.length > 0 && (
                  <div className="space-y-1 text-xs text-muted-foreground" data-testid="aml-share-sent">
                    <div className="font-medium text-foreground">Sent before</div>
                    {q.data!.sent.map((s, i) => (
                      <div key={i}>
                        {day(s.at)}: {s.files} files to {[s.toName, s.firm].filter(Boolean).join(", ") || s.toEmail} ({s.toEmail}) by {s.by || "BGP"} · downloaded {s.downloads} time{s.downloads === 1 ? "" : "s"} · link {new Date(s.expiresAt) < new Date() ? "expired" : `until ${day(s.expiresAt)}`}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            <Button type="button" onClick={() => void send()} disabled={busy || !ticked.size || !toEmail.trim()} data-testid="aml-share-send">
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
