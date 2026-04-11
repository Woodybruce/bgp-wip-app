import { useQuery } from "@tanstack/react-query";
import { Bell, AlertTriangle, AlertCircle, Info, Clock, ShieldAlert, PoundSterling, CalendarClock } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation } from "wouter";
import { useState } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: "warning" | "info" | "urgent";
  createdAt: string;
  dealId?: string;
  propertyId?: string;
}

const severityConfig: Record<string, { color: string; bg: string; icon: typeof AlertTriangle }> = {
  urgent: { color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30", icon: AlertCircle },
  warning: { color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-100 dark:bg-amber-900/30", icon: AlertTriangle },
  info: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30", icon: Info },
};

const typeIcons: Record<string, typeof AlertTriangle> = {
  stuck_deal: Clock,
  no_fee: PoundSterling,
  kyc_gap: ShieldAlert,
  overdue_completion: CalendarClock,
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const count = notifications.length;
  const urgentCount = notifications.filter(n => n.severity === "urgent").length;

  const handleClick = (notification: Notification) => {
    if (notification.dealId) {
      navigate(`/deals/${notification.dealId}`);
    } else if (notification.propertyId) {
      navigate(`/properties/${notification.propertyId}`);
    }
    setOpen(false);
  };

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
            <span className={`absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-medium ${urgentCount > 0 ? "bg-red-500" : "bg-amber-500"}`}>
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {count > 0 && (
            <span className="text-[10px] text-muted-foreground">{count} item{count !== 1 ? "s" : ""}</span>
          )}
        </div>
        <ScrollArea className="max-h-[400px]">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <Bell className="w-8 h-8 text-muted-foreground/20 mb-2" />
              <p className="text-xs text-muted-foreground">All clear — no notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((notification) => {
                const sev = severityConfig[notification.severity] || severityConfig.info;
                const TypeIcon = typeIcons[notification.type] || sev.icon;
                const isClickable = !!(notification.dealId || notification.propertyId);
                return (
                  <div
                    key={notification.id}
                    onClick={() => isClickable && handleClick(notification)}
                    className={`flex items-start gap-2.5 px-3 py-2.5 transition-colors ${isClickable ? "cursor-pointer hover:bg-muted/50" : ""}`}
                    data-testid={`notification-${notification.id}`}
                  >
                    <div className={`w-6 h-6 rounded-full ${sev.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                      <TypeIcon className={`w-3 h-3 ${sev.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">{notification.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{notification.description}</p>
                    </div>
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${notification.severity === "urgent" ? "bg-red-500" : notification.severity === "warning" ? "bg-amber-500" : "bg-blue-500"}`} />
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
