/**
 * CovenantBadge — compact tenant/counterparty covenant grade pill.
 * Fetches the house covenant report (/api/covenant/:number — CH + Gazette +
 * accounts, the free Red Flag replacement) and renders A–E with a hover
 * breakdown of flags + verdict. Drop it anywhere a company number appears.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const GRADE_STYLE: Record<string, string> = {
  A: "bg-emerald-600 text-white",
  B: "bg-emerald-500/80 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-orange-600 text-white",
  E: "bg-red-700 text-white",
};


// Covenant grades come from BGP's own credit engine and the endpoint is
// staff-only, so every client render of this badge fired a 403 and showed
// nothing anyway. Gate it here, once, rather than at each call site.
function useIsClientViewer(): boolean {
  const { data } = useQuery<any>({ queryKey: ["/api/auth/me"], staleTime: 5 * 60 * 1000 });
  return data?.role === "Client" || !!data?.companyScopeId;
}

export function CovenantBadge({ companyNumber, showScore = true, className = "" }: {
  companyNumber?: string | null;
  showScore?: boolean;
  className?: string;
}) {
  const num = (companyNumber || "").trim();
  const isClientViewer = useIsClientViewer();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["covenant", num],
    queryFn: async () => (await apiRequest("GET", `/api/covenant/${encodeURIComponent(num)}`)).json(),
    enabled: !!num && !isClientViewer,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (!num || isClientViewer) return null;
  if (isLoading) return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground ${className}`}>covenant…</span>;
  if (!data?.grade) return null;

  const reds = (data.flags || []).filter((f: any) => f.level === "red");
  const ambers = (data.flags || []).filter((f: any) => f.level === "amber");
  const tip = [
    `${data.companyName} — covenant ${data.grade} (${data.score}/100)`,
    ...reds.map((f: any) => `● ${f.label}${f.detail ? ` — ${f.detail}` : ""}`),
    ...ambers.map((f: any) => `◦ ${f.label}`),
    data.verdict || "",
  ].filter(Boolean).join("\n");

  return (
    <span
      title={tip}
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold cursor-help ${GRADE_STYLE[data.grade] || "bg-muted"} ${className}`}
      data-testid={`covenant-badge-${num}`}
    >
      {data.grade}
      {showScore && <span className="font-normal opacity-90">{data.score}</span>}
      {reds.length > 0 && <span className="font-normal">⚑{reds.length}</span>}
    </span>
  );
}


// Variant for surfaces that only hold a CRM company id (tenancy schedules,
// deal rows) — the server resolves the CH number. Renders nothing when the
// company has no Companies House number linked.
export function CovenantBadgeByCompany({ companyId, className = "" }: { companyId?: string | null; className?: string }) {
  const id = (companyId || "").trim();
  const isClientViewer = useIsClientViewer();
  const { data } = useQuery<any>({
    queryKey: ["covenant-crm", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/covenant/by-crm/${encodeURIComponent(id)}`);
      if (res.status === 204) return null;
      return res.json();
    },
    enabled: !!id && !isClientViewer,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  if (isClientViewer || !data?.grade) return null;
  const reds = (data.flags || []).filter((f: any) => f.level === "red");
  const tip = [`${data.companyName} — covenant ${data.grade} (${data.score}/100)`, ...reds.map((f: any) => `● ${f.label}`), data.verdict || ""].filter(Boolean).join("\n");
  return (
    <span title={tip} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold cursor-help ${GRADE_STYLE[data.grade] || "bg-muted"} ${className}`}>
      {data.grade}{reds.length > 0 && <span className="font-normal">⚑{reds.length}</span>}
    </span>
  );
}
