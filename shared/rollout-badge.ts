// The rollout badge on a brand (Entering UK, Scaling, Rumoured) lapses six
// months after it was set (Woody, 2026-11-15: "Yes to all on expansion").
// Greene King was the case: marked Scaling while it sold 24 pubs and its
// headcount fell 20%. The date is crm_companies.rollout_status_at, stamped
// when the badge changes or a person saves it again. A badge set before the
// date was kept counts from 15 November 2026. A lapsed badge scores nothing
// and is drawn greyed; saving it again renews it.

export const ROLLOUT_BADGE_DAYS = 183;
export const ROLLOUT_BADGE_UNDATED_FROM = "2026-11-15";
const DAY = 86400000;

export interface RolloutBadge {
  status: string | null;
  live: boolean;
  setAt: string | null;      // yyyy-mm-dd, null when the date was not kept
  lapsesOn: string | null;   // yyyy-mm-dd
}

export function rolloutBadge(status: unknown, setAt: unknown, now: Date = new Date()): RolloutBadge {
  const value = String(status ?? "").trim();
  if (!value) return { status: null, live: false, setAt: null, lapsesOn: null };
  const stamped = setAt ? new Date(setAt as any).getTime() : NaN;
  const from = Number.isFinite(stamped) ? stamped : Date.parse(ROLLOUT_BADGE_UNDATED_FROM);
  const lapses = from + ROLLOUT_BADGE_DAYS * DAY;
  return {
    status: value,
    live: now.getTime() < lapses,
    setAt: Number.isFinite(stamped) ? new Date(stamped).toISOString().slice(0, 10) : null,
    lapsesOn: new Date(lapses).toISOString().slice(0, 10),
  };
}
