import type { ElementType } from "react";

export interface CrmStats {
  properties: number;
  deals: number;
  companies: number;
  contacts: number;
  leads: number;
  comps: number;
  requirementsLeasing: number;
  requirementsInvestment: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  url: string;
  sourceName: string | null;
  summary: string | null;
  aiSummary: string | null;
  aiRelevanceScores: Record<string, number> | null;
  publishedAt: string | null;
  category: string | null;
  imageUrl: string | null;
}

export interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  organizer?: { emailAddress: { name: string; address: string } };
  isOnlineMeeting?: boolean;
  attendees?: Array<{ emailAddress: { name: string; address: string } }>;
}

export interface TeamIntelligence {
  summary: string;
  connections: { members: string[]; commonSubjects: string[] }[];
  schedules: { name: string; team: string; email: string; meetingCount: number; items: any[] }[];
  stats: {
    totalMembers: number;
    totalMeetings: number;
    busiestMember: { name: string; count: number } | null;
    crossTeamConnections: number;
  };
  period: string;
}

export interface DashboardIntelligence {
  activeContacts: { contactId: string; name: string; count: number; lastDate: string; lastType: string; bgpAllocation: string | string[] }[];
  recentRequirements: { id: string; name: string; createdAt: string; type: string }[];
  activityAlerts: { bgpUser: string; contactId: string; contactName: string; type: string; subject: string | null; date: string }[];
}

export interface LeadProfile {
  id: string;
  userId: string;
  focusAreas: string[] | null;
  assetClasses: string[] | null;
  dealTypes: string[] | null;
  customPrompt: string | null;
  setupComplete: boolean;
}

export interface Lead {
  id: string;
  title: string;
  summary: string;
  sourceType: string;
  sourceContext: string | null;
  area: string | null;
  assetClass: string | null;
  opportunityType: string | null;
  confidence: number;
  status: string;
  suggestedAction: string | null;
  aiReasoning: string | null;
  createdAt: string;
}

export interface WidgetDefinition {
  id: string;
  name: string;
  description: string;
  icon: ElementType;
  category: "overview" | "crm" | "microsoft" | "ai";
}

export interface BoardDefinition {
  id: string;
  name: string;
  description: string;
  icon: any;
  widgetIds: string[];
}
