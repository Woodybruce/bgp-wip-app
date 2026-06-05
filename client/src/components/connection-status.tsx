import { useState, useEffect } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { getSocket } from "@/lib/socket";

// Banner doesn't show instantly when the socket flips to disconnected —
// we wait this long first. Reason: socket.io routinely cycles through
// transient disconnect states (transport upgrade, idle reconnect, page
// visibility resume) and showing a red banner on every blip is noise.
// Real outages last well past 5s; transient flips don't.
const BANNER_GRACE_MS = 5000;

export function ConnectionStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

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

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    let reconnectedTimer: ReturnType<typeof setTimeout> | null = null;

    const checkSocket = () => {
      const socket = getSocket();
      const connected = socket?.connected ?? true;
      setSocketConnected(prev => {
        if (!prev && connected) {
          setShowReconnected(true);
          if (reconnectedTimer) clearTimeout(reconnectedTimer);
          reconnectedTimer = setTimeout(() => setShowReconnected(false), 3000);
        }
        return connected;
      });
    };

    interval = setInterval(checkSocket, 2000);
    checkSocket();

    return () => {
      clearInterval(interval);
      if (reconnectedTimer) clearTimeout(reconnectedTimer);
    };
  }, []);

  const disconnected = !isOnline || !socketConnected;

  // Hold off rendering the banner for BANNER_GRACE_MS — most "disconnects"
  // are transport blips that resolve themselves before then. If it's still
  // disconnected at the end of the grace period, show the banner.
  useEffect(() => {
    if (!disconnected) {
      setShowBanner(false);
      return;
    }
    const t = setTimeout(() => setShowBanner(true), BANNER_GRACE_MS);
    return () => clearTimeout(t);
  }, [disconnected]);

  if (!showBanner && !showReconnected) return null;

  if (showReconnected && !disconnected) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-green-600 text-white text-sm py-1.5 px-4 animate-in slide-in-from-top duration-300"
        data-testid="banner-reconnected"
      >
        <Wifi className="w-4 h-4" />
        <span>Connection restored</span>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-2 bg-destructive text-destructive-foreground text-sm py-1.5 px-4 animate-in slide-in-from-top duration-300"
      data-testid="banner-disconnected"
    >
      <WifiOff className="w-4 h-4" />
      <span>{!isOnline ? "You're offline — check your internet connection" : "Connection lost — trying to reconnect..."}</span>
    </div>
  );
}
