// The folder engine's dialogs: a dialog on a computer, a bottom sheet on a
// phone (docs/DESIGN.md §11), never the browser's prompt or confirm boxes.
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

export function FolderDialog({ open, onOpenChange, title, description, children, footer, testId, size = "md" }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
  size?: "sm" | "md" | "lg";
}) {
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex flex-col max-h-[92dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] gap-3" data-testid={testId}>
          <SheetHeader className="shrink-0 text-left pr-8">
            <SheetTitle className="break-words">{title}</SheetTitle>
            {description ? <SheetDescription>{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          {footer ? <div className="shrink-0 flex flex-wrap justify-end gap-2">{footer}</div> : null}
        </SheetContent>
      </Sheet>
    );
  }
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-2xl";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`flex flex-col ${width} max-h-[85dvh] gap-3`} data-testid={testId}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="break-words">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">{children}</div>
        {footer ? <div className="shrink-0 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </DialogContent>
    </Dialog>
  );
}
