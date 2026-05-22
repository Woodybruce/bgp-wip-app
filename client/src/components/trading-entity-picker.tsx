import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { EntityCombobox, type EntityComboboxItem } from "@/components/entity-combobox";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";

interface TradingEntity {
  id: string;
  parentCompanyId: string;
  name: string;
  companiesHouseNumber: string | null;
  vatNumber: string | null;
  isDefault: boolean;
}

interface Props {
  /** Parent brand id whose trading entities we list. Empty disables the picker. */
  parentCompanyId: string;
  value: string | null | undefined;
  onChange: (id: string) => void;
  /** Inline-create writes a new row under the parent and selects it. */
  allowCreate?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
}

// Picker for the formal legal / billing entity under a parent brand.
// The brand is what the team thinks in ("Pret"); the entity is what's
// on the lease and what we KYC ("Pret A Manger UK Ltd, CH 01057547").
// Same shape as the company picker — searchable list + inline-create
// of a new entity if it doesn't exist yet.
export function TradingEntityPicker({
  parentCompanyId,
  value,
  onChange,
  allowCreate = true,
  placeholder = "Pick trading entity",
  className,
  testId,
}: Props) {
  const { data: entities = [], isLoading } = useQuery<TradingEntity[]>({
    queryKey: ["/api/crm/companies", parentCompanyId, "trading-entities"],
    queryFn: async () => {
      if (!parentCompanyId) return [];
      const r = await fetch(`/api/crm/companies/${parentCompanyId}/trading-entities`, {
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!parentCompanyId,
    staleTime: 60_000,
  });

  // Auto-select the default entity when the parent changes and no
  // explicit pick has been made. Means a deal landed on "Pret" gets
  // "Pret A Manger UK Ltd" by default without Layla touching the picker.
  React.useEffect(() => {
    if (!value && entities.length > 0) {
      const def = entities.find((e) => e.isDefault) || entities[0];
      if (def) onChange(def.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentCompanyId, entities.length]);

  const items: EntityComboboxItem[] = entities.map((e) => ({
    id: e.id,
    label: e.name,
    subLabel: [
      e.companiesHouseNumber ? `CH ${e.companiesHouseNumber}` : null,
      e.isDefault ? "default" : null,
    ].filter(Boolean).join(" · ") || undefined,
    keywords: [e.companiesHouseNumber || "", e.vatNumber || ""],
  }));

  const handleCreate = async (name: string): Promise<EntityComboboxItem> => {
    const r = await apiRequest("POST", "/api/crm/trading-entities", {
      parentCompanyId,
      name: name.trim(),
      // Default to is_default when no existing default exists, so the
      // first entity for a brand becomes the canonical pick.
      isDefault: entities.length === 0,
    });
    const created = await r.json();
    queryClient.invalidateQueries({ queryKey: ["/api/crm/companies", parentCompanyId, "trading-entities"] });
    return { id: created.id, label: created.name };
  };

  return (
    <EntityCombobox
      testId={testId || "select-trading-entity"}
      placeholder={parentCompanyId ? placeholder : "Pick a company first"}
      searchPlaceholder="Search trading entities…"
      emptyText={isLoading ? "Loading…" : "No entities yet — type to create one"}
      items={items}
      value={value}
      onChange={onChange}
      disabled={!parentCompanyId}
      onCreate={allowCreate && parentCompanyId ? handleCreate : undefined}
      createLabel="trading entity"
      className={className}
    />
  );
}
