// ─────────────────────────────────────────────────────────────────────────
// ChatBGP context — keeps conversation state alive across page navigation.
//
// Wraps the Router in App.tsx so the ChatBGP page can unmount/remount
// without losing messages, active thread, or input. Conversation resets
// only when the user explicitly starts a new chat or clears history.
// ─────────────────────────────────────────────────────────────────────────
import { createContext, useContext, useState, useRef, useCallback, type ReactNode } from "react";

export type LocalMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  userId?: string | null;
};

interface ChatBGPState {
  activeThreadId: string | null;
  setActiveThreadId: (id: string | null) => void;
  messages: LocalMessage[];
  setMessages: React.Dispatch<React.SetStateAction<LocalMessage[]>>;
  messagesRef: React.MutableRefObject<LocalMessage[]>;
  input: string;
  setInput: (v: string) => void;
  streamingContent: string;
  setStreamingContent: (v: string) => void;
  completedActions: Set<string>;
  setCompletedActions: React.Dispatch<React.SetStateAction<Set<string>>>;
  messageQueueRef: React.MutableRefObject<string[]>;
  queueLength: number;
  setQueueLength: (v: number) => void;
  progressLabel: string;
  setProgressLabel: (v: string) => void;
  activeProjectView: any;
  setActiveProjectView: (v: any) => void;
  reset: () => void;
}

const ChatBGPContext = createContext<ChatBGPState | null>(null);

export function ChatBGPProvider({ children }: { children: ReactNode }) {
  const [activeThreadId, _setActiveThreadId] = useState<string | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const messagesRef = useRef<LocalMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [completedActions, setCompletedActions] = useState<Set<string>>(new Set());
  const messageQueueRef = useRef<string[]>([]);
  const [queueLength, setQueueLength] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [activeProjectView, setActiveProjectView] = useState<any>(null);

  const setActiveThreadId = useCallback((id: string | null) => {
    activeThreadIdRef.current = id;
    _setActiveThreadId(id);
    setCompletedActions(new Set());
    messageQueueRef.current = [];
    setQueueLength(0);
    if (id) setActiveProjectView(null);
  }, []);

  const reset = useCallback(() => {
    _setActiveThreadId(null);
    activeThreadIdRef.current = null;
    setMessages([]);
    messagesRef.current = [];
    setInput("");
    setStreamingContent("");
    setCompletedActions(new Set());
    messageQueueRef.current = [];
    setQueueLength(0);
    setProgressLabel("");
    setActiveProjectView(null);
  }, []);

  return (
    <ChatBGPContext.Provider value={{
      activeThreadId, setActiveThreadId,
      messages, setMessages, messagesRef,
      input, setInput,
      streamingContent, setStreamingContent,
      completedActions, setCompletedActions,
      messageQueueRef, queueLength, setQueueLength,
      progressLabel, setProgressLabel,
      activeProjectView, setActiveProjectView,
      reset,
    }}>
      {children}
    </ChatBGPContext.Provider>
  );
}

export function useChatBGPState(): ChatBGPState {
  const ctx = useContext(ChatBGPContext);
  if (!ctx) throw new Error("useChatBGPState must be used inside ChatBGPProvider");
  return ctx;
}
