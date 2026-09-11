// ─────────────────────────────────────────────────────────────────────────
// Non-lettable "unit" detection. Landlord schedules (Westgate Oxford was
// the offender) list every revenue line as a unit — InPost lockers, power
// bank stations, vending sites, ATMs, photo booths — and imports were
// carrying them onto the Letting Tracker as if they were shops to let.
// One shared test: the one-off sweep uses it to purge, and every
// available_units insert path uses it to keep them out for good.
// ─────────────────────────────────────────────────────────────────────────

const JUNK_UNIT_RE = new RegExp(
  [
    "inpost",
    "\\block ?ers?\\b",
    "power ?bank",
    "vending",
    "\\batm\\b",
    "cash ?machine",
    "photo ?booth",
    "photobooth",
    "kiddie ride",
    "massage chair",
    "charging (station|point)",
    "car ?wash",
    "click ?& ?collect locker",
    "parcel locker",
  ].join("|"),
  "i",
);

/** True when a unit name is a non-lettable revenue line, not a shop. */
export function isJunkUnitName(name: string | null | undefined): boolean {
  const n = (name || "").trim();
  if (!n) return false;
  return JUNK_UNIT_RE.test(n);
}
