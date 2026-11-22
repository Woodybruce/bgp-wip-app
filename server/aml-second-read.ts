// The officers' second read of an enhanced party (rules: shared/aml-second-read.ts;
// Jack, 20 November 2026). POST /api/deals/:id/parties/:role/second-read, the
// Nominated Officer and the Deputies only (admins until one is set: decider).
// It reads the documents on the party's KYC record (KYC4U's report, the trust
// deed, the register documents, the client's uploads) and BGP's own record of
// the checks (the same gathering as the AML file), and lists each checklist
// item as found, partly or not found, with the words read. Nothing is saved;
// a line on the party's KYC history says a read was made.
//
// Anthropic, called directly, one call a read, capped a day
// (AML_SECOND_READ_DAILY_CAP, default 40, 0 = off).
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Router, type Request, type Response } from "express";
import { pool } from "./db";
import { isDealPartyRole, type DealPartyRole } from "@shared/deal-parties";
import { amlFileDocWords } from "@shared/aml-file";
import {
  SECOND_READ_TOOL, checkSecondRead, secondReadSystem, unreadSecondRead,
  type SecondRead, type SecondReadChecklist, type SecondReadSource,
} from "@shared/aml-second-read";
import type { AmlFileParty } from "./aml-file";

const USAGE_KEY = "aml_second_read_usage";
const FEATURE = "aml-second-read";
const MAX_DOCS = 12;
const MAX_TOTAL_BYTES = 18 * 1024 * 1024;
const MAX_ONE_BYTES = 10 * 1024 * 1024;

export function secondReadDailyCap(): number {
  const raw = process.env.AML_SECOND_READ_DAILY_CAP;
  const n = raw == null || raw.trim() === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 40;
}

type Part =
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  | { type: "text"; text: string };

const clean = (s: string) => s.replace(/[<>]/g, " ");

async function textOf(buffer: Buffer, name: string): Promise<string | null> {
  const tmp = path.join(os.tmpdir(), `bgp_sr_${Date.now()}_${crypto.randomBytes(4).toString("hex")}${path.extname(name).replace(/[^.a-z0-9]/gi, "").slice(0, 8)}`);
  try {
    fs.writeFileSync(tmp, buffer);
    const { extractTextFromFile } = await import("./utils/file-extractor");
    const text = String(await extractTextFromFile(tmp, name) || "").replace(/\s+/g, " ").trim();
    return text.length >= 40 ? text : null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/** BGP's own record of the checks, as text the reader can cite as source R. */
export function partyRecordText(p: AmlFileParty): string {
  const lines: string[] = [];
  lines.push(`Party: ${p.brand.name}${p.company ? `; the company that signs: ${p.company.name}${p.company.number ? ` (${p.company.number})` : ""}` : ""}${p.individual ? " (a private individual)" : ""}`);
  if (p.level) lines.push(`Due diligence level: ${p.level.level}. ${p.level.why.join(" ")}`);
  for (const l of p.precheck?.lines || []) lines.push(`BGP check: ${l.label}${l.detail ? `: ${l.detail}` : ""}`);
  for (const f of p.flags) lines.push(`Red flag: ${f.label}${f.detail ? `: ${f.detail}` : ""}`);
  for (const a of p.aside) lines.push(`Set aside: ${(a as any).label || ""}${(a as any).comment ? `, comment: ${(a as any).comment}` : ""}`);
  for (const person of p.people?.people || []) {
    lines.push(`Person to check: ${person.name} (${person.roles.join(", ")}); identity check ${person.id.state}; proof of address ${person.address.done ? "done" : "not done"}; sanctions ${person.sanctions}`);
  }
  for (const r of p.kyc4u.records || []) lines.push(`KYC4U: ${[(r as any).status, (r as any).reference, (r as any).note, (r as any).date].filter(Boolean).join(", ")}`);
  for (const d of p.kyc4u.drafts || []) lines.push(`KYC4U request: ${[(d as any).status, (d as any).created_at || (d as any).createdAt].filter(Boolean).join(", ")}`);
  return lines.join("\n").slice(0, 20_000);
}

export interface SecondReadDeps {
  hasKey?: () => boolean;
  claim?: () => Promise<boolean>;
  ask?: (system: string, parts: Part[]) => Promise<{ input: unknown; model: string; usage?: unknown }>;
  load?: (url: string) => Promise<{ data: Buffer; contentType?: string | null } | null>;
  now?: () => Date;
}

async function askAnthropic(system: string, parts: Part[]) {
  const { getAnthropicClient, CHATBGP_MODEL } = await import("./utils/anthropic-client");
  const response = await getAnthropicClient(true).messages.create({
    model: CHATBGP_MODEL,
    max_tokens: 4000,
    system,
    tools: [SECOND_READ_TOOL as any],
    tool_choice: { type: "tool", name: SECOND_READ_TOOL.name },
    messages: [{ role: "user", content: [...parts, { type: "text", text: "Read the file against the checklist." }] as any }],
  }, { timeout: 150_000, maxRetries: 1 });
  const block = response.content.find((b: any) => b.type === "tool_use") as any;
  return { input: (response.stop_reason as string) === "max_tokens" ? null : block?.input ?? null, model: response.model || CHATBGP_MODEL, usage: response.usage };
}

/** Reads one party's file. Never throws: a read that cannot be made says why. */
export async function secondReadParty(p: AmlFileParty, checklist: SecondReadChecklist, deps: SecondReadDeps = {}): Promise<SecondRead> {
  const readAt = (deps.now?.() || new Date()).toISOString();
  const documents: SecondRead["documents"] = [];
  try {
    const hasKey = deps.hasKey || (() => !!(process.env.ANTHROPIC_API_KEY || process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY));
    if (!hasKey()) return unreadSecondRead(checklist, "The reader is not switched on.", readAt);
    const load = deps.load || (async (url: string) => {
      const { getFile } = await import("./file-storage");
      const f = await getFile(url.replace(/^\/api\//, ""));
      return f ? { data: f.data, contentType: f.contentType } : null;
    });
    const sources: SecondReadSource[] = [{ id: "R", name: "BGP's record", text: partyRecordText(p) }];
    const parts: Part[] = [{ type: "text", text: `<source id="R" name="BGP's record of the checks">\n${clean(sources[0].text || "")}\n</source>` }];
    let total = 0;
    // KYC4U's report and the trust's own papers first, then the newest.
    const order = [...p.documents].sort((a, b) => Number(/kyc4u|trust|deed/i.test(`${b.type} ${b.name}`)) - Number(/kyc4u|trust|deed/i.test(`${a.type} ${a.name}`)));
    for (const d of order) {
      const name = `${d.name} (${amlFileDocWords(d.type)})`;
      if (sources.length - 1 >= MAX_DOCS) { documents.push({ name, read: false, why: `only the first ${MAX_DOCS} documents are read` }); continue; }
      if (!d.url) { documents.push({ name, read: false, why: "no stored file" }); continue; }
      const stored = await load(d.url).catch(() => null);
      if (!stored?.data?.length) { documents.push({ name, read: false, why: "the stored file could not be found" }); continue; }
      const buf = stored.data;
      const mime = String(d.mime || stored.contentType || "").toLowerCase();
      if (buf.length > MAX_ONE_BYTES || total + buf.length > MAX_TOTAL_BYTES) { documents.push({ name, read: false, why: "too large to read with the rest" }); continue; }
      const id = `D${sources.length}`;
      const isPdf = mime === "application/pdf" || /\.pdf$/i.test(d.name) || buf.subarray(0, 5).toString("latin1") === "%PDF-";
      if (isPdf) {
        const text = await textOf(buf, d.name);
        sources.push({ id, name: d.name, text });
        parts.push({ type: "text", text: `<source id="${id}" name="${clean(d.name)}">` }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } }, { type: "text", text: "</source>" });
      } else if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(d.name)) {
        let img: Buffer;
        try {
          const sharp = (await import("sharp")).default;
          img = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        } catch { documents.push({ name, read: false, why: "the picture could not be opened" }); continue; }
        sources.push({ id, name: d.name, text: null });
        parts.push({ type: "text", text: `<source id="${id}" name="${clean(d.name)}">` }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.toString("base64") } }, { type: "text", text: "</source>" });
      } else {
        const text = await textOf(buf, d.name);
        if (!text) { documents.push({ name, read: false, why: "no text could be read from it" }); continue; }
        sources.push({ id, name: d.name, text });
        parts.push({ type: "text", text: `<source id="${id}" name="${clean(d.name)}">\n${clean(text).slice(0, 40_000)}\n</source>` });
      }
      total += buf.length;
      documents.push({ name, read: true, why: null });
    }
    const claim = deps.claim || (async () => (await import("./requirement-feeds")).claimDailyRead(USAGE_KEY, secondReadDailyCap()));
    if (!(await claim())) return unreadSecondRead(checklist, "Today's allowance of second reads is used up; try again tomorrow.", readAt, documents);
    const reply = await (deps.ask || askAnthropic)(secondReadSystem(checklist, p.company?.name || p.brand.name), parts);
    if (!deps.ask) import("./api-usage").then(m => m.logAiUsage({ provider: "anthropic", model: reply.model, feature: FEATURE, usage: reply.usage as any })).catch(() => {});
    if (!reply.input || typeof reply.input !== "object") return unreadSecondRead(checklist, "The reader gave no answer; try again.", readAt, documents);
    return checkSecondRead(reply.input, { checklist, sources, documents, readAt });
  } catch (e: any) {
    console.warn(`[aml-second-read] not read: ${e?.message}`);
    return unreadSecondRead(checklist, "The reader failed; try again later.", readAt, documents);
  }
}

const router = Router();

router.post("/api/deals/:id/parties/:role/second-read", async (req: Request, res: Response) => {
  try {
    const { decider } = await import("./deal-party-aml");
    const me = await decider(req);
    if (!("id" in me)) return res.status(me.status).json({ message: me.refusal });
    const role = String(req.params.role);
    if (!isDealPartyRole(role)) return res.status(400).json({ message: "Which party?" });
    const { gatherAmlFile } = await import("./aml-file");
    const data = await gatherAmlFile(String(req.params.id), [role as DealPartyRole], me);
    if (!data) return res.status(404).json({ message: "No such transaction." });
    const p = data.parties[0];
    if (!p) return res.status(404).json({ message: "The transaction has no such party." });
    if (p.level?.level !== "enhanced") return res.status(409).json({ message: "The second read is for an enhanced party." });
    const subject = (await pool.query(`SELECT aml_subject_type FROM crm_companies WHERE id = $1`, [p.brand.id])).rows[0];
    const checklist: SecondReadChecklist = String(subject?.aml_subject_type || "").toLowerCase() === "trust" ? "trust" : "enhanced";
    const read = await secondReadParty(p, checklist);
    if (!read.unreadable) {
      const found = read.items.filter(i => i.status === "found").length;
      await pool.query(`INSERT INTO kyc_audit_log (company_id, action, performed_by, notes) VALUES ($1, 'aml_second_read', $2, $3)`,
        [p.brand.id, me.name, `Second read on ${data.deal.name} (${checklist === "trust" ? "trust checklist" : "enhanced checklist"}): ${found} of ${read.items.length} items found in the file. Nothing decided by the reader.`]).catch(() => {});
    }
    res.json(read);
  } catch (err: any) {
    console.error("[aml-second-read] failed:", err?.message);
    res.status(500).json({ message: "The second read could not be made." });
  }
});

export default router;
