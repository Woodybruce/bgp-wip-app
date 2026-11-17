// Admins: every client checks email as the client sees it, and a test of
// each sent to yourself (server/aml-portal.ts, /api/admin/kyc-emails). The
// test request's link opens the real client page in test mode, whether
// in-app AML is on or off.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Eye, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Preview { kind: string; title: string; to: string; subject: string; html: string }
interface KycEmails { mailbox: string; fallback: string; inAppAml: boolean; veriff: boolean; previews: Preview[] }

// The preview each test sends (the individual request is seen, not sent:
// the company one tests the same page).
const TEST_KIND: Record<string, string> = { request_company: "request", reminder: "reminder", finished: "finished", id_check: "id_check" };

export function KycEmailsAdmin() {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<KycEmails>({ queryKey: ["/api/admin/kyc-emails"] });
  const [open, setOpen] = useState<Preview | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: async (kind: string) => (await apiRequest("POST", "/api/admin/kyc-emails/test", { kind })).json(),
    onSuccess: (r: any) => {
      if (r.link) setLastLink(r.link);
      if (!r.ok) {
        toast({ title: "Test not sent", description: `${r.error || "The email didn't go."}${r.link ? " The test client page still opens from the link below." : ""}`, variant: "destructive" });
        return;
      }
      toast({
        title: "Test sent to you",
        description: `To ${r.to}, from ${r.from}.${r.fellBack ? ` Microsoft wouldn't send from ${data?.mailbox}, so it came from the shared mailbox.` : ""}${r.link ? " Open the link in it to try the client's page." : ""}`,
      });
    },
    onError: (e: any) => toast({ title: "Test not sent", description: String(e?.message || e).replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });

  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" data-testid="kyc-emails-admin">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Client check emails</p>
        <p className="text-sm mt-1">What clients get when an agent sends the in-app client checks, and a test of each sent only to you.</p>
      </div>
      {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>}
      {error && <p className="text-sm text-red-700">{String((error as any)?.message || error).replace(/^\d{3}:\s*/, "")}</p>}
      {data && (
        <>
          <dl className="grid sm:grid-cols-3 gap-2 text-xs">
            <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">Sent from</dt><dd className="font-medium break-all">{data.mailbox}</dd><dd className="text-muted-foreground">or {data.fallback} if Microsoft won't send as it</dd></div>
            <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">In-app checks</dt><dd className="font-medium">{data.inAppAml ? "On" : "Off: deals use KYC4U"}</dd><dd className="text-muted-foreground">Tests work either way</dd></div>
            <div className="rounded-md bg-muted/60 p-2"><dt className="text-muted-foreground">Online ID check (Veriff)</dt><dd className="font-medium">{data.veriff ? "Set up" : "Not set up"}</dd><dd className="text-muted-foreground">{data.veriff ? "Clients verify on their phone" : "Photo ID is asked for as a document"}</dd></div>
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
                  <Button size="sm" variant="outline" className="h-8" disabled={test.isPending} onClick={() => test.mutate(TEST_KIND[p.kind])} data-testid={`kyc-email-test-${p.kind}`}>
                    {test.isPending && test.variables === TEST_KIND[p.kind] ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}Send me a test
                  </Button>
                )}
              </li>
            ))}
          </ul>
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
