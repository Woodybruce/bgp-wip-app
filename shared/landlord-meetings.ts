export interface LandlordMeetingPerson { email: string; name: string }

export interface LandlordMeeting {
  id: string;
  companyId: string;
  companyName: string;
  subject: string;
  start: string;
  end: string;
  location: string;
  participants: LandlordMeetingPerson[];
  bgpParticipants: LandlordMeetingPerson[];
  source: "calendar";
  sourceId: string;
  mailbox: string;
  webLink: string | null;
  matchReasons: string[];
  checkedAt: string;
}

export interface LandlordMeetingCoverage {
  status: "current" | "partial" | "not_synced";
  checkedAt: string | null;
  mailboxesChecked: number;
  mailboxesExpected: number;
  issues: string[];
  refreshing?: boolean;
}

export interface LandlordMeetingDigest {
  meetings: LandlordMeeting[];
  nextMeeting: LandlordMeeting | null;
  week: { start: string; end: string; timeZone: "Europe/London" };
  coverage: LandlordMeetingCoverage;
}
