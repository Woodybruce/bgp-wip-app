// Person enrichment from a single email — used by the mobile expense
// flow when a calendar attendee isn't in crm_contacts yet. Tries Apollo
// first (one-shot match endpoint), falls back to RocketReach lookup.
// Returns a normalised shape ready to insert into crm_contacts.
//
// Both providers are credit-metered; this is called from the user's
// explicit "Add to CRM" tap, never speculatively in a loop.

export interface EnrichedPerson {
  name: string;
  role: string | null;
  email: string;
  phone: string | null;
  mobile: string | null;
  linkedin: string | null;
  companyName: string | null;
  companyDomain: string | null;
  source: "apollo" | "rocketreach" | "fallback";
}

async function enrichViaApollo(email: string): Promise<EnrichedPerson | null> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key, "Cache-Control": "no-cache" },
      body: JSON.stringify({ email, reveal_personal_emails: false, reveal_phone_number: false }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const p = data?.person;
    if (!p) return null;
    const phones: string[] = (p.phone_numbers || []).map((x: any) => x?.sanitized_number || x?.raw_number).filter(Boolean);
    return {
      name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || email,
      role: p.title || null,
      email,
      phone: phones[0] || null,
      mobile: phones.find((x) => /^\+?[\d\s-]{7,}$/.test(x)) || null,
      linkedin: p.linkedin_url || null,
      companyName: p.organization?.name || null,
      companyDomain: p.organization?.primary_domain || null,
      source: "apollo",
    };
  } catch {
    return null;
  }
}

async function enrichViaRocketReach(email: string): Promise<EnrichedPerson | null> {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return null;
  try {
    // RocketReach v2 lookupProfile accepts email as a query param.
    const url = `https://api.rocketreach.co/v2/api/lookupProfile?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { headers: { "Api-Key": key }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const p: any = await res.json();
    if (!p || (!p.name && !p.first_name)) return null;
    const phones: string[] = (p.phones || []).map((x: any) => x?.number).filter(Boolean);
    return {
      name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim() || email,
      role: p.current_title || p.title || null,
      email,
      phone: phones[0] || null,
      mobile: phones.find((x) => /^\+?[\d\s-]{7,}$/.test(x)) || null,
      linkedin: p.linkedin_url || null,
      companyName: p.current_employer || null,
      companyDomain: null,
      source: "rocketreach",
    };
  } catch {
    return null;
  }
}

export async function enrichPersonFromEmail(email: string, fallbackName?: string): Promise<EnrichedPerson> {
  const cleanEmail = email.trim().toLowerCase();
  const apollo = await enrichViaApollo(cleanEmail);
  if (apollo) return apollo;
  const rr = await enrichViaRocketReach(cleanEmail);
  if (rr) return rr;
  // Fallback — best-effort from the email itself + display name if Outlook
  // had one. Always returns something so the caller can still create the
  // contact row with at least name + email.
  const domain = cleanEmail.split("@")[1] || null;
  const localPartName = cleanEmail.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    name: fallbackName?.trim() || localPartName,
    role: null,
    email: cleanEmail,
    phone: null,
    mobile: null,
    linkedin: null,
    companyName: null,
    companyDomain: domain,
    source: "fallback",
  };
}
