import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Check, Circle, Clock, AlertTriangle, Plus,
  ChevronRight, BarChart3, Sparkles, CalendarDays,
  ListTodo, Sun, CheckCircle2,
} from "lucide-react";
import type { User } from "@shared/schema";

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string | null;
  due_date: string | null;
  deal_name: string | null;
  property_name: string | null;
  contact_name: string | null;
  created_at: string;
}

interface DealSummary {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  property_name: string | null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

const PRIORITY_ICON: Record<string, typeof AlertTriangle> = {
  urgent: AlertTriangle,
  high: AlertTriangle,
  medium: Clock,
  low: Circle,
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "text-red-500",
  high: "text-orange-500",
  medium: "text-amber-500",
  low: "text-[#A8A29E]",
};

export default function TodayPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);

  const { data: user } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: tasks = [], isLoading: tasksLoading } = useQuery<Task[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: deals = [] } = useQuery<DealSummary[]>({
    queryKey: ["/api/crm/deals?limit=5&sort=updated"],
  });

  const { data: stats } = useQuery<{ totalDeals: number; activeDeals: number; totalContacts: number; totalProperties: number }>({
    queryKey: ["/api/crm/stats"],
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => apiRequest("PATCH", `/api/tasks/${id}`, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
  });

  const addTaskMutation = useMutation({
    mutationFn: (title: string) => apiRequest("POST", "/api/tasks", { title, priority: "medium" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setNewTaskTitle("");
      setShowAddTask(false);
      toast({ title: "Task added" });
    },
  });

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const pendingTasks = tasks.filter(t => t.status !== "done");
  const todayTasks = pendingTasks.filter(t => t.due_date && t.due_date.split("T")[0] === todayStr);
  const overdueTasks = pendingTasks.filter(t => t.due_date && t.due_date.split("T")[0] < todayStr);
  const upcomingTasks = pendingTasks.filter(t => !t.due_date || t.due_date.split("T")[0] > todayStr);
  const completedToday = tasks.filter(t => t.status === "done");

  const firstName = user?.name?.split(" ")[0] || "";

  return (
    <div className="min-h-screen bg-[#FAF9F7] dark:bg-background pb-24">
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Sun className="w-5 h-5 text-amber-400" />
          <span className="text-[13px] font-medium text-[#78716C] tracking-wide uppercase">
            {formatDate(today)}
          </span>
        </div>
        <h1 className="text-[28px] font-bold text-[#1C1917] dark:text-white tracking-tight leading-tight">
          {getGreeting()}{firstName ? `, ${firstName}` : ""}
        </h1>
      </div>

      {/* Quick Stats */}
      <div className="px-5 pb-4">
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => navigate("/deals")}
            className="bg-white dark:bg-card border border-[#E7E5E4]/60 rounded-2xl p-3.5 text-left active:bg-[#F5F5F4]"
          >
            <BarChart3 className="w-5 h-5 text-[#78716C] mb-2" />
            <div className="text-[22px] font-bold text-[#1C1917] dark:text-white tracking-tight">
              {stats?.activeDeals ?? "—"}
            </div>
            <div className="text-[11px] font-medium text-[#A8A29E] uppercase tracking-wide">Active Deals</div>
          </button>
          <button
            onClick={() => setShowAddTask(true)}
            className="bg-white dark:bg-card border border-[#E7E5E4]/60 rounded-2xl p-3.5 text-left active:bg-[#F5F5F4]"
          >
            <ListTodo className="w-5 h-5 text-[#78716C] mb-2" />
            <div className="text-[22px] font-bold text-[#1C1917] dark:text-white tracking-tight">
              {pendingTasks.length}
            </div>
            <div className="text-[11px] font-medium text-[#A8A29E] uppercase tracking-wide">Open Tasks</div>
          </button>
          <button
            onClick={() => navigate("/chatbgp")}
            className="bg-white dark:bg-card border border-[#E7E5E4]/60 rounded-2xl p-3.5 text-left active:bg-[#F5F5F4]"
          >
            <Sparkles className="w-5 h-5 text-[#78716C] mb-2" />
            <div className="text-[22px] font-bold text-[#1C1917] dark:text-white tracking-tight">
              {completedToday.length}
            </div>
            <div className="text-[11px] font-medium text-[#A8A29E] uppercase tracking-wide">Done Today</div>
          </button>
        </div>
      </div>

      {/* Overdue Tasks */}
      {overdueTasks.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h2 className="text-[15px] font-semibold text-red-600 dark:text-red-400">
              Overdue ({overdueTasks.length})
            </h2>
          </div>
          <div className="space-y-2">
            {overdueTasks.slice(0, 5).map(task => (
              <TaskCard key={task.id} task={task} onComplete={() => completeMutation.mutate(task.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Today's Tasks */}
      <div className="px-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[#78716C]" />
            <h2 className="text-[15px] font-semibold text-[#1C1917] dark:text-white">
              Today's Tasks
            </h2>
          </div>
          <button
            onClick={() => setShowAddTask(!showAddTask)}
            className="w-8 h-8 rounded-full bg-[#1C1917] dark:bg-white flex items-center justify-center active:opacity-80"
          >
            <Plus className="w-4 h-4 text-white dark:text-[#1C1917]" />
          </button>
        </div>

        {/* Quick Add */}
        {showAddTask && (
          <div className="flex gap-2 mb-3">
            <input
              autoFocus
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && newTaskTitle.trim()) addTaskMutation.mutate(newTaskTitle.trim()); }}
              placeholder="Add a task..."
              className="flex-1 h-11 px-4 text-[15px] rounded-xl bg-white dark:bg-card border border-[#E7E5E4] placeholder:text-[#A8A29E] focus:outline-none focus:ring-2 focus:ring-[#1C1917]/20"
            />
            <button
              onClick={() => newTaskTitle.trim() && addTaskMutation.mutate(newTaskTitle.trim())}
              disabled={!newTaskTitle.trim() || addTaskMutation.isPending}
              className="h-11 px-4 rounded-xl bg-[#1C1917] dark:bg-white text-white dark:text-[#1C1917] text-[14px] font-semibold disabled:opacity-40 active:opacity-80"
            >
              Add
            </button>
          </div>
        )}

        {tasksLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-[#E7E5E4] border-t-[#1C1917] rounded-full animate-spin" />
          </div>
        ) : todayTasks.length === 0 && overdueTasks.length === 0 && upcomingTasks.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle2 className="w-10 h-10 text-[#D6D3D1] mx-auto mb-3" />
            <p className="text-[15px] text-[#A8A29E] font-medium">No tasks yet</p>
            <p className="text-[13px] text-[#D6D3D1] mt-1">Tap + to add your first task</p>
          </div>
        ) : (
          <div className="space-y-2">
            {todayTasks.length > 0 ? todayTasks.map(task => (
              <TaskCard key={task.id} task={task} onComplete={() => completeMutation.mutate(task.id)} />
            )) : overdueTasks.length === 0 && (
              <div className="text-center py-6">
                <p className="text-[13px] text-[#A8A29E]">Nothing due today</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upcoming Tasks */}
      {upcomingTasks.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-[#78716C]" />
            <h2 className="text-[15px] font-semibold text-[#1C1917] dark:text-white">
              Upcoming ({upcomingTasks.length})
            </h2>
          </div>
          <div className="space-y-2">
            {upcomingTasks.slice(0, 5).map(task => (
              <TaskCard key={task.id} task={task} onComplete={() => completeMutation.mutate(task.id)} />
            ))}
            {upcomingTasks.length > 5 && (
              <button
                onClick={() => navigate("/tasks")}
                className="w-full py-2.5 text-[13px] font-medium text-[#78716C] active:text-[#1C1917]"
              >
                View all {upcomingTasks.length} tasks
              </button>
            )}
          </div>
        </div>
      )}

      {/* Recent Deals Activity */}
      {Array.isArray(deals) && deals.length > 0 && (
        <div className="px-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#78716C]" />
              <h2 className="text-[15px] font-semibold text-[#1C1917] dark:text-white">Recent Deals</h2>
            </div>
            <button
              onClick={() => navigate("/deals")}
              className="text-[13px] font-medium text-[#78716C] active:text-[#1C1917]"
            >
              See all
            </button>
          </div>
          <div className="space-y-2">
            {deals.slice(0, 4).map((deal: any) => (
              <button
                key={deal.id}
                onClick={() => navigate(`/deals/${deal.id}`)}
                className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-card border border-[#E7E5E4]/60 rounded-2xl text-left active:bg-[#F5F5F4]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold text-[#1C1917] dark:text-white truncate tracking-tight">
                    {deal.name}
                  </div>
                  <div className="text-[12px] text-[#A8A29E] truncate mt-0.5">
                    {deal.property_name || deal.propertyName || deal.status || ""}
                  </div>
                </div>
                <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0 ${
                  deal.status === "Active" || deal.status === "active" ? "bg-emerald-50 text-emerald-600" :
                  deal.status === "Under Offer" ? "bg-amber-50 text-amber-600" :
                  "bg-[#F5F5F4] text-[#78716C]"
                }`}>
                  {deal.status}
                </span>
                <ChevronRight className="w-4 h-4 text-[#D6D3D1] shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onComplete }: { task: Task; onComplete: () => void }) {
  const PriorityIcon = PRIORITY_ICON[task.priority] || Circle;
  const priorityColor = PRIORITY_COLOR[task.priority] || "text-[#A8A29E]";

  return (
    <div className="flex items-start gap-3 p-3.5 bg-white dark:bg-card border border-[#E7E5E4]/60 rounded-2xl">
      <button
        onClick={onComplete}
        className="mt-0.5 w-6 h-6 rounded-full border-2 border-[#D6D3D1] flex items-center justify-center shrink-0 active:bg-emerald-50 active:border-emerald-400"
      >
        <Check className="w-3.5 h-3.5 text-transparent" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-medium text-[#1C1917] dark:text-white leading-snug tracking-tight">
          {task.title}
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <PriorityIcon className={`w-3.5 h-3.5 ${priorityColor}`} />
          <span className={`text-[11px] font-medium ${priorityColor}`}>
            {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
          </span>
          {task.due_date && (
            <span className="text-[11px] text-[#A8A29E]">
              {new Date(task.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
          {(task.deal_name || task.property_name) && (
            <span className="text-[11px] text-[#A8A29E] truncate max-w-[150px]">
              {task.deal_name || task.property_name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
