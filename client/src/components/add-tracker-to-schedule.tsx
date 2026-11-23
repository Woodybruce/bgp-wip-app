// "Add to the tenancy schedule" for a Letting Tracker unit with no schedule
// row (Woody, 2026-11-23). One server door, server/tracker-to-schedule.ts: the
// row is made from the tracker unit and tied to it and its transaction by id.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function useAddTrackerToSchedule(propertyId: string) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async (trackerId: string) =>
      (await apiRequest("POST", `/api/tenancy-schedule/unit/from-tracker/${encodeURIComponent(trackerId)}`, {})).json() as Promise<{ status: string; unit?: string }>,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tenancy-schedule/property", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyId] });
      queryClient.invalidateQueries({ queryKey: ["/api/plans"] });
      toast({
        title: r.status === "already" ? "Already on the tenancy schedule" : "Added to the tenancy schedule",
        description: r.status === "already" ? "Another row on the schedule already holds this unit." : `${r.unit || "The unit"} is now a vacant row on the schedule, linked to its Letting Tracker unit.`,
      });
    },
    onError: (err: any) => toast({ title: "Couldn't add it to the tenancy schedule", description: String(err?.message || "").replace(/^\d{3}:\s*/, ""), variant: "destructive" }),
  });
}

export function AddTrackerToScheduleButton({ propertyId, trackerId, compact, className }: { propertyId: string; trackerId: string; compact?: boolean; className?: string }) {
  const add = useAddTrackerToSchedule(propertyId);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={add.isPending}
      onClick={() => add.mutate(trackerId)}
      className={cn(compact ? "h-6 px-1.5 text-[11px]" : "h-7 text-xs", "border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-300", className)}
      title="Add this unit to the tenancy schedule as a vacant row, linked to its Letting Tracker unit"
      data-testid={`add-tracker-to-schedule-${trackerId}`}
    >
      <Plus className="mr-0.5 h-3 w-3" aria-hidden />
      {add.isPending ? "Adding…" : "Add to the tenancy schedule"}
    </Button>
  );
}
