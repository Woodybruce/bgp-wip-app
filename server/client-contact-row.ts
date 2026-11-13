// What a client login (a landlord such as Landsec, or BGP staff viewing as
// one) is sent about a CRM contact, and what it may write to one.
//
// A contact row carries BGP's own working fields: the notes (including the
// "Auto-added from email — <staff name>, <date>" line and where a job title
// was read from), which BGP agents cover the person, the next meeting, how
// the record was sourced. None of that is for a client (Woody, 2026-11-13).
// The read is an allow-list, so a new column is closed until it is added
// here. The write filter goes with it: the client's Edit form no longer
// receives the notes, and without the filter its save would blank them.

const CLIENT_READ_KEYS = [
  "id", "name", "role", "companyId", "companyName", "email", "phone", "phoneMobile",
  "avatarUrl", "linkedinUrl", "groupName", "contactType", "agentSpecialty", "createdAt", "updatedAt",
] as const;

const CLIENT_WRITE_KEYS = [
  "name", "role", "companyId", "companyName", "email", "phone", "phoneMobile",
  "linkedinUrl", "groupName", "contactType", "agentSpecialty",
] as const;

/** A contact as a client login may see it. */
export function clientContactRow<T extends Record<string, any>>(row: T | null | undefined): Record<string, any> | null | undefined {
  if (!row) return row;
  const out: Record<string, any> = {};
  for (const key of CLIENT_READ_KEYS) if (key in row) out[key] = row[key];
  return out;
}

/** The fields of a contact a client login may set. Everything else in the request is dropped. */
export function clientContactWrite(body: unknown): Record<string, any> {
  const out: Record<string, any> = {};
  if (!body || typeof body !== "object") return out;
  for (const key of CLIENT_WRITE_KEYS) if (key in (body as any)) out[key] = (body as any)[key];
  return out;
}
