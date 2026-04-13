import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { LogIn, Loader2, Eye, EyeOff } from "lucide-react";
import bgpLogo from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";

interface LoginPageProps {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoCode = params.get("sso_code");
    const ssoError = params.get("sso_error");

    if (ssoCode) {
      window.history.replaceState({}, "", window.location.pathname);
      setIsSsoLoading(true);
      fetch("/api/auth/sso-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: ssoCode }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.token) {
            localStorage.setItem("bgp_auth_token", data.token);
            onLogin();
          } else {
            toast({
              title: "Microsoft sign-in failed",
              description: data.message || "Could not complete sign-in.",
              variant: "destructive",
            });
            setIsSsoLoading(false);
          }
        })
        .catch(() => {
          toast({
            title: "Microsoft sign-in failed",
            description: "Could not complete sign-in. Please try again.",
            variant: "destructive",
          });
          setIsSsoLoading(false);
        });
    } else if (ssoError) {
      toast({
        title: "Microsoft sign-in failed",
        description: decodeURIComponent(ssoError),
        variant: "destructive",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsLoading(true);

    try {
      const res = await apiRequest("POST", "/api/auth/login", { username: username.toLowerCase(), password });
      const data = await res.json();
      if (data.token) {
        localStorage.setItem("bgp_auth_token", data.token);
      }
      onLogin();
    } catch (err: any) {
      const msg = err?.message || "";
      const isNetwork = msg.includes("Failed to fetch") || msg.includes("Load failed") || msg.includes("NetworkError");
      toast({
        title: isNetwork ? "Connection error" : "Login failed",
        description: isNetwork
          ? "Could not reach the server. Check your internet connection and try again."
          : "Invalid email or password. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleMicrosoftLogin() {
    setIsSsoLoading(true);

    type SsoOutcome =
      | { kind: "redirected" }
      | { kind: "server_error"; status: number; message: string }
      | { kind: "network_error" };

    async function attemptSso(): Promise<SsoOutcome> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch("/api/auth/microsoft", {
          credentials: "include",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          let message = text;
          try { message = JSON.parse(text).message || text; } catch {}
          console.error("[login] SSO request failed:", res.status, text);
          return { kind: "server_error", status: res.status, message: message || `HTTP ${res.status}` };
        }
        const data = await res.json();
        if (data.authUrl) {
          window.location.href = data.authUrl;
          return { kind: "redirected" };
        }
        return { kind: "server_error", status: 200, message: data.message || "Could not start Microsoft login." };
      } catch (err: any) {
        clearTimeout(timeout);
        console.error("[login] SSO fetch error:", err?.message || err);
        return { kind: "network_error" };
      }
    }

    let outcome = await attemptSso();
    if (outcome.kind === "network_error") {
      await new Promise(r => setTimeout(r, 1500));
      outcome = await attemptSso();
    }

    if (outcome.kind === "redirected") return;

    if (outcome.kind === "server_error") {
      toast({
        title: "Microsoft sign-in unavailable",
        description: outcome.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Connection error",
        description: "Could not reach the server. Check your internet connection and try again.",
        variant: "destructive",
      });
    }
    setIsSsoLoading(false);
  }

  return (
    <div className="min-h-screen flex" data-testid="card-login">
      <div className="hidden lg:flex lg:w-1/2 bg-black items-center justify-center p-12">
        <img src={bgpLogo} alt="Bruce Gillingham Pollard" className="max-w-[500px] w-full" />
      </div>
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-neutral-950 p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex justify-center mb-8">
            <div className="bg-black p-6 rounded-lg">
              <img src={bgpLogo} alt="Bruce Gillingham Pollard" className="h-20 w-auto" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-light tracking-tight text-neutral-900 dark:text-white" data-testid="text-login-title">
              Sign in
            </h1>
            <p className="text-sm text-neutral-500">
              BGP Property Dashboard
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full h-12 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900 font-normal tracking-wide"
            onClick={handleMicrosoftLogin}
            disabled={isSsoLoading}
            data-testid="button-microsoft-login"
          >
            {isSsoLoading ? (
              <Loader2 className="w-4 h-4 mr-3 animate-spin" />
            ) : (
              <svg className="w-5 h-5 mr-3" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
            )}
            Sign in with Microsoft
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-neutral-200 dark:border-neutral-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-neutral-950 px-3 text-neutral-400">or</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs uppercase tracking-wider text-neutral-500">Email</Label>
              <Input
                id="username"
                data-testid="input-username"
                type="email"
                placeholder="name@brucegillinghampollard.com"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="email"
                className="h-11 border-neutral-200 dark:border-neutral-800"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider text-neutral-500">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="h-11 pr-10 border-neutral-200 dark:border-neutral-800"
                />
                <button
                  type="button"
                  data-testid="button-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-11 bg-black hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black font-normal tracking-wide"
              disabled={isLoading || !username || !password}
              data-testid="button-login"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4 mr-2" />
              )}
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
