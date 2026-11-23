// Admins: every client checks email as the client sees it, and a test of
// each sent to yourself (server/aml-portal.ts, /api/admin/kyc-emails). The
// test request's link opens the real client page in test mode, whether
// in-app AML is on or off. The request can also go to a colleague with a BGP
// login, naming the company or person being checked, copied to you as the
// agent; their Finish note comes to you.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Eye, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Preview { kind: string; title: string; to: string; subject: string; html: string }
interface KycEmails { mailbox: string; fallback: string; clientChecks: boolean; veriff: boolean; previews: Preview[] }

// The preview each test sends (the individual request is seen, not sent:
// the company one tests the same page).
const TEST_KIND: Record<string, string> = { request_company: "request", reminder: "reminder", finished: "finished", id_check: "id_check", red_flag: "red_flag" };

interface TestBody { kind: string; toUserId?: string; partyName?: string; partyKind?: "company" | "individual" }
interface StaffUser { id: string; name: string | null; email?: string | null; isActive?: boolean }
// A test goes only to a colleague with an active BGP login (the server
// checks the same).
const BGP_DOMAIN = "@brucegillinghampollard.com";
const firstName = (name: string | null | undefined) => String(name || "").trim().split(/\s+/)[0] || "them";

export function KycEmailsAdmin() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<KycEmails>({ queryKey: ["/api/admin/kyc-emails"] });
  const [open, setOpen] = useState<Preview | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: users } = useQuery<StaffUser[]>({ queryKey: ["/api/users"] });
  const colleagues = useMemo(() => (users || [])
    .filter(u => u.isActive !== false && u.id !== me?.id && String(u.email || "").trim().toLowerCase().endsWith(BGP_DOMAIN))
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))), [users, me?.id]);
  const [colleagueId, setColleagueId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [partyKind, setPartyKind] = useState<"company" | "individual">("company");
  const colleague = colleagues.find(u => u.id === colleagueId) || null;
  const test = useMutation({
    mutationFn: async (body: TestBody) => (await apiRequest("POST", "/api/admin/kyc-emails/test", body)).json(),
    onSuccess: (r: any, body: TestBody) => {
      if (r.link) setLastLink(r.link);
      if (!r.ok) {
        toast({ title: "Test not sent", description: `${r.error || "The email didn't go."}${r.link ? " The test client page still opens from the link below." : ""}`, variant: "destructive" });
        return;
      }
      const toColleague = !!body.toUserId && Array.isArray(r.cc) && r.cc.length > 0;
      const who = toColleague ? (colleagues.find(u => u.id === body.toUserId)?.name || r.to) : "you";
      toast({
        title: `Test sent to ${who}`,
        description: `To ${r.to}${toColleague ? ", copied to you" : ""}, from ${r.from}.${r.fellBack ? ` Microsoft wouldn't send from ${data?.mailbox}, so it came from ${r.from}.` : ""}${toColleague ? ` When ${firstName(who)} presses Finish on the page, the agents' note comes to you.` : r.link ? " Open the link in it to try the client's page." : ""}`,
      });
    },
    onError: (e: any) => toast({ title: "Test not sent", description: String(e?.message || e).replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" data-testid="kyc-emails-admin">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Client check emails</p>
        <p className="text-sm mt-1">What clients get when an agent sends the in-app client checks, a test of each sent only to you, and the request sent to a colleague to try as a client would.</p>
      </div>
      {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
      {error && <p className="text-sm text-red-700">{String((error as any)?.message || error).replace(/^\d{3}:\s*/, "")}</p>}
      {data && (
        <>
          <dl className="grid sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">Sent from</dt><dd className="font-medium break-all">{data.mailbox}</dd><dd className="text-muted-foreground">or {data.fallback} if Microsoft won't send as it</dd></div>
            <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">Client checks</dt><dd className="font-medium">{data.clientChecks ? "On" : "Off: the officers sign each party off"}</dd><dd className="text-muted-foreground">Tests work either way</dd></div>
            <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">Online ID check (Veriff)</dt><dd className="font-medium">{data.veriff ? "Set up" : "Not set up"}</dd><dd className="text-muted-foreground">{data.veriff ? "Clients verify on their phone. A test page runs a real check too, charged as usual." : "Photo ID is asked for as a document"}</dd></div>
          </dl>
          <ul className="divide-y rounded-md border">
            {data.previews.map(p => (
              <li key={p.kind} className="flex flex-wrap items-center gap-2 p-2.5" data-testid={`kyc-email-${p.kind}`}>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">To: {p.to}</div>
                  <div className="text-xs text-muted-foreground truncate">Subject: {p.subject}</div>
                </div>
                <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(p)}><Eye className="w-3.5 h-3.5 mr-1" />See it</Button>
                {TEST_KIND[p.kind] && (
                  <Button size="sm" variant="outline" className="h-8" disabled={test.isPending} onClick={() => test.mutate({ kind: TEST_KIND[p.kind] })} data-testid={`kyc-email-test-${p.kind}`}>
                    {test.isPending && test.variables?.kind === TEST_KIND[p.kind] && !test.variables?.toUserId ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}Send me a test
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="rounded-md border p-3 space-y-2" data-testid="kyc-email-colleague">
            <div>
              <div className="text-sm font-medium">Try it with a colleague</div>
              <p className="text-xs text-muted-foreground">The request goes to them as a client gets it, from {data.mailbox}, copied to you as the agent. When they press Finish on the page, the agents' note comes to you. Only people with a BGP login can be picked.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px]">
              <Select value={colleagueId} onValueChange={setColleagueId}>
                <SelectTrigger className="h-9" aria-label="Send the test to" data-testid="kyc-colleague-select"><SelectValue placeholder="Send to…" /></SelectTrigger>
                <SelectContent>
                  {colleagues.map(u => <SelectItem key={u.id} value={u.id}>{u.name || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-9" value={partyName} onChange={e => setPartyName(e.target.value)} maxLength={120} placeholder="Company or person being checked" aria-label="Company or person being checked" data-testid="kyc-colleague-party" />
              <Select value={partyKind} onValueChange={v => setPartyKind(v === "individual" ? "individual" : "company")}>
                <SelectTrigger className="h-9" aria-label="Who is being checked" data-testid="kyc-colleague-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">A company</SelectItem>
                  <SelectItem value="individual">A private individual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" className="h-8" disabled={!colleague || test.isPending}
              onClick={() => colleague && test.mutate({ kind: "request", toUserId: colleague.id, partyName: partyName.trim() || undefined, partyKind })}
              data-testid="kyc-colleague-send">
              {test.isPending && test.variables?.toUserId ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
              {colleague ? `Send the test to ${firstName(colleague.name)}` : "Send the test"}
            </Button>
          </div>
          {lastLink && (
            <p className="text-xs">
              <a href={lastLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Open the test client page <ExternalLink className="w-3 h-3" /></a>
              <span className="text-muted-foreground"> · works for two days; uploads there are not kept</span>
            </p>
          )}
        </>
      )}
      <Dialog open={!!open} onOpenChange={o => { if (!o) setOpen(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            <DialogDescription>Subject: {open?.subject}</DialogDescription>
          </DialogHeader>
          {open && <iframe title={open.title} srcDoc={open.html} sandbox="" className="w-full h-[70vh] rounded border bg-white" />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
