/**
 * My profile photo — the one place a user sets their own picture. The photo
 * propagates everywhere profilePicUrl already renders: chat messages and the
 * inbox, mobile, HR. Server side: POST /api/users/profile-pic (5MB max,
 * jpg/png/webp/heic), stored via file-storage and served from
 * /uploads/profile-pics/.
 */
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Camera, Loader2 } from "lucide-react";
import { queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function ProfilePhotoCard() {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { data: me } = useQuery<{ id: string; name?: string; username?: string; profilePicUrl?: string | null }>({
    queryKey: ["/api/auth/me"],
  });

  const initials = (me?.name || me?.username || "?")
    .split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Photo too large", description: "Max 5MB — try a smaller image.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/users/profile-pic", {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: { ...getAuthHeaders() },
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Upload failed");
      // Refresh everywhere the photo shows: own header/profile + team pics in chat.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Profile photo updated", description: "It now shows on your chat messages across the app." });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message, variant: "destructive" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card data-testid="profile-photo-card">
      <CardContent className="p-4 flex items-center gap-4">
        <button
          type="button"
          className="relative group rounded-full"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          title="Change profile photo"
          data-testid="button-change-profile-photo"
        >
          <Avatar className="h-16 w-16 border">
            {me?.profilePicUrl && <AvatarImage src={me.profilePicUrl} alt={me?.name || "Me"} />}
            <AvatarFallback className="bg-zinc-800 text-white text-lg">{initials}</AvatarFallback>
          </Avatar>
          <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            {busy ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{me?.name || me?.username || "My profile"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Your photo shows on your chat messages and anywhere your name appears.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Camera className="w-4 h-4 mr-1.5" />}
          {me?.profilePicUrl ? "Change photo" : "Add photo"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
      </CardContent>
    </Card>
  );
}
