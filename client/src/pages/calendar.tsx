import { useQuery, useMutation } from "@tanstack/react-query";
import { CRM_OPTIONS } from "@/lib/crm-options";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest, getQueryFn, getAuthHeaders } from "@/lib/queryClient";
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Users,
  Video,
  Cloud,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
  Eye,
  Phone,
  Briefcase,
  Scale,
  Megaphone,
  ClipboardCheck,
  Building2,
  Lock,
  Home,
  Handshake,
  UserCheck,
  Brain,
  Flame,
  TrendingUp,
  AlertTriangle,
  BarChart3,
  Sparkles,
  Target,
  MessageSquare,
  FileText,
  Shield,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { Link } from "wouter";

interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  organizer?: { emailAddress: { name: string; address: string } };
  isOnlineMeeting?: boolean;
  onlineMeetingUrl?: string;
  onlineMeeting?: { joinUrl: string };
  attendees?: Array<{
    emailAddress: { name: string; address: string };
    type?: string;
    status: { response: string };
  }>;
  bodyPreview?: string;
  isAllDay?: boolean;
  showAs?: string;
  categories?: string[];
  _source?: "outlook" | "crm";
  _eventType?: string;
  _propertyName?: string;
  _companyName?: string;
  _attendeeNames?: string[];
}

interface TeamEvent {
  id: string;
  title: string;
  event_type: string;
  start_time: string;
  end_time: string;
  property_id?: string;
  property_name?: string;
  deal_id?: string;
  company_name?: string;
  location?: string;
  attendees?: string[];
  notes?: string;
  created_by?: string;
}

interface ScheduleItem {
  status: string;
  subject: string;
  location: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isPrivate: boolean;
}

interface TeamMemberSchedule {
  email: string;
  name: string;
  team: string;
  availabilityView: string;
  scheduleItems: ScheduleItem[];
}

interface DaySummary {
  summary: string;
  events: CalendarEvent[];
  totalMeetings: number;
  internalMeetings: number;
  externalMeetings: number;
}

interface CrmProperty { id: string; name: string; address?: string; }
interface CrmDeal { id: string; property_name?: string; company_name?: string; status?: string; }
interface CrmContact { id: string; name: string; email?: string; company_name?: string; }
interface CrmCompany { id: string; name: string; }

interface CrmLinks {
  properties: { id: string; name: string }[];
  deals: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  companies: { id: string; name: string }[];
}

function teamEventToCalendarEvent(te: TeamEvent): CalendarEvent {
  return {
    id: `crm-${te.id}`,
    subject: te.title,
    start: { dateTime: te.start_time, timeZone: "Europe/London" },
    end: { dateTime: te.end_time, timeZone: "Europe/London" },
    location: te.location ? { displayName: te.location } : undefined,
    bodyPreview: te.notes || undefined,
    isAllDay: false,
    _source: "crm",
    _eventType: te.event_type,
    _propertyName: te.property_name || undefined,
    _companyName: te.company_name || undefined,
    _attendeeNames: te.attendees || [],
    attendees: (te.attendees || []).map(name => ({
      emailAddress: { name, address: "" },
      status: { response: "accepted" },
    })),
  };
}

type ViewMode = "day" | "workWeek" | "week";

const HOUR_HEIGHT = 56;
const START_HOUR = 6;
const END_HOUR = 22;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const TEAMS = ["All", ...CRM_OPTIONS.dealTeam];
const INTERNAL_BGP_TEAMS = new Set(CRM_OPTIONS.dealTeam.filter((t: string) => t !== "Landsec"));

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatTimeRange(start: string, end: string) {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function getEventDurationMinutes(start: string, end: string) {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60000;
}

function isSameDay(d1: Date, d2: Date) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getMonday(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function normalizeDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function classifyOutlookEvent(subject: string, categories?: string[]): string {
  const s = (subject || "").toLowerCase();
  const cats = (categories || []).map(c => c.toLowerCase());
  if (cats.some(c => c.includes("viewing")) || /\bview(ing)?\b/.test(s)) return "viewing";
  if (cats.some(c => c.includes("inspection")) || /\binspect(ion)?\b/.test(s)) return "inspection";
  if (cats.some(c => c.includes("call")) || /\bcall\b|\bphone\b|\bdial.in\b/.test(s)) return "call";
  if (cats.some(c => c.includes("legal")) || /\blegal\b|\bsolicitor\b|\bcompletion\b/.test(s)) return "legal";
  if (cats.some(c => c.includes("marketing")) || /\bmarketing\b|\blaunch\b|\bphoto\b/.test(s)) return "marketing";
  if (cats.some(c => c.includes("deadline")) || /\bdeadline\b|\bdue\b|\bexpir/.test(s)) return "deadline";
  if (/\bleave\b|\bannual leave\b|\bholiday\b|\bvacation\b|\boff\b|\bbreak\b|\bschool\b|\bski(ing)?\b|\btrip\b|\bbirthday\b|\bdentist\b|\bdoctor\b|\bgp\b|\bhairdresser\b|\bgym\b|\bpersonal\b|\bday off\b|\bwfh\b|\bwork(ing)?\s*from\s*home\b|\bremote\b|\bout of office\b|\booo\b|\bsick\b|\billness\b|\bfuneral\b|\bwedding\b|\bbank holiday\b|\bhalf.?term\b|\bhalf.?day\b|\beaster\b|\bchristmas\b|\bnew year\b|\blunch\b|\bpick.?up\b|\bdrop.?off\b|\bchildcare\b/.test(s)) return "personal";
  return "meeting";
}

function formatHeaderDate(date: Date) {
  const today = new Date();
  const tomorrow = addDays(today, 1);
  let prefix = "";
  if (isSameDay(date, today)) prefix = "Today, ";
  else if (isSameDay(date, tomorrow)) prefix = "Tomorrow, ";
  return prefix + date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function getViewDates(selectedDate: Date, mode: ViewMode): Date[] {
  if (mode === "day") return [selectedDate];
  const monday = getMonday(selectedDate);
  const count = mode === "workWeek" ? 5 : 7;
  return Array.from({ length: count }, (_, i) => addDays(monday, i));
}

function navigateView(selectedDate: Date, mode: ViewMode, direction: number): Date {
  if (mode === "day") return addDays(selectedDate, direction);
  return addDays(selectedDate, direction * 7);
}

const EVENT_COLORS = [
  { bg: "bg-blue-500/15 dark:bg-blue-500/25", border: "border-l-blue-500", text: "text-blue-800 dark:text-blue-200", dot: "bg-blue-500" },
  { bg: "bg-emerald-500/15 dark:bg-emerald-500/25", border: "border-l-emerald-500", text: "text-emerald-800 dark:text-emerald-200", dot: "bg-emerald-500" },
  { bg: "bg-violet-500/15 dark:bg-violet-500/25", border: "border-l-violet-500", text: "text-violet-800 dark:text-violet-200", dot: "bg-violet-500" },
  { bg: "bg-amber-500/15 dark:bg-amber-500/25", border: "border-l-amber-500", text: "text-amber-800 dark:text-amber-200", dot: "bg-amber-500" },
  { bg: "bg-rose-500/15 dark:bg-rose-500/25", border: "border-l-rose-500", text: "text-rose-800 dark:text-rose-200", dot: "bg-rose-500" },
  { bg: "bg-cyan-500/15 dark:bg-cyan-500/25", border: "border-l-cyan-500", text: "text-cyan-800 dark:text-cyan-200", dot: "bg-cyan-500" },
  { bg: "bg-orange-500/15 dark:bg-orange-500/25", border: "border-l-orange-500", text: "text-orange-800 dark:text-orange-200", dot: "bg-orange-500" },
];

const CRM_EVENT_COLORS: Record<string, typeof EVENT_COLORS[0]> = {
  viewing: { bg: "bg-emerald-500/15 dark:bg-emerald-500/25", border: "border-l-emerald-500", text: "text-emerald-800 dark:text-emerald-200", dot: "bg-emerald-500" },
  meeting: { bg: "bg-blue-500/15 dark:bg-blue-500/25", border: "border-l-blue-500", text: "text-blue-800 dark:text-blue-200", dot: "bg-blue-500" },
  call: { bg: "bg-violet-500/15 dark:bg-violet-500/25", border: "border-l-violet-500", text: "text-violet-800 dark:text-violet-200", dot: "bg-violet-500" },
  deadline: { bg: "bg-rose-500/15 dark:bg-rose-500/25", border: "border-l-rose-500", text: "text-rose-800 dark:text-rose-200", dot: "bg-rose-500" },
  inspection: { bg: "bg-amber-500/15 dark:bg-amber-500/25", border: "border-l-amber-500", text: "text-amber-800 dark:text-amber-200", dot: "bg-amber-500" },
  marketing: { bg: "bg-cyan-500/15 dark:bg-cyan-500/25", border: "border-l-cyan-500", text: "text-cyan-800 dark:text-cyan-200", dot: "bg-cyan-500" },
  legal: { bg: "bg-orange-500/15 dark:bg-orange-500/25", border: "border-l-orange-500", text: "text-orange-800 dark:text-orange-200", dot: "bg-orange-500" },
  personal: { bg: "bg-gray-500/15 dark:bg-gray-500/25", border: "border-l-gray-400", text: "text-gray-600 dark:text-gray-300", dot: "bg-gray-400" },
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  viewing: "Viewings", meeting: "Meetings", call: "Calls", deadline: "Deadlines",
  inspection: "Inspections", marketing: "Marketing", legal: "Legal", personal: "Personal / Leave",
};

function getEventTypeIcon(eventType?: string) {
  switch (eventType) {
    case "viewing": return Eye;
    case "call": return Phone;
    case "meeting": return Briefcase;
    case "legal": return Scale;
    case "marketing": return Megaphone;
    case "inspection": return ClipboardCheck;
    case "deadline": return CalendarIcon;
    case "personal": return UserCheck;
    default: return Building2;
  }
}

function getEventColor(subject: string, source?: string, eventType?: string) {
  if (source === "crm" && eventType && CRM_EVENT_COLORS[eventType]) return CRM_EVENT_COLORS[eventType];
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = subject.charCodeAt(i) + ((hash << 5) - hash);
  return EVENT_COLORS[Math.abs(hash) % EVENT_COLORS.length];
}

const TEAM_MEMBER_COLORS = [
  { bg: "bg-violet-400/20 dark:bg-violet-500/25", border: "border-l-violet-400", text: "text-violet-700 dark:text-violet-300" },
  { bg: "bg-teal-400/20 dark:bg-teal-500/25", border: "border-l-teal-400", text: "text-teal-700 dark:text-teal-300" },
  { bg: "bg-rose-400/20 dark:bg-rose-500/25", border: "border-l-rose-400", text: "text-rose-700 dark:text-rose-300" },
  { bg: "bg-amber-400/20 dark:bg-amber-500/25", border: "border-l-amber-400", text: "text-amber-700 dark:text-amber-300" },
  { bg: "bg-sky-400/20 dark:bg-sky-500/25", border: "border-l-sky-400", text: "text-sky-700 dark:text-sky-300" },
  { bg: "bg-lime-400/20 dark:bg-lime-500/25", border: "border-l-lime-400", text: "text-lime-700 dark:text-lime-300" },
  { bg: "bg-fuchsia-400/20 dark:bg-fuchsia-500/25", border: "border-l-fuchsia-400", text: "text-fuchsia-700 dark:text-fuchsia-300" },
  { bg: "bg-orange-400/20 dark:bg-orange-500/25", border: "border-l-orange-400", text: "text-orange-700 dark:text-orange-300" },
  { bg: "bg-cyan-400/20 dark:bg-cyan-500/25", border: "border-l-cyan-400", text: "text-cyan-700 dark:text-cyan-300" },
  { bg: "bg-indigo-400/20 dark:bg-indigo-500/25", border: "border-l-indigo-400", text: "text-indigo-700 dark:text-indigo-300" },
];

function findCrmLinks(
  event: CalendarEvent, properties: CrmProperty[], deals: CrmDeal[], contacts: CrmContact[], companies: CrmCompany[]
): CrmLinks {
  const links: CrmLinks = { properties: [], deals: [], contacts: [], companies: [] };
  const subject = (event.subject || "").toLowerCase();
  const attendeeEmails = (event.attendees || []).map(a => a.emailAddress?.address?.toLowerCase()).filter(Boolean);
  const externalEmails = attendeeEmails.filter(e => !e.includes("brucegillinghampollard"));
  for (const p of properties) {
    const pName = (p.name || "").toLowerCase();
    const pAddr = (p.address || "").toLowerCase();
    if (pName.length > 3 && subject.includes(pName)) {
      links.properties.push({ id: p.id, name: p.name });
    } else if (pAddr.length > 5) {
      const streetParts = pAddr.split(",")[0]?.trim();
      if (streetParts && streetParts.length > 4 && subject.includes(streetParts)) {
        links.properties.push({ id: p.id, name: p.name });
      }
    }
  }
  for (const c of contacts) {
    const cEmail = (c.email || "").toLowerCase();
    if (cEmail && externalEmails.includes(cEmail)) {
      links.contacts.push({ id: c.id, name: c.name });
      if (c.company_name) {
        const co = companies.find(co => co.name.toLowerCase() === c.company_name!.toLowerCase());
        if (co && !links.companies.find(x => x.id === co.id)) links.companies.push({ id: co.id, name: co.name });
      }
    }
  }
  for (const d of deals) {
    const dProp = (d.property_name || "").toLowerCase();
    const dComp = (d.company_name || "").toLowerCase();
    if (dProp.length > 3 && subject.includes(dProp)) {
      links.deals.push({ id: d.id, name: d.property_name || "Deal" });
    } else if (dComp.length > 3 && links.companies.some(c => c.name.toLowerCase() === dComp)) {
      links.deals.push({ id: d.id, name: `${d.property_name || ""} — ${d.company_name || ""}`.trim() });
    }
  }
  return links;
}

function CrmLinkBadges({ links }: { links: CrmLinks }) {
  const hasLinks = links.properties.length + links.deals.length + links.contacts.length + links.companies.length > 0;
  if (!hasLinks) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5" data-testid="crm-links">
      {links.properties.map(p => (
        <Link key={p.id} href={`/properties/${p.id}`}>
          <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-muted border-blue-300 dark:border-blue-700">
            <Home className="w-2.5 h-2.5 text-blue-500" />{p.name}
          </Badge>
        </Link>
      ))}
      {links.deals.map(d => (
        <Link key={d.id} href={`/deals/${d.id}`}>
          <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-muted border-green-300 dark:border-green-700">
            <Handshake className="w-2.5 h-2.5 text-green-500" />{d.name}
          </Badge>
        </Link>
      ))}
      {links.contacts.map(c => (
        <Link key={c.id} href={`/contacts/${c.id}`}>
          <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-muted border-violet-300 dark:border-violet-700">
            <UserCheck className="w-2.5 h-2.5 text-violet-500" />{c.name}
          </Badge>
        </Link>
      ))}
      {links.companies.map(co => (
        <Link key={co.id} href={`/companies/${co.id}`}>
          <Badge variant="outline" className="text-[9px] gap-0.5 cursor-pointer hover:bg-muted border-amber-300 dark:border-amber-700">
            <Building2 className="w-2.5 h-2.5 text-amber-500" />{co.name}
          </Badge>
        </Link>
      ))}
    </div>
  );
}

function ConnectPrompt() {
  const [connecting, setConnecting] = useState(false);
  const handleConnect = async () => {
    setConnecting(true);
    const authWindow = window.open("about:blank", "_blank");
    try {
      const res = await apiRequest("GET", "/api/microsoft/auth");
      const data = await res.json();
      if (authWindow) { authWindow.location.href = data.authUrl; } else { window.location.href = data.authUrl; }
    } catch {
      if (authWindow) authWindow.close();
      setConnecting(false);
    }
  };
  return (
    <div className="h-full flex items-center justify-center" data-testid="calendar-connect-prompt">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-20 h-20 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto">
          <CalendarIcon className="w-10 h-10 text-blue-500" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Outlook Calendar</h2>
          <p className="text-sm text-muted-foreground mt-2">Connect your Microsoft 365 account to view your meetings, team schedules, and get AI summaries.</p>
        </div>
        <Button size="lg" onClick={handleConnect} disabled={connecting} className="w-full" data-testid="button-connect-calendar">
          {connecting ? "Sign-in tab opened..." : "Connect Microsoft 365"}
        </Button>
        {connecting && <p className="text-xs text-muted-foreground">Complete sign-in in the new tab, then refresh this page.</p>}
      </div>
    </div>
  );
}

function DaySummaryBar() {
  const { data, isLoading } = useQuery<DaySummary>({
    queryKey: ["/api/microsoft/calendar/summary"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });
  if (isLoading || !data) return null;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b bg-muted/30 text-xs" data-testid="day-summary-bar">
      <Brain className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="text-muted-foreground truncate flex-1">{data.summary}</span>
      <Badge variant="secondary" className="text-[10px] shrink-0">{data.totalMeetings} meetings</Badge>
    </div>
  );
}

function computeEventLayout(dayEvents: CalendarEvent[]) {
  const timedEvents = dayEvents.filter(e => !e.isAllDay && getEventDurationMinutes(e.start.dateTime, e.end.dateTime) < 24 * 60);
  const layout: { event: CalendarEvent; col: number; totalCols: number }[] = [];
  const columns: { end: number }[] = [];
  timedEvents.forEach(event => {
    const startMin = new Date(event.start.dateTime).getHours() * 60 + new Date(event.start.dateTime).getMinutes();
    const endMin = new Date(event.end.dateTime).getHours() * 60 + new Date(event.end.dateTime).getMinutes();
    let placed = false;
    for (let c = 0; c < columns.length; c++) {
      if (startMin >= columns[c].end) { columns[c].end = endMin; layout.push({ event, col: c, totalCols: 0 }); placed = true; break; }
    }
    if (!placed) { columns.push({ end: endMin }); layout.push({ event, col: columns.length - 1, totalCols: 0 }); }
  });
  layout.forEach(item => { item.totalCols = columns.length; });
  return layout;
}

interface DayColumnProps {
  date: Date;
  events: CalendarEvent[];
  hours: number[];
  today: Date;
  nowTop: number;
  onSelectEvent: (e: CalendarEvent) => void;
  selectedEventId?: string;
  isMultiDay: boolean;
  label?: string;
  isTeamMember?: boolean;
  teamColor?: typeof TEAM_MEMBER_COLORS[0];
}

function DayColumn({ date, events, hours, today, nowTop, onSelectEvent, selectedEventId, isMultiDay, label, isTeamMember, teamColor }: DayColumnProps) {
  const isColumnToday = isSameDay(date, today);
  const eventLayout = computeEventLayout(events);

  return (
    <div className={`flex-1 relative border-l ${isColumnToday && !isTeamMember ? "bg-blue-500/[0.03]" : ""} min-w-0`}>
      {hours.map(hour => (
        <div key={hour} className="absolute w-full border-t border-border/40" style={{ top: `${(hour - START_HOUR) * HOUR_HEIGHT}px`, height: `${HOUR_HEIGHT}px` }}>
          <div className="absolute w-full border-t border-border/20 border-dashed" style={{ top: `${HOUR_HEIGHT / 2}px` }} />
        </div>
      ))}
      {isColumnToday && nowTop >= 0 && nowTop <= TOTAL_HOURS * HOUR_HEIGHT && (
        <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: `${nowTop}px` }}>
          {!isTeamMember && <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />}
          <div className="flex-1 h-[2px] bg-red-500" />
        </div>
      )}
      {eventLayout.map(({ event, col, totalCols }) => {
        const startDate = new Date(event.start.dateTime);
        const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
        const duration = getEventDurationMinutes(event.start.dateTime, event.end.dateTime);
        const top = ((startMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;
        const height = Math.max(22, (duration / 60) * HOUR_HEIGHT - 1);
        const isSelected = selectedEventId === event.id;
        const colWidth = totalCols > 1 ? (100 / totalCols) : 100;
        const colLeft = col * colWidth;

        if (isTeamMember && teamColor) {
          return (
            <div
              key={event.id}
              className={`absolute rounded-[3px] border-l-[3px] ${teamColor.border} ${teamColor.bg} px-1 py-0.5 text-left overflow-hidden`}
              style={{ top: `${top}px`, height: `${height}px`, left: `${colLeft}%`, width: `calc(${colWidth}% - 3px)`, marginLeft: "1px" }}
              title={event.subject || "Busy"}
              data-testid={`team-event-block-${event.id}`}
            >
              <p className={`text-[10px] font-medium truncate leading-tight ${teamColor.text}`}>
                {event.subject || "Busy"}
              </p>
              {height > 28 && (
                <p className="text-[9px] text-muted-foreground truncate leading-tight">{formatTime(event.start.dateTime)}</p>
              )}
            </div>
          );
        }

        const color = getEventColor(event.subject, event._source, event._eventType);
        const TypeIcon = event._source === "crm" ? getEventTypeIcon(event._eventType) : null;
        return (
          <button
            key={event.id}
            className={`absolute rounded-[4px] border-l-[3px] ${color.border} ${color.bg} px-1.5 py-0.5 text-left transition-all hover:shadow-md cursor-pointer overflow-hidden ${isSelected ? "ring-2 ring-blue-500 shadow-md" : ""}`}
            style={{ top: `${top}px`, height: `${height}px`, left: `${colLeft}%`, width: `calc(${colWidth}% - 4px)`, marginLeft: "2px" }}
            onClick={() => onSelectEvent(event)}
            data-testid={`event-block-${event.id}`}
          >
            <div className="flex items-center gap-1">
              {TypeIcon && <TypeIcon className={`w-3 h-3 shrink-0 ${color.text}`} />}
              <p className={`text-[11px] font-semibold truncate leading-tight ${color.text}`}>{event.subject}</p>
            </div>
            {height > 30 && (
              <p className="text-[10px] text-muted-foreground truncate leading-tight">
                {formatTime(event.start.dateTime)}
                {event._propertyName && ` · ${event._propertyName}`}
                {!event._propertyName && !isMultiDay && event.location?.displayName && ` · ${event.location.displayName}`}
              </p>
            )}
            {height > 50 && event._companyName && <p className="text-[9px] text-muted-foreground truncate mt-0.5">{event._companyName}</p>}
            {height > 50 && event.isOnlineMeeting && !isMultiDay && !event._source && (
              <div className="flex items-center gap-1 mt-0.5">
                <Video className="w-2.5 h-2.5 text-muted-foreground" />
                <span className="text-[9px] text-muted-foreground">Teams</span>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface TeamColumnInfo {
  name: string;
  email: string;
  colorIdx: number;
  events: CalendarEvent[];
}

function TimeGrid({
  events, dates, viewMode, onSelectEvent, selectedEventId, teamMembers, showTeam,
}: {
  events: CalendarEvent[];
  dates: Date[];
  viewMode: ViewMode;
  onSelectEvent: (e: CalendarEvent) => void;
  selectedEventId?: string;
  teamMembers: TeamMemberSchedule[];
  showTeam: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => i + START_HOUR);
  const isMultiDay = dates.length > 1;
  const isDayView = viewMode === "day";
  const today = new Date();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    dates.forEach(d => {
      const key = d.toDateString();
      map.set(key, events.filter(e => isSameDay(new Date(e.start.dateTime), d)).sort((a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()));
    });
    return map;
  }, [events, dates]);

  const allDayEvents = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    dates.forEach(d => {
      const key = d.toDateString();
      const dayEvts = eventsByDay.get(key) || [];
      map.set(key, dayEvts.filter(e => e.isAllDay || getEventDurationMinutes(e.start.dateTime, e.end.dateTime) >= 24 * 60));
    });
    return map;
  }, [eventsByDay, dates]);

  const hasAllDay = useMemo(() => Array.from(allDayEvents.values()).some(evts => evts.length > 0), [allDayEvents]);

  const teamColumnsByDay = useMemo(() => {
    if (!showTeam || teamMembers.length === 0) return new Map<string, TeamColumnInfo[]>();
    const map = new Map<string, TeamColumnInfo[]>();
    dates.forEach(d => {
      const key = d.toDateString();
      const normalDate = normalizeDay(d);
      const cols: TeamColumnInfo[] = teamMembers.map((member, idx) => {
        const dayItems = member.scheduleItems.filter(item => {
          const s = new Date(item.start.dateTime);
          const e = new Date(item.end.dateTime);
          return s.toDateString() === normalDate.toDateString() || (s < normalDate && e > normalDate);
        });
        const memberEvents: CalendarEvent[] = dayItems.map((item, i) => ({
          id: `team-${member.email}-${i}`,
          subject: item.isPrivate ? "Private" : item.subject,
          start: item.start,
          end: item.end,
          isAllDay: false,
          showAs: item.status,
          location: item.location ? { displayName: item.location } : undefined,
        }));
        return {
          name: member.name,
          email: member.email,
          colorIdx: idx % TEAM_MEMBER_COLORS.length,
          events: memberEvents,
        };
      });
      map.set(key, cols);
    });
    return map;
  }, [showTeam, teamMembers, dates]);

  useEffect(() => {
    if (scrollRef.current) {
      const now = new Date();
      const isVisibleToday = dates.some(d => isSameDay(d, now));
      if (isVisibleToday) {
        scrollRef.current.scrollTop = Math.max(0, (now.getHours() - START_HOUR - 1) * HOUR_HEIGHT);
      } else {
        let firstEventHour = 9;
        for (const evts of Array.from(eventsByDay.values())) {
          if (evts.length > 0) { firstEventHour = new Date(evts[0].start.dateTime).getHours(); break; }
        }
        scrollRef.current.scrollTop = Math.max(0, (firstEventHour - START_HOUR - 1) * HOUR_HEIGHT);
      }
    }
  }, [dates, eventsByDay]);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const nowTop = ((nowMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT;

  const showTeamColumns = showTeam && isDayView && teamMembers.length > 0;
  const showTeamOverlay = showTeam && !isDayView && teamMembers.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex border-b shrink-0">
        <div className="w-[52px] shrink-0" />
        {dates.map(date => {
          const isToday = isSameDay(date, today);
          const teamCols = teamColumnsByDay.get(date.toDateString()) || [];
          const totalCols = showTeamColumns ? 1 + teamCols.length : 1;
          return (
            <div key={date.toDateString()} className="flex-1 border-l min-w-0">
              {!showTeamColumns ? (
                <div className={`text-center py-2 ${isToday ? "bg-blue-500/5" : ""}`}>
                  <p className={`text-[10px] uppercase tracking-wider ${isToday ? "text-blue-600 dark:text-blue-400 font-bold" : "text-muted-foreground font-medium"}`}>
                    {date.toLocaleDateString("en-GB", { weekday: "short" })}
                  </p>
                  <p className={`text-lg leading-tight ${isToday ? "text-blue-600 dark:text-blue-400 font-bold" : "font-semibold"}`}>{date.getDate()}</p>
                </div>
              ) : (
                <div className="flex">
                  <div className={`flex-1 text-center py-1.5 border-r border-border/30 ${isToday ? "bg-blue-500/5" : ""}`}>
                    <p className={`text-[10px] uppercase tracking-wider font-bold ${isToday ? "text-blue-600 dark:text-blue-400" : ""}`}>
                      {date.toLocaleDateString("en-GB", { weekday: "short" })} {date.getDate()}
                    </p>
                    <p className="text-[9px] text-muted-foreground font-semibold">You</p>
                  </div>
                  {teamCols.map((tc, idx) => (
                    <div key={tc.email} className="flex-1 text-center py-1.5 border-r border-border/30 last:border-r-0 min-w-0">
                      <div className="flex items-center justify-center gap-1">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${TEAM_MEMBER_COLORS[tc.colorIdx].border.replace("border-l-", "bg-")}`} />
                        <p className="text-[9px] font-semibold truncate">{tc.name.split(" ")[0]}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="flex border-b shrink-0">
          <div className="w-[52px] shrink-0 flex items-center justify-end pr-2"><span className="text-[10px] text-muted-foreground">All day</span></div>
          {dates.map(date => {
            const dayAllDay = allDayEvents.get(date.toDateString()) || [];
            return (
              <div key={date.toDateString()} className="flex-1 border-l px-0.5 py-1 space-y-0.5 min-h-[28px]">
                {dayAllDay.map(event => {
                  const color = getEventColor(event.subject, event._source, event._eventType);
                  return (
                    <button key={event.id} className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] truncate ${color.bg} ${color.text} font-medium hover:opacity-80 transition-opacity`} onClick={() => onSelectEvent(event)} data-testid={`allday-${event.id}`}>
                      {event.subject}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="flex relative" style={{ height: `${TOTAL_HOURS * HOUR_HEIGHT}px` }}>
          <div className="w-[52px] shrink-0 relative">
            {hours.map(hour => (
              <div key={hour} className="absolute w-full pr-2 text-right" style={{ top: `${(hour - START_HOUR) * HOUR_HEIGHT}px` }}>
                <span className="text-[10px] text-muted-foreground font-medium -mt-[7px] block">{hour.toString().padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>

          {dates.map((date) => {
            const key = date.toDateString();
            const dayEvents = (eventsByDay.get(key) || []).filter(e => !e.isAllDay && getEventDurationMinutes(e.start.dateTime, e.end.dateTime) < 24 * 60);
            const teamCols = teamColumnsByDay.get(key) || [];

            if (showTeamColumns) {
              return (
                <div key={key} className="flex-1 flex border-l min-w-0">
                  <div className="flex-1 relative border-r border-border/30 min-w-0">
                    <DayColumn date={date} events={dayEvents} hours={hours} today={today} nowTop={nowTop} onSelectEvent={onSelectEvent} selectedEventId={selectedEventId} isMultiDay={false} />
                  </div>
                  {teamCols.map((tc) => (
                    <div key={tc.email} className="flex-1 relative border-r border-border/30 last:border-r-0 min-w-0">
                      <DayColumn date={date} events={tc.events} hours={hours} today={today} nowTop={nowTop} onSelectEvent={() => {}} isMultiDay={false} isTeamMember teamColor={TEAM_MEMBER_COLORS[tc.colorIdx]} />
                    </div>
                  ))}
                </div>
              );
            }

            return (
              <DayColumn key={key} date={date} events={dayEvents} hours={hours} today={today} nowTop={nowTop} onSelectEvent={onSelectEvent} selectedEventId={selectedEventId} isMultiDay={isMultiDay} />
            );
          })}
        </div>
      </div>

      {showTeamOverlay && (
        <div className="border-t px-3 py-1.5 bg-muted/30 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-semibold">Team:</span>
            {teamMembers.slice(0, 10).map((m, idx) => (
              <span key={m.email} className="flex items-center gap-1 text-[10px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${TEAM_MEMBER_COLORS[idx % TEAM_MEMBER_COLORS.length].border.replace("border-l-", "bg-")}`} />
                <span className="text-muted-foreground">{m.name.split(" ")[0]}</span>
              </span>
            ))}
            <span className="text-[10px] text-muted-foreground italic ml-1">Switch to Day view to see team columns</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface BriefingData {
  summary: string;
  talkingPoints: string[];
  preparation: string[];
  attendeeInsights: { name: string; insight: string }[];
  dealContext: string | null;
  propertyContext: string | null;
  riskFlags: string[];
  followUpSuggestions: string[];
}

interface BriefingResponse {
  crmContext: {
    contacts: any[];
    companies: any[];
    deals: any[];
    properties: any[];
    recentHistory: any[];
  };
  briefing: BriefingData;
}

function EventBriefing({ event }: { event: CalendarEvent }) {
  const [expanded, setExpanded] = useState(false);

  const briefingMutation = useMutation<BriefingResponse>({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/microsoft/calendar/briefing", {
        subject: event.subject,
        attendees: event.attendees,
        propertyName: event._propertyName,
        companyName: event._companyName,
        location: event.location?.displayName,
        startTime: event.start.dateTime,
        endTime: event.end.dateTime,
        bodyPreview: event.bodyPreview,
        eventType: event._eventType,
      });
      return res.json();
    },
  });

  const briefing = briefingMutation.data?.briefing;
  const crmContext = briefingMutation.data?.crmContext;

  useEffect(() => {
    briefingMutation.reset();
  }, [event.id]);

  if (briefingMutation.isPending) {
    return (
      <div className="space-y-3 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />
          <span>Preparing meeting briefing...</span>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </div>
    );
  }

  if (briefingMutation.isError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-rose-500">Failed to generate briefing</p>
        <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => briefingMutation.mutate()} data-testid="button-retry-briefing">
          <Sparkles className="w-3.5 h-3.5" />Retry AI Briefing
        </Button>
      </div>
    );
  }

  if (!briefingMutation.data) {
    return (
      <div className="space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 bg-gradient-to-r from-violet-500/5 to-blue-500/5 border-violet-200 dark:border-violet-800 hover:from-violet-500/10 hover:to-blue-500/10"
          onClick={() => briefingMutation.mutate()}
          data-testid="button-generate-briefing"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <span className="text-violet-700 dark:text-violet-300 font-medium">AI Meeting Prep</span>
        </Button>
      </div>
    );
  }

  if (!briefing) return null;

  return (
    <div className="space-y-3" data-testid="meeting-briefing">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-violet-500" />
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wider">AI Briefing</p>
        </div>
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => briefingMutation.mutate()} data-testid="button-refresh-briefing">
          Refresh
        </Button>
      </div>

      {briefing.summary && (
        <div className="rounded-lg bg-violet-500/5 border border-violet-200 dark:border-violet-800/50 px-3 py-2">
          <p className="text-[12px] leading-relaxed text-foreground/80">{briefing.summary}</p>
        </div>
      )}

      {briefing.talkingPoints.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-3 h-3 text-blue-500" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Talking Points</p>
          </div>
          <div className="space-y-1">
            {briefing.talkingPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                <span className="text-blue-500 font-bold mt-0.5 shrink-0">{i + 1}.</span>
                <span className="text-foreground/80">{point}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {briefing.attendeeInsights.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Users className="w-3 h-3 text-emerald-500" />
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Attendee Intel</p>
          </div>
          <div className="space-y-1">
            {briefing.attendeeInsights.map((ai, i) => (
              <div key={i} className="rounded-md bg-muted/40 px-2.5 py-1.5">
                <p className="text-[11px] font-semibold">{ai.name}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{ai.insight}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {expanded && (
        <>
          {briefing.dealContext && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Handshake className="w-3 h-3 text-green-500" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Deal Context</p>
              </div>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{briefing.dealContext}</p>
            </div>
          )}

          {briefing.propertyContext && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Building2 className="w-3 h-3 text-amber-500" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Property Context</p>
              </div>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{briefing.propertyContext}</p>
            </div>
          )}

          {briefing.preparation.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-sky-500" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Preparation</p>
              </div>
              <div className="space-y-1">
                {briefing.preparation.map((item, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-sky-500 mt-0.5 shrink-0">•</span>
                    <span className="text-foreground/80">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.riskFlags.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-rose-500" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Watch Out</p>
              </div>
              <div className="space-y-1">
                {briefing.riskFlags.map((flag, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <AlertTriangle className="w-3 h-3 text-rose-400 mt-0.5 shrink-0" />
                    <span className="text-foreground/80">{flag}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {briefing.followUpSuggestions.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <ArrowRight className="w-3 h-3 text-violet-500" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Follow-up</p>
              </div>
              <div className="space-y-1">
                {briefing.followUpSuggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="text-violet-500 mt-0.5 shrink-0">→</span>
                    <span className="text-foreground/80">{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {crmContext && crmContext.recentHistory.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-gray-500" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recent History</p>
              </div>
              <div className="space-y-1">
                {crmContext.recentHistory.slice(0, 5).map((h: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="shrink-0 font-medium">{h.date}</span>
                    <span className="capitalize shrink-0">{h.type}</span>
                    <span className="truncate">{h.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {(briefing.dealContext || briefing.propertyContext || briefing.preparation.length > 0 ||
        briefing.riskFlags.length > 0 || briefing.followUpSuggestions.length > 0 ||
        (crmContext && crmContext.recentHistory.length > 0)) && (
        <button
          className="flex items-center gap-1 text-[10px] text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 font-medium"
          onClick={() => setExpanded(!expanded)}
          data-testid="button-toggle-briefing-details"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Show less" : "Show more details"}
        </button>
      )}
    </div>
  );
}

function EventDetailPanel({ event, onClose, crmLinks }: { event: CalendarEvent; onClose: () => void; crmLinks?: CrmLinks }) {
  const color = getEventColor(event.subject, event._source, event._eventType);
  const duration = getEventDurationMinutes(event.start.dateTime, event.end.dateTime);
  const hrs = Math.floor(duration / 60);
  const mins = duration % 60;
  const durationStr = hrs > 0 ? (mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`) : `${mins}m`;
  const joinUrl = event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;

  return (
    <div className="h-full flex flex-col" data-testid={`event-detail-${event.id}`}>
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
        <h3 className="text-sm font-semibold">Event Details</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} data-testid="button-close-event"><X className="w-4 h-4" /></Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full shrink-0 ${color.dot}`} />
            {event._source === "crm" && event._eventType && (
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${color.bg} ${color.text}`}>{event._eventType}</span>
            )}
            {event._source === "crm" && <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">CRM</span>}
          </div>
          <h2 className="text-base font-semibold">{event.subject}</h2>
          {event._propertyName && (
            <div className="flex items-center gap-1.5 mt-1"><Building2 className="w-3.5 h-3.5 text-muted-foreground" /><span className="text-sm text-muted-foreground">{event._propertyName}</span></div>
          )}
          {event._companyName && <p className="text-sm text-muted-foreground mt-0.5">{event._companyName}</p>}
        </div>

        {crmLinks && <CrmLinkBadges links={crmLinks} />}

        <div className="space-y-3">
          <div className="flex items-start gap-3">
            <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <p className="text-sm">{new Date(event.start.dateTime).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</p>
              <p className="text-sm text-muted-foreground">{formatTimeRange(event.start.dateTime, event.end.dateTime)} ({durationStr})</p>
            </div>
          </div>
          {event.location?.displayName && (
            <div className="flex items-start gap-3"><MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" /><p className="text-sm">{event.location.displayName}</p></div>
          )}
          {event.isOnlineMeeting && joinUrl && (
            <div className="flex items-start gap-3">
              <Video className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <a href={joinUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-500 hover:underline" data-testid="link-join-meeting">Join online meeting</a>
            </div>
          )}
          {event.organizer && (
            <div className="flex items-start gap-3">
              <Users className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Organiser</p>
                <p className="text-sm text-muted-foreground">{event.organizer.emailAddress.name || event.organizer.emailAddress.address}</p>
              </div>
            </div>
          )}
        </div>

        {event.attendees && event.attendees.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Attendees ({event.attendees.length})</p>
            <div className="space-y-1.5">
              {event.attendees.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-medium">{(a.emailAddress.name || "?")[0].toUpperCase()}</span>
                  </div>
                  <span className="truncate flex-1">{a.emailAddress.name || a.emailAddress.address}</span>
                  {a.status.response === "accepted" && <span className="text-[10px] text-emerald-500 shrink-0">Accepted</span>}
                  {a.status.response === "tentativelyAccepted" && <span className="text-[10px] text-amber-500 shrink-0">Tentative</span>}
                  {a.status.response === "declined" && <span className="text-[10px] text-rose-500 shrink-0">Declined</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {event.bodyPreview && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</p>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{event.bodyPreview}</p>
          </div>
        )}

        {event._eventType !== "personal" && (
          <div className="border-t pt-3">
            <EventBriefing event={event} />
          </div>
        )}

        {event._source !== "crm" && (
          <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => window.open("https://outlook.office365.com/calendar", "_blank")} data-testid="button-open-outlook-calendar">
            <ExternalLink className="w-3.5 h-3.5" />Open in Outlook
          </Button>
        )}
      </div>
    </div>
  );
}

function MiniCalendar({ selectedDate, onSelectDate, events }: { selectedDate: Date; onSelectDate: (d: Date) => void; events: CalendarEvent[] }) {
  const [viewMonth, setViewMonth] = useState(new Date(selectedDate));
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const eventDates = useMemo(() => {
    const set = new Set<string>();
    events.forEach(e => { const d = new Date(e.start.dateTime); set.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`); });
    return set;
  }, [events]);
  const firstDay = new Date(year, month, 1).getDay();
  const adjustedFirst = firstDay === 0 ? 6 : firstDay - 1;

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewMonth(new Date(year, month - 1, 1))} data-testid="button-prev-month"><ChevronLeft className="w-3.5 h-3.5" /></Button>
        <span className="text-xs font-semibold">{viewMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setViewMonth(new Date(year, month + 1, 1))} data-testid="button-next-month"><ChevronRight className="w-3.5 h-3.5" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-0">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>)}
        {Array.from({ length: adjustedFirst }).map((_, i) => <div key={`empty-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const date = new Date(year, month, day);
          const isSelected = isSameDay(date, selectedDate);
          const isToday = isSameDay(date, today);
          const hasEvents = eventDates.has(`${year}-${month}-${day}`);
          return (
            <button key={day} className={`relative w-full aspect-square flex items-center justify-center text-[11px] rounded-full transition-colors ${isSelected ? "bg-blue-600 text-white font-bold" : isToday ? "font-bold text-blue-600 dark:text-blue-400" : "hover:bg-muted"}`} onClick={() => onSelectDate(date)} data-testid={`cal-day-${day}`}>
              {day}
              {hasEvents && !isSelected && <div className="absolute bottom-0.5 w-1 h-1 rounded-full bg-blue-500" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UpcomingList({ events, selectedDate, onSelectEvent }: { events: CalendarEvent[]; selectedDate: Date; onSelectEvent: (e: CalendarEvent) => void }) {
  const dayEvents = useMemo(() => events.filter(e => isSameDay(new Date(e.start.dateTime), selectedDate)).sort((a, b) => new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()), [events, selectedDate]);
  const now = new Date();
  const isToday = isSameDay(selectedDate, now);
  const dayLabel = isToday ? "Today" : isSameDay(selectedDate, addDays(now, 1)) ? "Tomorrow" : selectedDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="flex-1 flex flex-col overflow-hidden border-t">
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{dayLabel}'s Schedule</p>
        {dayEvents.length > 0 && (
          <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{dayEvents.length}</span>
        )}
      </div>
      {dayEvents.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-4 py-6 text-center">
          <div className="w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center mb-2">
            <CalendarIcon className="w-5 h-5 text-muted-foreground/60" />
          </div>
          <p className="text-[11px] text-muted-foreground">Nothing scheduled</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
          {dayEvents.map(event => {
            const color = getEventColor(event.subject, event._source, event._eventType);
            const TypeIcon = event._source === "crm" ? getEventTypeIcon(event._eventType) : null;
            const startTime = new Date(event.start.dateTime);
            const isPast = isToday && startTime < now;
            return (
              <button
                key={event.id}
                className={`w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 hover:bg-muted/50 transition-colors group ${isPast ? "opacity-50" : ""}`}
                onClick={() => onSelectEvent(event)}
                data-testid={`upcoming-${event.id}`}
              >
                <div className="flex flex-col items-center shrink-0 pt-0.5">
                  <span className={`text-[10px] font-bold tabular-nums ${color.text}`}>{formatTime(event.start.dateTime)}</span>
                  <div className={`w-[3px] flex-1 mt-1 rounded-full ${color.dot} opacity-40 min-h-[12px]`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold truncate leading-tight">{event.subject}</p>
                  {event._propertyName && (
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{event._propertyName}</p>
                  )}
                  {!event._propertyName && event.location?.displayName && (
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{event.location.displayName}</p>
                  )}
                  {event._companyName && (
                    <p className="text-[9px] text-muted-foreground/70 truncate">{event._companyName}</p>
                  )}
                </div>
                <div className="shrink-0 pt-0.5">
                  {TypeIcon && <TypeIcon className={`w-3.5 h-3.5 ${color.text} opacity-60 group-hover:opacity-100 transition-opacity`} />}
                  {!TypeIcon && event.isOnlineMeeting && <Video className="w-3.5 h-3.5 text-blue-400 opacity-60 group-hover:opacity-100 transition-opacity" />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface BackendInsight {
  type: string;
  title: string;
  detail: string;
  priority: number;
}

const INSIGHT_ICONS: Record<string, typeof Building2> = {
  todaySummary: CalendarIcon,
  hotProperty: Flame,
  viewingTrend: TrendingUp,
  activeTenant: Building2,
  busiestAgent: UserCheck,
  pipeline: Handshake,
  coldProperty: AlertTriangle,
  busiestDay: BarChart3,
};

const INSIGHT_COLORS: Record<string, string> = {
  todaySummary: "text-blue-500",
  hotProperty: "text-rose-500",
  viewingTrend: "text-emerald-500",
  activeTenant: "text-amber-500",
  busiestAgent: "text-violet-500",
  pipeline: "text-green-500",
  coldProperty: "text-orange-500",
  busiestDay: "text-sky-500",
};

function IntelligenceFooter({ connected }: { connected: boolean }) {
  const { data: insightsData, isLoading } = useQuery<{ insights: BackendInsight[] }>({
    queryKey: ["/api/microsoft/calendar/insights"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const insights = insightsData?.insights || [];

  return (
    <div className="border-t bg-muted/15 shrink-0" data-testid="calendar-footer">
      <div className="flex items-center px-5 py-3 gap-4">
        <div className="flex items-center gap-2.5 shrink-0 pr-4 border-r border-border/40">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="w-4.5 h-4.5 text-primary" />
          </div>
          <span className="text-sm font-semibold text-foreground/70 uppercase tracking-wider">Intelligence</span>
        </div>

        <div className="flex-1 flex items-center gap-4 overflow-x-auto scrollbar-none">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              <span className="text-sm">Analysing CRM data...</span>
            </div>
          ) : insights.length === 0 ? (
            <span className="text-sm text-muted-foreground">No insights available yet</span>
          ) : (
            insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || Brain;
              const color = INSIGHT_COLORS[insight.type] || "text-muted-foreground";
              return (
                <div
                  key={`${insight.type}-${i}`}
                  className="flex items-center gap-2.5 shrink-0 rounded-lg px-2.5 py-1.5 hover:bg-muted/40 transition-colors group"
                  data-testid={`insight-${insight.type}`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color.replace("text-", "bg-")}/10`}>
                    <Icon className={`w-4 h-4 ${color} shrink-0`} />
                  </div>
                  <div className="flex flex-col text-left">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight whitespace-nowrap">{insight.title}</span>
                    <span className="text-[13px] font-medium leading-tight whitespace-nowrap">{insight.detail}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 pl-4 border-l border-border/40">
          {connected && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          )}
          <span className="text-xs text-muted-foreground/50">
            {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Calendar() {
  const { data: currentUser } = useQuery<{ team?: string; name?: string; email?: string }>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("workWeek");
  const [showCrmEvents, setShowCrmEvents] = useState(true);
  const [showOutlookEvents, setShowOutlookEvents] = useState(true);
  const [showTeam, setShowTeam] = useState(true);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [activeEventType, setActiveEventType] = useState<string | null>(null);
  const userTeam = currentUser?.team || "All";
  const isClientTeam = !!userTeam && !INTERNAL_BGP_TEAMS.has(userTeam) && userTeam !== "All";
  const effectiveTeamFilter = isClientTeam ? userTeam : (teamFilter ?? (TEAMS.includes(userTeam) ? userTeam : "All"));

  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/microsoft/status"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: outlookEvents, isLoading: outlookLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/microsoft/calendar"],
    enabled: status?.connected === true,
  });

  const { data: teamEventsRaw, isLoading: teamEventsLoading } = useQuery<TeamEvent[]>({
    queryKey: ["/api/team-events"],
    queryFn: async () => {
      const res = await fetch("/api/team-events?days=30", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch team events");
      return res.json();
    },
  });

  const { data: teamSchedules } = useQuery<TeamMemberSchedule[]>({
    queryKey: ["/api/microsoft/team-calendar", effectiveTeamFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveTeamFilter !== "All") params.set("team", effectiveTeamFilter);
      params.set("days", "14");
      const res = await fetch(`/api/microsoft/team-calendar?${params}`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error("Failed to fetch team calendar");
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    enabled: showTeam && !!status?.connected,
  });

  const filteredTeamMembers = useMemo(() => {
    if (!teamSchedules) return [];
    return teamSchedules.filter(s => s.email?.toLowerCase() !== currentUser?.email?.toLowerCase());
  }, [teamSchedules, currentUser?.email]);

  const { data: crmProperties } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!status?.connected,
    staleTime: 10 * 60 * 1000,
  });
  const { data: crmDeals } = useQuery<CrmDeal[]>({
    queryKey: ["/api/crm/deals"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!status?.connected,
    staleTime: 10 * 60 * 1000,
  });
  const { data: crmContacts } = useQuery<CrmContact[]>({
    queryKey: ["/api/crm/contacts"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!status?.connected,
    staleTime: 10 * 60 * 1000,
  });
  const { data: crmCompanies } = useQuery<CrmCompany[]>({
    queryKey: ["/api/crm/companies"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!status?.connected,
    staleTime: 10 * 60 * 1000,
  });

  const mergedEvents = useMemo(() => {
    const events: CalendarEvent[] = [];
    if (showOutlookEvents && outlookEvents) events.push(...outlookEvents.map(e => ({
      ...e,
      _source: "outlook" as const,
      _eventType: e._eventType || classifyOutlookEvent(e.subject, e.categories),
    })));
    if (showCrmEvents && teamEventsRaw) events.push(...teamEventsRaw.map(teamEventToCalendarEvent));
    if (activeEventType) {
      return events.filter(e => e._eventType === activeEventType);
    }
    return events;
  }, [outlookEvents, teamEventsRaw, showCrmEvents, showOutlookEvents, activeEventType]);

  const eventsLoading = teamEventsLoading || (status?.connected && outlookLoading);

  const eventTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (teamEventsRaw) {
      teamEventsRaw.forEach(e => { counts[e.event_type] = (counts[e.event_type] || 0) + 1; });
    }
    if (outlookEvents) {
      outlookEvents.forEach(e => {
        const type = classifyOutlookEvent(e.subject, e.categories);
        counts[type] = (counts[type] || 0) + 1;
      });
    }
    return counts;
  }, [teamEventsRaw, outlookEvents]);

  const viewDates = useMemo(() => getViewDates(selectedDate, viewMode), [selectedDate, viewMode]);

  const headerLabel = useMemo(() => {
    if (viewMode === "day") return formatHeaderDate(selectedDate);
    const first = viewDates[0];
    const last = viewDates[viewDates.length - 1];
    if (first.getMonth() === last.getMonth()) return `${first.getDate()} – ${last.getDate()} ${first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
    return `${first.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${last.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  }, [viewMode, selectedDate, viewDates]);

  function getCrmLinksForEvent(ev: CalendarEvent): CrmLinks {
    return findCrmLinks(ev, crmProperties || [], crmDeals || [], crmContacts || [], crmCompanies || []);
  }

  if (statusLoading && teamEventsLoading) {
    return (
      <div className="h-full flex">
        <div className="w-[240px] border-r p-4 space-y-3 hidden lg:block">
          <Skeleton className="h-40 w-full" />
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
        <div className="flex-1 p-4 space-y-2">
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="calendar-page">
      <DaySummaryBar />

      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0 bg-background">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedDate(navigateView(selectedDate, viewMode, -1))} data-testid="button-prev-day">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedDate(navigateView(selectedDate, viewMode, 1))} data-testid="button-next-day">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" className="text-xs h-7 px-3" onClick={() => setSelectedDate(new Date())} data-testid="button-today">Today</Button>
          <span className="text-sm font-semibold ml-2 hidden sm:inline">{headerLabel}</span>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex bg-muted rounded-md p-0.5">
            {(["day", "workWeek", "week"] as ViewMode[]).map(mode => (
              <button
                key={mode}
                className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${viewMode === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setViewMode(mode)}
                data-testid={`view-${mode}`}
              >
                {mode === "day" ? "Day" : mode === "workWeek" ? "Work week" : "Week"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-2">
            <button className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${showCrmEvents ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`} onClick={() => setShowCrmEvents(!showCrmEvents)} data-testid="toggle-crm-events">
              <Building2 className="w-3 h-3" />CRM
            </button>
            {status?.connected && (
              <button className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${showOutlookEvents ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" : "bg-muted text-muted-foreground"}`} onClick={() => setShowOutlookEvents(!showOutlookEvents)} data-testid="toggle-outlook-events">
                <Cloud className="w-3 h-3" />Outlook
              </button>
            )}
            {status?.connected && (
              <button
                className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors ${showTeam ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-muted text-muted-foreground"}`}
                onClick={() => { setShowTeam(!showTeam); if (!showTeam && viewMode !== "day") setViewMode("day"); }}
                data-testid="toggle-team"
              >
                <Users className="w-3 h-3" />Team
              </button>
            )}
          </div>
        </div>
      </div>

      {showTeam && !isClientTeam && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-muted/20 shrink-0" data-testid="team-filter-bar">
          {TEAMS.map(t => (
            <button
              key={t}
              onClick={() => setTeamFilter(t)}
              className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-colors ${effectiveTeamFilter === t ? "bg-black text-white dark:bg-white dark:text-black border-transparent" : "bg-background hover:bg-muted border-border text-foreground"}`}
              data-testid={`team-pill-${t.toLowerCase().replace(/[\s/]+/g, "-")}`}
            >
              {t}
            </button>
          ))}
          {filteredTeamMembers.length > 0 && (
            <span className="text-[10px] text-muted-foreground ml-2">{filteredTeamMembers.length} member{filteredTeamMembers.length !== 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className="hidden lg:flex lg:flex-col w-[240px] border-r shrink-0 bg-background">
          <MiniCalendar selectedDate={selectedDate} onSelectDate={setSelectedDate} events={mergedEvents} />
          {Object.keys(eventTypeCounts).length > 0 && (
            <div className="px-3 py-2 border-t">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Event Types</p>
                {activeEventType && (
                  <button
                    className="text-[9px] text-blue-500 hover:text-blue-700 font-medium"
                    onClick={() => setActiveEventType(null)}
                    data-testid="clear-event-type-filter"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {Object.entries(eventTypeCounts).map(([type, count]) => {
                  const typeColor = CRM_EVENT_COLORS[type];
                  const Icon = getEventTypeIcon(type);
                  const isActive = activeEventType === type;
                  return (
                    <button
                      key={type}
                      className={`w-full flex items-center gap-2 text-[11px] px-1.5 py-1 rounded transition-colors ${isActive ? "bg-foreground/10 font-semibold" : "hover:bg-muted/60"}`}
                      onClick={() => setActiveEventType(isActive ? null : type)}
                      data-testid={`filter-event-type-${type}`}
                    >
                      <Icon className={`w-3 h-3 ${typeColor?.text || "text-muted-foreground"}`} />
                      <span className="flex-1 capitalize text-left">{EVENT_TYPE_LABELS[type] || type}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${typeColor?.bg || "bg-muted"} ${typeColor?.text || ""}`}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <UpcomingList events={mergedEvents} selectedDate={selectedDate} onSelectEvent={setSelectedEvent} />
        </div>

        <div className="flex-1 flex flex-col min-w-0 bg-background">
          {!status?.connected && !teamEventsRaw ? (
            <ConnectPrompt />
          ) : eventsLoading ? (
            <div className="p-4 space-y-3 flex-1">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
          ) : (
            <TimeGrid
              events={mergedEvents}
              dates={viewDates}
              viewMode={viewMode}
              onSelectEvent={setSelectedEvent}
              selectedEventId={selectedEvent?.id}
              teamMembers={filteredTeamMembers}
              showTeam={showTeam}
            />
          )}
        </div>

        {selectedEvent && (
          <div className="w-[320px] border-l shrink-0 hidden md:block bg-background">
            <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} crmLinks={getCrmLinksForEvent(selectedEvent)} />
          </div>
        )}
      </div>

      <IntelligenceFooter
        connected={!!status?.connected}
      />

      {selectedEvent && (
        <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setSelectedEvent(null)}>
          <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] bg-background rounded-t-2xl border-t shadow-xl overflow-y-auto" onClick={e => e.stopPropagation()}>
            <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} crmLinks={getCrmLinksForEvent(selectedEvent)} />
          </div>
        </div>
      )}
    </div>
  );
}
