import { useState, useEffect } from "react";
import { WifiOff } from "lucide-react";

// Connection banner. Driven SOLELY by the browser's online/offline
// state (navigator.onLine + the online/offline events) — a genuine,
// actionable signal the user can do something about.
//
// It deliberately does NOT track the socket.io connection. That socket
// only powers chat typing indicators + live notifications, which
// degrade gracefully (everything refreshes on the next poll). The WS
// upgrade is unreliable through the chatbgp.app proxy and flaps in and
// out; surfacing that as a red "Connection lost" banner was a constant
// false alarm for something the user can't fix. So we don't.
export function ConnectionStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-destructive text-destructive-foreground text-sm py-1.5 px-4 animate-in slide-in-from-top duration-300"
      data-testid="banner-disconnected"
    >
      <WifiOff className="w-4 h-4" />
      <span>You're offline — check your internet connection</span>
    </div>
  );
}
