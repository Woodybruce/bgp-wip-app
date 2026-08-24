import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/pill";
import type { LucideIcon } from "lucide-react";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
  /** Accepted for compatibility; the standard header is title + subtitle only (docs/DESIGN.md §5) */
  icon?: LucideIcon;
  actions?: React.ReactNode;
  tabs?: { label: string; value: string; count?: number }[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  children: React.ReactNode;
  className?: string;
  /** Use flex-col layout with h-full instead of space-y padding layout */
  fullHeight?: boolean;
  /** data-testid for the root element */
  testId?: string;
}

export function PageLayout({
  title,
  subtitle,
  icon: Icon,
  actions,
  tabs,
  activeTab,
  onTabChange,
  children,
  className,
  fullHeight = false,
  testId,
}: PageLayoutProps) {
  if (fullHeight) {
    return (
      <div
        className={cn("h-full flex flex-col", className)}
        data-testid={testId}
      >
        {/* Header */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-6 flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {actions}
              </div>
            )}
          </div>

          {/* Tabs bar */}
          {tabs && tabs.length > 0 && (
            <div className="flex items-center flex-wrap gap-1.5 mt-3">
              {tabs.map((tab) => (
                <Pill
                  key={tab.value}
                  active={activeTab === tab.value}
                  onClick={() => onTabChange?.(tab.value)}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="font-mono normal-case opacity-70">{tab.count}</span>
                  )}
                </Pill>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col px-4 sm:px-6 pb-4 sm:pb-6 pt-4">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("p-4 sm:p-6 space-y-4", className)}
      data-testid={testId}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            {title}
          </h1>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:flex-shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Tabs bar */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5 -mt-1">
          {tabs.map((tab) => (
            <Pill
              key={tab.value}
              active={activeTab === tab.value}
              onClick={() => onTabChange?.(tab.value)}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="font-mono normal-case opacity-70">{tab.count}</span>
              )}
            </Pill>
          ))}
        </div>
      )}

      {/* Content */}
      {children}
    </div>
  );
}
