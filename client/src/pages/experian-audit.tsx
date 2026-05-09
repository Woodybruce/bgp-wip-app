import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Download, RefreshCcw } from "lucide-react";

interface SandboxProbe {
  product: string;
  bgpUse: string;
  path: string;
  method: string;
  status: number | null;
  ok: boolean;
  latencyMs: number;
  fields: string[];
  responseShape?: string[];
  preview: string;
  note: string;
  errorCode?: string;
  errorMessage?: string;
  classification: "available" | "needs_real_input" | "not_entitled" | "path_unknown" | "rate_limited" | "server_error" | "ambiguous";
}

interface AuditResult {
  env: string;
  configured: boolean;
  tokenOk: boolean;
  tokenError?: string;
  probes: SandboxProbe[];
  recommendation: string[];
}

export default function ExperianAuditPage() {
  const [regnum, setRegnum] = useState("99999999");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/experian/sandbox-audit?regnum=${encodeURIComponent(regnum)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Audit failed: HTTP ${res.status}`);
      const data: AuditResult = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setRunning(false);
    }
  };

  const downloadSpec = () => {
    if (!result) return;
    const md = result.recommendation.join("\n");
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `experian-sales-spec-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
      <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Experian sandbox audit</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Probe every Experian product BGP needs. Anything green is provisioned;
            anything red goes on the order to sales.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={regnum}
            onChange={(e) => setRegnum(e.target.value)}
            placeholder="UK reg no"
            className="w-32 h-9 text-sm"
          />
          <Button onClick={run} disabled={running} className="h-9 gap-1.5">
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
            {running ? "Running…" : "Run audit"}
          </Button>
          {result && (
            <Button variant="outline" onClick={downloadSpec} className="h-9 gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Download sales spec
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-md border border-red-300 bg-red-50 text-sm flex items-start gap-2">
          <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Header */}
          <Card>
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <Badge variant="outline" className="capitalize">{result.env}</Badge>
              <span className="text-sm">
                <span className="text-muted-foreground">Configured:</span>{" "}
                {result.configured ? <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-600" /> : <XCircle className="inline w-3.5 h-3.5 text-red-600" />}
              </span>
              <span className="text-sm">
                <span className="text-muted-foreground">Token:</span>{" "}
                {result.tokenOk
                  ? <CheckCircle2 className="inline w-3.5 h-3.5 text-emerald-600" />
                  : <span className="text-red-700">{result.tokenError || "failed"}</span>}
              </span>
              <span className="text-sm ml-auto text-muted-foreground">
                {result.probes.filter(p => p.ok).length} / {result.probes.length} products available
              </span>
            </CardContent>
          </Card>

          {/* Business Profile schema explorer — what does the "full report" actually contain? */}
          {(() => {
            const bp = result.probes.find(p => p.product === "Business Profile (full report)" && p.ok && p.responseShape);
            if (!bp || !bp.responseShape) return null;
            return (
              <Card className="border-blue-300">
                <CardHeader>
                  <CardTitle className="text-base">Business Profile bundled fields</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Business Profile is a "full report" endpoint — many separate products may already
                    be bundled here. Below is the structure the sandbox returned. Anything Director-/CCJ-/Group-/Financials-shaped
                    means we don't need that as a separate SKU.
                  </p>
                </CardHeader>
                <CardContent>
                  <pre className="text-[11px] font-mono whitespace-pre-wrap bg-muted/30 p-3 rounded-md max-h-72 overflow-auto">
                    {bp.responseShape.join("\n")}
                  </pre>
                </CardContent>
              </Card>
            );
          })()}

          {/* Probes */}
          <div className="grid gap-2">
            {result.probes.map((p, i) => {
              const tone = p.classification === "available" ? "border-emerald-300" :
                p.classification === "needs_real_input" ? "border-yellow-300" :
                p.classification === "not_entitled" ? "border-orange-300" :
                p.classification === "path_unknown" ? "border-red-300" : "border-slate-200";
              const Icon = p.classification === "available" ? CheckCircle2 :
                p.classification === "needs_real_input" ? AlertCircle :
                p.classification === "not_entitled" ? AlertCircle :
                XCircle;
              const iconColor = p.classification === "available" ? "text-emerald-600" :
                p.classification === "needs_real_input" ? "text-yellow-600" :
                p.classification === "not_entitled" ? "text-orange-600" : "text-red-600";
              const label = p.classification === "available" ? "Available" :
                p.classification === "needs_real_input" ? "Endpoint OK, payload rejected" :
                p.classification === "not_entitled" ? "Not entitled — ask sales" :
                p.classification === "path_unknown" ? "Path unknown — ask Experian" :
                p.classification;
              return (
                <Card key={i} className={tone}>
                  <CardContent className="p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                    <div className="md:col-span-3 flex items-start gap-2">
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
                      <div>
                        <div className="font-semibold text-sm">{p.product}</div>
                        <div className="text-[11px] text-muted-foreground font-mono break-all">{p.method} {p.path}</div>
                      </div>
                    </div>
                    <div className="md:col-span-4 text-xs text-muted-foreground">{p.bgpUse}</div>
                    <div className="md:col-span-2 text-xs">
                      <Badge variant="outline" className={
                        p.classification === "available" ? "border-emerald-300 text-emerald-700" :
                        p.classification === "needs_real_input" ? "border-yellow-400 text-yellow-700" :
                        p.classification === "not_entitled" ? "border-orange-400 text-orange-700" :
                        "border-red-300 text-red-700"
                      }>
                        {p.status ?? "—"}
                      </Badge>
                      <span className="ml-2 text-muted-foreground">{p.latencyMs}ms</span>
                      <div className="text-[10px] mt-0.5 font-medium">{label}</div>
                      {p.errorCode && <div className="text-[10px] text-muted-foreground font-mono">code: {p.errorCode}</div>}
                      {p.fields.length > 0 && (
                        <div className="text-[10px] mt-1 text-muted-foreground">
                          {p.fields.slice(0, 4).join(", ")}{p.fields.length > 4 ? "…" : ""}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-3 text-[11px] text-muted-foreground">
                      <div>{p.note}</div>
                      {p.errorMessage && (
                        <div className="mt-1 italic text-[10px] line-clamp-3">"{p.errorMessage}"</div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Sales spec preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sales spec — paste this to your Experian rep</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/30 p-3 rounded-md max-h-96 overflow-auto">
                {result.recommendation.join("\n")}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}

      {!result && !running && (
        <div className="text-sm text-muted-foreground">
          Defaults to Experian's UK sandbox dummy reg <code className="font-mono">99999999</code>.
          For a real probe enter a Companies House number that's been seeded into your sandbox.
        </div>
      )}
    </div>
  );
}
