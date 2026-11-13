import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGoBack } from "@/lib/go-back";

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
 * Drop-in back button for a detail page: the screen before, or `fallback`
 * (the page's parent) when the page was opened from a pasted link. The
 * rule itself is in `@/lib/go-back`.
 */
export function SmartBack({ fallback, label = "Back", className, testId }: SmartBackProps) {
  const goBack = useGoBack(fallback);
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`gap-1.5 text-muted-foreground hover:text-foreground -ml-2 ${className || ""}`}
      onClick={goBack}
      data-testid={testId || "smart-back"}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      {label}
    </Button>
  );
}
