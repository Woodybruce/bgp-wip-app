// Every file on a party's KYC record as thumbnails that open in the pop-out
// viewer, so the files can be checked at any point without the AML file's zip
// (Woody, 23 November 2026: "on the files can the app show the files so can
// check them at any point rather than having to download a zip just a
// thumbnail can clikc and it pops out?"). It reads the same list as the AML
// board's trail (GET /api/aml-dashboard/party: the files on the brand's record
// and on the company that signs), BGP staff only, as that route is.
import { useQuery } from "@tanstack/react-query";
import { getAuthHeaders } from "@/lib/queryClient";
import { amlFileDocWords } from "@shared/aml-file";
import { FileThumbGrid, type PreviewFile } from "@/components/file-popout";

export interface PartyTrailDocument {
  id: string; type: string; name: string; url: string | null; mime?: string | null;
  at: string | null; note: string | null; onCompany: boolean;
}

export const partyTrailKey = (dealId: string, role: string) => ["/api/aml-dashboard/party", dealId, role];

export async function fetchPartyTrail(dealId: string, role: string) {
  const res = await fetch(`/api/aml-dashboard/party?dealId=${encodeURIComponent(dealId)}&role=${encodeURIComponent(role)}`, { credentials: "include", headers: getAuthHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || "The party's trail could not be read.");
  return body;
}

const shortDay = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

/** A party's files in the viewer's shape: the type and date under each, the note in the viewer. */
export function partyFilesForPreview(documents: PartyTrailDocument[]): PreviewFile[] {
  return documents.map(d => ({
    key: d.id,
    name: d.name || amlFileDocWords(d.type),
    url: d.url,
    mime: d.mime || null,
    caption: [amlFileDocWords(d.type), shortDay(d.at)].filter(Boolean).join(" · "),
    note: [d.onCompany ? "On the company that signs" : null, d.note].filter(Boolean).join(" · ") || null,
  }));
}

/** The files on record for one party of a transaction, at the top of its Documents step. */
export function PartyFiles({ dealId, role }: { dealId: string; role: string }) {
  const { data } = useQuery<{ documents: PartyTrailDocument[] }>({
    queryKey: partyTrailKey(dealId, role),
    queryFn: () => fetchPartyTrail(dealId, role),
  });
  const files = data?.documents?.length ? partyFilesForPreview(data.documents) : [];
  if (!files.length) return null;
  return (
    <div className="space-y-1.5" data-testid={`aml-files-${role}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Files on record · {files.length}</p>
      <FileThumbGrid files={files} testId={`aml-files-grid-${role}`} limit={8} />
    </div>
  );
}
