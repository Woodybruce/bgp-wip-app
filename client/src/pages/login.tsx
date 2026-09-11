import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import bgpLogo from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";

interface LoginPageProps {
  onLogin: () => void;
}

// Two login paths: Microsoft 365 SSO for BGP staff, and an email/password
// form for clients and guests without a @brucegillinghampollard.com
// Microsoft account (e.g. Landsec users). The guest form is collapsed
// behind a button so staff still default to SSO; it posts to the
// long-standing /api/auth/login endpoint.
export default function LoginPage({ onLogin }: LoginPageProps) {
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const [showGuest, setShowGuest] = useState(false);
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPassword, setGuestPassword] = useState("");
  const [isGuestLoading, setIsGuestLoading] = useState(false);
  const { toast } = useToast();

  async function handleGuestLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!guestEmail.trim() || !guestPassword) return;
    setIsGuestLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: guestEmail.trim(), password: guestPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        localStorage.setItem("bgp_auth_token", data.token);
        onLogin();
        return;
      }
      toast({
        title: "Sign-in failed",
        description: data.message || "Check your email and password and try again.",
        variant: "destructive",
      });
    } catch {
      toast({
        title: "Connection error",
        description: "Could not reach the server. Check your internet connection and try again.",
        variant: "destructive",
      });
    }
    setIsGuestLoading(false);
  }

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
        .then((res) => res.json())
        .then((data) => {
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
      await new Promise((r) => setTimeout(r, 1500));
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
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
            )}
            Sign in with Microsoft
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-800" />
            <span className="text-[11px] uppercase tracking-wide text-neutral-400">or</span>
            <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-800" />
          </div>

          {!showGuest ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full h-10 font-normal text-neutral-600 dark:text-neutral-300"
              onClick={() => setShowGuest(true)}
              data-testid="button-show-guest-login"
            >
              Client / guest sign in
            </Button>
          ) : (
            <form onSubmit={handleGuestLogin} className="space-y-3" data-testid="form-guest-login">
              <Input
                type="email"
                autoComplete="email"
                placeholder="Email address"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                autoFocus
                data-testid="input-guest-email"
              />
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={guestPassword}
                onChange={(e) => setGuestPassword(e.target.value)}
                data-testid="input-guest-password"
              />
              <Button
                type="submit"
                className="w-full h-10"
                disabled={isGuestLoading || !guestEmail.trim() || !guestPassword}
                data-testid="button-guest-login"
              >
                {isGuestLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Sign in
              </Button>
              <p className="text-[11px] text-center text-neutral-500">
                For clients and guests without a BGP Microsoft account.<br />
                No login yet? Ask your BGP contact to set one up.
              </p>
            </form>
          )}

          <p className="text-[11px] text-center text-neutral-500 pt-2">
            BGP staff — use your @brucegillinghampollard.com Microsoft account.<br />
            New starters — ask IT to provision your Entra account.
          </p>
        </div>
      </div>
    </div>
  );
}
