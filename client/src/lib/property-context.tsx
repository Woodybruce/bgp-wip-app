/**
 * PropertyContext — exposes the resolver-canonical property selection across
 * any tree wrapped in <PropertyProvider>. Pages opt into prefill by calling
 * usePropertyContext(); pages that don't care just ignore it.
 *
 * Used by: client/src/pages/property-intelligence.tsx wraps its children in
 * the provider, so all 5 tabs (Pathway, Map, Investigator, Land Registry,
 * Business Rates, Imagery) can consume — incrementally per-tab.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

export interface ResolvedProperty {
  id: string;
  name: string;
  postcode: string | null;
  address?: string | null;
  uprn?: string | null;
}

interface Ctx {
  property: ResolvedProperty | null;
  setProperty: (p: ResolvedProperty | null) => void;
}

const PropertyContext = createContext<Ctx>({ property: null, setProperty: () => {} });

export function PropertyProvider({ children, initial }: { children: ReactNode; initial?: ResolvedProperty | null }) {
  const [property, setProperty] = useState<ResolvedProperty | null>(initial || null);
  return (
    <PropertyContext.Provider value={{ property, setProperty }}>
      {children}
    </PropertyContext.Provider>
  );
}

/**
 * Read the canonical property selection. Returns null if not in a provider
 * or no property is resolved yet — callers must handle null.
 */
export function usePropertyContext(): ResolvedProperty | null {
  return useContext(PropertyContext).property;
}

/**
 * Read + write — for pages that resolve properties (e.g. the resolver bar
 * itself, the matter detail when it changes property).
 */
export function usePropertySetter(): (p: ResolvedProperty | null) => void {
  return useContext(PropertyContext).setProperty;
}
