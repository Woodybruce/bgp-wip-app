// The AML decisions log on Transactions, AML, Updates (Jack, 23 November
// 2026: "keep an up to date document of all these updates and rules we (Wood,
// Jack, Layla) are making"). The entries are shared/aml-decisions.ts, served
// to BGP staff by GET /api/aml-decisions.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/pill";
import type { AmlDecision } from "@shared/aml-decisions";

interface Feed { entries: AmlDecision[]; topics: string[]; people: string[] }

const dayWords = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export function AmlDecisionsBoard() {
  const { data, isLoading, error } = useQuery<Feed>({ queryKey: ["/api/aml-decisions"] });
  const [topic, setTopic] = useState<string>("all");
  const [who, setWho] = useState<string>("all");
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState(false);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (data?.entries || []).filter(e =>
      (topic === "all" || e.topic === topic) &&
      (who === "all" || (e.who as string[]).includes(who)) &&
      (!current || !e.changed) &&
      (!words || `${e.title} ${e.text} ${e.changed || ""}`.toLowerCase().includes(words)));
  }, [data, topic, who, q, current]);

  const days = useMemo(() => {
    const out: Array<{ date: string; entries: AmlDecision[] }> = [];
    for (const e of shown) {
      const last = out[out.length - 1];
      if (last && last.date === e.date) last.entries.push(e);
      else out.push({ date: e.date, entries: [e] });
    }
    return out;
  }, [shown]);

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Loading</div>;
  if (error || !data) return <p className="text-sm text-muted-foreground">The updates could not be loaded.</p>;

  return (
    <div className="space-y-4" data-testid="aml-decisions">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <p className="text-sm text-muted-foreground mr-auto">Every AML decision, who made it and when. {data.entries.length} so far.</p>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" className="h-8 w-48 text-sm" data-testid="aml-decisions-search" />
        <Button size="sm" variant="outline" className="h-8" onClick={() => window.print()} data-testid="aml-decisions-print">
          <Printer className="w-3.5 h-3.5 mr-1" />Print or save as PDF
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5 print:hidden">
        <Pill active={who === "all"} onClick={() => setWho("all")}>Everyone</Pill>
        {data.people.map(p => <Pill key={p} active={who === p} onClick={() => setWho(p)} data-testid={`aml-decisions-who-${p}`}>{p}</Pill>)}
        <span className="mx-1 w-px self-stretch bg-border" />
        <Pill active={current} onClick={() => setCurrent(v => !v)} data-testid="aml-decisions-current">Current rules only</Pill>
      </div>
      <div className="flex flex-wrap gap-1.5 print:hidden">
        <Pill active={topic === "all"} onClick={() => setTopic("all")}>All topics</Pill>
        {data.topics.map(t => <Pill key={t} active={topic === t} onClick={() => setTopic(t)}>{t}</Pill>)}
      </div>

      {!days.length && <p className="text-sm text-muted-foreground">Nothing matches.</p>}
      <div className="space-y-5">
        {days.map(d => (
          <section key={d.date} className="space-y-1.5">
            <h3 className="text-sm font-semibold">{dayWords(d.date)}</h3>
            <ul className="divide-y rounded-md border bg-card">
              {d.entries.map(e => (
                <li key={`${e.date}-${e.title}`} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={`font-medium ${e.changed ? "text-muted-foreground" : ""}`}>{e.title}</span>
                    <span className="text-[11px] text-muted-foreground">{e.who.join(" and ")} · {e.topic}</span>
                  </div>
                  <p className={e.changed ? "text-muted-foreground" : ""}>{e.text}</p>
                  {e.changed && <p className="text-[13px] text-amber-900 dark:text-amber-200">Since changed. {e.changed}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
