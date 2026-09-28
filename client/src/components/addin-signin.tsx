import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Same storage every Office pane uses, so signing in once covers them all.
export const ADDIN_TOKEN_KEY = "bgp_addin_token";
export const ADDIN_USER_KEY = "bgp_addin_user";

// Sign-in card shared by the Outlook, Word and PowerPoint panes.
// Microsoft SSO opens the existing /api/auth/microsoft flow in an Office
// dialog; the completion page posts back a one-time code we swap for a
// bearer token. Email/password is the fallback for guests and dev.
export function AddinSignIn({ onLogin, purpose }: { onLogin: (token: string, name: string) => void; purpose?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  const signInWithMicrosoft = () => {
    setError("");
    const OfficeRef = (window as any).Office;
    if (!OfficeRef?.context?.ui?.displayDialogAsync) {
      setError("Microsoft sign-in needs to run inside the Office task pane — use email + password here.");
      return;
    }
    setMsLoading(true);
    const url = `${window.location.origin}/api/auth/microsoft?addin=1`;
    OfficeRef.context.ui.displayDialogAsync(url, { height: 60, width: 30, promptBeforeOpen: false }, (result: any) => {
      if (result.status !== "succeeded" || !result.value) {
        setMsLoading(false);
        setError("Couldn't open the Microsoft sign-in window.");
        return;
      }
      const dialog = result.value;
      const finish = () => { try { dialog.close(); } catch {} setMsLoading(false); };
      dialog.addEventHandler(OfficeRef.EventType.DialogMessageReceived, async (arg: any) => {
        let msg: any = {};
        try { msg = JSON.parse(arg.message || "{}"); } catch {}
        if (msg.sso_code) {
          finish();
          try {
            const r = await fetch("/api/auth/sso-exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ code: msg.sso_code }),
            });
            const data = await r.json();
            if (r.ok && data.token) onLogin(data.token, data.name || data.username || "");
            else setError(data.message || "Microsoft sign-in failed.");
          } catch { setError("Microsoft sign-in failed. Please try again."); }
        } else {
          finish();
          setError(msg.error || "Microsoft sign-in was cancelled.");
        }
      });
      dialog.addEventHandler(OfficeRef.EventType.DialogEventReceived, () => { finish(); });
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setError(data.message || "Login failed");
        setLoading(false);
        return;
      }
      onLogin(data.token, data.name || data.username || email);
    } catch {
      setError("Login failed. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-3" data-testid="outlook-addin-login">
      <p className="text-sm text-muted-foreground">{purpose || "Sign in to use ChatBGP."}</p>
      <Button className="w-full h-9" variant="outline" onClick={signInWithMicrosoft} disabled={msLoading} data-testid="button-outlook-ms-login">
        {msLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
        Sign in with Microsoft
      </Button>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-wider">
        <div className="flex-1 border-t" /> or <div className="flex-1 border-t" />
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-sm" data-testid="input-outlook-email" />
        <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-9 text-sm" data-testid="input-outlook-password" />
        <Button type="submit" className="w-full h-9" disabled={loading} data-testid="button-outlook-login">
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Sign in
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}


// Token + sign-in state for a pane. Also mirrors the token into the main
// app's key so panes that call getAuthHeaders() are signed in too.
export function useAddinAuth() {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem(ADDIN_TOKEN_KEY) || localStorage.getItem("bgp_auth_token"); } catch { return null; }
  });
  const [userName, setUserName] = useState(() => {
    try { return localStorage.getItem(ADDIN_USER_KEY) || ""; } catch { return ""; }
  });
  const login = (t: string, name: string) => {
    setToken(t);
    setUserName(name);
    try {
      localStorage.setItem(ADDIN_TOKEN_KEY, t);
      localStorage.setItem(ADDIN_USER_KEY, name);
      localStorage.setItem("bgp_auth_token", t);
    } catch {}
  };
  const logout = () => {
    setToken(null);
    setUserName("");
    try {
      localStorage.removeItem(ADDIN_TOKEN_KEY);
      localStorage.removeItem(ADDIN_USER_KEY);
      localStorage.removeItem("bgp_auth_token");
    } catch {}
  };
  return { token, userName, login, logout };
}
