import { useState, useEffect } from "react";
import { WifiOff, Wifi } from "lucide-react";
import { getSocket } from "@/lib/socket";

export function ConnectionStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(true);
  const [showReconnected, setShowReconnected] = useState(false);

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

    const checkSocket = () => {
      const socket = getSocket();
      const connected = socket?.connected ?? true;
      setSocketConnected(prev => {
        if (!prev && connected) {
          setShowReconnected(true);
          setTimeout(() => setShowReconnected(false), 3000);
        }
        return connected;
      });
    };

    interval = setInterval(checkSocket, 2000);
    checkSocket();

    return () => clearInterval(interval);
  }, []);

  const disconnected = !isOnline || !socketConnected;

  if (!disconnected && !showReconnected) return null;

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
