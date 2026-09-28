import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Copy, ExternalLink, Share2, Download, Mail } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

interface CardResponse {
  card: {
    slug: string; enabled: boolean; name: string; title: string | null; mobile: string | null;
    email: string | null; linkedin: string | null; photoUrl: string | null; url: string;
  };
  signatureHtml: string;
  leads: Array<{ contact_id: string | null; name: string; company: string | null; role: string | null; created_at: string }>;
}

// Digital business card + email signature (Woody, 2026-09-28, "like blinq").
export default function BusinessCardPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<CardResponse>({ queryKey: ["/api/business-card/me"] });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => apiRequest("PATCH", "/api/business-card/me", { enabled }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/business-card/me"] }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading your card…</div>;
  if (error || !data) return <div className="p-6 text-sm text-muted-foreground">Business cards are for BGP staff accounts.</div>;
  const { card, signatureHtml, leads } = data;
  const path = `/card/${card.slug}`;

  const share = async () => {
    const payload = { title: `${card.name} · Bruce Gillingham Pollard`, text: `${card.name}${card.title ? `, ${card.title}` : ""} — Bruce Gillingham Pollard`, url: card.url };
    try {
      if (navigator.share) await navigator.share(payload);
      else { await navigator.clipboard.writeText(card.url); toast({ title: "Link copied" }); }
    } catch { /* share sheet closed */ }
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(card.url); toast({ title: "Link copied", description: card.url }); }
    catch { toast({ title: "Couldn't copy", description: card.url, variant: "destructive" }); }
  };
  const copySignature = async () => {
    try {
      const plain = [card.name, card.title, card.mobile && `M ${card.mobile}`, card.email, `Save my contact: ${card.url}`].filter(Boolean).join("\n");
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([signatureHtml], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      })]);
      toast({ title: "Signature copied", description: "Paste it into Outlook → Settings → Signatures." });
    } catch {
      toast({ title: "Couldn't copy the signature", description: "Select the preview, copy it, and paste into Outlook.", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-full bg-background pb-10" data-testid="page-business-card">
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-card md:hidden sticky top-0 z-10" style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}>
        <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/"))} className="p-1 -ml-1" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">Business card</h1>
      </div>
      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-5 md:pt-8">
        <div className="hidden md:block mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Business card</h1>
          <p className="text-sm text-muted-foreground mt-1">Show the QR code or send the link. People save your contact in one tap and can send you theirs, which goes into the CRM and your notifications.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border bg-card p-5 flex flex-col items-center text-center">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground self-start">Scan to save my contact</p>
            <img src={`${path}/qr.svg`} alt="QR code for your card" className="w-56 h-56 md:w-64 md:h-64 mt-3" />
            <p className="mt-3 font-semibold">{card.name}</p>
            {card.title && <p className="text-sm text-muted-foreground">{card.title}</p>}
            <p className="text-xs text-muted-foreground mt-1 break-all">{card.url.replace(/^https?:\/\//, "")}</p>
            <div className="grid grid-cols-2 gap-2 w-full mt-4">
              <Button onClick={share} className="rounded-full"><Share2 className="w-4 h-4 mr-1.5" />Share</Button>
              <Button variant="outline" onClick={copyLink} className="rounded-full"><Copy className="w-4 h-4 mr-1.5" />Copy link</Button>
              <Button variant="outline" asChild className="rounded-full"><a href={path} target="_blank" rel="noopener"><ExternalLink className="w-4 h-4 mr-1.5" />Open card</a></Button>
              <Button variant="outline" asChild className="rounded-full"><a href={`${path}/contact.vcf`}><Download className="w-4 h-4 mr-1.5" />Contact file</a></Button>
            </div>
            <label className="flex items-center justify-between w-full mt-4 pt-4 border-t text-sm">
              <span className="text-left">Card is live<span className="block text-xs text-muted-foreground">Turn off to stop the link and QR working.</span></span>
              <Switch checked={card.enabled} onCheckedChange={(v) => toggle.mutate(v)} data-testid="switch-card-enabled" />
            </label>
          </section>

          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Email signature</p>
              <Button size="sm" onClick={copySignature} className="rounded-full"><Mail className="w-4 h-4 mr-1.5" />Copy signature</Button>
            </div>
            <div className="mt-4 rounded-lg border bg-white p-4 overflow-x-auto" data-testid="signature-preview" dangerouslySetInnerHTML={{ __html: signatureHtml }} />
            <ol className="mt-4 text-xs text-muted-foreground space-y-1 list-decimal pl-4">
              <li>Press <strong>Copy signature</strong>.</li>
              <li>Outlook (new Outlook or web): Settings → Accounts → Signatures → New signature, paste, Save. Classic Outlook: File → Options → Mail → Signatures.</li>
              <li>Pick it as the default for new messages and for replies.</li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">It updates from People &amp; HR. Change your title, mobile, LinkedIn or photo there, then copy it again.</p>
          </section>
        </div>

        <section className="rounded-xl border bg-card p-5 mt-5">
          <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Shared with you</p>
          {leads.length === 0 ? (
            <p className="text-sm text-muted-foreground mt-2">Nobody has sent their details from your card yet. When they do, they're added to the CRM and appear here and in your notifications.</p>
          ) : (
            <div className="divide-y mt-2">
              {leads.map((lead, i) => (
                <button key={`${lead.contact_id}-${i}`} type="button" onClick={() => lead.contact_id && navigate(`/contacts/${lead.contact_id}`)}
                  className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-muted/40 rounded">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{lead.name}</span>
                    <span className="block text-xs text-muted-foreground truncate">{[lead.role, lead.company].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">{new Date(lead.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
