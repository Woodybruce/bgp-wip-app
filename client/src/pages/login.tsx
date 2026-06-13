import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import bgpLogo from "@assets/BGP_WhiteHolder.png_-_new_1771853582466.png";
import { useBrand } from "@/lib/brand-context";

interface LoginPageProps {
  onLogin: () => void;
}

// Single-method login: Microsoft 365 SSO only. The legacy email/password
// form has been removed from the UI — accounts must be Microsoft-backed.
// The /api/auth/login + /api/auth/register endpoints are intentionally
// left running on the server as an admin emergency fallback (curl-able
// if Entra is down or a new user can't yet provision) but they're not
// discoverable from the login screen.
export default function LoginPage({ onLogin }: LoginPageProps) {
  const [isSsoLoading, setIsSsoLoading] = useState(false);
  const { toast } = useToast();
  const { brand } = useBrand();
  const isBgp = brand.id === "bgp";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showRegister, setShowRegister] = useState(false);
  const [isPwLoading, setIsPwLoading] = useState(false);

  async function handlePasswordAuth(e: React.FormEvent) {
    e.preventDefault();
    setIsPwLoading(true);
    try {
      const endpoint = showRegister ? "/api/auth/register" : "/api/auth/login";
      const body = showRegister
        ? { name, email, password }
        : { username: email, password };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        localStorage.setItem("bgp_auth_token", data.token);
        onLogin();
        return;
      }
      toast({
        title: showRegister ? "Could not create account" : "Sign in failed",
        description: data.message || "Check your details and try again.",
        variant: "destructive",
      });
    } catch {
      toast({
        title: "Connection error",
        description: "Could not reach the server. Try again.",
        variant: "destructive",
      });
    }
    setIsPwLoading(false);
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
        {isBgp ? (
          <img src={bgpLogo} alt={brand.name} className="max-w-[500px] w-full" />
        ) : (
          <span className="font-serif text-white text-7xl tracking-tight">{brand.name}.</span>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-neutral-950 p-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="lg:hidden flex justify-center mb-8">
            <div className="bg-black p-6 rounded-lg">
              {isBgp ? (
                <img src={bgpLogo} alt={brand.name} className="h-20 w-auto" />
              ) : (
                <span className="font-serif text-white text-3xl tracking-tight">{brand.name}.</span>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-light tracking-tight text-neutral-900 dark:text-white" data-testid="text-login-title">
              Sign in
            </h1>
            <p className="text-sm text-neutral-500">
              {brand.headerText}
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

          {!isBgp && (
            <form onSubmit={handlePasswordAuth} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-neutral-200" />
                <span className="text-[11px] uppercase tracking-widest text-neutral-400">or</span>
                <div className="flex-1 border-t border-neutral-200" />
              </div>
              {showRegister && (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  className="w-full h-11 px-3 rounded-md border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                  data-testid="input-name"
                />
              )}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                autoComplete="username"
                className="w-full h-11 px-3 rounded-md border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                data-testid="input-email"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete={showRegister ? "new-password" : "current-password"}
                className="w-full h-11 px-3 rounded-md border border-neutral-200 text-sm focus:outline-none focus:ring-1 focus:ring-neutral-400"
                data-testid="input-password"
              />
              <Button type="submit" disabled={isPwLoading} className="w-full h-11" data-testid="button-password-login">
                {isPwLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : showRegister ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
              <button
                type="button"
                onClick={() => setShowRegister((v) => !v)}
                className="w-full text-[11px] text-neutral-500 hover:text-neutral-800"
              >
                {showRegister ? "Have an account? Sign in" : "First time? Create an account"}
              </button>
            </form>
          )}

          <p className="text-[11px] text-center text-neutral-500 pt-2">
            {isBgp ? (
              <>
                Use your @{brand.emailDomain} Microsoft account.<br />
                New starters — ask IT to provision your Entra account.
              </>
            ) : (
              <>Sign in with your {brand.name} {brand.emailDomain ? `@${brand.emailDomain}` : ""} account.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
