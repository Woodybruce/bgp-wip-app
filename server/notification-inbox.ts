// The bell (Woody, 2026-09-28: "this notification not working that well").
// It was the same 41 org-wide deal warnings for everyone, all "urgent", and
// nothing could be cleared. Now it is personal: "For you" is everything sent
// to this person (tasks, invoice verdicts, expenses — every push, whether or
// not the phone has push switched on), and "Your deals" is alerts on deals
// they are on, each of which can be cleared.
import { pool } from "./db";

const DISMISS_DAYS = 14;
const STUCK_DAYS = 30;

export interface BellItem {
  id: string;
  kind: "for_you" | "deal" | "firm";
  type: string;
  title: string;
  description: string;
  severity: "urgent" | "warning" | "info";
  createdAt: string;
  read: boolean;
  url?: string | null;
  dealId?: string;
}

// Chat messages have their own unread counts in the chat panel.
export async function recordNotification(userId: string, data: { title: string; body: string; tag?: string; url?: string }): Promise<void> {
  if (!userId || String(data.tag || "").startsWith("chat-")) return;
  try {
    await pool.query(
      `INSERT INTO user_notifications (user_id, title, body, url, tag) VALUES ($1, $2, $3, $4, $5)`,
      [userId, String(data.title || "").slice(0, 300), String(data.body || "").slice(0, 1000), data.url || null, data.tag || null]);
  } catch (err: any) {
    console.warn("[bell] could not record notification:", err?.message);
  }
}

export async function bellFor(userId: string): Promise<BellItem[]> {
  const inbox = await pool.query(
    `SELECT id, title, body, url, tag, created_at, read_at FROM user_notifications
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC LIMIT 40`, [userId]);
  const forYou: BellItem[] = inbox.rows.map((row: any) => ({
    id: `inbox-${row.id}`, kind: "for_you", type: String(row.tag || "").split("-")[0] || "message",
    title: row.title, description: row.body || "", severity: "info",
    createdAt: new Date(row.created_at).toISOString(), read: !!row.read_at, url: row.url,
  }));

  const me = (await pool.query(`SELECT name, is_admin FROM users WHERE id = $1`, [userId])).rows[0];
  const dismissed = new Set((await pool.query(
    `SELECT notification_key FROM notification_dismissals
      WHERE user_id = $1 AND dismissed_at > NOW() - make_interval(days => $2)`, [userId, DISMISS_DAYS])).rows.map((row: any) => row.notification_key));
  const deals = await pool.query(
    `SELECT id, name, status, updated_at, target_date, kyc_approved, fee
       FROM crm_deals
      WHERE status NOT IN ('COM', 'INV', 'WIT')
        AND ($1 = ANY(COALESCE(internal_agent_ids, '{}'::varchar[])) OR ($2::text IS NOT NULL AND $2 = ANY(COALESCE(internal_agent, '{}'::text[]))))`,
    [userId, me?.name || null]);
  const dealItems: BellItem[] = [];
  const now = Date.now();
  let noFee = 0;
  for (const deal of deals.rows) {
    const push = (key: string, item: Omit<BellItem, "id" | "kind" | "read" | "dealId" | "url">) => {
      const id = `${key}-${deal.id}`;
      if (!dismissed.has(id)) dealItems.push({ ...item, id, kind: "deal", read: false, dealId: deal.id, url: `/deals/${deal.id}` });
    };
    if (!deal.kyc_approved && ["NEG", "SOL", "EXC"].includes(deal.status)) {
      push("kyc", { type: "kyc_gap", title: `KYC not approved: ${deal.name}`, description: `In ${deal.status} without KYC clearance`,
        severity: deal.status === "NEG" ? "warning" : "urgent", createdAt: new Date().toISOString() });
    }
    const target = deal.target_date ? new Date(deal.target_date) : null;
    if (target && target.getTime() < now - 86400000) {
      push("overdue", { type: "overdue_completion", title: `Target date passed: ${deal.name}`,
        description: `Target was ${target.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
        severity: "warning", createdAt: target.toISOString() });
    }
    const days = Math.floor((now - new Date(deal.updated_at).getTime()) / 86400000);
    if (days >= STUCK_DAYS) {
      push("stuck", { type: "stuck_deal", title: `No update for ${days} days: ${deal.name}`, description: `Still in ${deal.status || "no status"}`,
        severity: "info", createdAt: new Date(deal.updated_at).toISOString() });
    }
    if (!Number(deal.fee)) noFee++;
  }
  if (noFee && !dismissed.has(`no-fee-${noFee}`)) {
    dealItems.push({ id: `no-fee-${noFee}`, kind: "deal", type: "no_fee", read: false, url: "/deals",
      title: `${noFee} of your live deal${noFee === 1 ? " has" : "s have"} no fee set`, description: "Add the fee on each deal",
      severity: "info", createdAt: new Date().toISOString() });
  }
  const order: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
  dealItems.sort((a, b) => order[a.severity] - order[b.severity] || b.createdAt.localeCompare(a.createdAt));
  // Admins also see the firm's compliance exposure as ONE line — 60 rows of
  // "KYC not approved" buried everything else (Woody, 2026-09-28).
  const firmItems: BellItem[] = [];
  if (me?.is_admin) {
    const mine = new Set(deals.rows.map((deal: any) => deal.id));
    const kyc = await pool.query(
      `SELECT id, status FROM crm_deals WHERE COALESCE(kyc_approved, false) = false AND status IN ('SOL', 'EXC')`);
    const others = kyc.rows.filter((deal: any) => !mine.has(deal.id));
    const exchanged = others.filter((deal: any) => deal.status === "EXC").length;
    const id = `firm-kyc-${others.length}`;
    if (others.length && !dismissed.has(id)) {
      firmItems.push({ id, kind: "firm", type: "kyc_gap", read: false, url: "/kyc-clouseau?tab=board",
        title: `${others.length} deal${others.length === 1 ? "" : "s"} at solicitors or exchanged without KYC`,
        description: `${exchanged} exchanged · ${others.length - exchanged} with solicitors · open AML Compliance`,
        severity: "urgent", createdAt: new Date().toISOString() });
    }
  }
  return [...forYou, ...dealItems, ...firmItems];
}

// Inbox rows are marked read; deal alerts are cleared for DISMISS_DAYS.
export async function markBellRead(userId: string, ids: string[]): Promise<void> {
  const inboxIds = ids.filter(id => id.startsWith("inbox-")).map(id => id.slice(6));
  if (inboxIds.length) {
    await pool.query(`UPDATE user_notifications SET read_at = NOW() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL`, [userId, inboxIds]);
  }
  const dealKeys = ids.filter(id => !id.startsWith("inbox-")).slice(0, 500);
  if (dealKeys.length) {
    await pool.query(
      `INSERT INTO notification_dismissals (user_id, notification_key)
       SELECT $1, key FROM unnest($2::text[]) AS key
       ON CONFLICT (user_id, notification_key) DO UPDATE SET dismissed_at = NOW()`, [userId, dealKeys]);
  }
}
