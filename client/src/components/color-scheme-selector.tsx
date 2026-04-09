import { useTheme, COLOR_SCHEMES } from "@/components/theme-provider";
import { Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Palette } from "lucide-react";

export function ColorSchemeSelector() {
  const { colorScheme, setColorScheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" data-testid="button-color-scheme">
          <Palette className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {COLOR_SCHEMES.map((scheme) => (
          <DropdownMenuItem
            key={scheme.id}
            onClick={() => setColorScheme(scheme.id)}
            className="flex items-center gap-2.5 cursor-pointer"
            data-testid={`button-scheme-${scheme.id}`}
          >
            <div
              className="w-4 h-4 rounded-full border border-border shrink-0"
              style={{ backgroundColor: scheme.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{scheme.label}</p>
              <p className="text-[10px] text-muted-foreground">{scheme.description}</p>
            </div>
            {colorScheme === scheme.id && (
              <Check className="w-3.5 h-3.5 text-primary shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
