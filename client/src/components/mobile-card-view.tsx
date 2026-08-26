import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, Inbox, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { useEffect } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

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
  /** Tap anywhere on the card (used where a detail opens in-page rather
      than at a route). Ignored when href is set. */
  onClick?: () => void;
  status?: string;
  statusColor?: string;
  fields: MobileCardField[];
  onEdit?: () => void;
  onDelete?: () => void;
  /** Optional extra control rendered in the action row (e.g. a download). */
  footer?: ReactNode;
};

function StatusDot({ color }: { color?: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${color || "bg-muted-foreground"}`}
    />
  );
}

export function MobileCardView({ items, emptyMessage, emptyIcon, emptyDescription }: { items: MobileCardItem[]; emptyMessage?: string; emptyIcon?: LucideIcon; emptyDescription?: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon || Inbox}
        title={emptyMessage || "No items found"}
        description={emptyDescription ?? "Try adjusting your filters"}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.id}
          onClick={item.onClick && !item.href ? item.onClick : undefined}
          className={`rounded-xl border bg-card p-4 space-y-3 shadow-sm ${item.onClick && !item.href ? "cursor-pointer active:bg-muted/40" : ""}`}
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
              .slice(0, 5)
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
          {(item.href || item.onEdit || item.onDelete || item.footer) && (
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
              {item.onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 px-3 text-xs gap-1.5 text-red-600 hover:text-red-700"
                  onClick={item.onDelete}
                  data-testid={`button-delete-card-${item.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </Button>
              )}
              {item.footer && <div className="ml-auto">{item.footer}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Toggle button for switching between table, card and board views.
 * On mobile (< 768px), defaults to board view.
 * On desktop, defaults to table view.
 */
export function ViewToggle({
  view,
  onToggle,
  showBoard = false,
}: {
  view: "table" | "card" | "board";
  onToggle: (view: "table" | "card" | "board") => void;
  showBoard?: boolean;
}) {
  // Tables never ship to the phone (DESIGN.md §6) — hide the Table option
  // below md and snap any lingering "table" state back to cards, so no page
  // using this toggle can leak its desktop table onto a phone.
  const isMobile = useIsMobile();
  useEffect(() => {
    if (isMobile && view === "table") onToggle("card");
  }, [isMobile, view, onToggle]);

  const options: { key: "table" | "card" | "board"; label: string }[] = [
    ...(isMobile ? [] : [{ key: "table" as const, label: "Table" }]),
    { key: "card", label: "Cards" },
    ...(showBoard ? [{ key: "board" as const, label: "Board" }] : []),
  ];

  return (
    <div className="inline-flex items-center gap-1.5">
      {options.map((opt) => (
        <Pill
          key={opt.key}
          active={view === opt.key}
          onClick={() => onToggle(opt.key)}
          data-testid={`button-view-${opt.key}`}
        >
          {opt.label}
        </Pill>
      ))}
    </div>
  );
}
