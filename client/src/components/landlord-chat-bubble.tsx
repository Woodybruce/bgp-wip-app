import { useState, type ReactNode } from "react";

export type LandlordChatMessage = {
  id?: string;
  role: string;
  userId?: string | null;
  userName?: string;
  createdAt?: string | null;
  editedAt?: string | null;
};

// Colour belongs to the author, never to the whole message. The ID keeps
// the same person recognisable in both the profile and full conversation.
const AUTHOR_COLOURS = [
  "text-teal-700 dark:text-teal-400", "text-indigo-700 dark:text-indigo-400",
  "text-rose-700 dark:text-rose-400", "text-blue-700 dark:text-blue-400",
  "text-purple-700 dark:text-purple-400", "text-orange-800 dark:text-orange-400",
  "text-emerald-700 dark:text-emerald-400", "text-pink-700 dark:text-pink-400",
  "text-cyan-800 dark:text-cyan-400", "text-amber-800 dark:text-amber-400",
  "text-fuchsia-700 dark:text-fuchsia-400", "text-lime-800 dark:text-lime-400",
  "text-sky-800 dark:text-sky-400", "text-violet-700 dark:text-violet-400",
  "text-red-800 dark:text-red-400", "text-slate-700 dark:text-slate-400",
];

export function landlordAuthorColour(userId?: string | null, role = "user", participantIds: string[] = []) {
  if (role === "assistant") return "text-primary";
  if (!userId) return "text-muted-foreground";
  const roster = [...new Set([...participantIds, userId].filter(id => id && id !== "__chatbgp__"))].sort();
  const used = new Set<number>();
  for (const id of roster) {
    let hash = 0;
    for (const letter of id) hash = Math.imul(hash, 31) + letter.charCodeAt(0) | 0;
    let index = (hash >>> 0) % AUTHOR_COLOURS.length;
    for (let attempt = 0; used.has(index) && attempt < AUTHOR_COLOURS.length; attempt++) index = (index + 1) % AUTHOR_COLOURS.length;
    used.add(index);
    if (id === userId) return AUTHOR_COLOURS[index];
  }
  return "text-muted-foreground";
}

export function landlordMessagePresentation(message: LandlordChatMessage, previous?: LandlordChatMessage, now = new Date()) {
  const date = new Date(message.createdAt || "");
  const previousDate = new Date(previous?.createdAt || "");
  const valid = Number.isFinite(date.getTime());
  const day = (value: Date) => value.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const sameDay = valid && Number.isFinite(previousDate.getTime()) && day(date) === day(previousDate);
  const sameAuthor = previous?.role === message.role && (message.role === "assistant" || !!message.userId && message.userId === previous.userId);
  const elapsed = date.getTime() - previousDate.getTime();
  const grouped = !!(sameAuthor && sameDay && elapsed >= 0 && elapsed <= 5 * 60_000);
  return {
    grouped,
    dateLabel: valid && !sameDay ? (day(date) === day(now) ? "Today" : date.toLocaleDateString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}) })) : null,
    timeLabel: valid ? date.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }) : null,
  };
}

export function LandlordChatBubble({ message, previous, currentUserId, photoUrl, participantIds, children, actions }: {
  message: LandlordChatMessage; previous?: LandlordChatMessage; currentUserId?: string | null;
  photoUrl?: string | null; participantIds?: string[]; children: ReactNode; actions?: ReactNode;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const own = message.role === "user" && !!currentUserId && message.userId === currentUserId;
  const name = message.role === "assistant" ? "ChatBGP" : own ? "You" : message.userName || "Team member";
  const colour = landlordAuthorColour(message.userId, message.role, participantIds);
  const { grouped, dateLabel, timeLabel } = landlordMessagePresentation(message, previous);
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" }}>
    {dateLabel && <div className="flex justify-center my-3" data-testid="landlord-chat-date"><span className="rounded-full bg-muted px-3 py-1 text-[11px] text-muted-foreground">{dateLabel}</span></div>}
    <div className={`group/msg relative flex items-start gap-2 text-sm leading-relaxed ${own ? "ml-auto justify-end" : "mr-auto justify-start"} ${grouped ? "mt-1" : "mt-3"}`} data-testid="landlord-chat-message">
      {!own && <div className="w-7 shrink-0 pt-0.5" aria-hidden="true">
        {!grouped && (photoUrl && failedPhoto !== photoUrl ? <img src={photoUrl} alt="" className="h-7 w-7 rounded-full object-cover" onError={() => setFailedPhoto(photoUrl)} />
          : <span className={`h-7 w-7 rounded-full bg-muted border border-border/60 flex items-center justify-center text-[11px] font-semibold ${colour}`}>{initials}</span>)}
      </div>}
      <div className={`relative min-w-0 w-fit max-w-[min(88%,42rem)] rounded-2xl px-3 py-2 shadow-sm ${own ? `bg-emerald-100/70 dark:bg-emerald-950/60 ${grouped ? "" : "rounded-tr-sm"}` : `bg-stone-50 dark:bg-stone-900 border border-border/60 ${grouped ? "" : "rounded-tl-sm"}`}`}>
        {!grouped && <p className={`mb-0.5 pr-5 text-xs font-semibold ${colour}`} data-testid="landlord-chat-author">{name}</p>}
        <div className="break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1">{children}</div>
        {(timeLabel || message.editedAt) && <p className="mt-1 text-right text-[11px] text-muted-foreground tabular-nums">
          {message.editedAt && <span>edited{timeLabel ? " · " : ""}</span>}
          {timeLabel && <time dateTime={message.createdAt || undefined} title="London time">{timeLabel}</time>}
        </p>}
        {actions}
      </div>
    </div>
  </div>;
}
