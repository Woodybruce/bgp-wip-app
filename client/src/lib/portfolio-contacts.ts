import type { PortfolioContactEntry, PortfolioContactGroup, PortfolioContactRelationship } from "@shared/portfolio-contacts";

export type PortfolioContactsFilter = {
  group: "all" | PortfolioContactGroup;
  propertyId: string;
  search: string;
};

const normalize = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
const searchTerms = (value: string) => normalize(value).trim().split(/\s+/).filter(Boolean);
const relationshipText = (relationship: PortfolioContactRelationship) => normalize([
  relationship.source, relationship.property?.name, relationship.deal?.name,
  relationship.unit?.name, relationship.unitName, relationship.status,
].filter(Boolean).join(" "));

export function portfolioRelationships(entry: PortfolioContactEntry, filter: PortfolioContactsFilter) {
  const terms = searchTerms(filter.search);
  return entry.relationships
    .filter(relationship => (filter.group === "all" || relationship.group === filter.group)
      && (filter.propertyId === "all" || relationship.property?.id === filter.propertyId))
    .map((relationship, index) => ({ relationship, index, matches: terms.filter(term => relationshipText(relationship).includes(term)).length }))
    .sort((a, b) => b.matches - a.matches || a.index - b.index)
    .map(item => item.relationship);
}

export function filterPortfolioContacts(entries: PortfolioContactEntry[], filter: PortfolioContactsFilter) {
  const terms = searchTerms(filter.search);
  return entries.filter(entry => {
    const relationships = portfolioRelationships(entry, filter);
    if (relationships.length === 0) return false;
    const text = normalize([entry.name, entry.role, entry.email, entry.phone, entry.company?.name,
      entry.side === "bgp" ? "BGP" : "", ...relationships.map(relationshipText)].filter(Boolean).join(" "));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id));
}

export function portfolioContactsPage<T>(entries: T[], requestedPage: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  const start = (page - 1) * pageSize;
  return { entries: entries.slice(start, start + pageSize), page, pageCount, start, end: Math.min(start + pageSize, entries.length) };
}
