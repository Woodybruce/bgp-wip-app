/**
 * OfficialCopyButton
 * ==================
 * One button, dropped on every surface where a title number appears. Orders an
 * Official Copy of Register (OC1) straight from HM Land Registry's Business
 * Gateway (mutual-TLS), persists the returned PDF to file storage (and badges
 * the title on the Land Registry board), then opens it.
 *
 * This is the official, statutory register — distinct from the PropertyData
 * convenience copy. Live ordering incurs the HMLR fee, so it confirms first.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Stamp, Download } from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function OfficialCopyButton({
  titleNumber,
  project,
  label = "Official Copy (HMLR)",
  size = "sm",
  variant = "outline",
  className = "",
  onComplete,
}: {
  titleNumber: string;
  project?: string | null;
  label?: string;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "outline" | "ghost" | "default" | "secondary";
  className?: string;
  onComplete?: (body: any) => void;
}) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

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
      if (!res.ok || !body.ok) {
        toast({ title: "Official Copy failed", description: body.fault || body.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const url: string | null = body.saved?.registerUrl || null;
      setDoneUrl(url);
      toast({
        title: "Official Copy retrieved",
        description: `${tn.toUpperCase()} register obtained from HMLR${body.fee ? ` · £${body.fee}` : ""} — saved to file storage`,
      });
      if (url) window.open(url, "_blank", "noopener");
      onComplete?.(body);
    } catch (e: any) {
      toast({ title: "Official Copy failed", description: e?.message || "request failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  if (doneUrl) {
    return (
      <a href={doneUrl} target="_blank" rel="noopener noreferrer">
        <Button variant="outline" size={size} className={`gap-1 text-emerald-600 ${className}`} title="Open the Official Copy register (saved to file storage)">
          <Download className="w-3 h-3" />
          Register (HMLR)
        </Button>
      </a>
    );
  }
  return (
    <Button variant={variant} size={size} className={`gap-1 ${className}`} onClick={order} disabled={loading} title="Order an Official Copy of Register from HM Land Registry Business Gateway">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stamp className="w-3 h-3" />}
      {label}
    </Button>
  );
}
