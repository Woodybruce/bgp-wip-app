import { useEffect, useRef, useCallback, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { connectSocket, disconnectSocket, getSocket, emitTyping, emitStopTyping } from "@/lib/socket";
import { useToast } from "@/hooks/use-toast";

interface TypingUser {
  userId: string;
  threadId: string;
}

export function useSocket(userId: string | null) {
  const { toast } = useToast();

  useEffect(() => {
    if (!userId) return;
    const socket = connectSocket();
    if (!socket) return;

    const handleNewMessage = (data: { threadId: string; message: any; senderName: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
    };

    const handleNotification = (data: { type: string; threadId: string; senderName: string; preview: string }) => {
      toast({
        title: data.senderName,
        description: data.preview,
        duration: 4000,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
    };

    const handleMessageUpdated = (data: { threadId: string; messageId: string; content: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
    };

    const handleMessageDeleted = (data: { threadId: string; messageId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
    };

    const handleThreadUpdated = (data: { threadId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
    };

    const handleMemberAdded = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    };

    const handleMemberRemoved = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
    };

    const handleThreadSeen = (data: { threadId: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads", data.threadId] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/chat/notifications"] });
    };

    socket.on("new_message", handleNewMessage);
    socket.on("notification", handleNotification);
    socket.on("message_updated", handleMessageUpdated);
    socket.on("message_deleted", handleMessageDeleted);
    socket.on("thread_updated", handleThreadUpdated);
    socket.on("member_added", handleMemberAdded);
    socket.on("member_removed", handleMemberRemoved);
    socket.on("thread_seen", handleThreadSeen);

    return () => {
      socket.off("new_message", handleNewMessage);
      socket.off("notification", handleNotification);
      socket.off("message_updated", handleMessageUpdated);
      socket.off("message_deleted", handleMessageDeleted);
      socket.off("thread_updated", handleThreadUpdated);
      socket.off("member_added", handleMemberAdded);
      socket.off("member_removed", handleMemberRemoved);
      socket.off("thread_seen", handleThreadSeen);
    };
  }, [userId, toast]);

  useEffect(() => {
    return () => {
      disconnectSocket();
    };
  }, []);
}

export function useTypingIndicator(threadId: string | null) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const typingTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const myTypingTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const socket = getSocket();
    if (!socket || !threadId) return;

    const handleTyping = (data: { threadId: string; userId: string }) => {
      if (data.threadId !== threadId) return;
      setTypingUsers(prev => {
        if (prev.find(u => u.userId === data.userId)) return prev;
        return [...prev, { userId: data.userId, threadId: data.threadId }];
      });
      const existing = typingTimeouts.current.get(data.userId);
      if (existing) clearTimeout(existing);
      typingTimeouts.current.set(data.userId, setTimeout(() => {
        setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
        typingTimeouts.current.delete(data.userId);
      }, 3000));
    };

    const handleStopTyping = (data: { threadId: string; userId: string }) => {
      if (data.threadId !== threadId) return;
      setTypingUsers(prev => prev.filter(u => u.userId !== data.userId));
      const existing = typingTimeouts.current.get(data.userId);
      if (existing) {
        clearTimeout(existing);
        typingTimeouts.current.delete(data.userId);
      }
    };

    socket.on("typing", handleTyping);
    socket.on("stop_typing", handleStopTyping);

    return () => {
      socket.off("typing", handleTyping);
      socket.off("stop_typing", handleStopTyping);
      for (const t of typingTimeouts.current.values()) clearTimeout(t);
      typingTimeouts.current.clear();
      setTypingUsers([]);
    };
  }, [threadId]);

  const sendTyping = useCallback(() => {
    if (!threadId) return;
    emitTyping(threadId);
    if (myTypingTimeout.current) clearTimeout(myTypingTimeout.current);
    myTypingTimeout.current = setTimeout(() => {
      emitStopTyping(threadId);
    }, 2000);
  }, [threadId]);

  const stopTyping = useCallback(() => {
    if (!threadId) return;
    emitStopTyping(threadId);
    if (myTypingTimeout.current) {
      clearTimeout(myTypingTimeout.current);
      myTypingTimeout.current = null;
    }
  }, [threadId]);

  return { typingUsers, sendTyping, stopTyping };
}
