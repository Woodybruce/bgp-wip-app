import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  ListTodo, Plus, Check, Circle, Clock, AlertTriangle, Flame, ArrowRight,
  Trash2, Pencil, Calendar as CalendarIcon, Building2, BarChart3, User,
  Sparkles, Brain, ChevronDown, ChevronRight, GripVertical, X, RefreshCw,
  CheckCircle2, CircleDot, Filter, SlidersHorizontal, Loader2, Star,
  Flag, ArrowUp, ArrowDown, Minus, Zap, Sun, Coffee, Briefcase, Target,
  Download, BookOpen, FileText, Notebook, FolderOpen, ChevronLeft,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
  status: string;
  category: string | null;
  linked_deal_id: string | null;
  linked_property_id: string | null;
  linked_contact_id: string | null;
  sort_order: number;
  created_at: string;
  completed_at: string | null;
  deal_name?: string;
  property_name?: string;
  contact_name?: string;
}

interface BriefingData {
  briefing: string;
  generatedAt: string;
  stats: {
    openTasks: number;
    overdueTasks: number;
    todayTasks: number;
    completedYesterday: number;
    activeDeals: number;
    stuckDeals: number;
    unreadEmails: number;
  };
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: any; sortOrder: number }> = {
  urgent: { label: "Urgent", color: "text-red-600 bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800", icon: Flame, sortOrder: 0 },
  high: { label: "High", color: "text-orange-600 bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800", icon: ArrowUp, sortOrder: 1 },
  medium: { label: "Medium", color: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800", icon: Minus, sortOrder: 2 },
  low: { label: "Low", color: "text-gray-500 bg-gray-50 border-gray-200 dark:bg-gray-900 dark:border-gray-700", icon: ArrowDown, sortOrder: 3 },
};

const CATEGORY_OPTIONS = [
  { value: "follow-up", label: "Follow Up", icon: RefreshCw },
  { value: "meeting", label: "Meeting", icon: Briefcase },
  { value: "deal", label: "Deal", icon: Target },
  { value: "admin", label: "Admin", icon: SlidersHorizontal },
  { value: "client", label: "Client", icon: User },
  { value: "research", label: "Research", icon: Brain },
  { value: "viewing", label: "Viewing", icon: Building2 },
  { value: "personal", label: "Personal", icon: Star },
];

function PriorityBadge({ priority }: { priority: string }) {
  const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${config.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {config.label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const cat = CATEGORY_OPTIONS.find(c => c.value === category);
  if (!cat) return null;
  const Icon = cat.icon;
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border">
      <Icon className="w-2.5 h-2.5" />
      {cat.label}
    </span>
  );
}

function formatDueDate(dateStr: string | null) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, className: "text-red-600 font-medium" };
  if (diffDays === 0) return { text: "Today", className: "text-orange-600 font-medium" };
  if (diffDays === 1) return { text: "Tomorrow", className: "text-blue-600" };
  if (diffDays <= 7) return { text: `${diffDays}d`, className: "text-muted-foreground" };
  return { text: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), className: "text-muted-foreground" };
}

function TaskRow({ task, onToggle, onEdit, onDelete }: { task: Task; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const isDone = task.status === "done";
  const dueInfo = formatDueDate(task.due_date);
  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !isDone;

  return (
    <div
      className={`group flex items-start gap-3 px-4 py-3 border-b last:border-b-0 transition-colors hover:bg-muted/30 ${isDone ? "opacity-50" : ""} ${isOverdue ? "bg-red-50/50 dark:bg-red-950/20" : ""}`}
      data-testid={`task-row-${task.id}`}
    >
      <button
        onClick={onToggle}
        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
          isDone
            ? "bg-emerald-500 border-emerald-500 text-white"
            : isOverdue
              ? "border-red-400 hover:border-red-500 hover:bg-red-50"
              : "border-gray-300 hover:border-primary hover:bg-primary/5"
        }`}
        data-testid={`task-toggle-${task.id}`}
      >
        {isDone && <Check className="w-3 h-3" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
            {task.title}
          </span>
          <PriorityBadge priority={task.priority} />
          {task.category && <CategoryBadge category={task.category} />}
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          {dueInfo && (
            <span className={`text-[11px] flex items-center gap-1 ${dueInfo.className}`}>
              <CalendarIcon className="w-3 h-3" />
              {dueInfo.text}
            </span>
          )}
          {task.deal_name && (
            <Link href={`/deals/${task.linked_deal_id}`}>
              <span className="text-[11px] text-blue-600 flex items-center gap-1 hover:underline cursor-pointer">
                <BarChart3 className="w-3 h-3" />
                {task.deal_name}
              </span>
            </Link>
          )}
          {task.property_name && (
            <Link href={`/properties/${task.linked_property_id}`}>
              <span className="text-[11px] text-blue-600 flex items-center gap-1 hover:underline cursor-pointer">
                <Building2 className="w-3 h-3" />
                {task.property_name}
              </span>
            </Link>
          )}
          {task.contact_name && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              <User className="w-3 h-3" />
              {task.contact_name}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEdit} data-testid={`task-edit-${task.id}`}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={onDelete} data-testid={`task-delete-${task.id}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function InlineFormatted({ text }: { text: string }) {
  const parts: { type: "text" | "bold" | "italic"; content: string }[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    const italicMatch = remaining.match(/\*(.*?)\*/);
    const firstMatch = boldMatch && italicMatch
      ? (boldMatch.index! <= italicMatch.index! ? boldMatch : italicMatch)
      : boldMatch || italicMatch;
    if (!firstMatch || firstMatch.index === undefined) {
      parts.push({ type: "text", content: remaining });
      break;
    }
    if (firstMatch.index > 0) {
      parts.push({ type: "text", content: remaining.slice(0, firstMatch.index) });
    }
    const isBold = firstMatch[0].startsWith("**");
    parts.push({ type: isBold ? "bold" : "italic", content: firstMatch[1] });
    remaining = remaining.slice(firstMatch.index + firstMatch[0].length);
  }
  return (
    <>
      {parts.map((p, i) =>
        p.type === "bold" ? <strong key={i}>{p.content}</strong> :
        p.type === "italic" ? <em key={i}>{p.content}</em> :
        <span key={i}>{p.content}</span>
      )}
    </>
  );
}

function BriefingMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed">
      {lines.map((line, i) => {
        if (line.startsWith("# ")) return <h2 key={i} className="text-base font-bold mt-4 mb-1 first:mt-0">{line.slice(2)}</h2>;
        if (line.startsWith("## ")) return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.slice(3)}</h3>;
        if (line.startsWith("### ")) return <h4 key={i} className="text-sm font-semibold mt-2 mb-0.5">{line.slice(4)}</h4>;
        if (line.match(/^\*\*.*\*\*$/)) return <h4 key={i} className="text-sm font-semibold mt-3 mb-1">{line.replace(/\*\*/g, "")}</h4>;
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return <li key={i} className="ml-4 text-sm list-disc marker:text-primary/40"><InlineFormatted text={line.slice(2)} /></li>;
        }
        if (line.match(/^\d+\.\s/)) {
          return <li key={i} className="ml-4 text-sm list-decimal marker:text-primary/40"><InlineFormatted text={line.replace(/^\d+\.\s/, "")} /></li>;
        }
        if (line.trim() === "") return <div key={i} className="h-2" />;
        if (line.startsWith("---")) return <hr key={i} className="my-3 border-border" />;
        return <p key={i} className="text-sm mb-1"><InlineFormatted text={line} /></p>;
      })}
    </div>
  );
}

function AddTaskInline({ onAdd }: { onAdd: (title: string) => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/20">
      <Plus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            onAdd(value.trim());
            setValue("");
          }
        }}
        placeholder="Add a task... press Enter"
        className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-8 text-sm px-0"
        data-testid="input-add-task"
      />
      {value.trim() && (
        <Button
          size="sm"
          className="h-7 text-xs px-2"
          onClick={() => { onAdd(value.trim()); setValue(""); }}
          data-testid="button-add-task-submit"
        >
          Add
        </Button>
      )}
    </div>
  );
}

export default function TasksPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "todo" | "in_progress" | "done">("all");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [briefingExpanded, setBriefingExpanded] = useState(true);
  const [showCompletedSection, setShowCompletedSection] = useState(false);

  const [editForm, setEditForm] = useState({
    title: "", description: "", priority: "medium", category: "", dueDate: "",
    linkedDealId: "", linkedPropertyId: "", linkedContactId: "",
  });

  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importTab, setImportTab] = useState<"onenote" | "evernote">("onenote");
  const [onenoteNotebooks, setOnenoteNotebooks] = useState<any[]>([]);
  const [onenoteSections, setOnenoteSections] = useState<any[]>([]);
  const [selectedNotebook, setSelectedNotebook] = useState<string | null>(null);
  const [selectedNotebookName, setSelectedNotebookName] = useState("");
  const [onenoteLoading, setOnenoteLoading] = useState(false);
  const [importingOnenote, setImportingOnenote] = useState(false);
  const [evernoteText, setEvernoteText] = useState("");
  const [importingEvernote, setImportingEvernote] = useState(false);

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: briefingData, isLoading: briefingLoading, refetch: refetchBriefing } = useQuery<BriefingData>({
    queryKey: ["/api/ai-briefing"],
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: deals = [] } = useQuery<any[]>({ queryKey: ["/api/crm/deals"] });
  const { data: properties = [] } = useQuery<any[]>({ queryKey: ["/api/crm/properties"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/tasks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PATCH", `/api/tasks/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setShowEditDialog(false);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task deleted" });
    },
  });

  const handleQuickAdd = (title: string) => {
    createMutation.mutate({ title, priority: "medium" });
  };

  const openImportDialog = async () => {
    setShowImportDialog(true);
    setImportTab("onenote");
    setSelectedNotebook(null);
    setOnenoteSections([]);
    setOnenoteLoading(true);
    try {
      const res = await fetch("/api/tasks/import/onenote/notebooks", { credentials: "include" });
      if (res.ok) {
        setOnenoteNotebooks(await res.json());
      } else {
        setOnenoteNotebooks([]);
      }
    } catch { setOnenoteNotebooks([]); }
    setOnenoteLoading(false);
  };

  const selectNotebook = async (nbId: string, nbName: string) => {
    setSelectedNotebook(nbId);
    setSelectedNotebookName(nbName);
    setOnenoteLoading(true);
    try {
      const res = await fetch(`/api/tasks/import/onenote/sections/${nbId}`, { credentials: "include" });
      if (res.ok) setOnenoteSections(await res.json());
      else setOnenoteSections([]);
    } catch { setOnenoteSections([]); }
    setOnenoteLoading(false);
  };

  const importFromSection = async (sectionId: string) => {
    setImportingOnenote(true);
    try {
      const res = await fetch("/api/tasks/import/onenote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sectionId }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Imported from OneNote", description: `${data.imported} tasks imported from ${data.pagesScanned} pages` });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        setShowImportDialog(false);
      } else {
        toast({ title: "Import failed", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
    setImportingOnenote(false);
  };

  const importFromEvernote = async () => {
    const lines = evernoteText.split("\n").map(l => l.trim()).filter(l => l.length > 2);
    if (lines.length === 0) {
      toast({ title: "Nothing to import", description: "Paste your Evernote tasks (one per line)", variant: "destructive" });
      return;
    }
    setImportingEvernote(true);
    try {
      const items = lines.map(l => {
        const clean = l.replace(/^[-•*☐□◻○[\]\s\d.]+/, "").trim();
        return { title: clean || l };
      });
      const res = await fetch("/api/tasks/import/evernote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Imported from Evernote", description: `${data.imported} tasks imported` });
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
        setShowImportDialog(false);
        setEvernoteText("");
      } else {
        toast({ title: "Import failed", description: data.error, variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    }
    setImportingEvernote(false);
  };

  const handleToggle = (task: Task) => {
    const newStatus = task.status === "done" ? "todo" : "done";
    updateMutation.mutate({ id: task.id, status: newStatus });
    if (newStatus === "done") {
      toast({ title: "Nice!", description: `"${task.title}" completed` });
    }
  };

  const openEdit = (task: Task) => {
    setEditTask(task);
    setEditForm({
      title: task.title,
      description: task.description || "",
      priority: task.priority,
      category: task.category || "",
      dueDate: task.due_date ? new Date(task.due_date).toISOString().slice(0, 16) : "",
      linkedDealId: task.linked_deal_id || "",
      linkedPropertyId: task.linked_property_id || "",
      linkedContactId: task.linked_contact_id || "",
    });
    setShowEditDialog(true);
  };

  const handleSaveEdit = () => {
    if (!editTask || !editForm.title.trim()) return;
    updateMutation.mutate({
      id: editTask.id,
      title: editForm.title.trim(),
      description: editForm.description.trim() || null,
      priority: editForm.priority,
      category: editForm.category || null,
      dueDate: editForm.dueDate || null,
      linkedDealId: editForm.linkedDealId || null,
      linkedPropertyId: editForm.linkedPropertyId || null,
      linkedContactId: editForm.linkedContactId || null,
    });
  };

  const activeTasks = tasks.filter(t => t.status !== "done");
  const completedTasks = tasks.filter(t => t.status === "done");
  const overdueTasks = activeTasks.filter(t => t.due_date && new Date(t.due_date) < new Date());
  const todayTasks = activeTasks.filter(t => {
    if (!t.due_date) return false;
    return new Date(t.due_date).toDateString() === new Date().toDateString();
  });
  const urgentHighTasks = activeTasks.filter(t => t.priority === "urgent" || t.priority === "high");

  const filteredTasks = filter === "all" ? tasks : tasks.filter(t => t.status === filter);
  const displayActive = filteredTasks.filter(t => t.status !== "done");
  const displayCompleted = filteredTasks.filter(t => t.status === "done");

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden" data-testid="tasks-page">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">

            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <ListTodo className="w-6 h-6 text-primary" />
                  My Tasks
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {activeTasks.length} open{overdueTasks.length > 0 ? ` · ${overdueTasks.length} overdue` : ""}{todayTasks.length > 0 ? ` · ${todayTasks.length} due today` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={openImportDialog}
                  data-testid="button-import-tasks"
                >
                  <Download className="w-3.5 h-3.5" />
                  Import
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => { setShowEditDialog(true); setEditTask(null); setEditForm({
                    title: "", description: "", priority: "medium", category: "", dueDate: "",
                    linkedDealId: "", linkedPropertyId: "", linkedContactId: "",
                  }); }}
                  data-testid="button-new-task"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Task
                </Button>
              </div>
            </div>

            <Card className="overflow-hidden border-primary/20 shadow-md">
              <div
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors bg-gradient-to-r from-primary/5 to-transparent"
                onClick={() => setBriefingExpanded(!briefingExpanded)}
                data-testid="briefing-toggle"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">AI Daily Briefing</h2>
                    <p className="text-[11px] text-muted-foreground">
                      {briefingData ? `Generated ${new Date(briefingData.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Your personalised morning summary"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {briefingData?.stats && (
                    <div className="hidden sm:flex items-center gap-3 mr-3">
                      {briefingData.stats.overdueTasks > 0 && (
                        <span className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {briefingData.stats.overdueTasks} overdue
                        </span>
                      )}
                      {briefingData.stats.unreadEmails > 0 && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {briefingData.stats.unreadEmails} unread
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {briefingData.stats.activeDeals} deals
                      </span>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); refetchBriefing(); }}
                    data-testid="button-refresh-briefing"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${briefingLoading ? "animate-spin" : ""}`} />
                  </Button>
                  {briefingExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </div>
              </div>
              {briefingExpanded && (
                <CardContent className="px-4 pb-4 pt-2">
                  {briefingLoading ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Preparing your briefing...</span>
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-2/3" />
                    </div>
                  ) : briefingData?.briefing ? (
                    <BriefingMarkdown text={briefingData.briefing} />
                  ) : (
                    <div className="text-center py-6">
                      <Sun className="w-8 h-8 mx-auto mb-2 text-amber-400" />
                      <p className="text-sm text-muted-foreground">Your AI briefing will appear here</p>
                      <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={() => refetchBriefing()} data-testid="button-generate-briefing">
                        <Sparkles className="w-3.5 h-3.5" />
                        Generate Briefing
                      </Button>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>

            {overdueTasks.length > 0 && (
              <Card className="border-red-200 dark:border-red-800 bg-red-50/30 dark:bg-red-950/20">
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                    <CardTitle className="text-sm font-semibold text-red-700 dark:text-red-400">
                      Overdue ({overdueTasks.length})
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  {overdueTasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => handleToggle(task)}
                      onEdit={() => openEdit(task)}
                      onDelete={() => deleteMutation.mutate(task.id)}
                    />
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-0 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <CircleDot className="w-4 h-4 text-primary" />
                    Tasks
                  </CardTitle>
                  <div className="flex items-center gap-1">
                    {(["all", "todo", "in_progress", "done"] as const).map(f => (
                      <Button
                        key={f}
                        variant={filter === f ? "default" : "ghost"}
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => setFilter(f)}
                        data-testid={`filter-${f}`}
                      >
                        {f === "all" ? "All" : f === "todo" ? "To Do" : f === "in_progress" ? "In Progress" : "Done"}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-0 pt-2">
                <AddTaskInline onAdd={handleQuickAdd} />

                {tasksLoading ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : displayActive.length === 0 && displayCompleted.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-400 opacity-60" />
                    <p className="text-sm font-medium text-muted-foreground">All clear!</p>
                    <p className="text-xs text-muted-foreground mt-1">Add a task above to get started</p>
                  </div>
                ) : (
                  <>
                    {displayActive.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        onToggle={() => handleToggle(task)}
                        onEdit={() => openEdit(task)}
                        onDelete={() => deleteMutation.mutate(task.id)}
                      />
                    ))}

                    {displayCompleted.length > 0 && (
                      <>
                        <button
                          className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/30 transition-colors"
                          onClick={() => setShowCompletedSection(!showCompletedSection)}
                          data-testid="toggle-completed"
                        >
                          {showCompletedSection ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          Completed ({displayCompleted.length})
                        </button>
                        {showCompletedSection && displayCompleted.map(task => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            onToggle={() => handleToggle(task)}
                            onEdit={() => openEdit(task)}
                            onDelete={() => deleteMutation.mutate(task.id)}
                          />
                        ))}
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {urgentHighTasks.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-red-100 dark:bg-red-900 flex items-center justify-center">
                      <Flame className="w-3.5 h-3.5 text-red-500" />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground">Urgent</span>
                  </div>
                  <p className="text-2xl font-bold">{activeTasks.filter(t => t.priority === "urgent").length}</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                      <ArrowUp className="w-3.5 h-3.5 text-orange-500" />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground">High Priority</span>
                  </div>
                  <p className="text-2xl font-bold">{activeTasks.filter(t => t.priority === "high").length}</p>
                </Card>
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground">Done Today</span>
                  </div>
                  <p className="text-2xl font-bold">{completedTasks.filter(t => t.completed_at && new Date(t.completed_at).toDateString() === new Date().toDateString()).length}</p>
                </Card>
              </div>
            )}

          </div>
        </div>

        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editTask ? "Edit Task" : "New Task"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Title</label>
                <Input
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  placeholder="What needs to be done?"
                  data-testid="input-task-title"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Add details..."
                  rows={3}
                  data-testid="input-task-description"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Priority</label>
                  <Select value={editForm.priority} onValueChange={(v) => setEditForm({ ...editForm, priority: v })}>
                    <SelectTrigger data-testid="select-task-priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="urgent">🔥 Urgent</SelectItem>
                      <SelectItem value="high">⬆️ High</SelectItem>
                      <SelectItem value="medium">➡️ Medium</SelectItem>
                      <SelectItem value="low">⬇️ Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Category</label>
                  <Select value={editForm.category || "none"} onValueChange={(v) => setEditForm({ ...editForm, category: v === "none" ? "" : v })}>
                    <SelectTrigger data-testid="select-task-category">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {CATEGORY_OPTIONS.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Due Date</label>
                <Input
                  type="datetime-local"
                  value={editForm.dueDate}
                  onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })}
                  data-testid="input-task-due-date"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Link to Deal</label>
                <Select value={editForm.linkedDealId || "none"} onValueChange={(v) => setEditForm({ ...editForm, linkedDealId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-task-deal">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(Array.isArray(deals) ? deals : []).slice(0, 50).map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Link to Property</label>
                <Select value={editForm.linkedPropertyId || "none"} onValueChange={(v) => setEditForm({ ...editForm, linkedPropertyId: v === "none" ? "" : v })}>
                  <SelectTrigger data-testid="select-task-property">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {(Array.isArray(properties) ? properties : []).slice(0, 50).map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="button-cancel-task">Cancel</Button>
              <Button
                onClick={editTask ? handleSaveEdit : () => {
                  createMutation.mutate({
                    title: editForm.title.trim(),
                    description: editForm.description.trim() || null,
                    priority: editForm.priority,
                    category: editForm.category || null,
                    dueDate: editForm.dueDate || null,
                    linkedDealId: editForm.linkedDealId || null,
                    linkedPropertyId: editForm.linkedPropertyId || null,
                    linkedContactId: editForm.linkedContactId || null,
                  });
                  setShowEditDialog(false);
                }}
                disabled={!editForm.title.trim() || updateMutation.isPending || createMutation.isPending}
                data-testid="button-save-task"
              >
                {(updateMutation.isPending || createMutation.isPending) && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                {editTask ? "Save Changes" : "Create Task"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Download className="w-4 h-4" />
                Import Tasks
              </DialogTitle>
            </DialogHeader>

            <div className="flex gap-1 p-1 bg-muted rounded-lg mb-4">
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors ${importTab === "onenote" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setImportTab("onenote")}
                data-testid="tab-import-onenote"
              >
                <Notebook className="w-3.5 h-3.5" />
                OneNote
              </button>
              <button
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-colors ${importTab === "evernote" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setImportTab("evernote")}
                data-testid="tab-import-evernote"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Evernote
              </button>
            </div>

            {importTab === "onenote" && (
              <div className="space-y-3">
                {onenoteLoading && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">Loading from OneNote...</span>
                  </div>
                )}

                {!onenoteLoading && !selectedNotebook && (
                  <>
                    {onenoteNotebooks.length === 0 ? (
                      <div className="text-center py-6">
                        <Notebook className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                        <p className="text-sm text-muted-foreground">No OneNote notebooks found.</p>
                        <p className="text-xs text-muted-foreground mt-1">Make sure your Microsoft account has OneNote notebooks.</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground mb-2">Select a notebook to import from:</p>
                        {onenoteNotebooks.map((nb: any) => (
                          <button
                            key={nb.id}
                            className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                            onClick={() => selectNotebook(nb.id, nb.name)}
                            data-testid={`notebook-${nb.id}`}
                          >
                            <div className="w-8 h-8 rounded-md bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
                              <Notebook className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{nb.name}</p>
                              {nb.lastModified && (
                                <p className="text-[11px] text-muted-foreground">
                                  Modified {new Date(nb.lastModified).toLocaleDateString("en-GB")}
                                </p>
                              )}
                            </div>
                            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {!onenoteLoading && selectedNotebook && (
                  <>
                    <button
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => { setSelectedNotebook(null); setOnenoteSections([]); }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Back to notebooks
                    </button>
                    <p className="text-xs font-medium">{selectedNotebookName}</p>
                    {onenoteSections.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No sections found in this notebook.</p>
                    ) : (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground mb-2">Select a section to import tasks from:</p>
                        {onenoteSections.map((sec: any) => (
                          <button
                            key={sec.id}
                            className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-left"
                            onClick={() => importFromSection(sec.id)}
                            disabled={importingOnenote}
                            data-testid={`section-${sec.id}`}
                          >
                            <div className="w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            <span className="text-sm font-medium flex-1">{sec.name}</span>
                            {importingOnenote ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : (
                              <Download className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {importTab === "evernote" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Paste your Evernote tasks below, one per line. Bullet points and checkboxes are automatically cleaned up.
                </p>
                <Textarea
                  value={evernoteText}
                  onChange={(e) => setEvernoteText(e.target.value)}
                  placeholder={"- Review lease agreement for 50 Gresham St\n- Chase solicitors on Fenchurch deal\n- Prep viewing schedule for Thursday\n- Follow up with Knight Frank on comparables"}
                  className="min-h-[160px] text-sm font-mono"
                  data-testid="textarea-evernote-import"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {evernoteText.split("\n").filter(l => l.trim().length > 2).length} items detected
                  </span>
                  <Button
                    size="sm"
                    onClick={importFromEvernote}
                    disabled={importingEvernote || !evernoteText.trim()}
                    data-testid="button-import-evernote"
                  >
                    {importingEvernote && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                    Import Tasks
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
