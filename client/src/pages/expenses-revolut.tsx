// Revolut integration admin page. The server-side wiring in
// server/revolut.ts is complete; this page surfaces:
//   1. Status: env vars set, refresh token persisted, last access token,
//      webhook signing secret configured, live probe against /accounts.
//   2. Bootstrap: paste the OAuth ?code= from Revolut consent — exchanges
//      it for the refresh token (one-time).
//   3. Webhook register: register the transaction webhook against this
//      host. Surfaces the signing secret once for admin to copy.
//   4. Cards list with per-row "map to BGP user" so the receipt matcher
//      knows whose card a transaction belongs to.
//   5. Backfill: pull historic transactions since X to catch anything
//      the webhook missed.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CheckCircle2, AlertCircle, Loader2, RefreshCw, ExternalLink, KeyRound, Webhook, CreditCard, Download,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RevolutStatus {
  configured: boolean;
  missing?: string[];
  env?: string;
  issuer?: string;
  clientId?: string;
  bootstrapped?: boolean;
  accessTokenExpiresAt?: string | null;
  webhookSecretConfigured?: boolean;
  probe?: { ok: boolean; accounts?: number; error?: string };
}

interface RevolutCard {
  id: string;
  holder_id?: string;
  label?: string;
  last_four?: string;
  state?: string;
}

interface BgpUser {
  id: string;
  name: string;
  email: string | null;
}

export default function ExpensesRevolut() {
  const { toast } = useToast();
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<RevolutStatus>({
    queryKey: ["/api/revolut/status"],
  });
  const { data: users = [] } = useQuery<BgpUser[]>({
    queryKey: ["/api/users"],
  });
  const { data: cards = [], refetch: refetchCards, isFetching: cardsFetching } = useQuery<RevolutCard[]>({
    queryKey: ["/api/revolut/cards"],
    enabled: !!status?.bootstrapped,
    retry: false,
  });

  const [code, setCode] = useState("");
  const [webhookUrl, setWebhookUrl] = useState(
    typeof window !== "undefined" ? `${window.location.origin}/api/revolut/webhook` : "",
  );
  const [syncFrom, setSyncFrom] = useState(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));

  const bootstrapMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/revolut/bootstrap", { code });
      return r.json();
    },
    onSuccess: () => {
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["/api/revolut/status"] });
      toast({ title: "Bootstrap complete", description: "Refresh token saved. You can now list cards and sync transactions." });
    },
    onError: (e: any) => toast({ title: "Bootstrap failed", description: e?.message, variant: "destructive" }),
  });

  const webhookMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/revolut/webhook/register", { url: webhookUrl });
      return r.json();
    },
    onSuccess: (json: any) => {
      toast({
        title: "Webhook registered",
        description: json.action || "Set REVOLUT_WEBHOOK_SECRET in env (see logs).",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/revolut/status"] });
    },
    onError: (e: any) => toast({ title: "Webhook register failed", description: e?.message, variant: "destructive" }),
  });

  const mapMutation = useMutation({
    mutationFn: async ({ revolutCardId, userId, holderId, label }: { revolutCardId: string; userId: string; holderId?: string; label?: string }) => {
      const r = await apiRequest("POST", "/api/revolut/cardholders/map", {
        userId, revolutCardId, revolutHolderId: holderId, name: label,
      });
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Card mapped" });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/cardholders"] });
    },
    onError: (e: any) => toast({ title: "Map failed", description: e?.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/revolut/sync-transactions", { from: syncFrom });
      return r.json();
    },
    onSuccess: (json: any) => {
      toast({
        title: "Sync complete",
        description: `${json.created || 0} new, ${json.updated || 0} updated, ${json.skipped || 0} skipped`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] });
    },
    onError: (e: any) => toast({ title: "Sync failed", description: e?.message, variant: "destructive" }),
  });

  const autoAssignMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/revolut/cards/auto-assign");
      return r.json();
    },
    onSuccess: (json: any) => {
      const unmatched = (json.unmatched || []).length;
      toast({
        title: `Auto-assigned ${json.assigned || 0} card(s)`,
        description: `${json.alreadyMapped || 0} already mapped${unmatched ? `, ${unmatched} couldn't match by email` : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/expenses/cardholders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/revolut/cards"] });
    },
    onError: (e: any) => toast({ title: "Auto-assign failed", description: e?.message, variant: "destructive" }),
  });

  if (statusLoading) {
    return <div className="container mx-auto p-6"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CreditCard className="w-6 h-6" /> Revolut Integration
          </h1>
          <p className="text-sm text-muted-foreground">Connect Revolut Business so card spend lands in BGP Expenses automatically.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchStatus()}>
          <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Status */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Status</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {!status?.configured ? (
            <div className="flex items-start gap-2 text-sm">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">Env vars missing</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Set these on Railway then refresh:
                  <ul className="mt-1 ml-4 list-disc font-mono text-[11px]">
                    {(status?.missing || []).map((m: string) => <li key={m}>{m}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            <>
              <StatusRow ok={true} label={`Environment: ${status.env || "—"}`} />
              <StatusRow ok={!!status.bootstrapped} label={status.bootstrapped ? "Bootstrapped (refresh token saved)" : "Not bootstrapped — exchange OAuth code below"} />
              <StatusRow ok={!!status.webhookSecretConfigured} label={status.webhookSecretConfigured ? "Webhook signing secret set" : "Webhook signing secret not set"} />
              <StatusRow ok={status.probe?.ok} label={
                status.probe?.ok
                  ? `Live probe ok — ${status.probe?.accounts ?? 0} accounts visible`
                  : status.probe?.error
                    ? `Live probe failed: ${status.probe.error}`
                    : "Live probe not run"
              } />
              {status.accessTokenExpiresAt && (
                <div className="text-xs text-muted-foreground">Access token expires {new Date(status.accessTokenExpiresAt).toLocaleString()}</div>
              )}
              <div className="text-xs text-muted-foreground">Client ID: <code>{status.clientId}</code> · Issuer: <code>{status.issuer}</code></div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Bootstrap */}
      {status?.configured && !status.bootstrapped && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><KeyRound className="w-5 h-5" /> Bootstrap OAuth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              1. Open the Revolut consent URL (Developer portal → Apps → your app → Authorize URL). Sign in as a Revolut Business admin.
            </p>
            <p className="text-sm">
              2. After consent Revolut redirects to your redirect URI with a <code>?code=…</code> query parameter. Paste that code below.
            </p>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="oa_prod_abc123…" className="font-mono text-xs" />
              <Button onClick={() => bootstrapMutation.mutate()} disabled={bootstrapMutation.isPending || !code}>
                {bootstrapMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Exchange
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The code is single-use; you'll see "code expired" if you paste an old one. Refresh the consent URL to get a new code.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Webhook */}
      {status?.bootstrapped && !status.webhookSecretConfigured && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><Webhook className="w-5 h-5" /> Register webhook</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Tell Revolut where to POST transaction events. Use your production Railway URL — must be https://.
            </p>
            <div className="flex gap-2">
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://bgp.up.railway.app/api/revolut/webhook" className="font-mono text-xs" />
              <Button onClick={() => webhookMutation.mutate()} disabled={webhookMutation.isPending || !webhookUrl.startsWith("https://")}>
                {webhookMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Register
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              The signing secret comes back in the response — you'll only see it once. Copy it into <code>REVOLUT_WEBHOOK_SECRET</code> on Railway, then refresh this page.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Cards + mapping */}
      {status?.bootstrapped && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><CreditCard className="w-5 h-5" /> Cards</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Cards auto-assign to BGP users by matching the holder's email. Use the dropdown only to override.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => autoAssignMutation.mutate()} disabled={autoAssignMutation.isPending}>
                {autoAssignMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Auto-assign by email
              </Button>
              <Button variant="ghost" size="sm" onClick={() => refetchCards()} disabled={cardsFetching}>
                {cardsFetching && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
                Reload
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {cards.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                No cards found yet — issue cards in the Revolut Business console, then click Reload.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr className="text-left">
                      <th className="px-4 py-2 font-medium">Card</th>
                      <th className="px-4 py-2 font-medium">Last 4</th>
                      <th className="px-4 py-2 font-medium">State</th>
                      <th className="px-4 py-2 font-medium">Assign to BGP user</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cards.map((c) => (
                      <CardRow
                        key={c.id}
                        card={c}
                        users={users}
                        onAssign={(userId) => mapMutation.mutate({
                          revolutCardId: c.id,
                          holderId: c.holder_id,
                          label: c.label,
                          userId,
                        })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Backfill */}
      {status?.bootstrapped && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2"><Download className="w-5 h-5" /> Backfill transactions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Pull card transactions since a date — for first-time sync, or catching anything the webhook missed.
            </p>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <Label htmlFor="sync-from" className="text-xs">From date</Label>
                <Input id="sync-from" type="date" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} />
              </div>
              <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                {syncMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Sync now
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="bg-blue-50/50 border-blue-200/50 dark:bg-blue-950/20 dark:border-blue-900/30">
        <CardContent className="p-4 text-sm">
          <strong>Useful links:</strong>{" "}
          <a className="text-blue-600 hover:underline inline-flex items-center gap-1" href="https://developer.revolut.com/docs/business/business-api" target="_blank" rel="noopener noreferrer">
            Revolut Business API docs <ExternalLink className="w-3 h-3" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusRow({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />}
      <span>{label}</span>
    </div>
  );
}

function CardRow({
  card, users, onAssign,
}: {
  card: RevolutCard;
  users: BgpUser[];
  onAssign: (userId: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");
  return (
    <tr className="border-t hover:bg-muted/10">
      <td className="px-4 py-2 font-medium">{card.label || card.id.slice(0, 8)}</td>
      <td className="px-4 py-2 font-mono text-xs">•••• {card.last_four || "—"}</td>
      <td className="px-4 py-2">
        <Badge variant="outline" className={card.state === "active" ? "text-emerald-600 border-emerald-600/30" : "text-muted-foreground"}>
          {card.state || "—"}
        </Badge>
      </td>
      <td className="px-4 py-2">
        <div className="flex gap-2">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger className="h-8 w-[200px]"><SelectValue placeholder="Pick a user…" /></SelectTrigger>
            <SelectContent>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!selected} onClick={() => onAssign(selected)}>Assign</Button>
        </div>
      </td>
    </tr>
  );
}
