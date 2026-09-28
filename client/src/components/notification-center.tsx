import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, AlertTriangle, AlertCircle, Info, Clock, ShieldAlert, PoundSterling, CalendarClock, CheckSquare, Receipt, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useState } from "react";

interface Notification {
  id: string;
  kind: "for_you" | "deal" | "firm";
  type: string;
  title: string;
  description: string;
  severity: "warning" | "info" | "urgent";
  createdAt: string;
  read: boolean;
  url?: string | null;
  dealId?: string;
}

const severityConfig: Record<string, { color: string; bg: string; icon: typeof AlertTriangle }> = {
  urgent: { color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30", icon: AlertCircle },
  warning: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", icon: AlertTriangle },
  info: { color: "text-muted-foreground", bg: "bg-muted", icon: Info },
};

const typeIcons: Record<string, typeof AlertTriangle> = {
  stuck_deal: Clock,
  no_fee: PoundSterling,
  kyc_gap: ShieldAlert,
  overdue_completion: CalendarClock,
  task: CheckSquare,
  expense: Receipt,
  receipt: Receipt,
};

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
  const markRead = useMutation({
    mutationFn: (ids: string[]) => apiRequest("POST", "/api/notifications/read", { ids }),
    onMutate: (ids: string[]) => {
      const cleared = new Set(ids);
      queryClient.setQueryData<Notification[]>(["/api/notifications"], (list = []) =>
        list.flatMap(n => !cleared.has(n.id) ? [n] : n.kind === "for_you" ? [{ ...n, read: true }] : []));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const forYou = notifications.filter(n => n.kind === "for_you");
  const deals = notifications.filter(n => n.kind === "deal");
  const firm = notifications.filter(n => n.kind === "firm");
  const unread = forYou.filter(n => !n.read);
  const count = unread.length + deals.length + firm.length;
  const urgent = [...deals, ...firm].some(n => n.severity === "urgent");

  const handleClick = (notification: Notification) => {
    if (notification.kind === "for_you" && !notification.read) markRead.mutate([notification.id]);
    const url = notification.url || (notification.dealId ? `/deals/${notification.dealId}` : null);
    if (url) navigate(url);
    setOpen(false);
  };

  const row = (notification: Notification) => {
    const sev = severityConfig[notification.severity] || severityConfig.info;
    const TypeIcon = typeIcons[notification.type] || (notification.kind === "for_you" ? Bell : sev.icon);
    const faded = notification.kind === "for_you" && notification.read;
    return (
      <div
        key={notification.id}
        onClick={() => handleClick(notification)}
        className={`group flex items-start gap-2.5 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${faded ? "opacity-60" : ""}`}
        data-testid={`notification-${notification.id}`}
      >
        <div className={`w-6 h-6 rounded-full ${sev.bg} flex items-center justify-center shrink-0 mt-0.5`}>
          <TypeIcon className={`w-3 h-3 ${sev.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-xs leading-tight ${faded ? "" : "font-medium"}`}>{notification.title}</p>
          {notification.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{notification.description}</p>}
          {notification.kind === "for_you" && <p className="text-[10px] text-muted-foreground/70 mt-0.5 tabular-nums">{ago(notification.createdAt)}</p>}
        </div>
        {notification.kind !== "for_you" ? (
          <button
            type="button"
            title="Clear for 2 weeks"
            aria-label="Clear"
            onClick={(event) => { event.stopPropagation(); markRead.mutate([notification.id]); }}
            className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-muted"
            data-testid={`notification-clear-${notification.id}`}
          >
            <X className="w-3 h-3" />
          </button>
        ) : !notification.read ? (
          <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 bg-blue-500" />
        ) : null}
      </div>
    );
  };

  const section = (label: string, items: Notification[], clearIds: string[], clearLabel: string) => (
    <div>
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
        {clearIds.length > 0 && (
          <button type="button" onClick={() => markRead.mutate(clearIds)} className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
            {clearLabel}
          </button>
        )}
      </div>
      <div className="divide-y">{items.map(row)}</div>
    </div>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid="button-notifications"
          className="relative inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors"
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className={`absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-medium tabular-nums ${urgent || unread.length ? "bg-red-500" : "bg-amber-500"}`}>
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {count > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{count} new</span>}
        </div>
        <div className="max-h-[min(70vh,480px)] overflow-y-auto overscroll-contain pb-1">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Bell className="w-8 h-8 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground">All clear. Tasks, invoice verdicts and alerts on your deals land here.</p>
            </div>
          ) : (
            <>
              {forYou.length > 0 && section("For you", forYou, unread.map(n => n.id), "Mark all read")}
              {deals.length > 0 && section("Your deals", deals, deals.map(n => n.id), "Clear all")}
              {firm.length > 0 && section("Firm-wide · KYC under offer or exchanged", firm, firm.map(n => n.id), "Clear all")}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
