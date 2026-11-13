import type { LettingNoteReading, NoteKind, NoteSource } from "@shared/letting-note";

export interface NoteFillProps {
  kind: NoteKind;
  unitId: string;
  offerId?: string;                 // round: the offer the position belongs to
  source?: NoteSource;              // read a piece of writing already in the app instead of a pasted note
  initialText?: string;
  autoRead?: boolean;               // read as soon as it mounts (used with source or initialText)
  autoApply?: boolean;              // and fill the form without a second press; the person still checks and saves
  onApply: (reading: LettingNoteReading) => void;
  className?: string;
}

export function NoteFill(_props: NoteFillProps) {
  return null;
}
