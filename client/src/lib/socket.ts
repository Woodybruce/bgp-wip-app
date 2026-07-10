import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function connectSocket(): Socket {
  // Idempotent: if we already have a socket object, return it — even if
  // it's mid-reconnect (connected === false). socket.io has its own
  // reconnection state machine; tearing the socket down and recreating
  // it on every transient blip was causing connection churn. Let the
  // existing instance recover.
  if (socket) return socket;

  const token = localStorage.getItem("bgp_auth_token");
  if (!token) {
    console.warn("[ws] No auth token, skipping socket connection");
    return socket as any;
  }

  socket = io({
    path: "/ws",
    auth: { token },
    // WebSocket-only — no HTTP long-polling fallback. Polling requires
    // sticky sessions (each poll must hit the same backend that holds
    // the session); behind Railway's edge with >1 replica or across a
    // restart, consecutive polls land on different instances and the
    // handshake fails, producing the constant "reconnecting" churn that
    // plagued chatbgp.app. A WebSocket is one persistent connection
    // pinned to a single instance, so it sidesteps that entirely — and
    // it's much lower latency, which is what chat actually needs.
    // Railway supports WS natively, so dropping polling is safe here.
    transports: ["websocket"],
    upgrade: false,
    rememberUpgrade: true,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    reconnectionAttempts: Infinity,
    // Generous handshake timeout so a slow first connect doesn't get
    // torn down prematurely.
    timeout: 20000,
  });

  socket.on("connect", () => {
    console.log("[ws] Connected", socket?.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("[ws] Disconnected:", reason);
    // "io server disconnect" means the server deliberately dropped us
    // (e.g. auth failure) — socket.io won't auto-reconnect in that case,
    // so kick it manually.
    if (reason === "io server disconnect") socket?.connect();
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
