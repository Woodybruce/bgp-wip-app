/** Only a complete UK postcode can identify the area for a property lookup. */
export function fullPropertyPostcode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().toUpperCase().match(/^(GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})$/);
  if (!match) return null;
  const compact = match[1].replace(/\s/g, "");
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

export function postcodeFromPropertyAddress(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === "object") {
    const fields = address as Record<string, unknown>;
    const saved = fullPropertyPostcode(fields.postcode);
    if (saved) return saved;
    return postcodeFromPropertyAddress(Object.values(fields).filter(v => typeof v === "string").join(", "));
  }
  if (typeof address !== "string") return null;
  const matches = address.toUpperCase().match(/\b(?:GIR\s*0AA|[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/g);
  return matches?.length ? fullPropertyPostcode(matches[matches.length - 1]) : null;
}

export function propertyLookupIdentity(property: { postcode?: unknown; uprn?: unknown; address?: unknown }) {
  const address = property.address && typeof property.address === "object"
    ? property.address as Record<string, unknown> : {};
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const uprn = text(property.uprn);
  return {
    postcode: fullPropertyPostcode(property.postcode) || postcodeFromPropertyAddress(property.address),
    uprn: uprn && /^\d{1,12}$/.test(uprn) ? uprn : undefined,
    street: text(address.street),
    streetNumber: text(address.streetNumber) || text(address.buildingNumber),
  };
}
