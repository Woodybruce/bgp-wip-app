import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Same storage every Office pane uses, so signing in once covers them all.
export const ADDIN_TOKEN_KEY = "bgp_addin_token";
export const ADDIN_USER_KEY = "bgp_addin_user";

// Outlook can wipe a pane's localStorage between sessions ("it doesn't
// stay", Will, 2026-10-13), so in Outlook the sign-in is also kept in the
// add-in's roaming settings, which live with the user's own mailbox.
const roaming = () => { try { return (window as any).Office?.context?.roamingSettings || null; } catch { return null; } };
export function saveAddinSignIn(token: string | null, name: string) {
  const rs = roaming();
  if (!rs) return;
  try {
    if (token) { rs.set(ADDIN_TOKEN_KEY, token); rs.set(ADDIN_USER_KEY, name); }
    else { rs.remove(ADDIN_TOKEN_KEY); rs.remove(ADDIN_USER_KEY); }
    rs.saveAsync(() => {});
  } catch {}
}
export function readAddinSignIn(): { token: string; name: string } | null {
  const rs = roaming();
  try {
    const token = rs?.get(ADDIN_TOKEN_KEY);
    return token ? { token: String(token), name: String(rs.get(ADDIN_USER_KEY) || "") } : null;
  } catch { return null; }
}

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
    // The pane also polls with a random nonce: Outlook can block the sign-in
    // window from posting back ("Couldn't return to the add-in").
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const url = `${window.location.origin}/api/auth/microsoft?addin=1&nonce=${nonce}`;
    let done = false;
    let dialog: any = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const stopPolling = () => { if (poll) { clearInterval(poll); poll = null; } };
    const finish = () => { stopPolling(); try { dialog?.close(); } catch {} setMsLoading(false); };
    const exchange = async (code: string) => {
      if (done) return;
      done = true;
      finish();
      try {
        const r = await fetch("/api/auth/sso-exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ code }),
        });
        const data = await r.json();
        if (r.ok && data.token) onLogin(data.token, data.name || data.username || "");
        else setError(data.message || "Microsoft sign-in failed.");
      } catch { setError("Microsoft sign-in failed. Please try again."); }
    };
    const started = Date.now();
    poll = setInterval(async () => {
      if (done || Date.now() - started > 5 * 60_000) { stopPolling(); if (!done) setMsLoading(false); return; }
      try {
        const r = await fetch(`/api/auth/addin-sso-poll?nonce=${nonce}`, { credentials: "include" });
        const j = await r.json();
        if (j?.code) void exchange(j.code);
      } catch {}
    }, 1500);
    OfficeRef.context.ui.displayDialogAsync(url, { height: 60, width: 30, promptBeforeOpen: false }, (result: any) => {
      if (result.status !== "succeeded" || !result.value) {
        finish();
        setError("Couldn't open the Microsoft sign-in window.");
        return;
      }
      dialog = result.value;
      dialog.addEventHandler(OfficeRef.EventType.DialogMessageReceived, (arg: any) => {
        let msg: any = {};
        try { msg = JSON.parse(arg.message || "{}"); } catch {}
        if (msg.sso_code) void exchange(msg.sso_code);
        else if (!done) { done = true; finish(); setError(msg.error || "Microsoft sign-in was cancelled."); }
      });
      // Closing the window: keep polling briefly in case sign-in finished
      // but the window couldn't post back.
      dialog.addEventHandler(OfficeRef.EventType.DialogEventReceived, () => {
        setTimeout(() => { if (!done) finish(); }, 6000);
      });
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
    try { return localStorage.getItem(ADDIN_TOKEN_KEY) || localStorage.getItem("bgp_auth_token") || readAddinSignIn()?.token || null; } catch { return null; }
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
    saveAddinSignIn(t, name);
  };
  const logout = () => {
    setToken(null);
    setUserName("");
    try {
      localStorage.removeItem(ADDIN_TOKEN_KEY);
      localStorage.removeItem(ADDIN_USER_KEY);
      localStorage.removeItem("bgp_auth_token");
    } catch {}
    saveAddinSignIn(null, "");
  };
  return { token, userName, login, logout };
}
