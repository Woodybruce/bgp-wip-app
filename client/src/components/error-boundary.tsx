import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
  /** Label for the section being protected — shown in the fallback so users can identify which panel broke. */
  name?: string;
  /** Render a compact one-line fallback instead of the full-screen one. Use when wrapping individual panels. */
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const label = this.props.name ? ` in "${this.props.name}"` : "";
    console.error(`[ErrorBoundary] Caught rendering error${label}:`, error, info.componentStack);

    // Stale-chunk recovery: after a deploy the open tab still references old
    // chunk hashes. A single hard reload fetches the new index.html and the
    // new asset hashes. Guard with sessionStorage so we don't reload-loop if
    // the network is genuinely down.
    const msg = String(error?.message || "");
    const isChunkError =
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Importing a module script failed/i.test(msg) ||
      /error loading dynamically imported module/i.test(msg) ||
      error?.name === "ChunkLoadError";
    if (isChunkError) {
      try {
        const KEY = "bgp:chunk-reload-attempted";
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.compact) {
        // Compact inline fallback: keeps the rest of the page rendering and
        // surfaces the actual error message so it can be triaged without
        // opening DevTools. Only the broken panel is taken out.
        const msg = this.state.error?.message || "Unknown error";
        const label = this.props.name || "This panel";
        return (
          <div className="border border-destructive/30 bg-destructive/5 rounded-md p-3 my-2 text-xs" data-testid="error-boundary-fallback">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-destructive">{label} couldn't render</p>
                <p className="text-muted-foreground font-mono break-all mt-0.5">{msg}</p>
                {this.props.fallbackMessage && (
                  <p className="text-muted-foreground mt-0.5">{this.props.fallbackMessage}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] shrink-0" onClick={this.handleReset}>
                <RefreshCw className="w-3 h-3 mr-1" /> Retry
              </Button>
            </div>
          </div>
        );
      }
      return (
        <div className="flex items-center justify-center min-h-[300px] p-8" data-testid="error-boundary-fallback">
          <div className="text-center space-y-4 max-w-md">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {this.props.name ? `${this.props.name} — something went wrong` : "Something went wrong"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {this.props.fallbackMessage || "This section encountered an unexpected error. You can try again or reload the page."}
            </p>
            {this.state.error?.message && (
              <p className="text-xs font-mono text-destructive/80 bg-destructive/5 border border-destructive/20 rounded p-2 max-w-md mx-auto break-all text-left">
                {this.state.error.message}
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={this.handleReset}
                data-testid="button-try-again"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Try again
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={this.handleReload}
                data-testid="button-reload-page"
              >
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
