// The quarterly check of HMRC's AML guidance behind BGP's rules in short
// (shared/aml-rules.ts). It reads each cited page's update date, and the
// manual's change notes, from GOV.UK's content API (no key, no AI), keeps the
// result in system_settings, and emails the officers when HMRC has changed a
// page since the rules were last reviewed. It never changes the rules.
// The officers can check now and mark the rules reviewed from the Rules pill
// on Deals, AML. HMRC_RULES_CHECK=off stops the quarterly run.
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import {
  AML_RULES_WRITTEN_ON, HMRC_AML_MANUAL, HMRC_AML_PAGES, hmrcChangesKey, hmrcChangesSince, nextHmrcCheck, rulesHmrcPages,
  type AmlRulesReview, type HmrcAmlPage, type HmrcChangeNote, type HmrcPageState, type HmrcRulesCheck,
} from "@shared/aml-rules";

const CHECK_KEY = "aml_rules_hmrc_check";
const REVIEW_KEY = "aml_rules_review";
const EMAILED_KEY = "aml_rules_hmrc_emailed";
const CONTENT_API = "https://www.gov.uk/api/content";

const text = (v: unknown): string => String(v ?? "").replace(/\s+/g, " ").trim();
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const isoOrNull = (v: unknown): string | null => {
  const t = Date.parse(String(v ?? ""));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export const hmrcRulesCheckOn = () => text(process.env.HMRC_RULES_CHECK).toLowerCase() !== "off";

type Fetcher = (url: string) => Promise<any>;
const fetchJson: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GOV.UK answered ${res.status}`);
  return res.json();
};

async function readSetting<T>(key: string): Promise<T | null> {
  const { rows } = await pool.query(`SELECT value FROM system_settings WHERE key = $1`, [key]).catch(() => ({ rows: [] as any[] }));
  return (rows[0]?.value ?? null) as T | null;
}
async function writeSetting(key: string, value: unknown): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
}

/** Read the manual's change notes and each cited page's update date from GOV.UK. */
export async function readHmrcPages(get: Fetcher = fetchJson): Promise<HmrcRulesCheck> {
  const pages: HmrcPageState[] = [];
  const failed: HmrcAmlPage[] = [];
  const notes: HmrcChangeNote[] = [];
  let error: string | null = null;
  const cited = rulesHmrcPages();
  try {
    const manual = await get(`${CONTENT_API}${HMRC_AML_MANUAL}`);
    for (const n of Array.isArray(manual?.details?.change_notes) ? manual.details.change_notes : []) {
      const path = text(n?.base_path);
      const id = path.split("/").pop() || "";
      const page = (id in HMRC_AML_PAGES ? id : null) as HmrcAmlPage | null;
      const at = isoOrNull(n?.published_at);
      if (!at) continue;
      // Notes about pages the rules do not cite are left out; notes about the manual itself are kept.
      if (!page && path !== HMRC_AML_MANUAL) continue;
      notes.push({ page, title: text(n?.title), note: text(n?.change_note), at });
    }
  } catch (e: any) {
    error = `The manual's change notes could not be read: ${text(e?.message) || "no answer"}`;
  }
  for (const page of cited) {
    try {
      const item = await get(`${CONTENT_API}${HMRC_AML_MANUAL}/${page}`);
      pages.push({ page, title: text(item?.title) || HMRC_AML_PAGES[page], updatedAt: isoOrNull(item?.public_updated_at) });
    } catch {
      failed.push(page);
    }
  }
  if (failed.length && !error) error = `${failed.length} of ${cited.length} HMRC pages could not be read`;
  return { checkedAt: new Date().toISOString(), pages, notes, failed, error };
}

export async function rulesState() {
  const [check, review] = await Promise.all([readSetting<HmrcRulesCheck>(CHECK_KEY), readSetting<AmlRulesReview>(REVIEW_KEY)]);
  return {
    writtenOn: AML_RULES_WRITTEN_ON,
    check,
    review,
    changes: hmrcChangesSince(check, review),
    nextCheck: nextHmrcCheck(londonToday()),
    on: hmrcRulesCheckOn(),
  };
}

/** Check HMRC's pages now and keep the result. A failed read keeps the pages it did read. */
export async function runHmrcRulesCheck(get: Fetcher = fetchJson): Promise<HmrcRulesCheck> {
  const fresh = await readHmrcPages(get);
  const before = await readSetting<HmrcRulesCheck>(CHECK_KEY);
  // A page that could not be read keeps what the last check found for it.
  for (const page of fresh.failed) {
    const kept = before?.pages?.find(p => p.page === page);
    if (kept) fresh.pages.push(kept);
  }
  await writeSetting(CHECK_KEY, fresh);
  return fresh;
}

/** The quarterly run: check, and email the officers once for changes they have not reviewed. */
export async function quarterlyHmrcRulesCheck(): Promise<void> {
  if (!hmrcRulesCheckOn()) { console.log("[aml-rules] HMRC check is off (HMRC_RULES_CHECK=off)"); return; }
  const check = await runHmrcRulesCheck();
  const review = await readSetting<AmlRulesReview>(REVIEW_KEY);
  const changes = hmrcChangesSince(check, review);
  console.log(`[aml-rules] HMRC check: ${check.pages.length} pages read, ${changes.length} changed since the last review${check.error ? ` (${check.error})` : ""}`);
  if (!changes.length && !check.error) return;
  const key = changes.length ? hmrcChangesKey(changes) : `error:${londonToday().slice(0, 7)}`;
  if ((await readSetting<string>(EMAILED_KEY)) === key) return;
  const { amlOfficerEmails } = await import("./aml-authority");
  const to = await amlOfficerEmails().catch(() => [] as string[]);
  if (!to.length) { console.warn("[aml-rules] no officer to email"); return; }
  const { sendKycEmail } = await import("./aml-portal");
  const { amlRulesChangedEmail } = await import("@shared/kyc-request");
  const link = `${(process.env.PUBLIC_APP_URL || "https://chatbgp.app").replace(/\/+$/, "")}/deals/aml?section=rules`;
  const sent = await sendKycEmail({ to, build: from => amlRulesChangedEmail({ changes, error: changes.length ? null : check.error, link, sentFrom: from }) });
  if (sent.ok) await writeSetting(EMAILED_KEY, key);
  else console.warn("[aml-rules] officers not emailed:", sent.error);
}

async function staffMe(req: Request): Promise<{ id: string; name: string } | null> {
  const userId = (req as any).session?.userId || (req as any).tokenUserId;
  if (!userId) return null;
  const { contactViewer } = await import("./contact-viewer");
  if (!(await contactViewer(req)).staff) return null;
  const u = (await pool.query(`SELECT id, name, email FROM users WHERE id = $1`, [userId])).rows[0];
  return u ? { id: String(u.id), name: text(u.name) || text(u.email) } : null;
}

const router = Router();

router.get("/api/aml-rules", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only" });
    const { amlActor } = await import("./aml-authority");
    const actor = await amlActor(req);
    res.json({ ...(await rulesState()), canManage: actor.isMlro });
  } catch (e: any) {
    console.error("[aml-rules] read failed:", e?.message);
    res.status(500).json({ message: "Could not read the rules" });
  }
});

router.post("/api/aml-rules/check", async (req: Request, res: Response) => {
  try {
    if (!(await staffMe(req))) return res.status(403).json({ message: "BGP staff only" });
    const { amlActor, officerRefusal } = await import("./aml-authority");
    const actor = await amlActor(req);
    if (!actor.isMlro) return res.status(403).json({ message: officerRefusal(actor, "check HMRC's pages") });
    await runHmrcRulesCheck();
    res.json({ ...(await rulesState()), canManage: true });
  } catch (e: any) {
    console.error("[aml-rules] check failed:", e?.message);
    res.status(502).json({ message: "HMRC's pages could not be read. Try again later." });
  }
});

router.post("/api/aml-rules/reviewed", async (req: Request, res: Response) => {
  try {
    const me = await staffMe(req);
    if (!me) return res.status(403).json({ message: "BGP staff only" });
    const { amlActor, officerRefusal } = await import("./aml-authority");
    const actor = await amlActor(req);
    if (!actor.isMlro) return res.status(403).json({ message: officerRefusal(actor, "mark the rules reviewed") });
    const note = text(req.body?.note).slice(0, 500) || null;
    const review: AmlRulesReview = { at: new Date().toISOString(), byName: me.name, note };
    await writeSetting(REVIEW_KEY, review);
    res.json({ ...(await rulesState()), canManage: true });
  } catch (e: any) {
    console.error("[aml-rules] review failed:", e?.message);
    res.status(500).json({ message: "Not saved" });
  }
});

export default router;
