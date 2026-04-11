import { Link } from "wouter";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="breadcrumb" className="mb-2">
      <ol className="flex items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={idx} className="inline-flex items-center gap-1">
              {idx > 0 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
              )}
              {isLast || !item.href ? (
                <span
                  className={
                    isLast
                      ? "font-medium text-foreground truncate max-w-[200px]"
                      : "truncate max-w-[200px]"
                  }
                >
                  {item.label}
                </span>
              ) : (
                <Link href={item.href}>
                  <span className="hover:text-foreground transition-colors cursor-pointer truncate max-w-[200px]">
                    {item.label}
                  </span>
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
