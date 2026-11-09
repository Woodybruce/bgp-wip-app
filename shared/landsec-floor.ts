// Landsec's feeds give floors as codes — 100 + floor number, so 99 is the
// basement, 100 ground, 101 first — plus "MultiFloorUnits". The unit name
// usually carries the centre's own level name ("Bluewater - Lower Level"),
// which wins when present (Woody, 2026-09-28: "fix the wrong records").
const CODE_LABELS: Record<string, string> = {
  "98": "Lower basement",
  "99": "Basement",
  "100": "Ground",
  "101": "First",
  "102": "Second",
  "103": "Third",
  "104": "Fourth",
  "105": "Fifth",
  "multifloorunits": "Multiple floors",
};

export function isLandsecFloorCode(value: string | null | undefined): boolean {
  return Object.prototype.hasOwnProperty.call(CODE_LABELS, String(value ?? "").trim().toLowerCase());
}

export function landsecFloorLabel(value: string | null | undefined, unitName?: string | null): string | null {
  const code = String(value ?? "").trim();
  if (!isLandsecFloorCode(code)) return value ?? null;
  const level = String(unitName || "").match(/\b(lower|upper|middle)\s+level\b/i)?.[1];
  if (level) return `${level.charAt(0).toUpperCase()}${level.slice(1).toLowerCase()} Level`;
  return CODE_LABELS[code.toLowerCase()];
}
