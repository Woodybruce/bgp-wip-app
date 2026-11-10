// Account-level exclusion requested by Woody: this inbox is private, including
// copies sent to other staff. Never use it for CRM evidence or app mail views.
export const PRIVATE_MAILBOX = "equity@brucegillinghampollard.com";
export const PRIVATE_MAIL_POLICY_VERSION = "equity-private-20261027-v1";

export function isPrivateMailboxAddress(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /(?:^|[\s<"',;:([{])equity(?:\+[^@\s<>]+)?@brucegillinghampollard\.com(?=$|[\s>"',;:)\]}])/i.test(value);
}

function containsPrivateAddress(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return isPrivateMailboxAddress(value);
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => containsPrivateAddress(item, seen));
  const person = value as Record<string, unknown>;
  // Participant maps and Graph emailAddress objects are both used by our
  // stored snapshots. Only callers' address-bearing fields reach this walker;
  // subject/body text must not turn an unrelated message into a private one.
  return Object.entries(person).some(([key, entry]) => isPrivateMailboxAddress(key) || containsPrivateAddress(entry, seen));
}

export function isPrivateEmailRecord(record: any, mailbox?: string): boolean {
  if (isPrivateMailboxAddress(mailbox)) return true;
  if (!record) return false;
  let participants = record.participants;
  if (typeof participants === "string") {
    try { participants = JSON.parse(participants); } catch { /* address text is checked below */ }
  }
  return [record.bgp_user, record.bgpUser, record.mailbox, record.mailboxEmail, record.mailbox_email,
    record.from, record.sender, record.fromEmail, record.from_email, record.senderEmail, record.sender_email,
    record.to, record.cc, record.bcc, record.to_emails, record.cc_emails, record.bcc_emails,
    record.toRecipients, record.ccRecipients, record.bccRecipients, record.recipients,
    record.organizer, record.attendees, record.bgpParticipants, participants].some(value => containsPrivateAddress(value));
}
