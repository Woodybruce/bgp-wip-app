import type { ReactNode } from "react";
import { Link } from "wouter";

// Shared renderer for every AI-written commentary in the app (Woody,
// 2026-09-08: "the old commentary was much better styled — coloured, easier
// to read, click and helpful links where appropriate, not just one massive
// bit of text. This was the same across the app"). Light markdown in,
// styled blocks out: bullets with coloured lead-in labels, action lines
// called out, citation markers stripped, and every mention of a known
// property / deal / contact / company turned into a link.

export type CommentaryEntity = {
  name: string;
  href: string;
  kind?: "property" | "deal" | "contact" | "company" | "person";
};

const ACTION_RE = /^(next step|next steps|action|actions|recommendation|recommend|do next|ask)\b/i;
const WATCH_RE = /^(risk|risks|watch|warning|caution|data note|flag|concern)\b/i;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function AiCommentary({
  text,
  entities = [],
  size = "xs",
  className = "",
}: {
  text: string | null | undefined;
  entities?: CommentaryEntity[];
  size?: "xs" | "sm";
  className?: string;
}) {
  const cleaned = String(text || "")
    .replace(/\[\d+\](?:\[\d+\])*/g, "")
    .replace(/\r/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (!cleaned) return null;

  // Longest names first so "Canary Wharf Group" wins over "Canary Wharf".
  const linkable = entities
    .filter(e => e.name && e.name.trim().length >= 3 && e.href)
    .sort((a, b) => b.name.length - a.name.length);
  const entityRe = linkable.length
    ? new RegExp(`(?<![\\w&])(${linkable.map(e => escapeRe(e.name.trim())).join("|")})(?![\\w&])`, "gi")
    : null;
  const hrefFor = (name: string) => linkable.find(e => e.name.trim().toLowerCase() === name.toLowerCase())?.href;

  let key = 0;
  const k = () => `c${key++}`;

  // Inline: **bold**, `code`, entity links (first mention per block only).
  const inline = (raw: string, linked: Set<string>): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
    let cursor = 0;
    let m: RegExpExecArray | null;
    const pushText = (t: string) => {
      if (!t) return;
      if (!entityRe) { out.push(<span key={k()}>{t}</span>); return; }
      let last = 0;
      let em: RegExpExecArray | null;
      entityRe.lastIndex = 0;
      while ((em = entityRe.exec(t)) !== null) {
        const name = em[1];
        const lower = name.toLowerCase();
        const href = hrefFor(name);
        if (em.index > last) out.push(<span key={k()}>{t.slice(last, em.index)}</span>);
        if (href && !linked.has(lower)) {
          linked.add(lower);
          out.push(
            <Link key={k()} href={href} className="text-primary font-medium underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
              {name}
            </Link>
          );
        } else {
          out.push(<span key={k()}>{name}</span>);
        }
        last = em.index + name.length;
      }
      if (last < t.length) out.push(<span key={k()}>{t.slice(last)}</span>);
    };
    while ((m = re.exec(raw)) !== null) {
      if (m.index > cursor) pushText(raw.slice(cursor, m.index));
      if (m[1]) out.push(<strong key={k()} className="font-semibold text-foreground">{m[2]}</strong>);
      else if (m[3]) out.push(<code key={k()} className="text-[10px] bg-muted px-1 py-px rounded">{m[4]}</code>);
      cursor = m.index + m[0].length;
    }
    if (cursor < raw.length) pushText(raw.slice(cursor));
    return out;
  };

  // A line that opens with a short "Label:" gets a coloured lead-in; action
  // and watch labels get their own colour so the eye lands on them.
  const leadIn = (line: string): { label: string; rest: string } | null => {
    const m = line.match(/^\**([A-Za-z][A-Za-z /&'-]{1,28}?)\**\s*:\s*\**\s*(.*)$/);
    if (!m) return null;
    const label = m[1].trim();
    if (label.split(/\s+/).length > 4) return null;
    return { label, rest: m[2].replace(/\*\*$/, "").trim() };
  };
  const labelClass = (label: string) =>
    ACTION_RE.test(label) ? "text-primary"
    : WATCH_RE.test(label) ? "text-amber-700 dark:text-amber-400"
    : "text-foreground";

  const renderLine = (line: string): ReactNode => {
    const linked = new Set<string>();
    const li = leadIn(line);
    if (li) {
      return (
        <>
          <span className={`font-semibold ${labelClass(li.label)}`}>{li.label}:</span>{" "}
          {inline(li.rest, linked)}
        </>
      );
    }
    return <>{inline(line, linked)}</>;
  };
  const isAction = (line: string) => {
    const li = leadIn(line);
    return li ? ACTION_RE.test(li.label) : false;
  };

  const lines = cleaned.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={k()} className="space-y-1 pl-3.5 list-disc marker:text-muted-foreground/50">
        {bullets.map(b => (
          <li key={k()} className={isAction(b) ? "border-l-2 border-primary/50 pl-2 -ml-3.5 list-none" : ""}>
            {renderLine(b)}
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };
  for (const line of lines) {
    const bullet = line.match(/^(?:[-•*]|\d+[.)])\s+(.*)$/);
    if (bullet) { bullets.push(bullet[1]); continue; }
    flush();
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      blocks.push(<div key={k()} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">{heading[1]}</div>);
      continue;
    }
    blocks.push(
      <p key={k()} className={isAction(line) ? "border-l-2 border-primary/50 pl-2" : ""}>
        {renderLine(line)}
      </p>
    );
  }
  flush();

  const sizeCls = size === "sm" ? "text-sm leading-relaxed" : "text-xs leading-snug";
  return (
    <div className={`${sizeCls} text-foreground/90 space-y-1.5 ${className}`} data-testid="ai-commentary">
      {blocks}
    </div>
  );
}
