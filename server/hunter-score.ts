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
