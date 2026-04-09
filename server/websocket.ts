import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { pool } from "./db";

let io: SocketIOServer | null = null;

async function getUserIdFromToken(token: string): Promise<string | null> {
  const result = await pool.query(
    "SELECT user_id FROM auth_tokens WHERE token = $1 AND expires_at > NOW()",
    [token]
  );
  return result.rows[0]?.user_id || null;
}

export function setupWebSocket(httpServer: HTTPServer) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: process.env.REPLIT_DEV_DOMAIN ? [`https://${process.env.REPLIT_DEV_DOMAIN}`, `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`] : "*", methods: ["GET", "POST"] },
    path: "/ws",
    transports: ["websocket", "polling"],
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const userId = await getUserIdFromToken(token);
      if (!userId) return next(new Error("Invalid token"));
      (socket as any).userId = userId;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", async (socket: Socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);

    try {
      const result = await pool.query(
        `SELECT DISTINCT ct.id FROM chat_threads ct
         LEFT JOIN chat_thread_members ctm ON ctm.thread_id = ct.id
         WHERE ct.created_by = $1 OR ctm.user_id = $1`,
        [userId]
      );
      for (const row of result.rows) {
        socket.join(`thread:${row.id}`);
      }
    } catch (err) {
      console.error("[ws] Failed to join thread rooms:", err);
    }

    socket.on("typing", (data: { threadId: string }) => {
      socket.to(`thread:${data.threadId}`).emit("typing", {
        threadId: data.threadId,
        userId,
      });
    });

    socket.on("stop_typing", (data: { threadId: string }) => {
      socket.to(`thread:${data.threadId}`).emit("stop_typing", {
        threadId: data.threadId,
        userId,
      });
    });

    socket.on("mark_seen", async (data: { threadId: string }) => {
      try {
        await pool.query(
          `UPDATE chat_thread_members SET seen = true WHERE thread_id = $1 AND user_id = $2`,
          [data.threadId, userId]
        );
        io?.to(`thread:${data.threadId}`).emit("thread_seen", {
          threadId: data.threadId,
          userId,
        });
      } catch (err: any) { console.error("[ws] mark_seen error:", err?.message); }
    });

    socket.on("disconnect", () => {});
  });

  console.log("[ws] WebSocket server initialized");
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitNewMessage(threadId: string, message: any, senderName: string) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit("new_message", {
    threadId,
    message,
    senderName,
  });
}

export function emitMessageUpdated(threadId: string, messageId: string, content: string) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit("message_updated", {
    threadId,
    messageId,
    content,
  });
}

export function emitMessageDeleted(threadId: string, messageId: string) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit("message_deleted", {
    threadId,
    messageId,
  });
}

export function emitThreadUpdated(threadId: string, updates: any) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit("thread_updated", {
    threadId,
    ...updates,
  });
}

export function emitMemberAdded(threadId: string, userId: string, memberName: string) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit("member_added", {
    threadId,
    userId,
    memberName,
  });
  const userSockets = io.sockets.adapter.rooms.get(`user:${userId}`);
  if (userSockets) {
    for (const socketId of userSockets) {
      const s = io.sockets.sockets.get(socketId);
      if (s) s.join(`thread:${threadId}`);
    }
  }
}

export function emitMemberRemoved(threadId: string, userId: string) {
  if (!io) return;
  io.to(`thread:${threadId}`).emit("member_removed", {
    threadId,
    userId,
  });
  const userSockets = io.sockets.adapter.rooms.get(`user:${userId}`);
  if (userSockets) {
    for (const socketId of userSockets) {
      const s = io.sockets.sockets.get(socketId);
      if (s) s.leave(`thread:${threadId}`);
    }
  }
}

export function emitNotification(userId: string, data: { type: string; threadId: string; senderName: string; preview: string }) {
  if (!io) return;
  io.to(`user:${userId}`).emit("notification", data);
}
