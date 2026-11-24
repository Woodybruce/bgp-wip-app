// A private individual's date of birth and nationality, typed in by BGP with no
// documents (Woody, 24 November 2026), in step 1 ("The person") of the
// transaction's AML box and of the client KYC window. Saving it runs BGP's
// checks again, so the screening tells the person from a namesake; a
// sanctions-only sign-off waits for the date. Rules: shared/kyc-person-details.ts.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AmlFact, AmlFactList } from "@/components/aml-frame";
import type { PersonDetailsView } from "@shared/kyc-person-details";

const plain = (e: any) => String(e?.message || e || "").replace(/^\d{3}:\s*/, "");

export function PersonDetailsLine({ view, url, onSaved, testKey }: {
  view: PersonDetailsView | null;
  /** The party's own address: `${party}/person-details` is the save. */
  url: string;
  onSaved: () => void;
  testKey: string;
}) {
  const { toast } = useToast();
  const details = view?.details || null;
  const [editing, setEditing] = useState(false);
  const [dob, setDob] = useState(details?.dateOfBirth || "");
  const [nationality, setNationality] = useState(details?.nationality || "");
  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", url, { dateOfBirth: dob, nationality })).json(),
    onSuccess: (r: any) => {
      toast({ title: "Date of birth saved", description: r?.started === "started" ? "BGP's checks are running again with it." : undefined });
      setEditing(false);
      onSaved();
    },
    onError: (e: any) => toast({ title: "Not saved", description: plain(e), variant: "destructive" }),
  });
  const open = () => { setDob(details?.dateOfBirth || ""); setNationality(details?.nationality || ""); setEditing(true); };

  if (editing) {
    return (
      <div className="space-y-1.5" data-testid={`person-details-form-${testKey}`}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-0.5 text-xs">
            <span className="block text-muted-foreground">Date of birth</span>
            <Input type="date" value={dob} onChange={e => setDob(e.target.value)} className="h-8 w-40 text-xs" data-testid={`person-details-dob-${testKey}`} />
          </label>
          <label className="space-y-0.5 text-xs">
            <span className="block text-muted-foreground">Nationality (if known)</span>
            <Input value={nationality} onChange={e => setNationality(e.target.value)} placeholder="British" className="h-8 w-40 text-xs" maxLength={60} data-testid={`person-details-nationality-${testKey}`} />
          </label>
          <Button type="button" size="sm" className="h-8 text-xs" disabled={!dob || save.isPending} onClick={() => save.mutate()} data-testid={`person-details-save-${testKey}`}>
            {save.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
        <p className="text-[11px] text-muted-foreground">From the heads of terms or the person. No document is needed; the checks run again with it.</p>
      </div>
    );
  }

  return (
    <AmlFactList testId={`person-details-${testKey}`}>
      <AmlFact label="Date of birth" tone={!details && view?.needed ? "warn" : undefined} testId={`person-details-value-${testKey}`}>
        <span>{details ? view?.words : view?.needed ? "Needed before sign-off" : "Not recorded"}</span>
        <Button type="button" size="sm" variant="outline" className="ml-2 h-6 px-2 text-[11px]" onClick={open} data-testid={`person-details-edit-${testKey}`}>
          {details ? "Change" : "Add"}
        </Button>
      </AmlFact>
    </AmlFactList>
  );
}
