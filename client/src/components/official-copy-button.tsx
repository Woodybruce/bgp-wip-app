/**
 * OfficialCopyButton
 * ==================
 * One button, dropped on every surface where a title number appears. Orders an
 * Official Copy of Register (OC1) straight from HM Land Registry's Business
 * Gateway (mutual-TLS), persists the returned PDF to file storage (and badges
 * the title on the Land Registry board), then offers an authenticated download.
 *
 * This is the official, statutory register — distinct from the PropertyData
 * convenience copy. Live ordering incurs the HMLR fee, so it confirms first.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Stamp } from "lucide-react";
import { AuthDownloadLink } from "@/components/chatbgp-markdown";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type OfficialCopyButtonProps = {
  titleNumber: string;
  project?: string | null;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "ghost" | "default" | "secondary";
  className?: string;
  onComplete?: (body: any) => void;
};

export function OfficialCopyButton(props: OfficialCopyButtonProps) {
  // A title picker can reuse this button. Keep a completed/pending request's
  // state attached to its title, including responses arriving after a switch.
  return <OfficialCopyOrder key={props.titleNumber.trim().toUpperCase()} {...props} />;
}

function OfficialCopyOrder({
  titleNumber,
  project,
  label = "Official Copy (HMLR)",
  size = "sm",
  variant = "outline",
  className = "",
  onComplete,
}: OfficialCopyButtonProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);
  const [orderNotice, setOrderNotice] = useState<{ label: string; description: string } | null>(null);

  const order = async () => {
    const tn = (titleNumber || "").trim();
    if (!tn) return;
    if (!window.confirm(`Order the Official Copy of Register for ${tn.toUpperCase()} from HM Land Registry?\n\nA statutory fee applies (£7 — free in test mode). The register PDF is saved to file storage.`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/lr-bg/official-copy", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ titleNumber: tn, project: project || undefined }),
      });
      const body = await res.json();
      const reference = body.reference || body.summary?.reference || body.requestMessageId;
      const referenceText = reference ? ` Reference: ${reference}.` : "";
      if (body.outcome === "pending") {
        const description = `HM Land Registry accepted the request and has not returned the register yet.${referenceText} Do not place another order while this is pending.`;
        setOrderNotice({ label: "Order pending", description });
        toast({ title: "Official Copy pending", description });
        onComplete?.(body);
        return;
      }
      const url: string | null = body.saved?.registerUrl || null;
      if (!url && (body.outcome === "delivered" || body.ok)) {
        const description = `HMLR returned the register, but it could not be saved.${referenceText} Ask support to recover this response; do not place another paid order.`;
        setOrderNotice({ label: "Register received — saving failed", description });
        toast({ title: "Register needs recovery", description, variant: "destructive" });
        onComplete?.(body);
        return;
      }
      if (body.outcome === "unknown" || body.outcome === "failed" && (body.status === 0 || body.status >= 500)) {
        const description = `The app could not confirm the order result.${referenceText} Check with support before placing another paid order.`;
        setOrderNotice({ label: "Check order status", description });
        toast({ title: "Official Copy status unknown", description, variant: "destructive" });
        return;
      }
      if (!res.ok || !body.ok) {
        toast({ title: "Official Copy failed", description: body.fault || body.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      setDoneUrl(url);
      toast({
        title: "Official Copy retrieved",
        description: `${tn.toUpperCase()} register obtained from HMLR${body.fee ? ` · £${body.fee}` : ""} — saved to file storage`,
      });
      onComplete?.(body);
    } catch (e: any) {
      const description = "The app could not confirm the order result. Check with support before placing another paid order.";
      setOrderNotice({ label: "Check order status", description });
      toast({ title: "Official Copy status unknown", description, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (orderNotice) {
    return (
      <div className="space-y-1">
        <Button variant="outline" size={size} className={className} disabled>{orderNotice.label}</Button>
        <p className="text-xs text-muted-foreground max-w-sm" role="status">{orderNotice.description}</p>
      </div>
    );
  }
  if (doneUrl) {
    return (
      <AuthDownloadLink href={doneUrl}>Register (HMLR)</AuthDownloadLink>
    );
  }
  return (
    <Button variant={variant} size={size} className={`gap-1 ${className}`} onClick={order} disabled={loading} title="Order an Official Copy of Register from HM Land Registry Business Gateway">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stamp className="w-3 h-3" />}
      {label}
    </Button>
  );
}
