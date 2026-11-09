type ContactSuggestion = { email?: unknown; name?: unknown; linkedin?: unknown; linkedin_url?: unknown };

export function landlordContactSuggestionKeys(candidate: ContactSuggestion): string[] {
  const keys: string[] = [];
  const email = String(candidate.email || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) keys.push(`contact:email:${email}`);
  try {
    const profile = new URL(String(candidate.linkedin_url || candidate.linkedin || ""));
    if (/^(?:[a-z]{2,3}\.)?linkedin\.com$/i.test(profile.hostname) && /^\/in\/[^/]+\/?$/i.test(profile.pathname)) {
      keys.push(`contact:linkedin:${profile.pathname.replace(/\/$/, "").toLowerCase()}`);
    }
  } catch { /* Name-only candidates are valid suggestions, too. */ }
  const name = String(candidate.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (name.length >= 3 && name.length <= 160 && !name.includes("@")) keys.push(`contact:name:${name}`);
  return keys;
}

export function isDismissedLandlordContact(candidate: ContactSuggestion, dismissed: ReadonlySet<string>): boolean {
  return landlordContactSuggestionKeys(candidate).some(key => dismissed.has(key));
}

export function showLandlordEmployerBadge(contact: { employerCompanyId?: unknown; employerName?: unknown }, companyId: string, companyName: string): boolean {
  if (!contact.employerName) return false;
  if (contact.employerCompanyId) return String(contact.employerCompanyId) !== companyId;
  return String(contact.employerName).trim().toLowerCase() !== companyName.trim().toLowerCase();
}
