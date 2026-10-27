import type { Querier, AccountView } from "./account-resolver";
import type { LandlordMeetingDigest } from "../shared/landlord-meetings";
import { LANDLORD_CATALOGUE_PREDICATE } from "./landlord-meeting-matching";
import { isPrivateEmailRecord, isPrivateMailboxAddress } from "./private-mail";

export type LandlordPersonScope = { key: string; name: string; email: string; userId?: string; contactId?: string };
export class LandlordPersonScopeError extends Error {
  constructor(message: string, public status = 404) { super(message); }
}

export function landlordPersonRequest(query: any): { userId?: string; contactId?: string } | null {
  const userId = query?.personUserId, contactId = query?.personContactId;
  if (userId == null && contactId == null) return null;
  if (!!userId === !!contactId || [userId, contactId].some(id => id != null && (typeof id !== "string" || !/^[\w-]{1,100}$/.test(id)))) {
    throw new LandlordPersonScopeError("Choose one saved person for this history", 400);
  }
  return userId ? { userId } : { contactId };
}

export async function resolveLandlordActivityPerson(companyId: string, request: ReturnType<typeof landlordPersonRequest>, options: {
  q?: Querier; account?: (companyId: string) => Promise<Pick<AccountView, "contacts">>;
} = {}): Promise<LandlordPersonScope | null> {
  if (!request) return null;
  const q = options.q || (await import("./db")).pool;
  const company = (await q.query(`SELECT c.id FROM crm_companies c WHERE c.id=$1 AND ${LANDLORD_CATALOGUE_PREDICATE}`, [companyId])).rows[0];
  if (!company) throw new LandlordPersonScopeError("Landlord not found");
  let person: { name: string; email: string } | undefined;
  if (request.userId) {
    // Former team members keep their recorded history; only the viewing
    // user's active staff access is required by the route.
    person = (await q.query(`SELECT COALESCE(name,username,email) AS name,lower(trim(email)) AS email FROM users
      WHERE id=$1 AND lower(COALESCE(role,'')) <> 'client'
      AND lower(trim(email)) LIKE '%@brucegillinghampollard.com'`, [request.userId])).rows[0];
  } else {
    // Same employer/property contact scope as the existing account panel.
    const account = await (options.account || (async id => (await import("./account-resolver")).resolveAccountView(id, {}, { pool: q })))(companyId);
    const contact = account.contacts.find(contact => contact.contactId === request.contactId);
    if (contact?.email) person = { name: contact.name, email: contact.email };
  }
  const email = String(person?.email || "").trim().toLowerCase();
  if (!person || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || isPrivateMailboxAddress(email)) {
    throw new LandlordPersonScopeError("This person has no available linked email address");
  }
  return { ...request, key: request.userId ? `staff:${request.userId}` : `contact:${request.contactId}`, name: person.name, email };
}

export function landlordRecordIncludesPerson(row: any, person: LandlordPersonScope): boolean {
  const includes = (value: any, depth = 0): boolean => {
    if (depth > 5 || value == null) return false;
    if (typeof value === "string") {
      if (value.trim().toLowerCase() === person.email) return true;
      if (/^\s*[\[{]/.test(value)) { try { return includes(JSON.parse(value), depth + 1); } catch { return false; } }
      return false;
    }
    if (Array.isArray(value)) return value.some(item => includes(item, depth + 1));
    return [value.email, value.address, value.emailAddress, value.participants, value.bgp_user].some(item => includes(item, depth + 1));
  };
  return includes(row?.bgp_user) || includes(row?.participants);
}

export function scopeLandlordMeetingDigest(digest: LandlordMeetingDigest, person: LandlordPersonScope | null, now = Date.now()): LandlordMeetingDigest {
  if (!person) return digest;
  const meetings = digest.meetings.filter(meeting => !isPrivateEmailRecord(meeting) && landlordRecordIncludesPerson(meeting, person));
  const upcoming = meetings.filter(meeting => Date.parse(meeting.end) >= now).sort((a,b) => Date.parse(a.start)-Date.parse(b.start));
  return { ...digest, meetings, nextMeeting: upcoming[0] || null };
}
