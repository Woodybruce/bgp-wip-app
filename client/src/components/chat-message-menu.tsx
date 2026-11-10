import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Copy, Download, Loader2, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { copyChatContent } from "@/lib/chat-clipboard";
import { createMessagePressGesture } from "@/lib/message-press-gesture";
import { downloadChatWord } from "@/lib/chat-word";

/** Shared chat message controls. Nothing is sent or forwarded by this menu. */
export function ChatMessageMenu({ content, threadId, children, disabled = false, onEdit, onDelete }: {
  content?: string; threadId?: string | null; children: ReactNode; disabled?: boolean;
  onEdit?: () => void; onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const gesture = useMemo(() => createMessagePressGesture(() => setOpen(true)), []);
  useEffect(() => () => gesture.cancel(), [gesture]);
  useEffect(() => { gesture.cancel(); setOpen(false); setStatus(null); }, [content, disabled, gesture]);
  const enabled = !disabled && (!!content?.trim() || !!onEdit || !!onDelete);
  const interactive = (target: EventTarget) => target instanceof Element && !!target.closest("a,button,input,textarea,select,audio,video,[contenteditable=true],[role=button]");
  const run = async (work: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setStatus(null);
    try { setStatus({ text: await work() }); }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : "That action could not be completed.", error: true }); }
    finally { setBusy(false); }
  };
  return <div className="group/message-actions relative pr-6 [@media(pointer:coarse)]:select-none [-webkit-touch-callout:none] [&_a]:[-webkit-touch-callout:default] [&_input]:select-text [&_textarea]:select-text [&_[contenteditable=true]]:select-text" data-testid="chat-message-controls"
    onPointerDown={event => {
      if (enabled && (event.pointerType === "touch" || event.pointerType === "pen") && !interactive(event.target)) gesture.start(event.clientX, event.clientY);
    }}
    onPointerMove={event => gesture.move(event.clientX, event.clientY)}
    onPointerUp={() => gesture.cancel()} onPointerCancel={() => gesture.cancel()} onPointerLeave={() => gesture.cancel()}
    onContextMenu={event => {
      if (!enabled || interactive(event.target) || window.getSelection()?.toString()) return;
      event.preventDefault(); gesture.cancel(); setOpen(true);
    }}>
    {children}
    {enabled && <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Message actions" title="Message actions" className={`absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-card/95 text-muted-foreground shadow-sm transition-opacity hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${open ? "opacity-100" : "opacity-70 sm:opacity-0 sm:group-hover/message-actions:opacity-100 focus:opacity-100"}`} data-testid="chat-message-menu-trigger">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {!!content?.trim() && <>
          <DropdownMenuItem disabled={busy} onSelect={() => void run(async () => { await copyChatContent(content); return "Message copied."; })}><Copy className="mr-2 h-4 w-4" />Copy</DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => void run(() => downloadChatWord(content, threadId))}><Download className="mr-2 h-4 w-4" />Download Word</DropdownMenuItem>
        </>}
        {(onEdit || onDelete) && !!content?.trim() && <DropdownMenuSeparator />}
        {onEdit && <DropdownMenuItem onSelect={onEdit}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
        {onDelete && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>}
    {status && <p className={`mt-1 text-[11px] ${status.error ? "text-destructive" : "text-muted-foreground"}`} role={status.error ? "alert" : "status"}>{status.text}</p>}
  </div>;
}
