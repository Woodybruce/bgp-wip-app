import { cn } from "@/lib/utils";

interface StandardCardProps {
  title?: string;
  subtitle?: string;
  badge?: { text: string; variant: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

const BADGE_VARIANT_CLASSES: Record<string, string> = {
  pipeline: "bg-blue-100 text-blue-800",
  wip: "bg-amber-100 text-amber-800",
  invoiced: "bg-green-100 text-green-800",
  dead: "bg-gray-100 text-gray-500",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  default: "bg-gray-100 text-gray-700",
};

export function StandardCard({
  title,
  subtitle,
  badge,
  actions,
  children,
  className,
  noPadding = false,
}: StandardCardProps) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-card border border-gray-200 dark:border-border rounded-lg",
        "hover:border-gray-300 dark:hover:border-border hover:shadow-sm transition-all",
        className
      )}
    >
      {(title || subtitle || badge || actions) && (
        <div className="bg-gray-50 dark:bg-muted/50 border-b px-4 py-3 rounded-t-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              {title && (
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {title}
                </h3>
              )}
              {subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {subtitle}
                </p>
              )}
            </div>
            {badge && (
              <span
                className={cn(
                  "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0",
                  BADGE_VARIANT_CLASSES[badge.variant] || BADGE_VARIANT_CLASSES.default
                )}
              >
                {badge.text}
              </span>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
            </div>
          )}
        </div>
      )}
      <div className={cn(!noPadding && "p-4")}>
        {children}
      </div>
    </div>
  );
}
