// Test access for a Claude session (Woody, 2026-09-26: "any way I can do
// from my phone?", then "can you just have it forever"). An admin creates a
// login token for their own account so a Claude session can screenshot and
// measure pages across many brands: one year to store once in the Claude
// environment's settings (BGP_QA_TOKEN), or 24 hours for a one-off. Revoke
// here removes every test login. Admin only.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Check, Copy, KeyRound, Loader2, ShieldOff } from "lucide-react";

type Status = { active: number; until: string | null };

export default function QaAccess() {
  const { toast } = useToast();
  const [token, setToken] = useState<{ value: string; days: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const { data: status, error } = useQuery<Status>({ queryKey: ["/api/admin/qa-access"], retry: false });

  const create = useMutation({
    mutationFn: async (days: number) => ({ ...(await (await apiRequest("POST", "/api/admin/qa-access", { days })).json()), days }),
    onSuccess: (r: any) => { setToken({ value: r.token, days: r.days }); setCopied(false); queryClient.invalidateQueries({ queryKey: ["/api/admin/qa-access"] }); },
    onError: (e: any) => toast({ title: "Couldn't create test access", description: e?.message, variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/admin/qa-access")).json(),
    onSuccess: (r: any) => {
      setToken(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/qa-access"] });
      toast({ title: "Test access revoked", description: `${r.revoked || 0} test login${r.revoked === 1 ? "" : "s"} removed.` });
    },
  });

  // The one-year token copies as the whole environment line, so it can't
  // land under the wrong name (a Railway token did, 2026-09-26).
  const line = token ? (token.days === 365 ? `BGP_QA_TOKEN=${token.value}` : token.value) : "";
  const copy = async () => {
    if (!token) return;
    try { await navigator.clipboard.writeText(line); setCopied(true); } catch { setCopied(false); }
  };

  if (error) {
    return <div className="p-4 max-w-lg mx-auto"><p className="text-sm text-muted-foreground">Test access is for admins only.</p></div>;
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4" data-testid="page-qa-access">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><KeyRound className="w-5 h-5" />Test access for Claude</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Creates a login that works as you, so Claude can open and check pages across many brands. Best: create the one-year login and save it once in the Claude environment's settings as <span className="font-mono">BGP_QA_TOKEN</span> — every new Claude session then has it. Revoke here at any time.
        </p>
      </div>

      <div className="rounded-xl border border-card-border bg-card shadow-sm p-3 space-y-3">
        <p className="text-sm">
          {status?.active
            ? <>Active test logins: <span className="font-mono tabular-nums">{status.active}</span>{status.until ? ` · until ${new Date(status.until).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</>
            : "No active test logins."}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => create.mutate(365)} disabled={create.isPending} data-testid="button-qa-create-year">
            {create.isPending && create.variables === 365 ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}Create one-year access
          </Button>
          <Button variant="outline" onClick={() => create.mutate(1)} disabled={create.isPending} data-testid="button-qa-create">
            {create.isPending && create.variables === 1 ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}24 hours only
          </Button>
          {!!status?.active && (
            <Button variant="outline" onClick={() => revoke.mutate()} disabled={revoke.isPending} data-testid="button-qa-revoke">
              <ShieldOff className="w-4 h-4" />Revoke all test access
            </Button>
          )}
        </div>
        {token && (
          <div className="space-y-2">
            <textarea readOnly value={line} rows={3} onFocus={e => e.currentTarget.select()} className="w-full rounded-md border bg-background p-2 font-mono text-xs break-all" data-testid="text-qa-token" />
            <Button variant="outline" size="sm" onClick={copy} data-testid="button-qa-copy">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}{copied ? "Copied" : "Copy"}
            </Button>
            <p className="text-xs text-muted-foreground">
              {token.days === 365
                ? <>Save it in Claude: the environment menu in the session's title bar → Edit → environment variables → paste this whole line as a new line, then save. New sessions pick it up. </>
                : "Valid for 24 hours. "}
              Shown once. Anyone with it can use the app as you until it expires or is revoked.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
