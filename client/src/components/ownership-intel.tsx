// Who owns the brand (Woody, 2026-11-15): the admin's view of the weekly read
// of the London Food Money Matrix. It shows what the last read found, the
// brands where our Backers names someone else, the owners that changed since
// the read before, and the backed operators the directory does not hold. The
// read itself matches names, saves the page's reading on matched brands and
// fills a blank Backers with a private equity or venture owner; it never adds
// a brand.
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Landmark, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BandHeading } from "@/components/brand-page/brand-top";
import { useCap, ShowAll } from "@/components/brand-page/brand-card";
import { OWNERSHIP_KIND_LABEL, OWNERSHIP_SOURCE_NAME, type OwnershipReport } from "@shared/ownership-intel";

const KEY = "/api/admin/ownership-intel";
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
// apiRequest errors read "409: {"error":"…"}"; show the sentence.
const errorText = (e: any) => { const m = String(e?.message || ""); try { return JSON.parse(m.slice(m.indexOf("{"))).error || m; } catch { return m; } };
const num = (v: number) => <span className="font-mono tabular-nums text-foreground">{v.toLocaleString("en-GB")}</span>;

export function OwnershipIntelButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid="ownership-intel-open"><Landmark className="w-3 h-3 mr-1" /> Ownership intel</Button>
      {open && <OwnershipIntelDialog onClose={() => setOpen(false)} />}
    </>
  );
}

const SourceLink = ({ href }: { href: string | null }) => href
  ? <a href={href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline whitespace-nowrap">source</a> : null;

function Rows<T>({ title, rows, cap = 8, testId, empty, children }: { title: string; rows: T[]; cap?: number; testId: string; empty: string; children: (row: T, index: number) => React.ReactNode }) {
  const list = useCap(rows, cap);
  return (
    <section className="space-y-1.5" data-testid={testId}>
      <BandHeading count={rows.length || null}>{title}</BandHeading>
      {rows.length === 0 ? <p className="text-[13px] text-muted-foreground">{empty}</p>
        : <div className="divide-y divide-border rounded-md border border-border">{list.shown.map((row, index) => <div key={index} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2.5 py-1.5 text-sm">{children(row, index)}</div>)}</div>}
      {list.over && <ShowAll total={rows.length} open={list.open} onToggle={list.toggle} />}
    </section>
  );
}

function OwnershipIntelDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading, error } = useQuery<{ sourceUrl: string | null; report: OwnershipReport | null }>({ queryKey: [KEY], staleTime: 0 });
  const read = useMutation({
    mutationFn: async () => (await apiRequest("POST", `${KEY}/read`, {})).json(),
    onSuccess: (r: any) => {
      toast({ title: `${r?.written ?? 0} brand${r?.written === 1 ? "" : "s"} updated`, description: `${r?.report?.places ?? 0} places read, ${r?.report?.matched ?? 0} matched to a brand.` });
      queryClient.invalidateQueries({ queryKey: [KEY] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/companies"] });
    },
    onError: (e: any) => toast({ title: "Nothing was changed", description: errorText(e), variant: "destructive" }),
  });
  const report = data?.report || null;
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="ownership-intel-dialog">
        <DialogHeader>
          <DialogTitle>Ownership intel</DialogTitle>
          <DialogDescription>
            Who owns each brand, read once a week from the {data?.sourceUrl ? <a href={data.sourceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{OWNERSHIP_SOURCE_NAME}</a> : OWNERSHIP_SOURCE_NAME}.
            A name that fits exactly one food and drink brand gets the page's reading on its profile, with the source link; a blank Backers is filled with a private equity or venture owner. Nothing a person typed is changed and no brand is added.
          </DialogDescription>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Loading the last read…</p>}
        {error && <p role="status" className="text-sm text-muted-foreground">The last read could not be loaded.</p>}
        {data && !data.sourceUrl && <p role="status" className="text-sm text-muted-foreground">The weekly read is switched off on this server.</p>}
        {data && !report && <p className="text-sm text-muted-foreground" data-testid="ownership-intel-none">The page has not been read yet. It is read every Monday; Read now reads it straight away.</p>}
        {report && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="ownership-intel-summary">
              Read {day(report.readAt)}: {num(report.places)} places ({num(report.byKind.pe)} private equity, {num(report.byKind.corp)} corporate, {num(report.byKind.vc)} venture, {num(report.byKind.ind)} independent).
              {" "}{num(report.matched)} matched to a brand, {num(report.filledBackers)} Backers filled on that read.
            </p>
            <Rows title="The page's owner has changed" rows={report.ownerChanges} testId="ownership-intel-changes" empty="No owner has changed since the read before.">
              {row => <>
                <Link href={`/companies/${row.id}`} className="font-medium hover:underline">{row.name}</Link>
                <span className="text-muted-foreground">was {row.was}, now <span className="text-foreground">{row.now}</span> ({OWNERSHIP_KIND_LABEL[row.kind]})</span>
                <SourceLink href={row.source} />
              </>}
            </Rows>
            <Rows title="Our Backers names someone else" rows={report.differs} testId="ownership-intel-differs" empty="Nothing differs.">
              {row => <>
                <Link href={`/companies/${row.id}`} className="font-medium hover:underline">{row.name}</Link>
                <span className="text-muted-foreground">ours: <span className="text-foreground">{row.ours}</span> · the page: <span className="text-foreground">{row.theirs}</span> ({OWNERSHIP_KIND_LABEL[row.kind]})</span>
                <SourceLink href={row.source} />
              </>}
            </Rows>
            <Rows title="Backed operators not in the directory" rows={report.notInDirectory} testId="ownership-intel-missing" empty="Every backed operator on the page is in the directory.">
              {row => <>
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground">{row.owner || "owner not named"} · {OWNERSHIP_KIND_LABEL[row.kind]}{row.area ? ` · ${row.area}` : ""}</span>
                <SourceLink href={row.source} />
              </>}
            </Rows>
            <p className="text-[13px] text-muted-foreground">
              {num(report.independentsNotInDirectory)} independents on the page are not in the directory either.
              {report.skipped.length > 0 && <> {num(report.skipped.length)} name{report.skipped.length === 1 ? " was" : "s were"} left alone: {report.skipped.slice(0, 6).map(row => `${row.name} (${row.why})`).join("; ")}{report.skipped.length > 6 ? "…" : "."}</>}
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          <Button size="sm" disabled={read.isPending || (!!data && !data.sourceUrl)} onClick={() => read.mutate()} data-testid="ownership-intel-read">
            <RefreshCw className={read.isPending ? "animate-spin" : ""} />{read.isPending ? "Reading…" : "Read now"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
