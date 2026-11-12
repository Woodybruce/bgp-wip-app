// Props shared by the Targeting Brief dialog's sections
// (client/src/components/unit-brief-dialog.tsx). `ws` is the whole brief
// workspace from GET /api/unit-briefs/:id/workspace; `refresh` re-reads it
// (and the tracker's brief list) after a change.
import type { BriefWorkspace } from "@shared/unit-brief";

export interface BriefSectionProps {
  ws: BriefWorkspace;
  refresh: () => void;
}

// People a client's brief document named, offered on People & sign-off.
export interface SuggestedBriefPerson { name: string; role: string | null; firm: string | null; email: string | null }

// apiRequest throws "409: the server's message": the message without the code.
export const serverMessage = (e: unknown, fallback: string): string =>
  (e instanceof Error ? e.message.replace(/^\d{3}:\s*/, "") : "") || fallback;
