// Tokenised KYC upload portal — public page (no BGP login required).
// Customer / tenant gets a link like /kyc-upload/<token> in their email,
// drops their docs, server runs Claude classification + SoF analysis and
// stores everything against the deal. No data leaves the BGP tenant.

import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { ShieldCheck, Upload, CheckCircle2, AlertCircle, Loader2, FileText } from "lucide-react";
import bgpLogo from "@assets/BGP_BlackHolder_1771853582461.png";

interface UploadResult { name: string; ok: boolean; classification?: string; error?: string; }

export default function KycUploadPage() {
  const [, params] = useRoute("/kyc-upload/:token");
  const token = params?.token;
  const [state, setState] = useState<{ status: "loading" | "valid" | "invalid"; deal?: { id: string; name: string }; error?: string }>({ status: "loading" });
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  useEffect(() => {
    if (!token) { setState({ status: "invalid", error: "No link provided." }); return; }
    fetch(`/api/kyc-upload/${token}`)
      .then(async r => {
        if (r.ok) { const j = await r.json(); setState({ status: "valid", deal: j.deal }); }
        else { const j = await r.json().catch(() => ({})); setState({ status: "invalid", error: j.error || "Link is no longer valid." }); }
      })
      .catch(() => setState({ status: "invalid", error: "Couldn't reach the BGP server." }));
  }, [token]);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !token) return;
    setUploading(true);
    const next: UploadResult[] = [];
    for (const f of Array.from(files)) {
      try {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch(`/api/kyc-upload/${token}/file`, { method: "POST", body: fd });
        if (r.ok) {
          const j = await r.json();
          next.push({ name: f.name, ok: true, classification: j.classification });
        } else {
          const j = await r.json().catch(() => ({}));
          next.push({ name: f.name, ok: false, error: j.error || "Upload failed" });
        }
      } catch (e: any) {
        next.push({ name: f.name, ok: false, error: e?.message || "Upload failed" });
      }
    }
    setResults(prev => [...next, ...prev]);
    setUploading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 flex items-start sm:items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-xl bg-white rounded-2xl border shadow-sm p-6 sm:p-8">
        <div className="flex items-center justify-between mb-5">
          <img src={bgpLogo} alt="Bruce Gillingham Pollard" className="h-10" />
          <ShieldCheck className="w-6 h-6 text-emerald-600" />
        </div>

        {state.status === "loading" && (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Checking link…</span>
          </div>
        )}

        {state.status === "invalid" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-red-800">Link not valid</p>
              <p className="text-sm text-red-700 mt-1">{state.error || "This upload link is invalid, expired or revoked."}</p>
              <p className="text-sm text-red-700 mt-2">Please reply to the email you received and we'll send a fresh link.</p>
            </div>
          </div>
        )}

        {state.status === "valid" && (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">KYC document upload</h1>
            <p className="text-sm text-muted-foreground mt-1">Deal: <span className="font-medium text-foreground">{state.deal?.name}</span></p>

            <div className="mt-5 rounded-lg border bg-muted/30 p-4 text-sm">
              <p className="font-medium mb-2">Please upload:</p>
              <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                <li>Photo ID — passport or driving licence</li>
                <li>Proof of address — utility bill / bank statement / council tax (within 3 months)</li>
                <li>Proof of source of funds — bank statement / payslip / accountant or lender confirmation</li>
              </ul>
            </div>

            <label
              htmlFor="kyc-file-input"
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
              className={`mt-5 block rounded-xl border-2 border-dashed p-8 sm:p-10 text-center cursor-pointer transition-colors ${drag ? "border-emerald-500 bg-emerald-50" : "border-muted-foreground/30 hover:border-emerald-400 hover:bg-emerald-50/50"}`}
            >
              {uploading ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                  <p className="font-medium">Uploading & analysing…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-emerald-600" />
                  <p className="font-medium">Drop files here, or click to browse</p>
                  <p className="text-xs text-muted-foreground">PDF, Word, Excel, images. Up to 25MB each.</p>
                </div>
              )}
              <input
                id="kyc-file-input"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.heic,.heif,.txt,.csv"
                className="hidden"
                onChange={(e) => upload(e.target.files)}
                data-testid="input-kyc-upload"
              />
            </label>

            {results.length > 0 && (
              <div className="mt-5 space-y-1.5">
                <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Uploaded</p>
                {results.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 rounded-md border p-2 text-sm ${r.ok ? "border-emerald-200 bg-emerald-50/50" : "border-red-200 bg-red-50/50"}`}>
                    {r.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />}
                    <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate flex-1">{r.name}</span>
                    {r.ok && r.classification && (
                      <span className="text-xs text-muted-foreground capitalize">{r.classification.replace(/_/g, " ")}</span>
                    )}
                    {!r.ok && <span className="text-xs text-red-700 truncate">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
              Documents are stored securely in BGP's UK SharePoint, accessible only to the deal team and our MLRO.
              You can email us anytime if you'd rather send the docs directly — please keep the subject line of the original email so we can route the reply correctly.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
