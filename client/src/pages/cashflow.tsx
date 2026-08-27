// The Cashflow board folded into the Finance page (Woody, 2026-08-27:
// "just have one finance page") — this route survives only for old links.
import { useEffect } from "react";
import { useLocation } from "wouter";

export default function CashflowRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/finance", { replace: true }); }, [setLocation]);
  return null;
}
