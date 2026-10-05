import { Kyc4uRequestButton, Kyc4uStatusStrip } from "@/components/kyc4u-panel";

// KYC4U is BGP's MLRO (Woody, 2026-10-05: "we just won't AML or KYC in the
// app itself"). The in-app panel — document uploads, ID checks, checklists,
// CDD form, source of wealth, suspicion reports and the two-tier sign-off —
// is retired. What's left is KYC4U's own status for the company and the
// button to raise a request with them. Stored AML records are untouched.
export function KycPanel({ companyId, dealId, role, partyName }: { companyId: string; dealId?: string; role?: string; partyName?: string }) {
  return (
    <div className="space-y-3" data-testid="kyc-panel">
      <Kyc4uStatusStrip companyId={companyId} />
      {partyName && <Kyc4uRequestButton dealId={dealId} companyId={companyId} role={role} partyName={partyName} />}
      <p className="text-xs text-muted-foreground">KYC4U run all AML/KYC checks as BGP's MLRO. Their approval is the sign-off; it shows here after the next sync.</p>
    </div>
  );
}
