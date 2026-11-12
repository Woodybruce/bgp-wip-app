// Each person's comments on the brief, with AI help, and the timeline of
// what happened (Woody, 2026-11-12): a person types their own view, can ask
// AI to draft it from the brief and their notes, edits it and saves it.
// Saved comments show who wrote them, what they are on the brief and when.
// The app's own lines (agreed, terms changed, person added) sit in the same
// timeline. Routes: server/unit-brief-workspace.ts.
import { useState } from "react";
import { Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pill, PillCount } from "@/components/ui/pill";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BriefComment } from "@shared/unit-brief";
import { serverMessage, type BriefSectionProps } from "./types";

const MICRO_LABEL = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const CHIP = "rounded-full border border-border px-2 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap text-muted-foreground";

const fmtWhen = (d: string | null | undefined): string => {
  if (!d) return "";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "" : `${dt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}, ${dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

type Filter = "all" | "comments" | "activity";

export function BriefCommentsPanel({ ws, refresh }: BriefSectionProps) {
  const { toast } = useToast();
  const { brief, comments, viewer } = ws;
  const [text, setText] = useState("");
  const [aiAssisted, setAiAssisted] = useState(false);
  const [beforeAi, setBeforeAi] = useState<string | null>(null); // what the person typed before the draft replaced it
  const [aiError, setAiError] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const own = comments.filter(c => c.kind === "comment");
  const events = comments.filter(c => c.kind === "event");
  const shown = filter === "comments" ? own : filter === "activity" ? events : comments;

  // AI drafts the comment from the brief, this person's role and whatever
  // they have typed. The draft goes into the box; nothing is saved.
  const draftWithAi = async () => {
    setDrafting(true); setAiError(null);
    try {
      const res = await apiRequest("POST", `/api/unit-briefs/${brief.id}/comments/draft-ai`, { notes: text });
      const data = await res.json();
      const body = String(data?.body || "").trim();
      if (!body) throw new Error("AI returned nothing. Try again.");
      setBeforeAi(text);
      setText(body);
      setAiAssisted(true);
    } catch (e) {
      setAiError(serverMessage(e, "AI could not draft the comment."));
    } finally {
      setDrafting(false);
    }
  };

  const undoAi = () => {
    if (beforeAi === null) return;
    setText(beforeAi); setBeforeAi(null); setAiAssisted(false);
  };

  const saveComment = async () => {
    const body = text.trim();
    if (!body || saving) return;
    setSaving(true);
    try {
      await apiRequest("POST", `/api/unit-briefs/${brief.id}/comments`, { body, aiAssisted });
      setText(""); setAiAssisted(false); setBeforeAi(null); setAiError(null);
      refresh();
    } catch (e) {
      toast({ title: "Comment not saved", description: serverMessage(e, "Try again."), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (c: BriefComment) => {
    const body = editText.trim();
    if (!body || busyId) return;
    if (body === c.body) { setEditId(null); return; }
    setBusyId(c.id);
    try {
      await apiRequest("PATCH", `/api/unit-briefs/comments/${c.id}`, { body });
      setEditId(null);
      refresh();
    } catch (e) {
      toast({ title: "Comment not saved", description: serverMessage(e, "Try again."), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const removeComment = async (c: BriefComment) => {
    if (busyId || !window.confirm("Delete your comment? This cannot be undone.")) return;
    setBusyId(c.id);
    try {
      await apiRequest("DELETE", `/api/unit-briefs/comments/${c.id}`);
      refresh();
    } catch (e) {
      toast({ title: "Comment not deleted", description: serverMessage(e, "Try again."), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4 min-w-0" data-testid="brief-comments-panel">
      {viewer.canComment && (
        <div className="space-y-1.5" data-testid="brief-comment-composer">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <label htmlFor="brief-comment-box" className={MICRO_LABEL}>Your comment</label>
            <span className="text-xs text-muted-foreground" data-testid="brief-comment-shown-as">Shown as {viewer.name || "you"}, {viewer.roleLabel}</span>
          </div>
          <Textarea
            id="brief-comment-box"
            rows={4}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Your view on the brief: the use, the commercials, the targets, anything you need before you can agree it."
            className="text-sm"
            disabled={drafting}
            data-testid="brief-comment-input"
          />
          {aiAssisted && !aiError && (
            <p className="text-xs text-muted-foreground" data-testid="brief-comment-ai-note">
              Drafted with AI from the brief and your notes. Edit it, then save.
              {beforeAi !== null && (
                <button type="button" className="ml-2 underline hover:text-foreground" onClick={undoAi} data-testid="brief-comment-ai-undo">
                  {beforeAi.trim() ? "Undo, and put back what I typed" : "Undo"}
                </button>
              )}
            </p>
          )}
          {aiError && <p className="text-xs text-destructive" role="alert" data-testid="brief-comment-ai-error">{aiError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={draftWithAi} disabled={drafting || saving} data-testid="brief-comment-ai">
              {drafting ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              {drafting ? "Drafting…" : "Help me write it"}
            </Button>
            <Button type="button" size="sm" onClick={saveComment} disabled={!text.trim() || saving || drafting} data-testid="brief-comment-save">
              {saving ? "Saving…" : "Save comment"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" data-testid="brief-comment-filters">
        <Pill active={filter === "all"} onClick={() => setFilter("all")} data-testid="brief-comment-filter-all">All</Pill>
        <Pill active={filter === "comments"} onClick={() => setFilter("comments")} data-testid="brief-comment-filter-comments">Comments<PillCount n={own.length} active={filter === "comments"} /></Pill>
        <Pill active={filter === "activity"} onClick={() => setFilter("activity")} data-testid="brief-comment-filter-activity">Activity<PillCount n={events.length} active={filter === "activity"} /></Pill>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="brief-comments-empty">
          {filter === "activity" ? "Nothing has happened on this brief yet." : "No comments yet. Each person involved adds their own view here before the brief is agreed."}
        </p>
      ) : (
        <ul className="space-y-2" data-testid="brief-comment-list">
          {shown.map(c => c.kind === "event" ? (
            <li key={c.id} className="text-xs text-muted-foreground flex flex-wrap gap-x-2 px-1" data-testid={`brief-event-${c.id}`}>
              <span className="min-w-0 break-words"><span className="font-medium text-foreground/80">{c.userName || "Someone"}</span> {c.body}</span>
              <span className="tabular-nums whitespace-nowrap">{fmtWhen(c.createdAt)}</span>
            </li>
          ) : (
            <li key={c.id} className="rounded-lg border p-3 space-y-1.5 min-w-0" data-testid={`brief-comment-${c.id}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium min-w-0 truncate" data-testid={`brief-comment-author-${c.id}`}>{c.userName || "Someone"}</span>
                {c.roleLabel && <span className={CHIP}>{c.roleLabel}</span>}
                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{fmtWhen(c.createdAt)}</span>
                {c.updatedAt && <span className="text-xs text-muted-foreground" title={`Edited ${fmtWhen(c.updatedAt)}`}>edited</span>}
                {c.aiAssisted && <span className="text-[10px] uppercase tracking-wide text-muted-foreground inline-flex items-center gap-0.5" data-testid={`brief-comment-ai-tag-${c.id}`}><Sparkles className="h-2.5 w-2.5" /> AI-assisted</span>}
                {c.userId === viewer.userId && editId !== c.id && (
                  <span className="ml-auto flex gap-0.5">
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!!busyId} onClick={() => { setEditId(c.id); setEditText(c.body); }} data-testid={`brief-comment-edit-${c.id}`}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" disabled={!!busyId} onClick={() => removeComment(c)} aria-label="Delete your comment" data-testid={`brief-comment-delete-${c.id}`}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </span>
                )}
              </div>
              {editId === c.id ? (
                <div className="space-y-1.5">
                  <Textarea rows={4} value={editText} onChange={e => setEditText(e.target.value)} className="text-sm" autoFocus data-testid={`brief-comment-edit-input-${c.id}`} />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditId(null)} disabled={busyId === c.id}>Cancel</Button>
                    <Button type="button" size="sm" onClick={() => saveEdit(c)} disabled={!editText.trim() || busyId === c.id} data-testid={`brief-comment-edit-save-${c.id}`}>{busyId === c.id ? "Saving…" : "Save"}</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm whitespace-pre-wrap break-words" data-testid={`brief-comment-body-${c.id}`}>{c.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
