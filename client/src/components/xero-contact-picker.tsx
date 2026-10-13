import { getAuthHeaders, startXeroConnect } from "@/lib/queryClient";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);
  // Opening from a linked contact ("Change") swaps the card for the search
  // box — focus it so typing works straight away (Layla, 2026-10-13: a
  // linked contact left no way to type a different one).
  useEffect(() => { if (open && value) inputRef.current?.focus(); }, [open, value]);

  const trimmed = search.trim();
  // Track Xero auth state separately so we can distinguish "no contacts"
  // from "not connected" in the empty UI. Surfaces the actionable error
  // ("Connect Xero in Settings") rather than the misleading "no contacts found".
  const [notConnected, setNotConnected] = useState(false);
  const { data: contacts = [], isFetching, error } = useQuery<XeroContact[]>({
    queryKey: ["/api/xero/contacts", trimmed],
    queryFn: async () => {
      const url = trimmed
        ? `/api/xero/contacts?search=${encodeURIComponent(trimmed)}`
        : `/api/xero/contacts`;
      const res = await fetch(url, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) {
        if (res.status === 401) {
          setNotConnected(true);
          return [];
        }
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || `Xero search failed (${res.status})`);
      }
      setNotConnected(false);
      return res.json();
    },
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });

  // Nothing at all came back — ask the server which Xero organisation it
  // searched, so the empty list says why (Layla, 2026-10-13).
  const emptyAnswer = open && !isFetching && !notConnected && !error && contacts.length === 0;
  const { data: check } = useQuery<any>({
    queryKey: ["/api/xero/contacts-check"],
    queryFn: async () => {
      const r = await fetch("/api/xero/contacts-check", { credentials: "include", headers: getAuthHeaders() });
      return r.ok ? r.json() : null;
    },
    enabled: emptyAnswer,
    staleTime: 30_000,
    retry: false,
  });
  const describe = (label: string, x: any) => !x?.connected ? `${label}: not signed in`
    : x.error ? `${label}: Xero said "${x.error}"`
    : `${label}: ${x.org || "unknown organisation"}, ${x.contacts === 100 ? "100+" : x.contacts} contacts${x.moved ? " (moved to the firm's organisation — search again)" : ""}${x.orgs?.length > 1 ? ` · your Xero login sees ${x.orgs.join(", ")}` : ""}`;

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
          variant="outline"
          size="sm"
          className="h-6 px-2 rounded-full text-[11px] flex-shrink-0"
          onClick={() => setOpen(true)}
          data-testid={`${testIdPrefix}-change`}
        >
          Change
        </Button>
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
        ref={inputRef}
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
          {!isFetching && notConnected && (
            <div className="px-3 py-2 text-xs text-muted-foreground space-y-1.5">
              <p>You're not signed in to Xero.</p>
              <Button
                size="sm"
                className="h-7 rounded-full"
                onMouseDown={(e) => { e.preventDefault(); void startXeroConnect({ returnTo: window.location.pathname + window.location.search }); }}
                data-testid={`${testIdPrefix}-connect`}
              >
                Connect to Xero
              </Button>
            </div>
          )}
          {!isFetching && !notConnected && error && (
            <div className="px-3 py-2 text-xs text-destructive" data-testid={`${testIdPrefix}-error`}>
              Xero search didn't work: {(error as Error).message.slice(0, 200)}
            </div>
          )}
          {!isFetching && !notConnected && !error && contacts.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {trimmed
                  ? "No Xero contacts found"
                  : "Type to search Xero contacts"}
              {check && (
                <div className="mt-1 space-y-0.5 text-[11px]" data-testid={`${testIdPrefix}-check`}>
                  <p>{describe("Your Xero sign-in", check.mine)}</p>
                  <p>{describe("Firm Xero link", check.firm)}</p>
                </div>
              )}
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
          {!isFetching && !notConnected && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-muted-foreground hover:bg-accent border-t"
              onMouseDown={(e) => { e.preventDefault(); void startXeroConnect({ returnTo: window.location.pathname + window.location.search }); }}
              data-testid={`${testIdPrefix}-reconnect`}
            >
              Connect to Xero again (switch organisation or fix missing contacts)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
