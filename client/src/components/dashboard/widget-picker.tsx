import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useState } from "react";
import {
  CalendarDays,
  Users,
  Sparkles,
  Newspaper,
  BarChart3,
  Mail as MailIcon,
  Loader2,
  Settings2,
  Plus,
  X,
  Star,
  Bell,
  UserCheck,
  ListPlus,
  Store,
  Target,
  ChevronUp,
  ChevronDown,
  FolderOpen,
  Building2,
  Zap,
  AlertTriangle,
  ListTodo,
  Briefcase,
} from "lucide-react";
import type { WidgetDefinition, BoardDefinition } from "./types";

export const WIDGET_REGISTRY: WidgetDefinition[] = [
  { id: "key-instructions", name: "Key Instructions", description: "Your starred instructions for quick access", icon: Star, category: "crm" },
  { id: "news-summary", name: "News Feed", description: "AI-curated news feed with headlines and photos", icon: Newspaper, category: "overview" },
  { id: "quick-actions", name: "Quick Actions", description: "Shortcuts to Model Generate, Doc Generate & News", icon: Sparkles, category: "overview" },
  { id: "available-units", name: "Letting Tracker", description: "Full-width letting tracker from your starred instructions", icon: Store, category: "crm" },
  { id: "today-diary", name: "Weekly Calendar", description: "Full week view with events, types, and intelligence insights", icon: CalendarDays, category: "overview" },
  { id: "active-contacts", name: "Most Active Contacts", description: "Contacts with most interactions recently", icon: UserCheck, category: "crm" },
  { id: "new-requirements", name: "New Requirements", description: "Requirements added in the last 7 days", icon: ListPlus, category: "crm" },
  { id: "activity-alerts", name: "Activity Alerts", description: "When colleagues interact with your contacts", icon: Bell, category: "crm" },
  { id: "inbox", name: "Inbox", description: "Microsoft 365 email with folder navigation", icon: MailIcon, category: "microsoft" },
  { id: "agent-pipeline", name: "Team WIP Report", description: "Full WIP report for your team with filters", icon: BarChart3, category: "crm" },
  { id: "my-leads", name: "My Leads", description: "AI-powered personalised lead generation from all your data", icon: Target, category: "crm" },
  { id: "sharepoint", name: "SharePoint Files", description: "Browse and open files from BGP SharePoint", icon: FolderOpen, category: "microsoft" },
  { id: "studios", name: "Studios", description: "Model Generate & Document Studio templates and recent runs", icon: Sparkles, category: "overview" },
  { id: "properties-deals", name: "Properties & Deals", description: "Properties grouped with their deals", icon: Building2, category: "crm" },
  { id: "system-activity", name: "System Activity", description: "Real-time feed of automated background processes", icon: Zap, category: "overview" },
  { id: "daily-digest", name: "Daily Digest", description: "Proactive alerts: stuck deals, KYC gaps, cooling contacts", icon: AlertTriangle, category: "crm" },
  { id: "my-tasks", name: "My Tasks & Briefing", description: "Personal task list with AI daily briefing", icon: ListTodo, category: "overview" },
  { id: "my-portfolio", name: "My Portfolio", description: "Properties and deals assigned to you", icon: Briefcase, category: "crm" },
];

export const DEFAULT_WIDGETS = WIDGET_REGISTRY.map(w => w.id);

export const BOARD_REGISTRY: BoardDefinition[] = [
  { id: "leads-news", name: "My Leads & News", description: "AI leads and curated news feed", icon: Target, widgetIds: ["my-leads", "news-summary"] },
  { id: "quick-actions", name: "Quick Actions", description: "Shortcuts to key tools", icon: Sparkles, widgetIds: ["quick-actions"] },
  { id: "triple-row", name: "Calendar · Instructions · Contacts", description: "Weekly calendar, starred instructions, and active contacts", icon: CalendarDays, widgetIds: ["today-diary", "key-instructions", "active-contacts"] },
  { id: "requirements-activity", name: "Requirements & Activity", description: "New requirements and team activity alerts", icon: ListPlus, widgetIds: ["new-requirements", "activity-alerts"] },
  { id: "letting-tracker", name: "Letting Tracker", description: "Available units from starred instructions", icon: Store, widgetIds: ["available-units"] },
  { id: "inbox", name: "Inbox", description: "Microsoft 365 email", icon: MailIcon, widgetIds: ["inbox"] },
  { id: "wip-report", name: "Team WIP Report", description: "Full WIP report with filters", icon: BarChart3, widgetIds: ["agent-pipeline"] },
  { id: "sharepoint-files", name: "SharePoint Files", description: "Browse and open SharePoint files", icon: FolderOpen, widgetIds: ["sharepoint"] },
  { id: "studios-board", name: "Studios", description: "Model Generate & Document Studio", icon: Sparkles, widgetIds: ["studios"] },
  { id: "properties-deals-board", name: "Properties & Deals", description: "Properties grouped with their deals", icon: Building2, widgetIds: ["properties-deals"] },
  { id: "system-activity-board", name: "System Activity", description: "Automated process activity feed", icon: Zap, widgetIds: ["system-activity"] },
  { id: "daily-digest-board", name: "Daily Digest", description: "Proactive alerts and action items", icon: AlertTriangle, widgetIds: ["daily-digest"] },
  { id: "tasks-briefing", name: "My Tasks & Briefing", description: "Personal tasks and AI daily briefing", icon: ListTodo, widgetIds: ["my-tasks"] },
  { id: "my-portfolio-board", name: "My Portfolio", description: "Properties and deals assigned to you", icon: Briefcase, widgetIds: ["my-portfolio"] },
];

export const DEFAULT_BOARDS = BOARD_REGISTRY.map(b => b.id);

export function boardsToWidgets(boardIds: string[]): string[] {
  const result: string[] = [];
  for (const bid of boardIds) {
    const board = BOARD_REGISTRY.find(b => b.id === bid);
    if (board) result.push(...board.widgetIds);
  }
  return result;
}

export function widgetsToBoards(widgetIds: string[]): string[] {
  const widgetSet = new Set(widgetIds);
  const result: string[] = [];
  for (const board of BOARD_REGISTRY) {
    if (board.widgetIds.every(wid => widgetSet.has(wid))) {
      result.push(board.id);
    }
  }
  const orderedResult: string[] = [];
  const boardByWidget = new Map<string, string>();
  for (const board of BOARD_REGISTRY) {
    for (const wid of board.widgetIds) boardByWidget.set(wid, board.id);
  }
  const seen = new Set<string>();
  for (const wid of widgetIds) {
    const bid = boardByWidget.get(wid);
    if (bid && result.includes(bid) && !seen.has(bid)) {
      orderedResult.push(bid);
      seen.add(bid);
    }
  }
  for (const bid of result) {
    if (!seen.has(bid)) orderedResult.push(bid);
  }
  return orderedResult;
}

export function WidgetPickerDialog({
  activeWidgets,
  onSave,
  saving,
  viewMode,
  onViewModeChange,
}: {
  activeWidgets: string[];
  onSave: (widgets: string[], onDone: () => void) => void;
  saving: boolean;
  viewMode: "team" | "individual";
  onViewModeChange: (mode: "team" | "individual") => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedBoards, setSelectedBoards] = useState<string[]>(() => widgetsToBoards(activeWidgets));

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) { setSelectedBoards(widgetsToBoards(activeWidgets)); }
    setOpen(isOpen);
  };

  const toggleBoard = (id: string) => {
    setSelectedBoards(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  };

  const moveBoard = (idx: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= selectedBoards.length) return;
    const copy = [...selectedBoards];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setSelectedBoards(copy);
  };

  const handleSave = () => {
    onSave(boardsToWidgets(selectedBoards), () => setOpen(false));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-testid="button-customize-dashboard">
          <Settings2 className="w-3.5 h-3.5" />
          Customise
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Customise Dashboard</DialogTitle>
          <p className="text-sm text-muted-foreground">Toggle boards on or off and drag to reorder</p>
        </DialogHeader>

        <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Dashboard View</p>
              <p className="text-xs text-muted-foreground">Show data for your team or just you</p>
            </div>
          </div>
          <div className="flex items-center gap-1 bg-background rounded-md border p-0.5">
            <button
              onClick={() => onViewModeChange("team")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "team" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-view-team"
            >
              Team
            </button>
            <button
              onClick={() => onViewModeChange("individual")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "individual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-view-individual"
            >
              Individual
            </button>
          </div>
        </div>

        <div className="space-y-1.5 py-1 max-h-[50vh] overflow-y-auto">
          {selectedBoards.map((bid, idx) => {
            const board = BOARD_REGISTRY.find(b => b.id === bid);
            if (!board) return null;
            const Icon = board.icon;
            return (
              <div
                key={bid}
                className="flex items-center gap-2.5 p-2.5 rounded-lg border bg-background group"
                data-testid={`board-row-${bid}`}
              >
                <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{board.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{board.description}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => moveBoard(idx, "up")}
                    disabled={idx === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-20"
                    data-testid={`board-move-up-${bid}`}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => moveBoard(idx, "down")}
                    disabled={idx === selectedBoards.length - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-20"
                    data-testid={`board-move-down-${bid}`}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => toggleBoard(bid)}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive ml-0.5"
                    data-testid={`board-remove-${bid}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {BOARD_REGISTRY.filter(b => !selectedBoards.includes(b.id)).length > 0 && (
            <>
              <div className="pt-2 pb-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Hidden boards</p>
              </div>
              {BOARD_REGISTRY.filter(b => !selectedBoards.includes(b.id)).map(board => {
                const Icon = board.icon;
                return (
                  <button
                    key={board.id}
                    onClick={() => toggleBoard(board.id)}
                    className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-dashed hover:bg-muted/50 transition-colors text-left opacity-60 hover:opacity-100"
                    data-testid={`board-add-${board.id}`}
                  >
                    <div className="w-8 h-8 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{board.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{board.description}</p>
                    </div>
                    <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedBoards([...DEFAULT_BOARDS])}
            data-testid="button-reset-widgets"
          >
            Reset to default
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} data-testid="button-save-widgets">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
