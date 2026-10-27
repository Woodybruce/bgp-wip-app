import { exportRichTextText } from "@shared/chat-rich-text";
import { getAuthHeaders } from "@/lib/queryClient";

export async function downloadChatWord(markdown: string, threadId?: string | null, subject?: string) {
  const response = await fetch("/api/chat-drafts/word", {
    method: "POST", credentials: "include", headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ subject: subject || "BGP note", bodyMarkdown: markdown, ...(threadId ? { threadId } : {}) }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "The Word document could not be downloaded. Please try again.");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = `${exportRichTextText(subject || "BGP note").replace(/[^a-z0-9 -]/gi, "").slice(0, 80) || "BGP note"}.docx`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "Word document downloaded.";
}
