// Apollo-powered contact discovery dialog. Opens from a company page,
// queries Apollo for likely key people, lets the user cherry-pick which to
// import into crm_contacts.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Sparkles, Search, Linkedin, Mail } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ApolloPerson {
  apollo_id: string;
  name: string;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  location: string | null;
}

export function ApolloContactsDialog({ companyId, companyName, open, onOpenChange }: {
  companyId: string;
  companyName: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [people, setPeople] = useState<ApolloPerson[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ran, setRan] = useState(false);

  const discover = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/brand/${companyId}/apollo/discover`, {});
      return res.json() as Promise<{ people: ApolloPerson[] }>;
    },
    onSuccess: (out) => {
      setPeople(out.people || []);
      setSelected(new Set(out.people?.map(p => p.apollo_id) || []));
      setRan(true);
      if (!out.people?.length) toast({ title: "No new contacts found" });
    },
    onError: (e: any) => toast({ title: "Apollo error", description: e.message, variant: "destructive" }),
  });

  const importM = useMutation({
    mutationFn: async () => {
      const chosen = people.filter(p => selected.has(p.apollo_id));
      const res = await apiRequest("POST", `/api/brand/${companyId}/apollo/import`, { people: chosen });
      return res.json() as Promise<{ inserted: number; requested: number }>;
    },
    onSuccess: (out) => {
      toast({ title: `Imported ${out.inserted} contact${out.inserted === 1 ? "" : "s"}` });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/contacts"] });
      onOpenChange(false);
      setPeople([]);
      setSelected(new Set());
      setRan(false);
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            Find contacts at {companyName}
          </DialogTitle>
          <DialogDescription>
            Pulls likely key people (founders, property directors, heads of retail) from Apollo.
            Nothing is saved until you click Import.
          </DialogDescription>
        </DialogHeader>

        {!ran && !discover.isPending && (
          <div className="py-8 flex flex-col items-center gap-3">
            <Button onClick={() => discover.mutate()} disabled={discover.isPending}>
              <Search className="w-4 h-4 mr-2" /> Search Apollo
            </Button>
          </div>
        )}

        {discover.isPending && (
          <div className="py-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Searching Apollo…
          </div>
        )}

        {ran && !discover.isPending && (
          <div className="max-h-[500px] overflow-y-auto space-y-1">
            {people.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6">
                No new contacts — Apollo returned nobody we don't already have.
              </div>
            )}
            {people.map(p => (
              <label key={p.apollo_id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
                <Checkbox checked={selected.has(p.apollo_id)} onCheckedChange={() => toggle(p.apollo_id)} />
                <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0">
                  {p.avatar_url && <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{p.name}</span>
                    {p.role && <Badge variant="outline" className="text-[10px]">{p.role}</Badge>}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {p.email && <span className="flex items-center gap-0.5"><Mail className="w-3 h-3" />{p.email}</span>}
                    {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 hover:underline" onClick={(e) => e.stopPropagation()}><Linkedin className="w-3 h-3" />LinkedIn</a>}
                    {p.location && <span>· {p.location}</span>}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          {ran && people.length > 0 && (
            <Button onClick={() => importM.mutate()} disabled={importM.isPending || selected.size === 0}>
              {importM.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Import {selected.size} contact{selected.size === 1 ? "" : "s"}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
