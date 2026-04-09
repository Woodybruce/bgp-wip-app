import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(): Socket {
  if (socket?.connected) return socket;

  const token = localStorage.getItem("bgp_auth_token");
  if (!token) {
    console.warn("[ws] No auth token, skipping socket connection");
    return socket as any;
  }

  if (socket) {
    socket.disconnect();
  }

  socket = io({
    path: "/ws",
    auth: { token },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", () => {
    console.log("[ws] Connected");
  });

  socket.on("disconnect", (reason) => {
    console.log("[ws] Disconnected:", reason);
  });

  socket.on("connect_error", (err) => {
    console.warn("[ws] Connection error:", err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function emitTyping(threadId: string) {
  socket?.emit("typing", { threadId });
}

export function emitStopTyping(threadId: string) {
  socket?.emit("stop_typing", { threadId });
}

export function emitMarkSeen(threadId: string) {
  socket?.emit("mark_seen", { threadId });
}
