// Sharing a record's folder with a client, and following a folder (Woody, 24
// November 2026: decision 6 of docs/folders-review-2026-11-20.md, and the
// Followed list of the picker). Share with <client> puts the folder and
// everything in it in that client's documents in the app, read only; Stop
// sharing takes it out. Nothing changes in SharePoint. Follow and Stop
// following run on the person's own Microsoft 365. BGP staff only: a client
// login never draws these (record-folders.tsx's client branch).
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Star, StarOff, UserX, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import type { FolderLinkView, FolderPlaces } from "@shared/folders";
import type { ShareOptions } from "@shared/folder-share";
import { FolderApiError, folderApi, refreshFolders } from "./folder-api";
import { FolderDialog } from "./folder-dialog";

// Under "/api/folders", so a change to the record's folders reads it again too.
const shareKey = (linkId: string) => ["/api/folders", "links", linkId, "share"];
const useShareOptions = (linkId: string | null) => useQuery<ShareOptions, FolderApiError>({
  queryKey: shareKey(linkId || ""),
  queryFn: () => folderApi("GET", `/api/folders/links/${encodeURIComponent(linkId!)}/share`),
  enabled: !!linkId,
  retry: false,
  staleTime: 60_000,
});

/** On a folder's chip: "Shared with <client>". */
export function SharedMark({ link }: { link: FolderLinkView }) {
  if (!link.sharedWith) return null;
  return (
    <span className="inline-flex shrink-0" title={`Shared with ${link.sharedWith.name}`} data-testid={`folder-chip-shared-${link.id}`}>
      <Users className="w-3 h-3" aria-hidden />
      <span className="sr-only">Shared with {link.sharedWith.name}</span>
    </span>
  );
}

/** Under the strip, for the open folder. */
export function SharedLine({ link }: { link: FolderLinkView }) {
  if (!link.sharedWith) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="folders-shared-line">
      <Users className="w-3.5 h-3.5 shrink-0" />
      Shared with {link.sharedWith.name}: they see this folder and everything in it, read only.
    </p>
  );
}

/** In a chip's menu (read when the menu opens): Share with <client>, Stop sharing, or why it can't be shared. */
export function FolderShareMenuItems({ link, onShare }: { link: FolderLinkView; onShare: (link: FolderLinkView) => void }) {
  const { toast } = useToast();
  const options = useShareOptions(link.id);
  const shared = options.data ? options.data.sharedWith : link.sharedWith || null;
  if (shared) {
    const stop = async () => {
      try {
        await folderApi("POST", `/api/folders/links/${encodeURIComponent(link.id)}/share`, { companyId: null });
        await refreshFolders();
        toast({ title: `No longer shared with ${shared.name}`, description: `${link.label} is out of their documents. Nothing changed in SharePoint.` });
      } catch (e: any) {
        toast({ title: "Still shared", description: e?.message, variant: "destructive" });
      }
    };
    return <DropdownMenuItem onClick={stop} data-testid={`folder-chip-unshare-${link.id}`}><UserX className="w-3.5 h-3.5 mr-2" />Stop sharing with {shared.name}</DropdownMenuItem>;
  }
  if (options.isLoading) return <DropdownMenuItem disabled><Users className="w-3.5 h-3.5 mr-2" />Share with a client</DropdownMenuItem>;
  if (options.error || !options.data) return null;
  const { candidates, why } = options.data;
  if (!candidates.length) {
    return <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground" data-testid={`folder-chip-share-why-${link.id}`}>Can't be shared with a client: {why}</DropdownMenuLabel>;
  }
  return (
    <DropdownMenuItem onClick={() => onShare(link)} data-testid={`folder-chip-share-${link.id}`}>
      <Users className="w-3.5 h-3.5 mr-2" />{candidates.length === 1 ? `Share with ${candidates[0].name}` : "Share with a client"}
    </DropdownMenuItem>
  );
}

/** Asks first: which client, and what they will see. */
export function ShareWithClientDialog({ link, recordType, onClose }: { link: FolderLinkView | null; recordType: string; onClose: () => void }) {
  const { toast } = useToast();
  const options = useShareOptions(link?.id || null);
  const candidates = options.data?.candidates || [];
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; connect: boolean } | null>(null);
  useEffect(() => { setChosen(null); setBusy(false); setProblem(null); }, [link?.id]);
  const company = candidates.find(c => c.id === chosen) || (candidates.length === 1 ? candidates[0] : null);
  const share = async () => {
    if (!link || !company) return;
    setBusy(true); setProblem(null);
    try {
      await folderApi("POST", `/api/folders/links/${encodeURIComponent(link.id)}/share`, { companyId: company.id });
      await refreshFolders();
      toast({ title: `Shared with ${company.name}`, description: `${link.label} is in their documents in the app, read only.` });
      onClose();
    } catch (e: any) {
      setProblem({ message: e?.message || "Not shared.", connect: e instanceof FolderApiError && e.connect });
    } finally { setBusy(false); }
  };
  const who = company?.name || "the client";
  return (
    <FolderDialog
      open={!!link}
      onOpenChange={o => { if (!o && !busy) onClose(); }}
      title={company ? `Share ${link?.label || "this folder"} with ${company.name}?` : `Share ${link?.label || "this folder"} with a client?`}
      description="Nothing changes in SharePoint: they read it through the app."
      size="sm"
      testId="folder-share-client-dialog"
      footer={<>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" onClick={share} disabled={busy || !company} data-testid="folder-share-client-confirm">
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}{company ? `Share with ${company.name}` : "Share"}
        </Button>
      </>}
    >
      {options.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" />Reading who can see it…</div>
      ) : options.error ? (
        <p className="text-sm text-muted-foreground">{options.error.message}</p>
      ) : !candidates.length ? (
        <p className="text-sm text-muted-foreground">{options.data?.why}</p>
      ) : (
        <>
          {candidates.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Which client">
              {candidates.map(c => <Pill key={c.id} active={company?.id === c.id} onClick={() => setChosen(c.id)} data-testid={`folder-share-client-${c.id}`}>{c.name}</Pill>)}
            </div>
          )}
          <p className="text-sm">
            {recordType === "company"
              ? `${who}'s logins see ${link?.label || "it"} and everything in it, now and later, read only. Logins held to named schemes, joint agents among them, don't.`
              : `${who}'s logins see ${link?.label || "it"} and everything in it, now and later, read only, with the documents for this ${recordType === "deal" ? "transaction's property" : "property"}. A joint agent sees it only when the property is at its schemes.`}
          </p>
        </>
      )}
      {problem && (
        <p className="text-sm text-destructive" data-testid="folder-share-client-problem">
          {problem.message}
          {problem.connect && <> <Link href="/sharepoint" className="underline underline-offset-2">Open the SharePoint page</Link></>}
        </p>
      )}
    </FolderDialog>
  );
}

/** In a folder's menu (read when the menu opens): Follow, or Stop following, on the person's own Microsoft 365. */
export function FolderFollowMenuItem({ driveId, itemId, name, testId }: { driveId: string; itemId: string; name: string; testId: string }) {
  const { toast } = useToast();
  const places = useQuery<FolderPlaces, FolderApiError>({
    queryKey: ["/api/folders/places"],
    queryFn: () => folderApi("GET", "/api/folders/places"),
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (places.error) return null;
  const following = !!places.data?.followed.some(e => e.driveId === driveId && e.itemId === itemId);
  const run = async () => {
    try {
      await folderApi("POST", `/api/folders/items/${encodeURIComponent(driveId)}/${encodeURIComponent(itemId)}/${following ? "unfollow" : "follow"}`);
      await queryClient.invalidateQueries({ queryKey: ["/api/folders/places"] });
      toast(following ? { title: `Stopped following ${name}` } : { title: `Following ${name}`, description: "It is under Followed in the folder picker, and in SharePoint." });
    } catch (e: any) {
      toast({ title: following ? "Still following" : "Not followed", description: e?.message, variant: "destructive" });
    }
  };
  return (
    <DropdownMenuItem disabled={places.isLoading} onClick={run} data-testid={testId}>
      {following ? <StarOff className="w-3.5 h-3.5 mr-2" /> : <Star className="w-3.5 h-3.5 mr-2" />}{following ? "Stop following" : "Follow"}
    </DropdownMenuItem>
  );
}
