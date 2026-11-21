import { useEffect } from "react";
import { useLocation } from "wouter";

// KYC4U lives in Subscriptions & APIs (Woody, 21 November 2026: "Move KYC4U
// into subscriptions and APIS when done as we shouldn't need it again
// really"). /kyc-clouseau, /aml-compliance, /compliance-board and
// /aml-training still work: they open that section, keeping what the address
// carried (Microsoft's ?kyc4u= note after Connect, for one).
export default function KycHub() {
  const [, navigate] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.delete("tab");
    params.set("section", "kyc4u");
    navigate(`/subscriptions?${params.toString()}`, { replace: true });
  }, [navigate]);
  return null;
}
