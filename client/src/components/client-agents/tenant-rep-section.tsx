// The tenant rep section of the client Agents page: one row per named agent
// grouped under its firm on desktop, one card per firm on phones. Who
// qualifies is decided by the server (server/client-agent-directory.ts).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { groupBySource, foldGroups, repAgentCount, type RepFirm, type RepRow } from "./model";
import {
  TH, TD, Count, SectionHeading, TableShell, EmailLink, PhoneLink, NotRecorded, BrandChips, ShowAllButton,
} from "./parts";

// A list folds to about FOLD_ROWS rows (FOLD_CARDS firms on a phone), but
// only when that hides more than FOLD_SLACK of them.
const FOLD_ROWS = 25;
const FOLD_CARDS = 8;
const FOLD_SLACK = 5;
const CARD_AGENTS = 3;

// One firm's block of rows. People whose firm is not confirmed share one
// block at the end; each of their rows keeps its own entry's test id, and
// the person's own test id sits on the name inside it (nameTestId).
interface Block {
  key: string;
  testId: string;
  label: string;
  confirmed: boolean;
  rows: { row: RepRow; testId?: string; nameTestId?: string }[];
}

function toBlocks(firms: RepFirm[]): Block[] {
  const blocks: Block[] = firms.filter(f => f.entry.kind === "firm").map(f => ({
    key: f.entry.id, testId: `client-agent-${f.entry.id}`, label: f.entry.name, confirmed: true,
    rows: f.rows.map(row => ({ row, testId: row.contact ? `client-agent-contact-${row.contact.id}` : undefined })),
  }));
  const loose = firms.filter(f => f.entry.kind === "contact");
  if (loose.length > 0) {
    blocks.push({
      key: "unconfirmed", testId: "client-agent-unconfirmed", label: "Firm not confirmed", confirmed: false,
      rows: loose.flatMap(f => f.rows.map(row => ({
        row, testId: `client-agent-${f.entry.id}`, nameTestId: row.contact ? `client-agent-contact-${row.contact.id}` : undefined,
      }))),
    });
  }
  return blocks;
}

const agentNoun = (n: number) => (n === 1 ? "agent" : "agents");
const namedCount = (block: Block) => block.rows.filter(r => r.row.contact).length;

function AgentName({ row }: { row: RepRow }) {
  if (!row.contact) return <NotRecorded>No named agent recorded</NotRecorded>;
  const detail = [row.contact.role, row.contact.specialty].filter(Boolean).join(" · ");
  return (
    <>
      <span className="block break-words font-medium">{row.contact.name}</span>
      {detail && <span className="block break-words text-[11px] text-muted-foreground">{detail}</span>}
    </>
  );
}

function BlockRows({ block, searching }: { block: Block; searching: boolean }) {
  const groupsByRow = block.rows.map(r => groupBySource(r.row.brands));
  const span = groupsByRow.reduce((n, g) => n + g.length, 0);
  const named = namedCount(block);
  return (
    <tbody className="border-b border-border last:border-b-0" data-testid={block.testId}>
      {block.rows.map(({ row, testId, nameTestId }, r) => groupsByRow[r].map((group, g) => (
        <tr key={`${row.key}:${g}`} className={r > 0 && g === 0 ? "border-t border-border/60" : undefined} data-testid={g === 0 ? testId : undefined}>
          {r === 0 && g === 0 && (
            <td className={`${TD} border-r border-border/60`} rowSpan={span}>
              <span className={`block break-words font-semibold ${block.confirmed ? "" : "text-muted-foreground"}`}>{block.label}</span>
              {named > 0 && <span className="block text-[11px] text-muted-foreground"><Count n={named} /> {agentNoun(named)}</span>}
            </td>
          )}
          {g === 0 && <td className={TD} rowSpan={groupsByRow[r].length} data-testid={nameTestId}><AgentName row={row} /></td>}
          <td className={TD}><BrandChips brands={group.brands} expanded={searching} /></td>
          <td className={TD}>
            {group.lines.map(line => <span key={line} className="block text-xs leading-5 text-muted-foreground">{line}</span>)}
          </td>
          {g === 0 && (
            <>
              <td className={TD} rowSpan={groupsByRow[r].length}>
                {row.contact ? (row.contact.email ? <EmailLink email={row.contact.email} /> : <NotRecorded />) : null}
              </td>
              <td className={TD} rowSpan={groupsByRow[r].length}>
                {row.contact ? (row.contact.phone ? <PhoneLink number={row.contact.phone} /> : <NotRecorded />) : null}
              </td>
            </>
          )}
        </tr>
      )))}
    </tbody>
  );
}

function BlockCard({ block, searching }: { block: Block; searching: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const open = showAll || searching || block.rows.length <= CARD_AGENTS + 1;
  const rows = open ? block.rows : block.rows.slice(0, CARD_AGENTS);
  const named = namedCount(block);
  return (
    <div className="rounded-2xl border border-border bg-card" data-testid={block.testId}>
      <div className="border-b border-border p-4">
        <h3 className={`text-sm font-semibold break-words ${block.confirmed ? "" : "text-muted-foreground"}`}>{block.label}</h3>
        {named > 0 && <p className="text-[11px] text-muted-foreground"><Count n={named} /> {agentNoun(named)}</p>}
      </div>
      {rows.map(({ row, testId, nameTestId }) => (
        <div key={row.key} className="space-y-2 border-b border-border p-4 last:border-b-0" data-testid={testId}>
          <div className="text-sm" data-testid={nameTestId}><AgentName row={row} /></div>
          {row.contact && (
            <div className="flex flex-col items-start text-sm">
              <EmailLink email={row.contact.email} phone />
              <PhoneLink number={row.contact.phone} phone />
              {!row.contact.email && !row.contact.phone && <NotRecorded>No email or phone recorded</NotRecorded>}
            </div>
          )}
          {groupBySource(row.brands).map(group => (
            <div key={group.label} className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Acts for · {group.label}</p>
              <BrandChips brands={group.brands} limit={4} expanded={searching} />
            </div>
          ))}
        </div>
      ))}
      {block.rows.length > CARD_AGENTS + 1 && !searching && (
        <div className="border-t border-border p-3">
          <ShowAllButton open={open} total={block.rows.length} noun="agents" onToggle={() => setShowAll(!showAll)} testId={`client-agent-show-contacts-${block.key}`} />
        </div>
      )}
    </div>
  );
}

export function TenantRepSection({ firms, searching, isMobile, note, emptyText, onClear, clearLabel }: {
  firms: RepFirm[]; searching: boolean; isMobile: boolean;
  note?: React.ReactNode; emptyText: string; onClear?: () => void; clearLabel?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const blocks = toBlocks(firms);
  const rowTotal = blocks.reduce((n, b) => n + b.rows.length, 0);
  const agents = repAgentCount(firms);
  const folds = isMobile ? blocks.length > FOLD_CARDS + 2 : rowTotal > FOLD_ROWS + FOLD_SLACK;
  const open = showAll || searching || !folds;
  const shown = open ? blocks : isMobile ? blocks.slice(0, FOLD_CARDS) : foldGroups(blocks, b => b.rows.length, FOLD_ROWS);

  return (
    <section className="space-y-2" data-testid="client-agent-section-reps" aria-labelledby="client-agent-section-reps-title">
      <div id="client-agent-section-reps-title">
        <SectionHeading
          testId="client-agent-section-reps"
          title="Tenant rep agents"
          count={agents}
          noun={["named agent", "named agents"]}
          description="Agents acting for brands in your Brand Directory, linked through a current requirement or a recorded representation. Only people with a recorded brand link are listed."
        />
      </div>
      {note && <p className="text-[11px] text-muted-foreground" data-testid="client-agent-reps-note">{note}</p>}
      {blocks.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-4 py-8 text-center" data-testid="client-agent-empty">
          <p className="text-sm text-muted-foreground">{emptyText}</p>
          {onClear && clearLabel && <Button type="button" variant="outline" size="sm" onClick={onClear}>{clearLabel}</Button>}
        </div>
      ) : isMobile ? (
        <div className="space-y-3" data-testid="client-agent-reps-cards">
          {shown.map(block => <BlockCard key={block.key} block={block} searching={searching} />)}
        </div>
      ) : (
        <TableShell testId="client-agent-reps-table">
          <colgroup>
            <col className="w-[13%]" /><col className="w-[15%]" /><col className="w-[14%]" /><col className="w-[16%]" /><col /><col className="w-[176px]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border">
              <th className={TH}>Firm</th><th className={TH}>Agent</th><th className={TH}>Acts for</th><th className={TH}>How we know</th><th className={TH}>Email</th><th className={TH}>Phone</th>
            </tr>
          </thead>
          {shown.map(block => <BlockRows key={block.key} block={block} searching={searching} />)}
        </TableShell>
      )}
      {folds && !searching && (
        <ShowAllButton
          open={open}
          total={isMobile ? blocks.length : agents || rowTotal}
          noun={isMobile ? "firms" : "agents"}
          onToggle={() => setShowAll(!showAll)}
          testId="client-agent-reps-show-all"
        />
      )}
    </section>
  );
}
