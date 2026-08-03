// ─────────────────────────────────────────────────────────────────────────
// Hunter expansion scorer — evaluates how likely a brand is to take new UK
// space in the next 12 months. Used by:
//   - GET /api/brands/hunter           (bulk dashboard)
//   - GET /api/brand/:id/hunter-score  (single-brand surfacing)
//
// Score is 0-100; flags are short human-readable labels. The signal mix is
// deliberately broad so brands without one strong signal can still rank
// high if multiple weaker signals pile up.
// ─────────────────────────────────────────────────────────────────────────

const EUROPE_KEYWORDS = ["paris", "milan", "berlin", "amsterdam", "dubai", "new york", "nyc", "tokyo", "sydney", "los angeles"];
const DTC_KEYWORDS = ["online only", "dtc", "direct to consumer", "direct-to-consumer", "e-commerce", "ecommerce", "no stores"];

export interface HunterScoreInput {
  brand: {
    id: string;
    name: string;
    rollout_status?: string | null;
    store_count?: number | null;
    backers?: string | null;
    instagram_handle?: string | null;
    tiktok_handle?: string | null;
    dept_store_presence?: string | null;
    franchise_activity?: string | null;
    hunter_flag?: boolean | null;
    concept_pitch?: string | null;
    description?: string | null;
    stock_ticker?: string | null;
  };
  signals: Array<{ signal_type: string; headline?: string | null; magnitude?: string | null; sentiment?: string | null }>;
  stock?: { signals?: { strongMomentum?: boolean; stockMomentum?: boolean; largeCap?: boolean; midCap?: boolean } } | null;
}

export interface HunterScoreOutput {
  expansionScore: number;
  expansionFlags: string[];
}

export function computeHunterScore(input: HunterScoreInput): HunterScoreOutput {
  const b = input.brand;
  const signals = input.signals || [];
  const stock = input.stock || null;
  let score = 0;
  const flags: string[] = [];

  if (b.hunter_flag) { score += 25; flags.push("Hunter Pick"); }

  if (b.rollout_status === "entering_uk") { score += 30; flags.push("Entering UK"); }
  else if (b.rollout_status === "scaling") { score += 20; flags.push("Scaling"); }
  else if (b.rollout_status === "rumoured") { score += 10; flags.push("Rumoured"); }

  if (b.dept_store_presence) { score += 20; flags.push("Dept Store Entry"); }
  if (b.franchise_activity) { score += 15; flags.push("Franchise Abroad"); }

  if (b.backers) { score += 10; flags.push("Funded"); }

  if (b.tiktok_handle) { score += 5; flags.push("TikTok"); }
  if (b.instagram_handle) { score += 5; flags.push("Instagram"); }

  if (b.store_count && b.store_count > 0) { score += 5; flags.push("Has Stores"); }

  const pitchLower = (b.concept_pitch || "").toLowerCase();
  const descLower = (b.description || "").toLowerCase();
  if (DTC_KEYWORDS.some(k => pitchLower.includes(k) || descLower.includes(k))) {
    score += 10; flags.push("DTC / Online-only");
  }

  const fundingSignals = signals.filter(s => s.signal_type === "funding");
  if (fundingSignals.length > 0) { score += 15; flags.push("Funding Raised"); }

  const openingSignals = signals.filter(s => s.signal_type === "opening" && s.sentiment !== "negative");
  if (openingSignals.length > 0) {
    const boost = Math.min(openingSignals.length * 8, 16);
    score += boost;
    flags.push(`${openingSignals.length} New Opening${openingSignals.length > 1 ? "s" : ""}`);
  }

  const execSignals = signals.filter(s => s.signal_type === "exec_change" && s.sentiment === "positive");
  if (execSignals.length > 0) { score += 8; flags.push("New Leadership"); }

  const allText = [b.concept_pitch, b.description, b.franchise_activity, b.dept_store_presence,
    ...signals.map(s => s.headline)].filter(Boolean).join(" ").toLowerCase();
  const euroMatches = EUROPE_KEYWORDS.filter(city => allText.includes(city));
  if (euroMatches.length > 0) {
    score += Math.min(euroMatches.length * 5, 15);
    flags.push("European Presence");
  }

  const popUpSignals = signals.filter(s =>
    (s.headline || "").toLowerCase().includes("pop-up") ||
    (s.headline || "").toLowerCase().includes("popup") ||
    (s.signal_type === "opening" && (s.headline || "").toLowerCase().includes("temporary"))
  );
  if (popUpSignals.length > 0) { score += 10; flags.push("Pop-up Activity"); }

  const newsSignals = signals.filter(s => s.signal_type === "news" && s.sentiment === "positive");
  if (newsSignals.length >= 3) { score += 8; flags.push("Press Momentum"); }
  else if (newsSignals.length >= 1) { score += 3; }

  const sectorSignals = signals.filter(s => s.signal_type === "sector_move");
  if (sectorSignals.length > 0) { score += 5; flags.push("Format Pivot"); }

  if (stock?.signals) {
    if (stock.signals.strongMomentum) { score += 15; flags.push("Stock +40% YoY"); }
    else if (stock.signals.stockMomentum) { score += 10; flags.push("Stock Momentum"); }
    if (stock.signals.largeCap) { score += 5; flags.push("Large Cap"); }
    else if (stock.signals.midCap) { score += 3; flags.push("Mid Cap"); }
  }

  return { expansionScore: Math.min(score, 100), expansionFlags: flags };
}

// ─────────────────────────────────────────────────────────────────────────
// Expansion Intelligence v2 (Woody, 2026-08-03). Four legible sub-scores,
// each 0-25, built from dated / geo-tagged / confidence-rated facts with a
// ~6-month half-life, negatives for closures and distress, and BGP's own
// ground truth (requirements, viewings, offers, deals) in the score. Every
// contribution is returned as a line so the panel can show WHY.
// ─────────────────────────────────────────────────────────────────────────

export interface ExpansionFact {
  signal_type: string;
  headline?: string | null;
  magnitude?: string | null;
  sentiment?: string | null;
  geography?: string | null;   // uk | europe | row | unknown
  confidence?: string | null;  // confirmed | reported | rumour
  signal_date?: string | Date | null;
  created_at?: string | Date | null;
}

export interface BgpEvidence {
  activeRequirements: number;   // BGP-logged requirements, Active
  pipnetRequirements: number;   // external market requirements feed
  liveDeals: number;            // deals not WIT/COM/INV with brand as tenant
  offers90d: number;
  viewings90d: number;
  interactions90d: number;      // emails/calls/meetings with brand contacts
  representedBy: number;        // active agent representations
}

export interface ExpansionScoreV2 {
  score: number;
  subScores: { ukMomentum: number; capacity: number; intent: number; engagement: number };
  lines: { points: number; label: string; bucket: "ukMomentum" | "capacity" | "intent" | "engagement" }[];
  expansionScore: number;       // legacy alias
  expansionFlags: string[];     // legacy chips — top contributing lines
}

const HALF_LIFE_MONTHS = 6;

function decayWeight(fact: ExpansionFact): number {
  const raw = fact.signal_date || fact.created_at;
  if (!raw) return 0.5; // undated facts count at half weight
  const ageMonths = Math.max(0, (Date.now() - new Date(raw as any).getTime()) / (30 * 86400000));
  return Math.pow(0.5, ageMonths / HALF_LIFE_MONTHS);
}

function confidenceWeight(fact: ExpansionFact): number {
  const c = (fact.confidence || "").toLowerCase();
  if (c === "confirmed") return 1;
  if (c === "rumour") return 0.35;
  return 0.7; // reported / unknown
}

// Geography fallback for facts written before v2 columns existed.
function factGeography(fact: ExpansionFact): "uk" | "europe" | "row" | "unknown" {
  const g = (fact.geography || "").toLowerCase();
  if (g === "uk" || g === "europe" || g === "row") return g as any;
  const hay = (fact.headline || "").toLowerCase();
  if (/\b(uk|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|oxford|cambridge|britain|british|england|scotland|wales)\b/.test(hay)) return "uk";
  return "unknown";
}

export function computeExpansionScoreV2(input: {
  brand: HunterScoreInput["brand"] & { rollout_status?: string | null };
  facts: ExpansionFact[];
  stock?: HunterScoreInput["stock"];
  covenant?: { grade?: string | null } | null;
  bgp?: Partial<BgpEvidence> | null;
}): ExpansionScoreV2 {
  const lines: ExpansionScoreV2["lines"] = [];
  const add = (bucket: ExpansionScoreV2["lines"][number]["bucket"], points: number, label: string) => {
    if (Math.abs(points) < 0.5) return;
    lines.push({ bucket, points: Math.round(points), label });
  };
  const facts = input.facts || [];
  const b = input.brand;
  const bgp: BgpEvidence = {
    activeRequirements: 0, pipnetRequirements: 0, liveDeals: 0,
    offers90d: 0, viewings90d: 0, interactions90d: 0, representedBy: 0,
    ...(input.bgp || {}),
  };

  // ── UK momentum — what they're actually doing on the ground ──
  let openUk = 0, closeUk = 0;
  for (const f of facts) {
    const w = decayWeight(f) * confidenceWeight(f);
    const geo = factGeography(f);
    if (f.signal_type === "opening") {
      if (geo === "uk") { openUk += 7 * w; }
      else if (geo === "unknown") { openUk += 2.5 * w; }
      else if (geo === "europe") { openUk += 1.5 * w; }
    } else if (f.signal_type === "closure") {
      if (geo === "uk" || geo === "unknown") closeUk += 6 * w;
    } else if (f.signal_type === "hiring" && geo !== "row") {
      openUk += 2.5 * w;
    }
  }
  if (openUk > 0) add("ukMomentum", Math.min(openUk, 22), "UK openings & hiring, time-decayed");
  if (closeUk > 0) add("ukMomentum", -Math.min(closeUk, 20), "UK closures, time-decayed");
  if (b.rollout_status === "entering_uk") add("ukMomentum", 8, "Marked entering UK");
  else if (b.rollout_status === "scaling") add("ukMomentum", 5, "Marked scaling");

  // ── Capacity — can they fund a rollout ──
  for (const f of facts) {
    if (f.signal_type !== "funding") continue;
    const w = decayWeight(f) * confidenceWeight(f);
    add("capacity", (f.magnitude === "large" ? 14 : 9) * w, `Funding: ${String(f.headline || "raise").slice(0, 60)}`);
  }
  const grade = (input.covenant?.grade || "").toUpperCase();
  if (["A", "STRONG"].some(g => grade.startsWith(g))) add("capacity", 8, `Covenant grade ${grade}`);
  else if (["D", "E", "WEAK", "DISTRESS"].some(g => grade.startsWith(g))) add("capacity", -10, `Covenant grade ${grade}`);
  if (input.stock?.signals?.strongMomentum) add("capacity", 8, "Stock +40% YoY");
  else if (input.stock?.signals?.stockMomentum) add("capacity", 5, "Stock momentum");
  if (openUk > closeUk && openUk > 2) add("capacity", 3, "Estate growing, not shrinking");

  // ── Intent — are they telling the market they want space ──
  if (bgp.activeRequirements > 0) add("intent", Math.min(bgp.activeRequirements * 8, 14), `${bgp.activeRequirements} active requirement${bgp.activeRequirements === 1 ? "" : "s"} with BGP`);
  if (bgp.pipnetRequirements > 0) add("intent", Math.min(bgp.pipnetRequirements * 4, 8), `${bgp.pipnetRequirements} live market requirement${bgp.pipnetRequirements === 1 ? "" : "s"}`);
  if (bgp.representedBy > 0) add("intent", 3, "Actively represented by agents");
  for (const f of facts) {
    if (f.signal_type !== "requirement") continue;
    add("intent", 5 * decayWeight(f) * confidenceWeight(f), `Stated requirement: ${String(f.headline || "").slice(0, 60)}`);
  }
  if (b.dept_store_presence) add("intent", 2, "Department-store concessions");
  if (b.franchise_activity) add("intent", 2, "Franchising abroad");

  // ── BGP engagement — the ground truth: are they transacting with us ──
  if (bgp.liveDeals > 0) add("engagement", Math.min(bgp.liveDeals * 8, 14), `${bgp.liveDeals} live deal${bgp.liveDeals === 1 ? "" : "s"} with BGP`);
  if (bgp.offers90d > 0) add("engagement", Math.min(bgp.offers90d * 5, 8), `${bgp.offers90d} offer${bgp.offers90d === 1 ? "" : "s"} in 90 days`);
  if (bgp.viewings90d > 0) add("engagement", Math.min(bgp.viewings90d * 3, 6), `${bgp.viewings90d} viewing${bgp.viewings90d === 1 ? "" : "s"} in 90 days`);
  if (bgp.interactions90d >= 5) add("engagement", 4, `${bgp.interactions90d} touchpoints in 90 days`);
  else if (bgp.interactions90d > 0) add("engagement", 2, `${bgp.interactions90d} touchpoint${bgp.interactions90d === 1 ? "" : "s"} in 90 days`);

  const clamp25 = (n: number) => Math.max(0, Math.min(25, Math.round(n)));
  const bucketTotal = (bucket: string) => lines.filter(l => l.bucket === bucket).reduce((n, l) => n + l.points, 0);
  const subScores = {
    ukMomentum: clamp25(bucketTotal("ukMomentum")),
    capacity: clamp25(bucketTotal("capacity")),
    intent: clamp25(bucketTotal("intent")),
    engagement: clamp25(bucketTotal("engagement")),
  };
  const score = subScores.ukMomentum + subScores.capacity + subScores.intent + subScores.engagement;
  const flags = lines
    .filter(l => l.points > 0)
    .sort((a, b2) => b2.points - a.points)
    .slice(0, 6)
    .map(l => l.label.length > 34 ? `${l.label.slice(0, 32)}…` : l.label);

  return { score, subScores, lines, expansionScore: score, expansionFlags: flags };
}
