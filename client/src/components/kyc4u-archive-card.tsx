// KYC4U's files kept in the app (Woody, 21 November 2026: "yes build it so we
// keep all documents in the app"). How much of KYC4U's site is held, the
// request folders not matched to a company yet (match one and its files are
// filed on that company), and the files that could not be copied. The copy
// itself runs in the Send to ChatBGP bookmark's window (kyc4u-import.tsx);
// the server is server/kyc4u-archive.ts. Admins only.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest, queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { archiveSummaryWords, type Kyc4uArchiveTotals } from "@shared/kyc4u-archive";

interface ArchiveFolder { ref: string; entity: string | null; files: number; bytes: number; listId: string | null }
interface ArchiveProblem { id: number; name: string; path: string; ref: string | null; size: number | null; status: string; error: string | null }
interface ArchiveSummary {
  totals: Kyc4uArchiveTotals & { lastCopiedAt: string | null; lastCopiedBy: string | null };
  folders: ArchiveFolder[];
  problems: ArchiveProblem[];
  outside: Array<{ id: number; name: string; path: string; size: number | null }>;
}
interface FolderFile { id: number; name: string; section: string | null; status: string; size: number | null; companyName: string | null }

const KEY = ["/api/kyc4u/archive"];
const mb = (b: number | null | undefined) => b == null ? "" : b >= 1024 * 1024 * 1024 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 * 1024 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

function FolderFiles({ reqRef }: { reqRef: string }) {
  const { data, isLoading } = useQuery<{ files: FolderFile[] }>({ queryKey: ["/api/kyc4u/archive/folder", reqRef], queryFn: async () => (await apiRequest("GET", `/api/kyc4u/archive/folder/${encodeURIComponent(reqRef)}`)).json() });
  if (isLoading) return <p className="text-xs text-muted-foreground pl-6 py-1">Loading…</p>;
  return (
    <ul className="pl-6 py-1 space-y-0.5 text-xs" data-testid={`kyc4u-archive-folder-files-${reqRef}`}>
      {(data?.files || []).map(f => (
        <li key={f.id} className="flex flex-wrap gap-x-2">
          {f.status === "copied"
            ? <a href={`/api/kyc4u/archive/files/${f.id}`} target="_blank" rel="noopener" className="text-primary hover:underline break-all">{f.name}</a>
            : <span className="break-all">{f.name}</span>}
          <span className="text-muted-foreground">{[f.section, mb(f.size), f.status === "copied" ? null : f.status.replace("_", " ")].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ul>
  );
}

// Match a KYC4U request to a CRM company: the request's own hand-set match
// (PATCH /api/kyc4u/requests/…), after which its kept files are filed there.
function MatchToCompany({ folder, onDone }: { folder: ArchiveFolder; onDone: () => void }) {
  const { toast } = useToast();
  const [term, setTerm] = useState(folder.entity || "");
  const [q, setQ] = useState(term);
  useEffect(() => { const t = setTimeout(() => setQ(term.trim()), 250); return () => clearTimeout(t); }, [term]);
  const hits = useQuery<Array<{ id: string; name: string; companyType: string | null }>>({
    queryKey: ["/api/crm/companies", "kyc4u-match", q],
    enabled: q.length >= 2,
    queryFn: async () => {
      const r = await fetch(`/api/crm/companies?search=${encodeURIComponent(q)}&limit=10&fields=id,name,companyType`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      return (Array.isArray(d) ? d : (d.companies || d.items || [])).map((c: any) => ({ id: String(c.id), name: c.name, companyType: c.companyType ?? c.company_type ?? null }));
    },
  });
  const match = useMutation({
    mutationFn: async (c: { id: string; name: string }) => {
      await apiRequest("PATCH", `/api/kyc4u/requests/${encodeURIComponent(folder.listId || "")}/${encodeURIComponent(folder.ref)}`, { companyId: c.id });
      return c;
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/kyc4u/requests"] });
      toast({ title: `${folder.ref} matched to ${c.name}`, description: `Its ${folder.files} file${folder.files === 1 ? "" : "s"} are filed on ${c.name}'s KYC record.` });
      onDone();
    },
    onError: (e: any) => toast({ title: "Not matched", description: String(e?.message || e).replace(/^\d+:\s*/, ""), variant: "destructive" }),
  });
  return (
    <div className="pl-6 py-1.5 space-y-1" data-testid={`kyc4u-archive-match-${folder.ref}`}>
      <div className="relative max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input autoFocus value={term} onChange={e => setTerm(e.target.value)} placeholder="Find the company in the CRM" className="h-8 pl-7 text-xs" />
      </div>
      {q.length >= 2 && (
        <ul className="max-w-sm space-y-0.5">
          {hits.isFetching && !hits.data ? <li className="text-xs text-muted-foreground">Searching…</li>
            : (hits.data || []).length === 0 ? <li className="text-xs text-muted-foreground">Nothing in the CRM by that name</li>
            : (hits.data || []).map(c => (
              <li key={c.id}>
                <button type="button" className="w-full text-left text-xs rounded px-2 py-1 hover:bg-muted disabled:opacity-50" disabled={match.isPending} onClick={() => match.mutate(c)}>
                  {c.name}{c.companyType ? <span className="text-muted-foreground"> · {c.companyType}</span> : null}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function Kyc4uArchiveCard() {
  const { data, isLoading } = useQuery<ArchiveSummary>({ queryKey: KEY });
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [matching, setMatching] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [showOutside, setShowOutside] = useState(false);
  if (isLoading || !data) return null;
  const t = data.totals;
  return (
    <section className="rounded-xl border bg-card p-4 space-y-3" data-testid="kyc4u-archive">
      <div>
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">KYC4U's files in the app</p>
        <p className="text-sm mt-1" data-testid="kyc4u-archive-summary">{archiveSummaryWords(t)}</p>
        {t.copied > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {mb(t.bytes)} kept{t.lastCopiedAt ? ` · last copied ${when(t.lastCopiedAt)}${t.lastCopiedBy ? ` by ${t.lastCopiedBy}` : ""}` : ""}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          Click the Send to ChatBGP bookmark on KYC4U's site: after the requests, its window copies every file the app does not hold yet. A file in a request folder matched to a company is filed on that company's KYC record; match the others below and their files follow.
        </p>
      </div>

      {data.folders.length > 0 && (
        <div className="border-t pt-2" data-testid="kyc4u-archive-folders">
          <p className="text-xs font-medium mb-1">Request folders not matched to a company ({data.folders.length})</p>
          <ul className="space-y-0.5 max-h-96 overflow-y-auto">
            {data.folders.map(f => (
              <li key={f.ref} className="text-xs">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-primary" onClick={() => setOpenFolder(openFolder === f.ref ? null : f.ref)} aria-expanded={openFolder === f.ref}>
                    {openFolder === f.ref ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span className="font-medium tabular-nums">{f.ref}</span>
                  </button>
                  <span>{f.entity || "No name on the folder"}</span>
                  <span className="text-muted-foreground">{f.files} file{f.files === 1 ? "" : "s"} · {mb(f.bytes)}</span>
                  {f.listId && (
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setMatching(matching === f.ref ? null : f.ref)} data-testid={`kyc4u-archive-match-button-${f.ref}`}>
                      Match to a company
                    </Button>
                  )}
                </div>
                {openFolder === f.ref && <FolderFiles reqRef={f.ref} />}
                {matching === f.ref && <MatchToCompany folder={f} onDone={() => setMatching(null)} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.problems.length > 0 && (
        <div className="border-t pt-2">
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium" onClick={() => setShowProblems(v => !v)} aria-expanded={showProblems}>
            {showProblems ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}Not copied ({data.problems.length})
          </button>
          {showProblems && (
            <ul className="mt-1 space-y-0.5 text-xs" data-testid="kyc4u-archive-problems">
              {data.problems.map(p => (
                <li key={p.id} className="break-all">
                  <span>{p.ref ? `${p.ref} · ` : ""}{p.name}</span>
                  <span className="text-muted-foreground"> · {[mb(p.size), p.error || (p.status === "too_large" ? "too large" : "failed")].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data.outside.length > 0 && (
        <div className="border-t pt-2">
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium" onClick={() => setShowOutside(v => !v)} aria-expanded={showOutside}>
            {showOutside ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}Outside a request folder ({data.outside.length})
          </button>
          {showOutside && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {data.outside.map(o => (
                <li key={o.id} className="break-all">
                  <a href={`/api/kyc4u/archive/files/${o.id}`} target="_blank" rel="noopener" className="text-primary hover:underline">{o.name}</a>
                  <span className="text-muted-foreground"> · {o.path}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
    </section>
  );
}
