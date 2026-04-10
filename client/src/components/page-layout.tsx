import { cn } from "@/lib/utils";

interface PageLayoutProps {
  title: string;
  subtitle?: string;
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
        <div className="border-b px-4 sm:px-6 py-4 flex-shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <div>
              <h1 className="text-xl font-semibold" data-testid="text-page-title">
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
            <div className="flex items-center gap-1 mt-3 -mb-4 pb-0">
              {tabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => onTabChange?.(tab.value)}
                  className={cn(
                    "text-sm px-3 py-2 rounded-t-md border-b-2 transition-colors font-medium",
                    activeTab === tab.value
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
                  )}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      ({tab.count})
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto flex flex-col">
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {actions}
          </div>
        )}
      </div>

      {/* Tabs bar */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 border-b -mt-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onTabChange?.(tab.value)}
              className={cn(
                "text-sm px-3 py-2 rounded-t-md border-b-2 transition-colors font-medium",
                activeTab === tab.value
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300"
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {children}
    </div>
  );
}
