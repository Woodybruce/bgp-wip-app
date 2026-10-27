type ContactRecord = { id?: string; name?: string | null; email?: string | null; linkedin_url?: string | null; linkedin?: string | null; [field: string]: any };

/** Identity keys for display grouping, never a CRM merge or a name guess. */
export function landlordContactIdentityKeys(contact: ContactRecord): string[] {
  const keys: string[] = [];
  if (contact.id) keys.push(`id:${contact.id}`);
  const email = String(contact.email || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) keys.push(`email:${email}`);
  try {
    const raw = String(contact.linkedin_url || contact.linkedin || "").trim();
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const parts = url.pathname.split("/").filter(Boolean);
    if ((url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) && parts.length === 2 && parts[0].toLowerCase() === "in") {
      keys.push(`linkedin:${parts[1].toLowerCase()}`);
    }
  } catch { /* No usable personal profile. */ }
  return keys;
}

/** Show a confirmed identity once, retaining links to all saved records. */
export function landlordDisplayContacts(rows: ContactRecord[]): ContactRecord[] {
  const parents = rows.map((_, index) => index);
  const root = (index: number): number => parents[index] === index ? index : (parents[index] = root(parents[index]));
  const seen = new Map<string, number>();
  rows.forEach((row, index) => landlordContactIdentityKeys(row).forEach(key => {
    const previous = seen.get(key);
    if (previous !== undefined) parents[root(index)] = root(previous);
    else seen.set(key, index);
  }));
  const groups = new Map<number, ContactRecord[]>();
  rows.forEach((row, index) => { const key = root(index); groups.set(key, [...(groups.get(key) || []), row]); });
  const touches = (row: ContactRecord) => Number(row.interaction_count || row.bgp?.threadCount || 0);
  const completeness = (row: ContactRecord) => [row.email, row.phone, row.role, row.linkedin_url, row.avatar_url].filter(Boolean).length;
  const naturalName = (row: ContactRecord) => {
    const name = String(row.name || "").trim();
    return name && !name.includes("@") ? 1 + Number(!/\b[A-Z]{2,}\b/.test(name)) : 0;
  };
  return [...groups.values()].map(group => {
    if (group.length === 1) return group[0];
    const ranked = [...group].sort((a, b) => touches(b) - touches(a) || completeness(b) - completeness(a));
    const primary = ranked[0];
    const named = [...ranked].sort((a, b) => naturalName(b) - naturalName(a))[0];
    return {
      ...primary,
      name: named.name || primary.name,
      phone: primary.phone || ranked.find(row => row.phone)?.phone,
      linkedin_url: primary.linkedin_url || ranked.find(row => row.linkedin_url)?.linkedin_url,
      // Counts are those of the primary record, never a sum of overlapping mail.
      relatedContactRecords: ranked.slice(1).filter(row => row.id && row.id !== primary.id),
    };
  });
}
