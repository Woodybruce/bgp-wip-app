import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

interface SmartBackProps {
  /** Where to land if browser history is empty (e.g. a deep link opened
   *  in a fresh tab from an email). */
  fallback: string;
  /** Override button label. Defaults to "Back". */
  label?: string;
  /** Tailwind classes appended to the Button. */
  className?: string;
  testId?: string;
}

/**
 * Drop-in back button used across every detail page. Prefers
 * `window.history.back()` so the user lands on the list view they came
 * from with their search + filters intact (provided that list page
 * pushes its own URL state, which most of them don't yet — see batch 2).
 * Falls back to a static destination when there's no history.
 *
 * Replaces a fleet of `<Link href="/x">Back</Link>` buttons that hardcoded
 * a single destination regardless of where the user came from. Pattern
 * is the same shape already in use at property-detail.tsx:433 and
 * companies.tsx:1306 — extracted so the rest of the app stops
 * reinventing it.
 */
export function SmartBack({ fallback, label = "Back", className, testId }: SmartBackProps) {
  const [, navigate] = useLocation();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`gap-1.5 text-muted-foreground hover:text-foreground -ml-2 ${className || ""}`}
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
          window.history.back();
        } else {
          navigate(fallback);
        }
      }}
      data-testid={testId || "smart-back"}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {label}
    </Button>
  );
}
