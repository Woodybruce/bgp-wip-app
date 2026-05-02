import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { requireAuth, getUserIdFromToken } from "./auth";
import { pool } from "./db";
import { saveFile } from "./file-storage";

const router = Router();

const KYC_UPLOAD_DIR = path.join(process.cwd(), "ChatBGP", "kyc-uploads");
if (!fs.existsSync(KYC_UPLOAD_DIR)) fs.mkdirSync(KYC_UPLOAD_DIR, { recursive: true });
const kycUpload = multer({ dest: KYC_UPLOAD_DIR, limits: { fileSize: 25 * 1024 * 1024 } });

const ALLOWED_DOC_TYPES = new Set([
  "passport", "certified_passport", "drivers_licence", "proof_of_address",
  "source_of_funds", "source_of_wealth", "ubo_declaration", "company_cert",
  "bank_statement", "onfido_report", "other",
]);

// --- AML Settings (Nominated Officer, Firm Risk Assessment, Policy) ---

router.get("/api/aml/settings", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM aml_settings ORDER BY id LIMIT 1");
    res.json(result.rows[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/aml/settings", requireAuth, async (req: Request, res: Response) => {
  try {
    const {
      nominatedOfficerId, nominatedOfficerName, nominatedOfficerEmail,
      nominatedOfficerAppointedAt, firmRiskAssessment, firmRiskAssessmentUpdatedBy,
      amlPolicyNotes, recheckIntervalDays,
    } = req.body;

    const existing = await pool.query("SELECT id FROM aml_settings LIMIT 1");

    if (existing.rows.length > 0) {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      const addField = (col: string, val: any) => {
        if (val !== undefined) {
          sets.push(`${col} = $${idx++}`);
          vals.push(val);
        }
      };

      addField("nominated_officer_id", nominatedOfficerId);
      addField("nominated_officer_name", nominatedOfficerName);
      addField("nominated_officer_email", nominatedOfficerEmail);
      addField("nominated_officer_appointed_at", nominatedOfficerAppointedAt);
      if (firmRiskAssessment !== undefined) {
        addField("firm_risk_assessment", JSON.stringify(firmRiskAssessment));
        sets.push(`firm_risk_assessment_updated_at = NOW()`);
        addField("firm_risk_assessment_updated_by", firmRiskAssessmentUpdatedBy);
      }
      addField("aml_policy_notes", amlPolicyNotes);
      addField("recheck_interval_days", recheckIntervalDays);
      sets.push("updated_at = NOW()");

      if (sets.length > 1) {
        vals.push(existing.rows[0].id);
        const result = await pool.query(
          `UPDATE aml_settings SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`,
          vals
        );
        return res.json(result.rows[0]);
      }
      return res.json(existing.rows[0]);
    } else {
      const result = await pool.query(
        `INSERT INTO aml_settings (nominated_officer_id, nominated_officer_name, nominated_officer_email, nominated_officer_appointed_at, firm_risk_assessment, firm_risk_assessment_updated_at, firm_risk_assessment_updated_by, aml_policy_notes, recheck_interval_days, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, NOW()) RETURNING *`,
        [
          nominatedOfficerId || null,
          nominatedOfficerName || null,
          nominatedOfficerEmail || null,
          nominatedOfficerAppointedAt || null,
          firmRiskAssessment ? JSON.stringify(firmRiskAssessment) : null,
          firmRiskAssessmentUpdatedBy || null,
          amlPolicyNotes || null,
          recheckIntervalDays || 365,
        ]
      );
      return res.json(result.rows[0]);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive training modules (content + quiz + attempts) ────────────

const STARTER_MODULES: Array<{
  title: string; description: string; estimatedMinutes: number;
  contentMarkdown: string;
  quiz: Array<{ question: string; options: string[]; correct: number; explanation?: string }>;
}> = [
  {
    title: "AML Essentials — MLR 2017 for Property Agents",
    description: "Baseline induction: the Money Laundering Regulations 2017 as they apply to BGP.",
    estimatedMinutes: 15,
    contentMarkdown: `## Why MLR 2017 applies to BGP
Estate agency businesses (EAB) are supervised by HMRC. Since the 2020 update, letting agency businesses handling rents of £8,500 PCM or more are also in scope.

## The five pillars you must know
1. **Customer Due Diligence (CDD)** — identify who the counterparty is and where the money comes from. Reg 27-28.
2. **Enhanced Due Diligence (EDD)** — for PEPs, high-risk third countries, and complex structures. Reg 33.
3. **Ongoing monitoring** — 6-month re-check cycle at BGP. Reg 28(11).
4. **Record-keeping** — 5 years minimum from end of business relationship. Reg 40.
5. **Suspicious Activity Reports (SARs)** — report to the MLRO IMMEDIATELY. Tipping-off the subject is a CRIMINAL OFFENCE.

## Red flags you'll see at BGP
- Buyer wants to close unusually fast without negotiation.
- Payments routed from a third party who isn't the named purchaser.
- SPV substituted late in the process with a newly-incorporated company.
- Source of funds story doesn't match the transaction size.
- Ownership chain passes through FATF-greylist jurisdictions without clear business rationale.

## Your duty
If anything feels off, escalate to the MLRO same-day. You do NOT need to be certain — "reasonable suspicion" is the threshold. The MLRO decides whether to file a SAR with the NCA.`,
    quiz: [
      { question: "What is the minimum record-keeping period under MLR 2017?", options: ["1 year", "3 years", "5 years", "7 years"], correct: 2 },
      { question: "Who must you tell if a counterparty triggers your suspicion?", options: ["The counterparty, so they can clarify", "The MLRO — immediately", "Your team lead first", "Nobody until you're 100% sure"], correct: 1, explanation: "Telling the counterparty = tipping-off = criminal offence. Always MLRO first." },
      { question: "The BGP KYC re-check cadence is:", options: ["Monthly", "Every 3 months", "Every 6 months", "Annually"], correct: 2 },
      { question: "Enhanced Due Diligence is required for:", options: ["Every new client", "PEPs, high-risk countries, complex structures", "Only residential transactions", "Only deals over £10m"], correct: 1 },
      { question: "If a buyer wants to close suddenly with cash from an unrelated third party, you should:", options: ["Proceed — the client is in a hurry", "Raise a same-day MLRO flag", "Ask the buyer to explain in writing and continue", "Escalate only if the amount is over £5m"], correct: 1 },
    ],
  },
  {
    title: "SAR Reporting — How to Escalate a Suspicion",
    description: "Process for filing a Suspicious Activity Report via the MLRO.",
    estimatedMinutes: 8,
    contentMarkdown: `## When to raise a SAR
The threshold is **reasonable grounds to suspect** — not certainty. If you would stop to think "is this normal?", that's enough.

## How at BGP
1. Document what triggered your suspicion (who, what, when, how much). No opinions, just facts.
2. Message the MLRO via the AML Compliance page (this system logs it).
3. Do NOT discuss with the subject, their agents, or anyone outside the MLRO chain. Tipping-off is a criminal offence carrying up to 5 years.
4. Continue business AS NORMAL with the subject until the MLRO instructs otherwise — sudden changes in your behaviour are themselves a tipping-off risk.

## What the MLRO does next
The MLRO reviews, may request more info, and decides whether to file with the National Crime Agency via SAR Online. If filed, a Defence Against Money Laundering (DAML) request may be submitted so BGP can continue the transaction without committing an offence.

## Timeline
The NCA has 7 working days to refuse consent. If they don't refuse, deemed consent is granted.`,
    quiz: [
      { question: "The threshold for filing a SAR is:", options: ["Certainty of wrongdoing", "Reasonable grounds to suspect", "A court order", "The MLRO's gut feeling"], correct: 1 },
      { question: "Telling the subject that you've raised a SAR is:", options: ["Best practice — honesty first", "A criminal offence (tipping-off)", "Fine if they're a long-standing client", "Required under GDPR"], correct: 1 },
      { question: "After raising a SAR, your behaviour towards the subject should:", options: ["Become cold and formal", "Stay normal until the MLRO says otherwise", "Stop all communication", "Demand additional documentation immediately"], correct: 1 },
    ],
  },
  {
    title: "Sanctions Screening — UK OFSI + OFAC Basics",
    description: "What the sanctions lists mean for a BGP deal and when you must stop.",
    estimatedMinutes: 10,
    contentMarkdown: `## The lists that matter
- **UK OFSI Consolidated List** — HM Treasury, legally binding in the UK. Updated daily.
- **OFAC SDN (USA)** — US persons and USD transactions. If BGP's deal touches a US bank, this applies.
- **EU Consolidated List** — post-Brexit less direct but still relevant for EU counterparties.

## When screening triggers
Every counterparty goes through Companies House + sanctions at the KYC stage. Hits are flagged RED on the deal page. You must not proceed without MLRO sign-off even if you think it's a false positive.

## False positives
Common names ("John Smith") will hit. The MLRO disambiguates using DOB, nationality, and passport number. If in doubt, stop.

## What a real hit looks like
- Named individual on the UK sanctions list
- Company owned ≥50% by a sanctioned individual (the "50% rule" — ownership aggregated across family members and associates)
- Vessel / aircraft associated with a sanctioned entity

## What you do
Stop the transaction. Notify the MLRO. Do NOT release any assets or payment already received — frozen means frozen. File a SAR AND a sanctions report to OFSI (the MLRO handles this).`,
    quiz: [
      { question: "A company is owned 40% by a sanctioned individual and 30% by their spouse. The company is:", options: ["Not sanctioned", "Only sanctioned via OFAC", "Treated as sanctioned under the 50% rule", "Sanctioned only if the spouse is also on the list"], correct: 2, explanation: "Ownership is aggregated across connected persons — 40% + 30% = 70% combined control." },
      { question: "A sanctions hit on the KYC screen turns out to be a common name match. You should:", options: ["Ignore it and proceed", "Ask the client to confirm it's a false positive", "Escalate to MLRO for disambiguation", "Cancel the deal immediately"], correct: 2 },
      { question: "If you discover sanctions apply to a deal in progress, frozen assets:", options: ["Can be released to the client's solicitor", "Must remain frozen until OFSI licence", "Can be returned to the purchaser", "Can be paid into a third-party escrow"], correct: 1 },
    ],
  },
  {
    title: "Source of Funds & Source of Wealth — Practical Verification",
    description: "How to evidence and challenge the money story on a BGP deal.",
    estimatedMinutes: 12,
    contentMarkdown: `## Why SoF and SoW are not the same
- **Source of Funds (SoF)** — the specific pot paying *this* transaction. e.g. "£1.4m from the sale of a flat in Fulham in Feb 2026, sitting in Barclays account ending 4417."
- **Source of Wealth (SoW)** — the cumulative story of how the client became wealthy overall. Business sale, inheritance, senior role in a listed firm, trust distributions.

Both are required on higher-risk deals (Reg 33). SoF alone without SoW is a red flag.

## Evidence that stands up
**Good:**
- Bank statement ≤3 months old, full PDF (not screenshot), showing the balance that will fund the deal.
- Solicitor's completion statement for a property sale feeding this one.
- Share-sale SPA + broker note confirming proceeds received.
- Trust deed + recent trustee distribution letter.
- Grant of probate + executor statement for inheritance.

**Not good enough:**
- "I'll show you proof at exchange." (never)
- Screenshot of a mobile banking app with no account number visible.
- A statement from an account that doesn't match the named purchaser.
- Cryptocurrency holdings without a fiat on-ramp trail.
- Loan from a family member without the lender's own SoW.

## Third-party funders
If the money comes from anyone other than the named purchaser, that third party is a counterparty too. You CDD them. Same standard. No exceptions.

## BGP rule of thumb
If the size of the deal makes sense against the SoW story, and the SoF evidence traces cleanly into the purchaser's account in the last 12 months, you're usually safe. If either side is vague, escalate.`,
    quiz: [
      { question: "Source of Wealth is:", options: ["The specific account paying this transaction", "The overall story of how the client got wealthy", "Required only for PEPs", "Only needed if the deal exceeds £10m"], correct: 1 },
      { question: "A purchaser says the £2m deposit will be wired from their brother's account. You:", options: ["Accept — family money is standard", "CDD the brother as a separate counterparty", "Ask for a signed gift letter and proceed", "Refuse unless it comes from the purchaser's own account"], correct: 1, explanation: "Third-party funders are their own KYC subject — same standard applies." },
      { question: "A client offers a mobile-banking screenshot as SoF. You should:", options: ["Accept it — it's a bank statement", "Ask for a full PDF statement with account details", "Ask them to email their banker", "Proceed if the balance matches the deal"], correct: 1 },
      { question: "Cryptocurrency as a source of funds requires:", options: ["Nothing extra — crypto is legitimate", "A fiat on-ramp trail (exchange statements, wire receipts)", "Only a wallet address screenshot", "Conversion to fiat before we'll consider it"], correct: 1 },
    ],
  },
  {
    title: "PEPs & Family / Close Associates — Enhanced Due Diligence",
    description: "Identifying Politically Exposed Persons and the people connected to them.",
    estimatedMinutes: 12,
    contentMarkdown: `## What a PEP is (Reg 35)
A Politically Exposed Person holds a prominent public function — current OR within the last 12 months. The UK definition includes:
- Heads of state, ministers, senior civil servants
- MPs, senior judges, central bank governors
- Senior military officers, ambassadors
- Senior executives of state-owned enterprises
- Senior officials of major international organisations

**UK domestic PEPs** (post-FSMA 2023) are treated as LOWER risk by default than foreign PEPs, but you still do EDD.

## The people around the PEP matter too
- **Family members** — spouse, civil partner, children, parents, siblings of a PEP.
- **Close associates** — individuals known to maintain close business or personal relations (business partners, long-term confidants).

If the *buyer* isn't a PEP but a family member is, you may still be dealing with PEP money. Dig.

## What EDD on a PEP looks like
1. Senior management approval before onboarding — at BGP, that's MLRO sign-off.
2. Establish source of wealth *and* source of funds (both, documented).
3. Ongoing enhanced monitoring — closer scrutiny of transactions through the relationship.
4. Re-approval at least annually.

## Common slip-ups
- Missing a PEP because they retired 11 months ago (still in the 12-month window).
- Treating a state-owned enterprise like a normal company — the CEO is a PEP by virtue of the role.
- Forgetting the PEP's adult children are also in scope.
- Accepting "I'm a private citizen now" without verifying the retirement date.

## BGP process
KYC Clouseau screens every named counterparty and officer against the sanctions + PEP feeds. Any hit → amber card on the Compliance Board → MLRO review before any invoice is raised.`,
    quiz: [
      { question: "A client retired as a cabinet minister 10 months ago. They are:", options: ["No longer a PEP", "Still a PEP — 12-month window applies", "Only a PEP if they held the role for 5+ years", "A domestic PEP but not a foreign PEP"], correct: 1 },
      { question: "The daughter of a foreign ambassador wants to buy a £4m flat. She is:", options: ["Not relevant to PEP rules", "Treated as a PEP family member — EDD applies", "Only relevant if she uses her father's money", "A PEP only if she's also politically active"], correct: 1 },
      { question: "EDD on a PEP at BGP requires:", options: ["No extra steps — standard CDD is enough", "MLRO senior-management sign-off before onboarding", "Just a Companies House check", "Only enhanced monitoring after the deal completes"], correct: 1 },
      { question: "The CEO of a state-owned sovereign wealth fund is:", options: ["Not a PEP — they work for an investment fund", "A PEP by virtue of the state-owned role", "Only a PEP if the fund is sanctioned", "A PEP only if personally named on a list"], correct: 1 },
    ],
  },
  {
    title: "Beneficial Ownership & SPV Structures — Seeing Through the Layers",
    description: "How to identify the natural persons behind corporate purchasers.",
    estimatedMinutes: 13,
    contentMarkdown: `## The 25% rule
A Beneficial Owner (BO) is any natural person who ultimately owns or controls more than 25% of a legal entity — directly or indirectly through a chain of companies and trusts. Below 25%, they're still a counterparty of interest if they exercise control via other means (voting rights, board appointments).

## The People with Significant Control (PSC) register
UK companies file PSCs at Companies House. It's your first stop but:
- It reflects what's been filed, not what's true.
- Overseas entities buying UK property now register with the **Register of Overseas Entities** (ROE) at Companies House — mandatory since August 2022.
- A company refusing to disclose its PSCs is itself a red flag.

## Common structures at BGP
- **Single UK SPV** — straightforward, PSC usually clean.
- **Jersey / Guernsey holding + UK SPV** — check the Channel Islands entity's BO register too.
- **Trust over an SPV** — you need the settlor, trustees, beneficiaries, and any protector.
- **Multi-layer offshore** — BVI → Cayman → Jersey → UK SPV. Each layer must resolve to named natural persons.

## Nominees and bearer shares
A nominee director or shareholder acting for an undisclosed principal is a red flag. Bearer shares are banned in the UK but still exist in some offshore jurisdictions — if you see them, stop.

## The layer test
If the ownership chain is deeper than 3 layers and there's no clean commercial reason (tax, succession, liability ring-fencing), treat the structure as higher risk.

## What we do at BGP
KYC Clouseau traces PSC chains and flags layers ≥3 deep. Overseas Entity IDs (OE numbers) are logged on the deal page. No SPV proceeds to invoice without the BO chain resolved to natural persons.`,
    quiz: [
      { question: "A Beneficial Owner is a natural person who owns or controls:", options: ["Any percentage of the entity", "More than 10%", "More than 25%", "More than 50%"], correct: 2 },
      { question: "The UK Register of Overseas Entities (ROE) applies to:", options: ["All UK companies", "Overseas entities buying or owning UK property", "Only Panama and BVI companies", "Trusts only"], correct: 1 },
      { question: "A purchaser refuses to disclose the PSCs of their SPV. You should:", options: ["Proceed — Companies House has it already", "Treat as a red flag and escalate", "Accept a lawyer's letter confirming the structure", "Only escalate if they're from a high-risk country"], correct: 1 },
      { question: "A BVI → Cayman → Jersey → UK SPV structure is:", options: ["Normal for HNW property deals", "Higher risk unless there's a clear commercial rationale", "Automatic sanctions territory", "Fine if the UK SPV is clean"], correct: 1 },
    ],
  },
  {
    title: "High-Risk Third Countries & FATF Lists",
    description: "When geography drives your EDD obligation.",
    estimatedMinutes: 8,
    contentMarkdown: `## The lists you must know
- **HM Treasury High-Risk Third Country list** — UK statutory instrument. Mirrors the FATF blacklist + greylist with UK tweaks. Legally binding EDD trigger.
- **FATF blacklist (Call for Action)** — currently DPRK, Iran, Myanmar. Near-total freeze of business.
- **FATF greylist (Increased Monitoring)** — larger, rotating. EDD required for any counterparty nexus.
- **UK sanctions list (OFSI)** — separate from the FATF framework but overlaps in practice.

## What "nexus" means
EDD applies if ANY of the following is true:
- The counterparty is incorporated or resident in a listed country.
- A significant shareholder or controller is resident there.
- The money originates from or transits through a listed jurisdiction.
- A material counterparty (solicitor, banker) is based there.

## EDD obligations when a list country is involved
1. Senior management approval — MLRO sign-off.
2. Enhanced source-of-wealth AND source-of-funds evidence.
3. Enhanced ongoing monitoring — re-check cycle halves to 3 months.
4. Consider whether the deal should proceed at all.

## The "business rationale" question
Ask yourself: why is the money coming via this country? If it's a legitimate commercial reason (e.g. the client genuinely lives in Dubai), fine — document it. If there's no clear reason the money had to route through Malta, treat as layering.

## Practical at BGP
KYC Clouseau flags counterparties with a listed-country nexus in red on the sanctions card. The MLRO decides go/no-go. If the deal proceeds, the 3-month re-check cadence is automated via the Compliance Board recheck queue.`,
    quiz: [
      { question: "EDD is required when a counterparty's money transits through a high-risk country, even if the counterparty themselves isn't based there.", options: ["True", "False — only if the counterparty is resident there", "Only if the amount exceeds £5m", "Only for sanctioned countries"], correct: 0 },
      { question: "The FATF blacklist currently includes:", options: ["DPRK, Iran, Myanmar", "Russia, China, Turkey", "Only countries under UN sanctions", "All OFAC-sanctioned countries"], correct: 0 },
      { question: "A client lives in Dubai and funds a London purchase from a UAE bank. This:", options: ["Is automatic EDD regardless of context", "Requires EDD but the business rationale may be clean", "Is banned under UK rules", "Only requires standard CDD"], correct: 1 },
      { question: "When a high-risk-country nexus exists, the BGP re-check cadence:", options: ["Stays at 6 months", "Shortens to 3 months", "Extends to 12 months", "Is abolished — one-off check only"], correct: 1 },
    ],
  },
];

// Seed the starter modules if the table is empty
async function seedStarterModules() {
  try {
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM aml_training_modules");
    if (count.rows[0]?.n > 0) return;
    for (const m of STARTER_MODULES) {
      await pool.query(
        `INSERT INTO aml_training_modules (title, description, content_markdown, quiz, estimated_minutes)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [m.title, m.description, m.contentMarkdown, JSON.stringify(m.quiz), m.estimatedMinutes]
      );
    }
    console.log("[aml-training] seeded", STARTER_MODULES.length, "starter modules");
  } catch (err: any) {
    console.warn("[aml-training] seed error:", err?.message);
  }
}
seedStarterModules();

router.get("/api/aml/training-modules", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM aml_training_modules WHERE active = true ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.get("/api/aml/training-modules/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM aml_training_modules WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Module not found" });
    res.json(result.rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/api/aml/training-modules/:id/attempt", requireAuth, async (req: Request, res: Response) => {
  try {
    const moduleRow = await pool.query("SELECT * FROM aml_training_modules WHERE id = $1", [req.params.id]);
    const mod = moduleRow.rows[0];
    if (!mod) return res.status(404).json({ error: "Module not found" });

    const { answers } = req.body as { answers: Record<number, number> };
    if (!answers || typeof answers !== "object") return res.status(400).json({ error: "answers object required" });

    const quiz = Array.isArray(mod.quiz) ? mod.quiz : JSON.parse(mod.quiz);
    let correct = 0;
    const detail: Array<{ index: number; picked: number; correct: number; right: boolean; explanation?: string }> = [];
    quiz.forEach((q: any, i: number) => {
      const picked = answers[i];
      const right = picked === q.correct;
      if (right) correct++;
      detail.push({ index: i, picked, correct: q.correct, right, explanation: q.explanation });
    });
    const score = Math.round((correct / quiz.length) * 100);
    const passed = score >= (mod.pass_score || 80);

    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    let userName: string | null = null;
    if (userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      userName = u.rows[0]?.name || null;
    }

    const attempt = await pool.query(
      `INSERT INTO aml_training_attempts (module_id, user_id, user_name, answers, score, passed, completed_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW()) RETURNING *`,
      [mod.id, userId, userName, JSON.stringify(answers), score, passed]
    );

    // On pass, auto-log to aml_training_records so the MLRO's existing
    // compliance view reflects completion.
    if (passed) {
      try {
        const nextDue = new Date();
        nextDue.setFullYear(nextDue.getFullYear() + 1);
        await pool.query(
          `INSERT INTO aml_training_records (user_id, user_name, training_type, training_date, completed_at, score, topics, notes, certified_by, next_due_date)
           VALUES ($1, $2, $3, NOW(), NOW(), $4, $5, $6, 'System (quiz pass)', $7)`,
          [
            userId, userName, mod.title, score,
            `{"${mod.title.replace(/"/g, '\\"')}"}`,
            `Completed online module · ${correct}/${quiz.length} correct`,
            nextDue,
          ]
        );
      } catch (logErr: any) {
        console.warn("[aml-training] record insert failed:", logErr?.message);
      }
    }

    res.json({ score, passed, correct, total: quiz.length, detail, attemptId: attempt.rows[0]?.id || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/aml/training-attempts", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, moduleId } = req.query;
    const conds: string[] = [];
    const params: any[] = [];
    if (userId) { params.push(userId); conds.push(`user_id = $${params.length}`); }
    if (moduleId) { params.push(moduleId); conds.push(`module_id = $${params.length}`); }
    const where = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT a.*, m.title AS module_title FROM aml_training_attempts a
       LEFT JOIN aml_training_modules m ON m.id = a.module_id
       ${where}
       ORDER BY a.completed_at DESC NULLS LAST, a.started_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// --- Training Records (legacy manual log — kept alongside the new modules) ---

router.get("/api/aml/training", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM aml_training_records ORDER BY training_date DESC"
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/aml/training", requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId, userName, trainingType, trainingDate, completedAt, score, topics, notes, certifiedBy, nextDueDate } = req.body;
    if (!userId || !userName || !trainingType || !trainingDate) {
      return res.status(400).json({ error: "userId, userName, trainingType, and trainingDate are required" });
    }
    const result = await pool.query(
      `INSERT INTO aml_training_records (user_id, user_name, training_type, training_date, completed_at, score, topics, notes, certified_by, next_due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        userId, userName, trainingType, trainingDate,
        completedAt || null, score || null,
        topics ? `{${topics.map((t: string) => `"${t}"`).join(",")}}` : null,
        notes || null, certifiedBy || null, nextDueDate || null,
      ]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/aml/training/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { completedAt, score, notes, certifiedBy, nextDueDate } = req.body;
    const sets: string[] = [];
    const vals: any[] = [req.params.id];
    let idx = 2;
    if (completedAt !== undefined) { sets.push(`completed_at = $${idx++}`); vals.push(completedAt); }
    if (score !== undefined) { sets.push(`score = $${idx++}`); vals.push(score); }
    if (notes !== undefined) { sets.push(`notes = $${idx++}`); vals.push(notes); }
    if (certifiedBy !== undefined) { sets.push(`certified_by = $${idx++}`); vals.push(certifiedBy); }
    if (nextDueDate !== undefined) { sets.push(`next_due_date = $${idx++}`); vals.push(nextDueDate); }
    if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });
    const result = await pool.query(`UPDATE aml_training_records SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/aml/training/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM aml_training_records WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Re-check Reminders ---

router.get("/api/aml/reminders", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM aml_recheck_reminders ORDER BY due_date ASC"
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/aml/reminders", requireAuth, async (req: Request, res: Response) => {
  try {
    const { dealId, companyId, entityName, recheckType, dueDate, notes } = req.body;
    if (!entityName || !recheckType || !dueDate) {
      return res.status(400).json({ error: "entityName, recheckType, and dueDate are required" });
    }
    const result = await pool.query(
      `INSERT INTO aml_recheck_reminders (deal_id, company_id, entity_name, recheck_type, due_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [dealId || null, companyId || null, entityName, recheckType, dueDate, notes || null]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/aml/reminders/:id/complete", requireAuth, async (req: Request, res: Response) => {
  try {
    const token = (req.headers.authorization?.replace("Bearer ", "") || req.query.token || "") as string;
    const userId = await getUserIdFromToken(token);
    let userName = "Unknown";
    if (userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      if (u.rows[0]) userName = u.rows[0].name;
    }
    const result = await pool.query(
      `UPDATE aml_recheck_reminders SET completed_at = NOW(), completed_by = $2 WHERE id = $1 RETURNING *`,
      [req.params.id, userName]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/aml/reminders/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await pool.query("DELETE FROM aml_recheck_reminders WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// --- Overdue reminders count (for dashboard) ---
router.get("/api/aml/reminders/overdue-count", requireAuth, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM aml_recheck_reminders WHERE due_date < NOW() AND completed_at IS NULL"
    );
    res.json({ count: parseInt(result.rows[0]?.count || "0") });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── KYC documents (proof of funds, certified passport, etc.) ─────────────

router.get("/api/kyc/documents", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId, contactId, dealId } = req.query;
    if (!companyId && !contactId && !dealId) {
      return res.status(400).json({ error: "Provide companyId, contactId, or dealId" });
    }
    const conditions: string[] = ["deleted_at IS NULL"];
    const params: any[] = [];
    if (companyId) { params.push(companyId); conditions.push(`company_id = $${params.length}`); }
    if (contactId) { params.push(contactId); conditions.push(`contact_id = $${params.length}`); }
    if (dealId) { params.push(dealId); conditions.push(`deal_id = $${params.length}`); }
    const result = await pool.query(
      `SELECT * FROM kyc_documents WHERE ${conditions.join(" AND ")} ORDER BY uploaded_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/kyc/documents/upload", requireAuth, kycUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });
    const { companyId, contactId, dealId, docType, certifiedBy, certifiedAt, expiresAt, notes } = req.body;
    if (!docType || !ALLOWED_DOC_TYPES.has(docType)) {
      return res.status(400).json({ error: "docType required, one of: " + Array.from(ALLOWED_DOC_TYPES).join(", ") });
    }
    if (!companyId && !contactId) {
      return res.status(400).json({ error: "Provide companyId or contactId" });
    }
    const ext = path.extname(file.originalname).toLowerCase() || "";
    const safeName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-${file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, "_")}`;
    const storageKey = `chat-media/${safeName}`;
    const buffer = fs.readFileSync(file.path);
    await saveFile(storageKey, buffer, file.mimetype || "application/octet-stream", file.originalname);
    try { fs.unlinkSync(file.path); } catch {}
    const fileUrl = `/api/chat-media/${safeName}`;
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    const inserted = await pool.query(
      `INSERT INTO kyc_documents
       (company_id, contact_id, deal_id, doc_type, file_url, file_name, file_size, mime_type,
        certified_by, certified_at, expires_at, notes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        companyId || null, contactId || null, dealId || null, docType,
        fileUrl, file.originalname, buffer.length, file.mimetype || null,
        certifiedBy || null, certifiedAt || null, expiresAt || null, notes || null,
        userId,
      ]
    );
    res.json(inserted.rows[0]);
  } catch (err: any) {
    console.error("[kyc-docs] upload error:", err?.message);
    res.status(500).json({ error: err?.message || "Upload failed" });
  }
});

router.patch("/api/kyc/documents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { certifiedBy, certifiedAt, expiresAt, notes, docType } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (certifiedBy !== undefined) { params.push(certifiedBy); updates.push(`certified_by = $${params.length}`); }
    if (certifiedAt !== undefined) { params.push(certifiedAt); updates.push(`certified_at = $${params.length}`); }
    if (expiresAt !== undefined) { params.push(expiresAt); updates.push(`expires_at = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }
    if (docType !== undefined && ALLOWED_DOC_TYPES.has(docType)) { params.push(docType); updates.push(`doc_type = $${params.length}`); }
    if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE kyc_documents SET ${updates.join(", ")} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/kyc/documents/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `UPDATE kyc_documents SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Per-company AML state (checklist + approval) ─────────────────────────

router.get("/api/kyc/company/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const company = await pool.query(
      `SELECT id, name, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at,
              aml_checklist, aml_risk_level, aml_pep_status, aml_source_of_wealth,
              aml_source_of_wealth_notes, aml_edd_required, aml_edd_reason, aml_notes,
              companies_house_number
       FROM crm_companies WHERE id = $1`,
      [req.params.id]
    );
    if (!company.rows[0]) return res.status(404).json({ error: "Company not found" });
    const docs = await pool.query(
      `SELECT * FROM kyc_documents WHERE company_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at DESC`,
      [req.params.id]
    );
    res.json({ company: company.rows[0], documents: docs.rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/api/kyc/company/:id/checklist", requireAuth, async (req: Request, res: Response) => {
  try {
    const { checklist, riskLevel, pepStatus, sourceOfWealth, sourceOfWealthNotes, eddRequired, eddReason, notes } = req.body;
    const updates: string[] = [];
    const params: any[] = [];
    if (checklist !== undefined) { params.push(JSON.stringify(checklist)); updates.push(`aml_checklist = $${params.length}::jsonb`); }
    if (riskLevel !== undefined) { params.push(riskLevel); updates.push(`aml_risk_level = $${params.length}`); }
    if (pepStatus !== undefined) { params.push(pepStatus); updates.push(`aml_pep_status = $${params.length}`); }
    if (sourceOfWealth !== undefined) { params.push(sourceOfWealth); updates.push(`aml_source_of_wealth = $${params.length}`); }
    if (sourceOfWealthNotes !== undefined) { params.push(sourceOfWealthNotes); updates.push(`aml_source_of_wealth_notes = $${params.length}`); }
    if (eddRequired !== undefined) { params.push(!!eddRequired); updates.push(`aml_edd_required = $${params.length}`); }
    if (eddReason !== undefined) { params.push(eddReason); updates.push(`aml_edd_reason = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); updates.push(`aml_notes = $${params.length}`); }
    // Bump kyc_status to in_review on first checklist edit if currently null/pending
    updates.push(`kyc_status = COALESCE(NULLIF(kyc_status, 'approved'), 'in_review')`);
    if (updates.length === 1) return res.status(400).json({ error: "No fields to update" });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE crm_companies SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING id, kyc_status, aml_checklist`,
      params
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Company not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/kyc/company/:id/approve", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    let approverName: string | null = req.body?.approverName || null;
    if (!approverName && userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      approverName = u.rows[0]?.name || null;
    }
    // MLR 2017 Reg 28: ongoing monitoring must be "proportionate" — for a
    // commercial property agency with recurring counterparties, BGP policy
    // is a 6-month re-check cadence on every approved counterparty.
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);
    const result = await pool.query(
      `UPDATE crm_companies
       SET kyc_status = 'approved', kyc_checked_at = NOW(), kyc_approved_by = $1, kyc_expires_at = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, name, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at`,
      [approverName, expiresAt, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Company not found" });
    // Auto-schedule the 12-month re-check reminder
    try {
      await pool.query(
        `INSERT INTO aml_recheck_reminders (company_id, entity_name, recheck_type, due_date, notes)
         VALUES ($1, $2, 'periodic_cdd', $3, 'Auto-generated on KYC approval — 6-month re-check')`,
        [req.params.id, result.rows[0].name, expiresAt]
      );
    } catch (rmErr: any) {
      console.warn("[kyc-approve] reminder insert failed:", rmErr?.message);
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/kyc/company/:id/reject", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    const reason = req.body?.reason || null;
    const result = await pool.query(
      `UPDATE crm_companies
       SET kyc_status = 'rejected', kyc_checked_at = NOW(), kyc_approved_by = $1,
           aml_notes = COALESCE(aml_notes || E'\\n', '') || ('Rejected: ' || COALESCE($2, 'no reason given')),
           updated_at = NOW()
       WHERE id = $3
       RETURNING id, kyc_status`,
      [userId, reason, req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Company not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Firm-wide risk assessment: MLR 2017 Reg 18 template + approval ───────

// Sensible starting point for a London commercial property consultancy.
// MLRO edits before approving — this is a DRAFT, not a rubber stamp.
const DEFAULT_RISK_ASSESSMENT_TEMPLATE = {
  overallRisk: "medium",
  clientRisk: [
    "Mix of UK corporate occupiers, UK institutional investors, overseas investors, and HNW individuals.",
    "Overseas counterparties (esp. Middle East, Hong Kong, Singapore, mainland China, Russia/CIS) elevate risk — require EDD on source of wealth.",
    "Corporate vehicles (UK Limited, LLPs, offshore SPVs) are common — UBO identification is the key control.",
    "Higher-risk: PEPs, politically connected family offices, complex trust structures, shell companies with recent incorporation.",
    "Lower-risk: FTSE-listed corporates, regulated financial institutions, UK public bodies.",
  ].join("\n"),
  serviceRisk: [
    "Leasing instructions (landlord or tenant rep) — moderate risk; settle via solicitors with CDD obligations of their own.",
    "Investment sales/acquisitions — higher risk; large cash sums, offshore purchasers, SPV re-structurings.",
    "Development advisory / tenant reps — usually lower risk.",
    "No handling of client money (no client account) — reduces inherent risk.",
    "We do not advise on lettings to residential tenants (out of MLR 2017 scope for lettings below 8500/mo).",
  ].join("\n"),
  geographicRisk: [
    "Central London — super-prime exposure across West End, Mayfair, City, Southbank.",
    "UK nationals: standard risk.",
    "FATF greylist/blacklist jurisdictions (e.g. UAE, Cayman, BVI) in ownership chains: EDD required.",
    "Russia, Belarus, Iran, North Korea — prohibited without explicit MLRO sign-off and sanctions screening.",
    "Hong Kong + mainland Chinese nationals: EDD given source-of-funds verification complexity.",
  ].join("\n"),
  transactionRisk: [
    "Unusually rapid transactions, pressure to exchange quickly — red flag.",
    "Cash-only purchases over 1m — mandatory EDD.",
    "Third-party payors (funds not from the stated purchaser) — mandatory EDD or decline.",
    "Frequent SPV substitutions during a deal — UBO re-verification required.",
    "Rent-free periods or fit-out contributions structured unusually — record rationale.",
    "Under-value or over-value transactions vs comps — document with rationale.",
  ].join("\n"),
  mitigatingMeasures: [
    "Nominated Officer (MLRO) appointed per MLR 2017 Reg 21; backup officer named.",
    "CDD on both counterparties BEFORE invoice is raised — enforced system-side on the deal page.",
    "KYC file reviewed every 6 months or on material change of circumstances (Reg 28).",
    "Staff training: induction, annual refresher, SAR reporting, red-flag recognition — tracked in system.",
    "Sanctions + PEP screening via Companies House + OFAC/UK OFSI lists on every approval.",
    "Biometric passport verification via Veriff for HNW and high-risk counterparties.",
    "Source of funds evidenced via bank statements / solicitor letter / loan documentation.",
    "Record-keeping: all CDD docs retained for 5 years per Reg 40.",
    "SAR procedure: any suspicion reported to the MLRO same-day; MLRO files to NCA where appropriate (Tipping-off warning — do NOT inform the subject).",
  ].join("\n"),
};

router.get("/api/aml/risk-assessment/template", requireAuth, (_req: Request, res: Response) => {
  res.json(DEFAULT_RISK_ASSESSMENT_TEMPLATE);
});

router.post("/api/aml/risk-assessment/populate-default", requireAuth, async (req: Request, res: Response) => {
  try {
    const existing = await pool.query("SELECT id FROM aml_settings LIMIT 1");
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    let userName: string | null = null;
    if (userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      userName = u.rows[0]?.name || null;
    }
    const payload = JSON.stringify(DEFAULT_RISK_ASSESSMENT_TEMPLATE);
    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE aml_settings SET
          firm_risk_assessment = $1::jsonb,
          firm_risk_assessment_updated_at = NOW(),
          firm_risk_assessment_updated_by = $2,
          firm_risk_assessment_status = 'draft'
         WHERE id = $3`,
        [payload, userName, existing.rows[0].id]
      );
    } else {
      await pool.query(
        `INSERT INTO aml_settings (firm_risk_assessment, firm_risk_assessment_updated_at, firm_risk_assessment_updated_by, firm_risk_assessment_status)
         VALUES ($1::jsonb, NOW(), $2, 'draft')`,
        [payload, userName]
      );
    }
    res.json({ success: true, populated: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/aml/risk-assessment/approve", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId || null;
    let approverName: string | null = req.body?.approverName || null;
    if (!approverName && userId) {
      const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
      approverName = u.rows[0]?.name || null;
    }
    // Next review in 12 months (MLR 2017 Reg 18 — annual review is industry standard)
    const nextReview = new Date();
    nextReview.setFullYear(nextReview.getFullYear() + 1);
    const result = await pool.query(
      `UPDATE aml_settings SET
         firm_risk_assessment_status = 'approved',
         firm_risk_assessment_approved_at = NOW(),
         firm_risk_assessment_approved_by = $1,
         firm_risk_assessment_next_review_at = $2
       WHERE id = (SELECT id FROM aml_settings LIMIT 1)
       RETURNING *`,
      [approverName, nextReview]
    );
    if (!result.rows[0]) return res.status(400).json({ error: "No risk assessment exists yet — populate the template first" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cross-link helpers so the KYC hub tabs route workflow between each other ───

// Find the CRM company (if any) that matches a given Companies House number
// or name. Used by the Investigator after a verdict — if there's a hit, we
// show a 'Manage compliance profile' link to /companies/:id.
router.get("/api/kyc/match-company", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyNumber, companyName } = req.query as { companyNumber?: string; companyName?: string };
    if (!companyNumber && !companyName) return res.status(400).json({ error: "companyNumber or companyName required" });
    if (companyNumber) {
      const r = await pool.query(
        `SELECT id, name, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at, companies_house_number
         FROM crm_companies WHERE companies_house_number = $1 OR companies_house_number = LPAD($1, 8, '0') LIMIT 1`,
        [companyNumber]
      );
      if (r.rows[0]) return res.json(r.rows[0]);
    }
    if (companyName) {
      const r = await pool.query(
        `SELECT id, name, kyc_status, kyc_checked_at, kyc_approved_by, kyc_expires_at, companies_house_number
         FROM crm_companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [companyName]
      );
      if (r.rows[0]) return res.json(r.rows[0]);
    }
    res.json(null);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new CRM company from an investigation so the MLRO can start the
// compliance workflow without retyping anything.
router.post("/api/kyc/create-company-from-investigation", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyNumber, companyName, companyType, address } = req.body;
    if (!companyName) return res.status(400).json({ error: "companyName required" });
    const existing = companyNumber
      ? await pool.query(
          `SELECT id FROM crm_companies WHERE companies_house_number = $1 OR companies_house_number = LPAD($1, 8, '0') LIMIT 1`,
          [companyNumber]
        )
      : { rows: [] as any[] };
    if (existing.rows[0]) return res.json({ id: existing.rows[0].id, existed: true });
    const r = await pool.query(
      `INSERT INTO crm_companies (name, companies_house_number, head_office_address, company_type, kyc_status)
       VALUES ($1, $2, $3::jsonb, $4, 'pending')
       RETURNING id, name`,
      [companyName, companyNumber || null, address ? JSON.stringify(address) : null, companyType || null]
    );
    res.json({ id: r.rows[0].id, name: r.rows[0].name, created: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Live deals the current user owns — feeds the 'My live deals' panel on
// the Training tab so a user who's just finished a module immediately sees
// where their attention is needed.
router.get("/api/kyc/my-deals", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id || (req.session as any)?.userId;
    if (!userId) return res.json([]);
    const u = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
    const userName: string | null = u.rows[0]?.name || null;
    const names: string[] = userName ? [userName] : [];
    // crmDeals.internal_agent is a text[] of user names; also match agent id columns
    const result = await pool.query(
      `SELECT d.id, d.name, d.status, d.deal_type, d.fee, d.updated_at,
              d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id,
              p.name AS property_name,
              (SELECT c.name FROM crm_companies c WHERE c.id = d.landlord_id) AS landlord_name,
              (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.landlord_id) AS landlord_kyc,
              (SELECT c.name FROM crm_companies c WHERE c.id = d.tenant_id) AS tenant_name,
              (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.tenant_id) AS tenant_kyc,
              (SELECT c.name FROM crm_companies c WHERE c.id = d.vendor_id) AS vendor_name,
              (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.vendor_id) AS vendor_kyc,
              (SELECT c.name FROM crm_companies c WHERE c.id = d.purchaser_id) AS purchaser_name,
              (SELECT c.kyc_status FROM crm_companies c WHERE c.id = d.purchaser_id) AS purchaser_kyc
       FROM crm_deals d
       LEFT JOIN crm_properties p ON d.property_id = p.id
       WHERE d.status NOT IN ('WIT', 'COM', 'INV')
         AND (
           d.vendor_agent_id = $1 OR d.acquisition_agent_id = $1 OR
           d.purchaser_agent_id = $1 OR d.leasing_agent_id = $1 OR
           ($2::text[] && d.internal_agent)
         )
       ORDER BY d.updated_at DESC NULLS LAST
       LIMIT 15`,
      [userId, names]
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Compliance board — all counterparties grouped by KYC status ──────────

router.get("/api/kyc/board", requireAuth, async (_req: Request, res: Response) => {
  try {
    // Pull every company that's referenced by at least one live deal
    // (landlord/tenant/vendor/purchaser) so the board shows the people
    // we actually need to AML, not the entire CRM.
    //
    // Rewritten to avoid correlated subqueries per company — instead we
    // build the deal list and doc count via GROUP BY joins on small sets.
    const result = await pool.query(
      `WITH deal_roles AS (
         SELECT d.id AS deal_id, d.name AS deal_name, d.landlord_id AS company_id, 'landlord' AS role
           FROM crm_deals d WHERE d.landlord_id IS NOT NULL AND d.landlord_id <> '' AND d.status NOT IN ('WIT')
         UNION ALL
         SELECT d.id, d.name, d.tenant_id, 'tenant'
           FROM crm_deals d WHERE d.tenant_id IS NOT NULL AND d.tenant_id <> '' AND d.status NOT IN ('WIT')
         UNION ALL
         SELECT d.id, d.name, d.vendor_id, 'vendor'
           FROM crm_deals d WHERE d.vendor_id IS NOT NULL AND d.vendor_id <> '' AND d.status NOT IN ('WIT')
         UNION ALL
         SELECT d.id, d.name, d.purchaser_id, 'purchaser'
           FROM crm_deals d WHERE d.purchaser_id IS NOT NULL AND d.purchaser_id <> '' AND d.status NOT IN ('WIT')
       ),
       company_deals AS (
         SELECT company_id,
                json_agg(json_build_object('id', deal_id, 'name', deal_name, 'role', role)
                         ORDER BY deal_name) AS deals
           FROM deal_roles
          GROUP BY company_id
       ),
       company_docs AS (
         SELECT kd.company_id, COUNT(*)::int AS doc_count
           FROM kyc_documents kd
          WHERE kd.deleted_at IS NULL
          GROUP BY kd.company_id
       )
       SELECT
         c.id, c.name, c.kyc_status, c.kyc_checked_at, c.kyc_approved_by,
         c.kyc_expires_at, c.aml_risk_level, c.aml_pep_status,
         c.aml_checklist, c.companies_house_number,
         COALESCE(cd.doc_count, 0) AS doc_count,
         cdl.deals
       FROM crm_companies c
       JOIN company_deals cdl ON cdl.company_id = c.id
       LEFT JOIN company_docs cd ON cd.company_id = c.id
       ORDER BY c.name ASC`
    );

    // Checklist keys must match server/kyc-orchestrator.ts CHECKLIST_KEYS
    // and client/src/components/kyc-panel.tsx CHECKLIST_ITEMS.
    const CHECKLIST_KEYS = [
      "id_verified", "address_verified", "ubo_identified", "company_cert",
      "sof_evidenced", "sow_evidenced", "sanctions_clear", "pep_checked",
      "adverse_media", "edd_complete", "risk_assessed", "mlro_review",
    ];
    const TOTAL_CHECKS = CHECKLIST_KEYS.length;

    const now = new Date();
    const rows = result.rows.map((r: any) => {
      const isExpired = r.kyc_expires_at ? new Date(r.kyc_expires_at) < now : false;
      const checklist = (r.aml_checklist || {}) as Record<string, { ticked?: boolean; source?: string }>;
      const tickedCount = CHECKLIST_KEYS.reduce(
        (sum, k) => (checklist[k]?.ticked ? sum + 1 : sum),
        0,
      );
      const autoTickedCount = CHECKLIST_KEYS.reduce(
        (sum, k) => (checklist[k]?.ticked && checklist[k]?.source && checklist[k]?.source !== "manual" ? sum + 1 : sum),
        0,
      );
      const mlroSignedOff = !!checklist["mlro_review"]?.ticked;
      const hasAnyProgress = tickedCount > 0 || r.doc_count > 0;

      // Board movement logic — cards slide rightwards as automation +
      // manual review progress. "approved" still requires the MLRO to
      // explicitly sign off (either via the kyc_status enum or by
      // ticking mlro_review), so we never auto-approve.
      let column: "missing" | "in_review" | "approved" | "rejected" | "expired";
      if (r.kyc_status === "rejected") {
        column = "rejected";
      } else if ((r.kyc_status === "approved" || mlroSignedOff) && isExpired) {
        column = "expired";
      } else if (r.kyc_status === "approved" || (mlroSignedOff && tickedCount === TOTAL_CHECKS)) {
        column = "approved";
      } else if (r.kyc_status === "in_review" || hasAnyProgress) {
        column = "in_review";
      } else {
        column = "missing";
      }

      return {
        ...r,
        column,
        isExpired,
        checklist_ticked_count: tickedCount,
        checklist_auto_ticked_count: autoTickedCount,
        checklist_total: TOTAL_CHECKS,
        mlro_signed_off: mlroSignedOff,
      };
    });

    res.json({
      counts: {
        missing: rows.filter((r: any) => r.column === "missing").length,
        in_review: rows.filter((r: any) => r.column === "in_review").length,
        approved: rows.filter((r: any) => r.column === "approved").length,
        expired: rows.filter((r: any) => r.column === "expired").length,
        rejected: rows.filter((r: any) => r.column === "rejected").length,
        total: rows.length,
      },
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deals-needing-KYC board: every live un-invoiced deal ─────────────────

router.get("/api/kyc/board/deals", requireAuth, async (_req: Request, res: Response) => {
  try {
    // Every live deal that hasn't been invoiced yet — these are the deals
    // that MUST have AML cleared on both sides before they can be invoiced.
    //
    // Rewritten to use 4 LEFT JOINs against crm_companies instead of 12
    // scalar correlated subqueries per row.
    const result = await pool.query(
      `SELECT
         d.id, d.name, d.status, d.deal_type, d.fee, d.updated_at, d.property_id,
         d.landlord_id, d.tenant_id, d.vendor_id, d.purchaser_id,
         d.kyc_approved, d.exchanged_at, d.completed_at,
         p.name AS property_name,
         lc.name AS landlord_name, lc.kyc_status AS landlord_kyc, lc.kyc_expires_at AS landlord_kyc_expires,
         tc.name AS tenant_name,   tc.kyc_status AS tenant_kyc,   tc.kyc_expires_at AS tenant_kyc_expires,
         vc.name AS vendor_name,   vc.kyc_status AS vendor_kyc,   vc.kyc_expires_at AS vendor_kyc_expires,
         pc.name AS purchaser_name,pc.kyc_status AS purchaser_kyc,pc.kyc_expires_at AS purchaser_kyc_expires
       FROM crm_deals d
       LEFT JOIN crm_properties p ON d.property_id = p.id
       LEFT JOIN crm_companies lc ON d.landlord_id  = lc.id
       LEFT JOIN crm_companies tc ON d.tenant_id    = tc.id
       LEFT JOIN crm_companies vc ON d.vendor_id    = vc.id
       LEFT JOIN crm_companies pc ON d.purchaser_id = pc.id
       WHERE d.status NOT IN ('WIT', 'COM', 'INV')
       ORDER BY d.updated_at DESC NULLS LAST`
    );

    const now = new Date();
    const rows = result.rows.map((d: any) => {
      const cps: Array<{ id: string; name: string; role: string; status: string | null; expiresAt: string | null; isApproved: boolean; isExpired: boolean }> = [];
      const push = (id: string | null, name: string | null, role: string, status: string | null, expiresAt: string | null) => {
        if (!id || !name) return;
        const isExpired = expiresAt ? new Date(expiresAt) < now : false;
        cps.push({ id, name, role, status, expiresAt, isApproved: status === "approved" && !isExpired, isExpired });
      };
      push(d.landlord_id, d.landlord_name, "landlord", d.landlord_kyc, d.landlord_kyc_expires);
      push(d.tenant_id, d.tenant_name, "tenant", d.tenant_kyc, d.tenant_kyc_expires);
      push(d.vendor_id, d.vendor_name, "vendor", d.vendor_kyc, d.vendor_kyc_expires);
      push(d.purchaser_id, d.purchaser_name, "purchaser", d.purchaser_kyc, d.purchaser_kyc_expires);

      const anyStarted = cps.some(c => c.status && c.status !== "pending");
      const allApproved = cps.length >= 2 && cps.every(c => c.isApproved);
      let column: "not_started" | "in_progress" | "ready_to_invoice";
      if (allApproved) column = "ready_to_invoice";
      else if (anyStarted) column = "in_progress";
      else column = "not_started";

      return {
        id: d.id,
        name: d.name,
        status: d.status,
        dealType: d.deal_type,
        fee: d.fee,
        updatedAt: d.updated_at,
        propertyName: d.property_name,
        counterparties: cps,
        column,
        canInvoice: allApproved,
      };
    });

    res.json({
      counts: {
        not_started: rows.filter((r: any) => r.column === "not_started").length,
        in_progress: rows.filter((r: any) => r.column === "in_progress").length,
        ready_to_invoice: rows.filter((r: any) => r.column === "ready_to_invoice").length,
        total: rows.length,
      },
      rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Deal-level rollup: AML status of both counterparties ─────────────────

router.get("/api/kyc/deal/:id/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const dealRow = await pool.query(
      `SELECT id, name, deal_type, landlord_id, tenant_id, vendor_id, purchaser_id,
              client_contact_id, kyc_approved
       FROM crm_deals WHERE id = $1`,
      [req.params.id]
    );
    if (!dealRow.rows[0]) return res.status(404).json({ error: "Deal not found" });
    const d = dealRow.rows[0];

    // Pick the counterparties relevant to this deal type
    const counterpartyIds: Array<{ id: string; role: string }> = [];
    if (d.landlord_id) counterpartyIds.push({ id: d.landlord_id, role: "landlord" });
    if (d.tenant_id) counterpartyIds.push({ id: d.tenant_id, role: "tenant" });
    if (d.vendor_id) counterpartyIds.push({ id: d.vendor_id, role: "vendor" });
    if (d.purchaser_id) counterpartyIds.push({ id: d.purchaser_id, role: "purchaser" });

    const counterparties: any[] = [];
    for (const cp of counterpartyIds) {
      const r = await pool.query(
        "SELECT id, name, kyc_status, kyc_expires_at, kyc_approved_by FROM crm_companies WHERE id = $1",
        [cp.id]
      );
      if (r.rows[0]) {
        counterparties.push({
          ...r.rows[0],
          role: cp.role,
          isApproved: r.rows[0].kyc_status === "approved",
          isExpired: r.rows[0].kyc_expires_at ? new Date(r.rows[0].kyc_expires_at) < new Date() : false,
        });
      }
    }

    const allApproved = counterparties.length >= 2 && counterparties.every(c => c.isApproved && !c.isExpired);
    const missing = counterparties.filter(c => !c.isApproved || c.isExpired).map(c => c.name);

    res.json({
      dealId: d.id,
      dealName: d.name,
      counterparties,
      allApproved,
      canInvoice: allApproved,
      missing,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
