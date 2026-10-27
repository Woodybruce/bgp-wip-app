export const LANDLORD_TEAM_ROLES = ["Relationship lead", "Tenant representative", "Leasing agent", "Lease advisory", "Investment", "Development", "Support"] as const;
export type LandlordTeamRole = typeof LANDLORD_TEAM_ROLES[number];
export interface LandlordTeamSource { kind: "deal" | "lease_advisory" | "property"; id: string; label: string; url: string; }
export interface LandlordTeamContext {
  id: string; role: string; propertyId: string | null; propertyName: string | null;
  origin: "manual" | "suggested"; notes: string; sources: LandlordTeamSource[];
}
export interface LandlordTeamMember {
  id: string; name: string; title: string | null; profilePicUrl: string | null; active: boolean;
  assigned: boolean; assignedRole: string | null; emailCount: number; meetingCount: number; dealCount: number; conversationCount: number;
  lastInteractionAt: string | null; contexts: LandlordTeamContext[];
}
export interface LandlordRelationshipTeamData {
  companyId: string; members: LandlordTeamMember[]; properties: Array<{ id: string; name: string }>;
  issues: string[]; checkedAt: string; diaryStatus: string;
}
