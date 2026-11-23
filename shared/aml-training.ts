// AML training records (Woody, 19 November 2026: build what BGP's AML policy
// needs). The policy, section L: staff get formal and informal training (for
// example emails and articles) on a regular basis, on the Regulations, HMRC's
// guidance, the money laundering, terrorist financing and proliferation
// financing risks to the business, the weak points of its services and
// channels, and its own policies and procedures. Senior management provide
// training to all; the compliance officer makes sure staff are screened and
// trained; training records are kept for five years (section M).
//
// The records live in the old in-app AML's table, aml_training_records. Its
// online modules and quiz are not brought back: they teach rules Issue 2
// replaced (a three-month re-check cycle, the MLRO deciding alone).

import { AML_POLICY_DOCUMENTS } from "./aml-policy";

export const AML_TRAINING_TOPICS = [
  { key: "regulations", label: "The Money Laundering Regulations" },
  { key: "hmrc_guidance", label: "HMRC's guidance" },
  { key: "risks", label: "The money laundering, terrorist and proliferation financing risks to BGP" },
  { key: "vulnerabilities", label: "Where BGP's services and channels are open to abuse" },
  { key: "procedures", label: "BGP's AML policy, controls and procedures" },
] as const;
export type AmlTrainingTopic = typeof AML_TRAINING_TOPICS[number]["key"];
const TOPIC_KEYS = AML_TRAINING_TOPICS.map(t => t.key) as string[];
export const topicWords = (key: string): string => AML_TRAINING_TOPICS.find(t => t.key === key)?.label || key;

export const AML_TRAINING_KINDS = ["formal", "informal", "policy_read"] as const;
export type AmlTrainingKind = typeof AML_TRAINING_KINDS[number];
export const AML_TRAINING_KIND_WORDS: Record<AmlTrainingKind, string> = {
  formal: "Formal training",
  informal: "Informal (an email, article or briefing)",
  policy_read: "Read the AML policy",
};
/** A stored type in words: the old records hold induction, annual_refresh, a module's title and so on. */
export function trainingKindWords(raw: unknown): string {
  const s = String(raw || "");
  if ((AML_TRAINING_KINDS as readonly string[]).includes(s)) return AML_TRAINING_KIND_WORDS[s as AmlTrainingKind];
  if (s === "induction") return "Induction";
  if (s === "annual_refresh") return "Annual refresher";
  return s ? s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()) : "Training";
}

// The policy says "on a regular basis"; a year without any is shown as due.
export const AML_TRAINING_DUE_MONTHS = 12;

// The policy issue each person confirms they have read: the latest issue.
const POLICY = AML_POLICY_DOCUMENTS.filter(d => d.key.startsWith("policy")).sort((a, b) => b.issue - a.issue)[0] || AML_POLICY_DOCUMENTS[0];
export const CURRENT_POLICY_KEY = POLICY.key;
export const CURRENT_POLICY_READ_TITLE = `Read BGP's ${POLICY.title}, Issue ${POLICY.issue}`;

export interface AmlTrainingRow { id: number; userId: string; userName: string; kind: string; kindWords: string; title: string; trainedOn: string | null; topics: string[]; provider: string | null; notes: string | null; recordedBy: string | null; createdAt: string | null }

/** Where one person stands: their last training, whether a year has passed without any, and whether they have read the current policy. */
export function trainingStanding(rows: Array<Pick<AmlTrainingRow, "kind" | "title" | "trainedOn">>, now = new Date()): { lastTrainedOn: string | null; due: boolean; readPolicy: boolean } {
  const dates = rows.map(r => r.trainedOn).filter((d): d is string => !!d).sort();
  const lastTrainedOn = dates.length ? dates[dates.length - 1] : null;
  const due = !lastTrainedOn || (now.getTime() - Date.parse(`${lastTrainedOn}T00:00:00Z`)) > AML_TRAINING_DUE_MONTHS * 30.44 * 86400000;
  const readPolicy = rows.some(r => r.kind === "policy_read" && r.title === CURRENT_POLICY_READ_TITLE);
  return { lastTrainedOn, due, readPolicy };
}

export interface AmlTrainingInput { title: string; kind: AmlTrainingKind; trainedOn: string; topics: string[]; provider: string | null; notes: string | null; userIds: string[] }

const clip = (v: unknown, n: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, n) : null;
};

/** A session recorded by the officers or an admin, for one or more people. The date may not be in the future. */
export function trainingInput(body: any, today: string): { ok: true; value: AmlTrainingInput } | { ok: false; error: string } {
  const title = clip(body?.title, 200);
  if (!title) return { ok: false, error: "Give the training a title (what it was)." };
  const kind = body?.kind === "informal" ? "informal" : "formal";
  const trainedOn = String(body?.trainedOn || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trainedOn) || Number.isNaN(Date.parse(`${trainedOn}T00:00:00Z`))) return { ok: false, error: "Give the date of the training." };
  if (trainedOn > today) return { ok: false, error: "The training date is in the future." };
  const topics = Array.isArray(body?.topics) ? [...new Set(body.topics.map(String).filter((t: string) => TOPIC_KEYS.includes(t)))] as string[] : [];
  if (!topics.length) return { ok: false, error: "Tick what the training covered." };
  const userIds = Array.isArray(body?.userIds) ? [...new Set(body.userIds.map((u: unknown) => String(u || "").trim()).filter(Boolean))] as string[] : [];
  if (!userIds.length) return { ok: false, error: "Choose who did the training." };
  if (userIds.length > 200) return { ok: false, error: "Record at most 200 people at once." };
  return { ok: true, value: { title, kind, trainedOn, topics, provider: clip(body?.provider, 200), notes: clip(body?.notes, 2000), userIds } };
}
