import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Receipt, X, Loader2 } from "lucide-react";

export interface XeroContact {
  ContactID: string;
  Name: string;
  AccountNumber: string | null;
  EmailAddress: string | null;
  BillingAddress: any | null;
  Addresses?: any[];
}

interface Props {
  value: string | null | undefined;
  cachedName?: string | null;
  cachedAccountNumber?: string | null;
  cachedAddress?: any | null;
  onChange: (contact: XeroContact | null) => void;
  placeholder?: string;
  testIdPrefix?: string;
  compact?: boolean;
}

function formatAddress(addr: any): string {
  if (!addr) return "";
  const parts = [addr.AddressLine1, addr.AddressLine2, addr.City, addr.Region, addr.PostalCode, addr.Country].filter(Boolean);
  return parts.join(", ");
}

export function XeroContactPicker({
  value,
  cachedName,
  cachedAccountNumber,
  cachedAddress,
  onChange,
  placeholder = "Search Xero contacts…",
  testIdPrefix = "xero-contact",
  compact,
}: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const trimmed = search.trim();
  const { data: contacts = [], isFetching } = useQuery<XeroContact[]>({
    queryKey: ["/api/xero/contacts", trimmed],
    queryFn: async () => {
      const url = trimmed
        ? `/api/xero/contacts?search=${encodeURIComponent(trimmed)}`
        : `/api/xero/contacts`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) return [];
        throw new Error(await res.text());
      }
      return res.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  const showSelected = !!value;
  const selectedAddress = cachedAddress ? formatAddress(cachedAddress) : "";

  if (showSelected && !open) {
    return (
      <div className={`flex items-start gap-2 rounded-md border bg-background px-3 py-2 ${compact ? "" : "min-h-[44px]"}`} data-testid={`${testIdPrefix}-selected`}>
        <Receipt className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{cachedName || "Xero contact"}</span>
            {cachedAccountNumber && (
              <Badge variant="outline" className="text-[10px]">A/C {cachedAccountNumber}</Badge>
            )}
          </div>
          {selectedAddress && !compact && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{selectedAddress}</div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-shrink-0"
          onClick={() => onChange(null)}
          data-testid={`${testIdPrefix}-clear`}
          title="Clear Xero contact"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        data-testid={`${testIdPrefix}-search`}
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg max-h-64 overflow-y-auto">
          {isFetching && (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Searching Xero…
            </div>
          )}
          {!isFetching && contacts.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {trimmed ? "No Xero contacts found" : "Type to search Xero contacts"}
            </div>
          )}
          {contacts.map((c) => {
            const addr = formatAddress(c.BillingAddress);
            return (
              <button
                key={c.ContactID}
                className="w-full text-left px-3 py-2 hover:bg-accent border-b last:border-b-0"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(c);
                  setSearch("");
                  setOpen(false);
                }}
                data-testid={`${testIdPrefix}-option-${c.ContactID}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{c.Name}</span>
                  {c.AccountNumber && (
                    <Badge variant="outline" className="text-[10px]">A/C {c.AccountNumber}</Badge>
                  )}
                </div>
                {addr && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{addr}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
