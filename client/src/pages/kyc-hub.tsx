import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";

// KYC4U is BGP's MLRO (Woody, 2026-10-05): "we just won't AML or KYC in the
// app itself". The hub's in-app tabs (Compliance Board, Investigator,
// Training, Firm Settings) are gone; /kyc-clouseau, /aml-compliance,
// /compliance-board and /aml-training all land on the KYC4U page, so old
// links and the Send to ChatBGP bookmark install keep working.
const Kyc4uPanel = lazy(() => import("@/components/kyc4u-panel"));

export default function KycHub() {
  return (
    <div className="flex flex-col h-full min-h-screen">
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}>
          <Kyc4uPanel />
        </Suspense>
      </div>
    </div>
  );
}
