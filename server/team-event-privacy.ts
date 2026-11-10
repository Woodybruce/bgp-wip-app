import { isPrivateEmailRecord } from "./private-mail";

/** Shared/client calendars must never promote private invitations. */
export function isShareableClientCalendarEvent(event: any, mailbox?: string): boolean {
  return !!event && !isPrivateEmailRecord(event, mailbox) && event.sensitivity === "normal"
    && event.isCancelled !== true && !/^cancell?ed:/i.test(String(event.subject || "").trim());
}

/** Read boundary for historical saved rows; keep private attendee data stored
 * out of every calendar, dashboard, briefing and activity response. */
export function teamEventPrivacySql(alias = ""): string {
  if (alias && !/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid team-event alias");
  const prefix = alias ? `${alias}.` : "";
  return `NOT bgp_private_mail_record(${prefix}created_by,to_jsonb(${prefix}attendees))`;
}
