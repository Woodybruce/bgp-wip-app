import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, Pencil } from "lucide-react";
import { Link } from "wouter";

export type MobileCardField = {
  label: string;
  value: string | number | null | undefined;
  badge?: boolean;
  badgeColor?: string;
};

export type MobileCardItem = {
  id: string;
  title: string;
  subtitle?: string;
  href?: string;
  status?: string;
  statusColor?: string;
  fields: MobileCardField[];
  onEdit?: () => void;
};

function StatusDot({ color }: { color?: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${color || "bg-muted-foreground"}`}
    />
  );
}

export function MobileCardView({ items, emptyMessage }: { items: MobileCardItem[]; emptyMessage?: string }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">{emptyMessage || "No items found"}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border bg-card p-4 space-y-3 shadow-sm"
          data-testid={`mobile-card-${item.id}`}
        >
          {/* Card header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {item.href ? (
                <Link href={item.href}>
                  <span className="text-sm font-semibold leading-tight hover:underline cursor-pointer block truncate">
                    {item.title}
                  </span>
                </Link>
              ) : (
                <span className="text-sm font-semibold leading-tight block truncate">
                  {item.title}
                </span>
              )}
              {item.subtitle && (
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {item.subtitle}
                </p>
              )}
            </div>
            {item.status && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] px-2 py-0.5 gap-1.5"
              >
                <StatusDot color={item.statusColor} />
                {item.status}
              </Badge>
            )}
          </div>

          {/* Key fields */}
          <div className="space-y-1.5">
            {item.fields
              .filter((f) => f.value != null && f.value !== "")
              .slice(0, 6)
              .map((field, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-muted-foreground shrink-0">
                    {field.label}
                  </span>
                  {field.badge ? (
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${field.badgeColor || ""}`}
                    >
                      {String(field.value)}
                    </Badge>
                  ) : (
                    <span className="font-medium truncate text-right">
                      {String(field.value)}
                    </span>
                  )}
                </div>
              ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-1 border-t">
            {item.href && (
              <Link href={item.href}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-xs gap-1.5"
                  data-testid={`button-view-card-${item.id}`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  View
                </Button>
              </Link>
            )}
            {item.onEdit && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-3 text-xs gap-1.5"
                onClick={item.onEdit}
                data-testid={`button-edit-card-${item.id}`}
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Toggle button for switching between table and card views.
 * On mobile (< 768px), defaults to card view.
 * On desktop, defaults to table view.
 */
export function ViewToggle({
  view,
  onToggle,
}: {
  view: "table" | "card";
  onToggle: (view: "table" | "card") => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg border bg-card p-0.5 gap-0.5">
      <button
        onClick={() => onToggle("table")}
        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
          view === "table"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
        data-testid="button-view-table"
      >
        Table
      </button>
      <button
        onClick={() => onToggle("card")}
        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
          view === "card"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
        data-testid="button-view-card"
      >
        Cards
      </button>
    </div>
  );
}
