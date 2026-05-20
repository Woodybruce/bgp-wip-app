/**
 * Find the meeting context for a card transaction.
 * Returns the closest calendar event around the transaction time, with attendees.
 *
 * TODO: requires a Microsoft Graph service principal (app permissions) to fetch
 * calendars without a logged-in user session. Currently stubbed; the receipt
 * flow proceeds without calendar context until this is wired up.
 */

export interface MeetingContext {
  eventId: string;
  subject: string;
  attendees: string;       // comma-separated
  start: Date;
  end: Date;
  refinedCategory?: string; // e.g. "Client Entertainment" if attendees include external clients
}

export async function findMeetingContext(args: {
  userEmail: string;
  when: Date | string | null;
}): Promise<MeetingContext | null> {
  // Stubbed — returns null so the receipt flow continues without calendar context.
  // Wire up via Graph app permissions:
  //   GET /users/{userEmail}/calendarView?startDateTime=<when-30m>&endDateTime=<when+90m>
  // Then pick the event whose timespan contains `when`, refine category based on attendees.
  return null;
}

/**
 * Refine an entertainment category based on attendees.
 * - All BGP staff → "Staff Entertainment"
 * - All directors only → "Directors Meetings"
 * - External + property agency keywords → "Agent Entertainment (External)"
 * - External + non-agency → "Client Entertainment"
 */
export function refineEntertainmentCategory(args: {
  attendeeEmails: string[];
  baseCategory: string;
}): string {
  if (!["Meals & Drinks", "Subsistence"].includes(args.baseCategory)) return args.baseCategory;

  const bgpDomain = "@bgpllp.co.uk";
  const allBgp = args.attendeeEmails.every((e) => e.toLowerCase().includes(bgpDomain));
  if (allBgp) {
    const directorsOnly = args.attendeeEmails.length <= 5 &&
      args.attendeeEmails.every((e) => /woody|layla|charlotte|jack|rupert/i.test(e));
    return directorsOnly ? "Directors Meetings" : "Staff Entertainment";
  }

  const agencyDomains = /knightfrank|cbre|jll|colliers|cushman|savills|avisonyoung|bnp|gerald-eve|dtre|bryce|workman|corestate|edge|hanover/i;
  const hasAgency = args.attendeeEmails.some((e) => agencyDomains.test(e));
  return hasAgency ? "Agent Entertainment (External)" : "Client Entertainment";
}
