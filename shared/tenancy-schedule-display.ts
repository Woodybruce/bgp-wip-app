export function tenancyStatusMatches(status: string | null | undefined, filter: string): boolean {
  const value = (status || "").trim().toLowerCase();
  const wanted = filter.trim().toLowerCase();
  if (wanted === "occupied") return ["occupied", "trading", "let", "not vacant"].includes(value);
  if (wanted === "vacant") return ["vacant", "void", "available", "ava"].includes(value);
  return value === wanted;
}

export function isArchivedTenancy(row: { status?: string | null; occupancy_status?: string | null }): boolean {
  return tenancyStatusMatches(row.status, "Archived") || tenancyStatusMatches(row.occupancy_status, "Archived");
}

export function recordedTenancyTotal(values: unknown[]) {
  let total = 0, known = 0;
  for (const value of values) {
    if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") continue;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) continue;
    total += number;
    known++;
  }
  return { total: known ? total : null, known, rows: values.length };
}

export function normaliseTenancyUnitReference(raw: string | null | undefined): string {
  return (raw || "")
    .toUpperCase()
    .replace(/\b(UNIT|STORE|SHOP)\b/g, " ")
    .replace(/[^A-Z0-9/&-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/([A-Z]+)0+(\d)/g, "$1$2"))
    .join(" ")
    .trim();
}

export function findTenancyUnitLink<T extends { id: string }>(
  explicitId: string | null | undefined,
  unitReference: string | null | undefined,
  candidates: T[] | undefined,
  reference: (candidate: T) => string | null | undefined,
): T | undefined {
  if (explicitId) return candidates?.find(candidate => candidate.id === explicitId);
  const key = normaliseTenancyUnitReference(unitReference);
  if (!key) return undefined;
  const matches = candidates?.filter(candidate => normaliseTenancyUnitReference(reference(candidate)) === key) || [];
  return matches.length === 1 ? matches[0] : undefined;
}
