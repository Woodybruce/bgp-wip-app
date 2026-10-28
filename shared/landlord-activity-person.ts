export type LandlordActivityPerson = { userId?: string; contactId?: string; name: string };

export function landlordActivityPersonQuery(person?: LandlordActivityPerson): string {
  if (!person) return "";
  const params = new URLSearchParams();
  if (person.userId) params.set("personUserId", person.userId);
  if (person.contactId) params.set("personContactId", person.contactId);
  return params.size ? `?${params.toString()}` : "";
}
