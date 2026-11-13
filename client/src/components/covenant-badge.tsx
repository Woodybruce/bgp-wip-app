/**
 * CovenantBadge — compact tenant/counterparty covenant grade pill.
 * Fetches the house covenant report (/api/covenant/:number — CH + Gazette +
 * accounts, the free Red Flag replacement) and renders A–E with a hover
 * breakdown of flags + verdict. Drop it anywhere a company number appears.
 */
import { useQuery } from "@tanstack/react-query";
import { AiCommentary } from "@/components/ai-commentary";
import { apiRequest } from "@/lib/queryClient";
import { useLandsecRestricted } from "@/hooks/use-landsec-restricted";

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
// The gateway refuses the report by company number to a Landsec asset
// manager or joint agent, so those logins are not sent to ask for it.
export function useCovenantReportEnabled(num: string): boolean {
  const restricted = useLandsecRestricted();
  return !!num && !restricted;
}

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
  const enabled = useCovenantReportEnabled(num);
  const { data, isLoading } = useQuery<any>({
    queryKey: ["covenant", num],
    queryFn: async () => (await apiRequest("GET", `/api/covenant/${encodeURIComponent(num)}`)).json(),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (!num) return null;
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
// `note` is added to the end of the tooltip (the tenancy schedule says the
// grade is the brand's own company, not the company on the lease).
export function CovenantBadgeByCompany({ companyId, className = "", note }: { companyId?: string | null; className?: string; note?: string }) {
  const id = (companyId || "").trim();
  const isClientViewer = useIsClientViewer();
  const { data } = useQuery<any>({
    queryKey: ["covenant-crm", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/covenant/by-crm/${encodeURIComponent(id)}`);
      if (res.status === 204) return null;
      return res.json();
    },
    enabled: !!id,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  if (!data?.grade) return null;
  const reds = (data.flags || []).filter((f: any) => f.level === "red");
  const tip = [`${data.companyName} — covenant ${data.grade} (${data.score}/100)`, ...reds.map((f: any) => `● ${f.label}`), data.verdict || "", note || ""].filter(Boolean).join("\n");
  return (
    <span title={tip} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold cursor-help ${GRADE_STYLE[data.grade] || "bg-muted"} ${className}`}>
      {data.grade}{reds.length > 0 && <span className="font-normal">⚑{reds.length}</span>}
    </span>
  );
}

// Inline AI commentary + data-gap list for covenant cards. Shares the badge's
// query key so the report is fetched once per company number.
/**
 * A one-paragraph verdict reads as a wall of text (Woody, 2026-09-23) — show
 * the first sentence as the headline and each further sentence as a bullet.
 * Text that already has structure (bullets / line breaks) is left alone.
 */
const VERDICT_SENTENCE = /(?<=[.!?])\s+(?=[A-Z£"'(])/;
// clauseOnly (a brand's Company checks card): only the first clause of the
// headline is bold, where the whole first sentence set four lines in bold.
export function verdictAsBullets(text: string, clauseOnly = false): string {
  const t = String(text || "").trim();
  if (!t || /\n\s*[-•*]\s|\n\n/.test(t)) return t;
  const sentences = t.split(VERDICT_SENTENCE).map(x => x.trim()).filter(Boolean);
  if (sentences.length < 3) return t;
  const [head, ...rest] = sentences;
  const plain = head.replace(/\*\*/g, "");
  const clause = clauseOnly ? (plain.match(/^(.{12,160}?)(?::|;|\s[—–]\s)/) || plain.match(/^(.{12,160}?),\s/))?.[1] : null;
  const headline = !clauseOnly ? `**${plain}**` : clause ? `**${clause}**${plain.slice(clause.length)}` : plain.length <= 110 ? `**${plain}**` : plain;
  return `${headline}\n${rest.map(x => `- ${x}`).join("\n")}`;
}

/** The verdict's first sentence, as plain text: the one line a collapsed card shows. */
export function verdictFirstSentence(text: string | null | undefined): string {
  const first = String(text || "").replace(/\*\*/g, "").trim().split(/\n/)[0].replace(/^\s*[-•*]\s*/, "");
  return first.split(VERDICT_SENTENCE)[0].trim();
}

// The report query on its own, so a card can decide whether it has anything
// to show before drawing a bare "Covenant" heading (Woody, 2026-09-28).
export function useCovenantReport(companyNumber?: string | null) {
  const num = (companyNumber || "").trim();
  const enabled = useCovenantReportEnabled(num);
  return useQuery<any>({
    queryKey: ["covenant", num],
    queryFn: async () => (await apiRequest("GET", `/api/covenant/${encodeURIComponent(num)}`)).json(),
    enabled,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

export function CovenantCommentary({ companyNumber, className = "", clauseOnly = false }: { companyNumber?: string | null; className?: string; clauseOnly?: boolean }) {
  const num = (companyNumber || "").trim();
  const { data } = useCovenantReport(num);
  if (!num || !data?.grade) return null;

  return (
    <div className={`rounded-md border border-border bg-muted/40 p-3 ${className}`} data-testid="covenant-commentary">
      {data.verdict ? (
        <AiCommentary text={verdictAsBullets(data.verdict, clauseOnly)} />
      ) : (
        <p className="text-xs italic text-muted-foreground">Grade {data.grade} ({data.score}/100) — AI commentary unavailable.</p>
      )}
      {/* The data gaps behind a grade aren't shown to readers — "Still
          missing: Filed accounts not read yet" read as back-of-house
          (Woody, 2026-09-27). */}
    </div>
  );
}
