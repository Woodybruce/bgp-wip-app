// An email box that looks in the CRM as it is typed (Woody, 25 November 2026:
// "link to our CRM so when type emails come up here and then does name if its
// found and has a create contact if its new"). Typing a name or an email lists
// the CRM's contacts that match; picking one fills the email (and the mobile
// when the form has a box for it). An email no contact holds says it will be
// added to the CRM: the server saves it when the request is sent.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { getAuthHeaders } from "@/lib/queryClient";

type Hit = { id: string; name: string; email: string | null; companyName: string | null; phone: string | null; phoneMobile: string | null };

export function CrmEmailInput({ value, onChange, onPick, personName, savedUnder, placeholder, testId }: {
  value: string;
  onChange: (email: string) => void;
  /** A CRM contact was picked: its name and numbers, for forms that take them. */
  onPick?: (c: { id: string; name: string; email: string; mobile: string | null }) => void;
  /** Whose email: their CRM records are offered before anything is typed. */
  personName?: string | null;
  /** Where a new contact is filed, in words ("Tokoro Capital"). */
  savedUnder?: string | null;
  placeholder?: string;
  testId?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [term, setTerm] = useState("");
  const typed = value.trim();
  // A short wait so each key press is not a request.
  useEffect(() => {
    const next = typed.length >= 2 ? typed : (personName || "").trim();
    const t = window.setTimeout(() => setTerm(next), 250);
    return () => window.clearTimeout(t);
  }, [typed, personName]);
  const { data } = useQuery<{ data: Hit[]; total: number }>({
    queryKey: ["/api/crm/contacts", "lookup", term],
    queryFn: async () => {
      const r = await fetch(`/api/crm/contacts?${new URLSearchParams({ search: term, page: "1", limit: "6" })}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return { data: [], total: 0 };
      return r.json();
    },
    enabled: term.length >= 2,
    staleTime: 30_000,
  });
  const hits = (data?.data || []).filter(h => !!h.email);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed);
  const exact = validEmail ? hits.find(h => (h.email || "").toLowerCase() === typed.toLowerCase()) || null : null;
  const showList = focused && hits.length > 0 && !exact;
  return (
    <div className="relative space-y-1" data-testid={testId ? `${testId}-crm` : undefined}>
      <Input type="email" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || "Their email"}
        onFocus={() => setFocused(true)} onBlur={() => window.setTimeout(() => setFocused(false), 150)} autoComplete="off" data-testid={testId} />
      {showList && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md" data-testid="crm-email-hits">
          <li className="px-2 py-1 text-[11px] text-muted-foreground">In the CRM</li>
          {hits.map(h => (
            <li key={h.id}>
              <button type="button" className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(h.email || ""); onPick?.({ id: h.id, name: h.name, email: h.email || "", mobile: h.phoneMobile || h.phone || null }); setFocused(false); }}
                data-testid={`crm-email-hit-${h.id}`}>
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-muted-foreground">{[h.email, h.companyName].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {exact ? (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400" data-testid="crm-email-found">In the CRM: {exact.name}{exact.companyName ? `, ${exact.companyName}` : ""}</p>
      ) : validEmail && data ? (
        <p className="text-[11px] text-muted-foreground" data-testid="crm-email-new">New contact: added to the CRM{savedUnder ? ` under ${savedUnder}` : ""} when you send.</p>
      ) : null}
    </div>
  );
}
