// One definition of "landlord-shaped" for the profile layouts, shared by the
// desktop brand panel and the mobile brand view (they used to run different
// tests — desktop read the server flag with a landlord|investor|developer|
// reit|fund type fallback, mobile regexed /landlord|client/i on the type —
// so the same company rendered as a landlord on one and a brand on the
// other).
//
// The server computes the authoritative flag (deal/property relationships
// included — see brand-profile.ts, "One definition of landlord for the whole
// app") and sends it on the profile payload as `isLandlord`. The type
// heuristic is only a fallback for stale cached responses without the flag.
export function isLandlordCompany(
  companyType: string | null | undefined,
  serverFlag?: unknown,
): boolean {
  if (typeof serverFlag === "boolean") return serverFlag;
  const t = (companyType || "").toLowerCase();
  if (!t) return false;
  return t.includes("landlord") || t.includes("investor") || t.includes("developer") || t.includes("reit") || t.includes("fund");
}
