// The AML register: what BGP's Nominated Officer and Deputy receive and
// report (Woody, 19 November 2026: build the items left out of the AML
// policy build). BGP's AML policy, Issue 2:
//   - C.b: the Nominated Officer receives and reviews internal reports of
//     suspected money laundering, terrorist or proliferation financing,
//     decides whether there are reasonable grounds, submits a Suspicious
//     Activity Report (SAR) to the National Crime Agency where appropriate,
//     keeps suspicious transactions from proceeding unlawfully, and seeks the
//     NCA's consent (a defence, DAML) where required.
//   - I.b: a suspicion is reported to the Nominated Officer or the Deputy at
//     once, without discussing it with the client or colleagues (tipping off
//     is an offence, POCA 2002 s.333A); the officer records the circumstances
//     and the decision.
//   - I.c: a material discrepancy with the Trust Registration Service not
//     resolved by the trustees is reported to HMRC.
//   - J and 3.10, and the risk assessment: a designated person or a breach of
//     financial sanctions is reported to OFSI as soon as practicable, with the
//     nature and amount of any funds held for the customer, and legal advice
//     is taken before BGP acts further.
//   - Joint agents: an agent not registered with HMRC for AML supervision is
//     reported to HMRC.
//   - MLR 2017 reg 30A (and the risk assessment's "overseas company
//     registrations"): a material discrepancy with the PSC register or the
//     Register of Overseas Entities is reported to Companies House.
// One register for all of them, read only by the officers. The rules and the
// words are here; the routes are server/aml-register.ts.

export const REGISTER_KINDS = ["suspicion", "sanctions", "psc_discrepancy", "trs_discrepancy", "agent_unregistered"] as const;
export type RegisterKind = typeof REGISTER_KINDS[number];
export const isRegisterKind = (v: unknown): v is RegisterKind => typeof v === "string" && (REGISTER_KINDS as readonly string[]).includes(v);

export const REGISTER_KIND_INFO: Record<RegisterKind, { short: string; label: string; reportedTo: string; staffMayRaise: boolean; ask: string }> = {
  suspicion: {
    short: "Suspicion", label: "A suspicion of money laundering, terrorist financing or proliferation financing",
    reportedTo: "the National Crime Agency (a SAR)", staffMayRaise: true,
    ask: "What happened, who it is about, and why it seems wrong. Facts, not conclusions.",
  },
  sanctions: {
    short: "Sanctions", label: "A designated person, or a breach of financial sanctions",
    reportedTo: "OFSI", staffMayRaise: true,
    ask: "Who it is, which list or record shows it, and what BGP holds or has done for them.",
  },
  psc_discrepancy: {
    short: "Register discrepancy", label: "A discrepancy with the PSC register or the Register of Overseas Entities",
    reportedTo: "Companies House", staffMayRaise: false,
    ask: "Which company, what the register says, and what the client told BGP.",
  },
  trs_discrepancy: {
    short: "Trust register discrepancy", label: "A discrepancy with the Trust Registration Service the trustees did not resolve",
    reportedTo: "HMRC", staffMayRaise: false,
    ask: "Which trust, what the register says, what BGP holds, and what the trustees were asked to do.",
  },
  agent_unregistered: {
    short: "Unregistered agent", label: "An agent not registered with HMRC for AML supervision",
    reportedTo: "HMRC", staffMayRaise: true,
    ask: "Which firm, which deal, and how its registration was checked.",
  },
};

// Tipping off (POCA 2002 s.333A), in the words the screens use.
export const TIPPING_OFF_WARNING = "Do not discuss this with the client, the other side or colleagues: telling anyone that a report has been or may be made can be the offence of tipping off. Only the Nominated Officer and the Deputy can read it.";

export const REGISTER_STATUSES = ["open", "reported", "no_report", "closed"] as const;
export type RegisterStatus = typeof REGISTER_STATUSES[number];
export const REGISTER_STATUS_WORDS: Record<RegisterStatus, string> = { open: "Open", reported: "Reported", no_report: "No report made", closed: "Closed" };
/** A stored status as one of the four: the old register wrote reported_nca and reported_ch. */
export function registerStatusOf(raw: unknown): RegisterStatus {
  const s = String(raw || "").toLowerCase();
  if (s.startsWith("reported")) return "reported";
  if (s === "no_report" || s === "closed") return s;
  return "open";
}

// What the officer records beyond the decision, by kind.
export interface RegisterDetails {
  // Sanctions (OFSI): the nature and amount or quantity of any funds or
  // economic resources BGP holds for the customer when it first knew or
  // suspected; the legal advice taken; what BGP did.
  fundsHeld?: string | null;
  legalAdvice?: string | null;
  outcome?: "declined" | "licence" | "continue" | null;
  // Suspicion (NCA): what was asked of the client to resolve it, when it was
  // discussed with senior management, and the consent (DAML) request.
  furtherInfo?: string | null;
  seniorManagement?: string | null;
  damlRequestedOn?: string | null;
  damlOutcome?: "granted" | "refused" | "deemed" | null;
  damlOutcomeOn?: string | null;
  // The officer's working notes.
  notes?: string | null;
}

export const OUTCOME_WORDS: Record<NonNullable<RegisterDetails["outcome"]>, string> = {
  declined: "BGP declined to act", licence: "Acting only under an OFSI licence", continue: "Continued on legal advice",
};
export const DAML_OUTCOME_WORDS: Record<NonNullable<RegisterDetails["damlOutcome"]>, string> = {
  granted: "Consent given by the NCA", refused: "Consent refused by the NCA", deemed: "No refusal within the notice period: consent deemed",
};

// England and Wales bank holidays, from GOV.UK (www.gov.uk/bank-holidays.json,
// read 19 November 2026). Add the next year's when GOV.UK publishes them.
export const ENGLAND_BANK_HOLIDAYS: readonly string[] = [
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04", "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isWorkingDay = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !ENGLAND_BANK_HOLIDAYS.includes(ymd(d));
export const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/**
 * The consent (DAML) timings, POCA 2002 s.335: the notice period is seven
 * working days starting with the first working day after the disclosure;
 * consent refused within it starts a moratorium of 31 days starting with the
 * day the refusal is received (a court can extend it). Dates as yyyy-mm-dd;
 * the NCA's own acknowledgement gives the dates to rely on.
 */
export function damlDates(requestedOn: string | null | undefined, outcome: RegisterDetails["damlOutcome"], outcomeOn: string | null | undefined): { noticeEnds: string | null; moratoriumEnds: string | null } {
  if (!isYmd(requestedOn)) return { noticeEnds: null, moratoriumEnds: null };
  const d = new Date(`${requestedOn}T00:00:00Z`);
  let counted = 0;
  while (counted < 7) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(d)) counted++;
  }
  const noticeEnds = ymd(d);
  let moratoriumEnds: string | null = null;
  if (outcome === "refused" && isYmd(outcomeOn)) {
    const m = new Date(`${outcomeOn}T00:00:00Z`);
    m.setUTCDate(m.getUTCDate() + 30);
    moratoriumEnds = ymd(m);
  }
  return { noticeEnds, moratoriumEnds };
}

const clip = (v: unknown, n: number): string | null => {
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  return s ? s.slice(0, n) : null;
};
const day = (v: unknown): string | null => {
  const s = String(v ?? "").trim().slice(0, 10);
  return isYmd(s) ? s : null;
};

export const REGISTER_CONCERN_MIN = 20;

export interface RegisterRaise { kind: RegisterKind; concern: string; dealId: string | null; role: string | null; companyId: string | null }

/** A new entry, checked: staff raise a suspicion, a sanctions concern or an unregistered agent; the officers raise any kind. */
export function registerRaiseInput(body: any, opts: { officer: boolean }): { ok: true; value: RegisterRaise } | { ok: false; error: string } {
  const kind: RegisterKind = isRegisterKind(body?.kind) ? (body.kind as RegisterKind) : "suspicion";
  if (!opts.officer && !REGISTER_KIND_INFO[kind].staffMayRaise) return { ok: false, error: "Only the Nominated Officer or the Deputy records that kind of report. Tell them instead." };
  const concern = clip(body?.concern, 8000);
  if (!concern || concern.length < REGISTER_CONCERN_MIN) return { ok: false, error: "Describe it in a sentence or two, so the Nominated Officer can act on it." };
  const role = clip(body?.role, 20);
  return {
    ok: true,
    value: {
      kind, concern,
      dealId: clip(body?.dealId, 80),
      role: role && ["landlord", "tenant", "vendor", "purchaser"].includes(role) ? role : null,
      companyId: clip(body?.companyId, 80),
    },
  };
}

export interface RegisterUpdate {
  status: RegisterStatus;
  reportedOn: string | null;
  reference: string | null;
  reason: string | null;
  details: RegisterDetails;
}

/** An officer's update, checked against the entry's kind. Dates may not be in the future. */
export function registerUpdateInput(body: any, kind: RegisterKind, today: string): { ok: true; value: RegisterUpdate } | { ok: false; error: string } {
  const status: RegisterStatus = (REGISTER_STATUSES as readonly string[]).includes(body?.status) ? body.status : "open";
  const reportedOn = day(body?.reportedOn);
  const reference = clip(body?.reference, 120);
  const reason = clip(body?.reason, 4000);
  if (status === "reported" && !reportedOn) return { ok: false, error: `Give the date it was reported to ${REGISTER_KIND_INFO[kind].reportedTo}.` };
  if (status === "no_report" && (!reason || reason.length < 10)) return { ok: false, error: "Record why no report is being made (at least a sentence)." };
  const raw = body?.details && typeof body.details === "object" ? body.details : {};
  const details: RegisterDetails = { notes: clip(raw.notes, 4000) };
  if (kind === "sanctions") {
    details.fundsHeld = clip(raw.fundsHeld, 1000);
    details.legalAdvice = clip(raw.legalAdvice, 500);
    details.outcome = ["declined", "licence", "continue"].includes(raw.outcome) ? raw.outcome : null;
    if (details.outcome === "continue" && !details.legalAdvice) return { ok: false, error: "Record the legal advice taken before BGP continues (AML policy 3.10)." };
  }
  if (kind === "suspicion") {
    details.furtherInfo = clip(raw.furtherInfo, 2000);
    details.seniorManagement = clip(raw.seniorManagement, 1000);
    details.damlRequestedOn = day(raw.damlRequestedOn);
    details.damlOutcome = ["granted", "refused", "deemed"].includes(raw.damlOutcome) ? raw.damlOutcome : null;
    details.damlOutcomeOn = day(raw.damlOutcomeOn);
    if (details.damlOutcome && !details.damlRequestedOn) return { ok: false, error: "Give the date the consent request was made." };
    if (details.damlOutcome && details.damlOutcome !== "deemed" && !details.damlOutcomeOn) return { ok: false, error: "Give the date the NCA answered." };
  }
  for (const [label, v] of [["reported", reportedOn], ["consent request", details.damlRequestedOn], ["NCA answer", details.damlOutcomeOn]] as const) {
    if (v && v > today) return { ok: false, error: `The ${label} date is in the future.` };
  }
  return { ok: true, value: { status, reportedOn, reference, reason, details } };
}

// What the person who raised an entry sees of it: that it reached the
// officers, and whether it is still open. Never the decision, a reference or
// whether anything was reported (tipping off).
export function reporterView(row: { id: number; kind: string; concern: string; created_at: string | Date | null; status: string }): { id: number; kind: RegisterKind; kindWords: string; concern: string; raisedAt: string | null; where: string } {
  const kind: RegisterKind = isRegisterKind(row.kind) ? (row.kind as RegisterKind) : "suspicion";
  return {
    id: Number(row.id), kind, kindWords: REGISTER_KIND_INFO[kind].short, concern: String(row.concern || ""),
    raisedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    where: registerStatusOf(row.status) === "open" ? "With the Nominated Officer" : "Dealt with by the Nominated Officer",
  };
}
