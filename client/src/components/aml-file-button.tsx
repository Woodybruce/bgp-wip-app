// The officers' AML file (Woody, 20 November 2026: "an option for the AML
// officers to generate a report to include all the documents etc which we can
// then send to HMRC if asked? Also we can send to KYC4U if we get stuck and
// need them so they can move quicker"). The server (server/aml-file.ts)
// refuses anyone but the Nominated Officer and the Deputies (admins until a
// Nominated Officer is set); the callers draw this only for them.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileArchive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getAuthHeaders, queryClient } from "@/lib/queryClient";

const plain = (e: unknown) => String((e as any)?.message || e || "").replace(/^\d{3}:\s*/, "").replace(/^\{"message":"(.*?)"(,.*)?\}$/, "$1");

function fileNameFrom(disposition: string | null): string | null {
  if (!disposition) return null;
  const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  const plainName = disposition.match(/filename="([^"]+)"/i);
  return plainName ? plainName[1] : null;
}

// role: one party; none: every party on the deal.
export function AmlFileButton({ dealId, role, partyName, className }: { dealId: string; role?: string | null; partyName?: string | null; className?: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<null | "zip" | "pdf">(null);
  const download = async (format: "zip" | "pdf") => {
    setBusy(format);
    try {
      const qs = new URLSearchParams({ ...(role ? { role } : {}), format });
      const res = await fetch(`/api/deals/${dealId}/aml-file?${qs}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "The AML file could not be made.");
      const blob = await res.blob();
      const name = fileNameFrom(res.headers.get("Content-Disposition")) || (format === "pdf" ? "AML report.pdf" : "AML file.zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      toast({ title: format === "pdf" ? "AML report made" : "AML file made", description: "It is on the KYC history with your name. Send it only to HMRC, when they ask, or to KYC4U." });
    } catch (e) {
      toast({ title: "Not made", description: plain(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };
  const forKyc4u = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/deals/${dealId}/aml-file/kyc4u`, { role })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: q => String(q.queryKey[0] || "").startsWith("/api/kyc4u") });
      queryClient.invalidateQueries({ queryKey: ["/api/aml-dashboard/party"] });
      toast({ title: "Filed for KYC4U", description: `The report is on ${partyName || "the party"}'s KYC record. Tick it in Request KYC4U check and the bookmark attaches it.` });
    },
    onError: (e) => toast({ title: "Not filed", description: plain(e), variant: "destructive" }),
  });
  const working = !!busy || forKyc4u.isPending;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={`h-7 text-xs ${className || ""}`} disabled={working} data-testid={role ? `aml-file-${role}` : "aml-file-deal"}>
          {working ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <FileArchive className="w-3.5 h-3.5 mr-1" />}
          {busy ? "Making the file…" : "AML file"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {role ? `Everything BGP holds on ${partyName || "this party"}'s checks` : "Everything BGP holds on each party's checks"}, for HMRC or KYC4U. Officers only; each file made is recorded.
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void download("zip")} data-testid={role ? `aml-file-zip-${role}` : "aml-file-zip"}>Report and every document (ZIP)</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download("pdf")} data-testid={role ? `aml-file-pdf-${role}` : "aml-file-pdf"}>The report only (PDF)</DropdownMenuItem>
        {role && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => forKyc4u.mutate()} data-testid={`aml-file-kyc4u-${role}`}>File the report for KYC4U</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
