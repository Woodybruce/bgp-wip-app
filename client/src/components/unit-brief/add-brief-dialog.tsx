import type { AvailableUnit } from "@shared/schema";

export function AddBriefDialog(_props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onStarted: (unit: AvailableUnit, info: { briefId: string; briefCreated: boolean; alreadyListed: boolean; dealRef: number | null }) => void;
}) {
  return null;
}
