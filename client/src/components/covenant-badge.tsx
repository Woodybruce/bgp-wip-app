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

export function CovenantBadge({ companyNumber, showScore = true, className = "" }: {
  companyNumber?: string | null;
  showScore?: boolean;
  className?: string;
}) {
  const num = (companyNumber || "").trim();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["covenant", num],
    queryFn: async () => (await apiRequest("GET", `/api/covenant/${encodeURIComponent(num)}`)).json(),
    enabled: !!num,
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
