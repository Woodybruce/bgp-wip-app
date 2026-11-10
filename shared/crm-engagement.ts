// Staff CRM planning. Events reuse Marketing; follow-ups reuse My Tasks.
export type StrategyStatus = "active" | "paused" | "completed";
export type EventStatus = "draft" | "planned" | "cancelled" | "completed";
export type GuestStatus = "suggested" | "invited" | "accepted" | "declined" | "attended" | "no_show";
export type ActionStatus = "todo" | "in_progress" | "done";
export interface EngagementCompanyLink { companyId: string; companyName: string; reason: string }
export interface StrategyTarget extends EngagementCompanyLink { contactIds: string[] }
export interface EngagementStrategy {
  id: string; name: string; objective: string; team: string | null;
  ownerId: string | null; ownerName: string | null; status: StrategyStatus;
  startsOn: string | null; endsOn: string | null; updatedAt: string;
  targets: StrategyTarget[];
}
export interface EngagementGuest {
  contactId: string; name: string; companyId: string | null; companyName: string | null; status: GuestStatus;
}
export interface EngagementEvent {
  id: string; title: string; kind: string | null; startsAt: string | null; endsAt: string | null;
  location: string | null; description: string | null; ownerId: string | null; ownerName: string | null;
  status: EventStatus; sourceUrl: string | null; dateConfirmed: boolean; outcome: string | null;
  updatedAt: string; strategyIds: string[]; companies: EngagementCompanyLink[]; guests: EngagementGuest[];
}
export interface EngagementAction {
  id: string; title: string; notes: string | null; dueAt: string | null; status: ActionStatus;
  canEdit?: boolean;
  ownerId: string; ownerName: string | null; companyId: string; companyName: string;
  strategyId: string | null; eventId: string | null;
  source?: {
    kind: "crm_interview"; interviewId: string; questionId: string; label: string; url: string;
  } | null;
}
export interface EngagementData { events: EngagementEvent[]; strategies: EngagementStrategy[]; actions: EngagementAction[] }
export interface EngagementOptions {
  staff: Array<{id: string; name: string}>;
  companies: Array<{id: string; name: string}>;
  contacts: Array<{id: string; name: string; companyId: string; role: string | null}>;
}
export type StrategyInput = Omit<EngagementStrategy, "id" | "ownerName" | "updatedAt" | "targets"> & {
  targets: Array<Omit<StrategyTarget, "companyName">>; expectedUpdatedAt?: string;
};
export type EventInput = Omit<EngagementEvent, "id" | "ownerName" | "updatedAt" | "companies" | "guests"> & {
  companies: Array<Omit<EngagementCompanyLink, "companyName">>;
  guests: Array<{contactId: string; status: GuestStatus}>; expectedUpdatedAt?: string;
};
export type ActionInput = Omit<EngagementAction, "id" | "ownerName" | "companyName" | "canEdit" | "source"> & {
  sourceInterviewId?: string | null; sourceQuestionId?: string | null;
};
