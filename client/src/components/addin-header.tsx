import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useTheme, COLOR_SCHEMES } from "@/components/theme-provider";
import { Check, Plus, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { pillMetrics } from "@/components/ui/pill";
import bgpLogoDark from "@assets/BGP_BlackHolder_1771853582461.png";
import bgpLogoLight from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";

interface AddinHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  onNewChat?: () => void;
}

export function AddinHeader({ title, subtitle, children, onNewChat }: AddinHeaderProps) {
  const { theme, toggleTheme, colorScheme, setColorScheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50 bg-card/80 backdrop-blur-sm shrink-0" data-testid="addin-header">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <img
          src={theme === "dark" ? bgpLogoLight : bgpLogoDark}
          alt="BGP"
          className="h-5 w-auto shrink-0"
          data-testid="addin-header-logo"
        />
        <h1 className="text-[15px] font-semibold tracking-tight leading-none">{title}</h1>
        {subtitle && (
          <span className={cn(pillMetrics, "border border-border text-muted-foreground max-w-full overflow-hidden text-ellipsis")}>{subtitle}</span>
        )}
      </div>
      {onNewChat && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full hover:bg-muted/80"
          onClick={onNewChat}
          title="New chat"
          data-testid="button-new-chat"
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      )}
      {children}
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-full hover:bg-muted/80"
          onClick={() => setSettingsOpen(!settingsOpen)}
          title="Settings"
          data-testid="button-settings-addin"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </Button>
        {settingsOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} />
            <div className="absolute right-0 top-full mt-1.5 z-50 bg-card border border-border/50 rounded-xl shadow-xl p-2 min-w-[160px]">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1">Colour</p>
              {COLOR_SCHEMES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setColorScheme(s.id); setSettingsOpen(false); }}
                  className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left text-[11px] hover:bg-muted/80 transition-colors ${colorScheme === s.id ? "bg-muted font-medium" : ""}`}
                  data-testid={`button-scheme-${s.id}-addin`}
                >
                  <div className="w-3 h-3 rounded-full border border-border/50 shrink-0" style={{ backgroundColor: s.color }} />
                  {s.label}
                  {colorScheme === s.id && <Check className="w-3 h-3 ml-auto text-primary" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
