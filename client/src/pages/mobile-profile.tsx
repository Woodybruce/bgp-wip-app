// My Profile — WhatsApp-style profile screen for the phone app (Woody,
// 2026-08-23: "allow for mobile upload a profile like WhatsApp? Maybe can
// link with the CV"). Big photo with a camera badge (tap to change —
// POST /api/users/profile-pic, same endpoint as the desktop Settings card),
// then the person's HR/CV record from /api/hr/staff/:id, with a jump-off to
// the full HR profile. Route: /m/profile (owns its own header, like the
// other /m/* pages).
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Camera, Loader2, Phone, Mail, Users, Briefcase, GraduationCap, Linkedin, ChevronRight, FileText, Bell, BellOff } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export default function MobileProfilePage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Push notifications — status + a real end-to-end test, because "are
  // notifications working?" was unanswerable from inside the app.
  const push = usePushNotifications();
  const [pushBusy, setPushBusy] = useState(false);
  const isStandalone = typeof window !== "undefined" && ((window.navigator as any).standalone === true || window.matchMedia?.("(display-mode: standalone)").matches);
  const pushStatus: { label: string; detail: string; tone: "ok" | "warn" | "off" } = !push.isSupported
    ? { label: "Not available in the browser", detail: isStandalone ? "This device can't receive web push." : "Add the app to your Home Screen (Share → Add to Home Screen) and open it from there — iPhones only deliver notifications to the installed app.", tone: "off" }
    : push.permission === "denied"
      ? { label: "Blocked", detail: "Allow them in iPhone Settings → Notifications → BGP, then come back here.", tone: "warn" }
      : push.isSubscribed
        ? { label: "On for this device", detail: "You'll get a push for new messages, tags and approvals.", tone: "ok" }
        : { label: "Not enabled on this device", detail: "Tap Enable and allow notifications when asked.", tone: "warn" };
  const enablePush = async () => {
    setPushBusy(true);
    try {
      const ok = await push.subscribe();
      toast(ok ? { title: "Notifications on", description: "Send a test to check they arrive." } : { title: "Couldn't enable notifications", description: push.permission === "denied" ? "They're blocked in iPhone Settings for this app." : "Try again from the installed Home Screen app.", variant: "destructive" });
    } finally { setPushBusy(false); }
  };
  const testPush = async () => {
    setPushBusy(true);
    try {
      const r = await apiRequest("POST", "/api/push/test").then(x => x.json());
      if (!r.configured) toast({ title: "Server push isn't configured", description: "VAPID keys are missing on the server.", variant: "destructive" });
      else if (r.subscriptions === 0) toast({ title: "No devices registered", description: "Tap Enable on this device first.", variant: "destructive" });
      else if (r.sent > 0 && r.failed.length === 0) toast({ title: `Test sent to ${r.sent} device${r.sent === 1 ? "" : "s"}`, description: "It should appear on your lock screen within a few seconds. If not, check iPhone Settings → Notifications → BGP and Focus modes." });
      else toast({ title: `Sent ${r.sent}, failed ${r.failed.length}`, description: r.failed.map((f: any) => `${f.host}: ${f.statusCode ?? ""} ${f.message}`).join(" · ").slice(0, 300), variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Test failed", description: e?.message?.slice(0, 200), variant: "destructive" });
    } finally { setPushBusy(false); }
  };

  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const { data: hr } = useQuery<any>({
    queryKey: ["/api/hr/staff", me?.id],
    queryFn: async () => {
      const r = await fetch(`/api/hr/staff/${me.id}`, { credentials: "include", headers: getAuthHeaders() });
      if (!r.ok) return null;
      return r.json();
    },
    enabled: !!me?.id,
    staleTime: 5 * 60 * 1000,
  });

  const initials = (me?.name || me?.username || "?")
    .split(/\s+/).map((p: string) => p[0]).slice(0, 2).join("").toUpperCase();

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


  const infoRows: Array<{ icon: any; label: string; value: string; href?: string }> = [];
  if (me?.phone) infoRows.push({ icon: Phone, label: "Phone", value: me.phone, href: `tel:${me.phone.replace(/\s+/g, "")}` });
  if (me?.email) infoRows.push({ icon: Mail, label: "Email", value: me.email, href: `mailto:${me.email}` });
  if (me?.team || me?.department) infoRows.push({ icon: Users, label: "Team", value: [me?.team, me?.department].filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(" · ") });
  if (hr?.linkedin_url) infoRows.push({ icon: Linkedin, label: "LinkedIn", value: hr.linkedin_url.replace(/^https?:\/\/(www\.)?/, ""), href: hr.linkedin_url });

  const cvSections: Array<{ icon: any; title: string; body: string }> = [];
  if (hr?.bio) cvSections.push({ icon: FileText, title: "About", body: hr.bio });
  if (hr?.cv_summary && hr.cv_summary !== hr?.bio) cvSections.push({ icon: Briefcase, title: "CV summary", body: hr.cv_summary });
  if (hr?.cv_specialisms) cvSections.push({ icon: Briefcase, title: "Specialisms", body: hr.cv_specialisms });
  if (hr?.cv_notable_clients) cvSections.push({ icon: Users, title: "Notable clients", body: hr.cv_notable_clients });
  if (hr?.cv_career_history) cvSections.push({ icon: Briefcase, title: "Career history", body: hr.cv_career_history });
  if (hr?.education) cvSections.push({ icon: GraduationCap, title: "Education", body: hr.education });

  return (
    <div className="min-h-full bg-[#FAF9F7] dark:bg-background pb-8">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-card border-b border-[#E7E5E4] dark:border-border sticky top-0 z-10"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        <button onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/"))} className="p-1 -ml-1" data-testid="button-profile-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold">My Profile</h1>
      </div>

      {/* Photo — WhatsApp-style: big circle, camera badge, tap to change */}
      <div className="flex flex-col items-center pt-8 pb-5 px-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="relative active:opacity-80"
          data-testid="button-profile-photo"
        >
          {me?.profilePicUrl ? (
            <img src={me.profilePicUrl} alt={me?.name || "Me"} className="w-36 h-36 rounded-full object-cover border border-[#E7E5E4]" />
          ) : (
            <div className="w-36 h-36 rounded-full bg-[hsl(var(--mobile-chrome))] text-white flex items-center justify-center text-4xl font-semibold">
              {initials}
            </div>
          )}
          <span className="absolute bottom-1 right-1 w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-4 border-[#FAF9F7] dark:border-background">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
        />
        <h2 className="text-xl font-bold mt-4 text-center">{me?.name || me?.username || ""}</h2>
        {(hr?.title || me?.role) && (
          <p className="text-sm text-muted-foreground mt-0.5 text-center">{hr?.title || me?.role}</p>
        )}
        <p className="text-[11px] text-muted-foreground mt-2 text-center max-w-[260px]">
          Tap the photo to change it — it shows on your chat messages and everywhere your name appears.
        </p>
      </div>

      {/* Notifications */}
      <div className="mx-4 mb-3 rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] dark:border-border overflow-hidden" data-testid="profile-notifications">
        <div className="flex items-center gap-3 px-4 py-3">
          {pushStatus.tone === "ok" ? <Bell className="w-4 h-4 text-emerald-600 shrink-0" /> : <BellOff className="w-4 h-4 text-amber-600 shrink-0" />}
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">Notifications</p>
            <p className="text-sm">{pushStatus.label}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{pushStatus.detail}</p>
          </div>
        </div>
        {push.isSupported && push.permission !== "denied" && (
          <div className="flex gap-2 px-4 pb-3">
            {!push.isSubscribed && (
              <button onClick={enablePush} disabled={pushBusy} className="flex-1 h-9 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60" data-testid="button-profile-enable-push">
                {pushBusy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Enable"}
              </button>
            )}
            <button onClick={testPush} disabled={pushBusy} className="flex-1 h-9 rounded-full border border-[#E7E5E4] dark:border-border text-sm font-medium disabled:opacity-60" data-testid="button-profile-test-push">
              {pushBusy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : "Send test notification"}
            </button>
          </div>
        )}
      </div>

      {/* Contact / team rows */}
      {infoRows.length > 0 && (
        <div className="mx-4 rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] dark:border-border divide-y divide-[#F0EEEC] dark:divide-border overflow-hidden">
          {infoRows.map((r, i) => {
            const inner = (
              <div className="flex items-center gap-3 px-4 py-3">
                <r.icon className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">{r.label}</p>
                  <p className="text-sm truncate">{r.value}</p>
                </div>
              </div>
            );
            return r.href
              ? <a key={i} href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="block active:bg-muted">{inner}</a>
              : <div key={i}>{inner}</div>;
          })}
        </div>
      )}

      {/* CV sections from HR */}
      {cvSections.map((s, i) => (
        <div key={i} className="mx-4 mt-3 rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] dark:border-border px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <s.icon className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</p>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.body}</p>
        </div>
      ))}

      {/* Full HR profile jump-off — CV edits, documents, holidays live there */}
      {me?.id && (
        <button
          onClick={() => navigate(`/hr/${me.id}`)}
          className="mx-4 mt-3 w-[calc(100%-2rem)] flex items-center gap-3 rounded-2xl bg-white dark:bg-card border border-[#E7E5E4] dark:border-border px-4 py-3 active:bg-muted"
          data-testid="button-profile-full-hr"
        >
          <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 text-left flex-1">
            <p className="text-sm font-medium">Full HR profile</p>
            <p className="text-[11px] text-muted-foreground">CV, documents, holidays — edit your details there</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      )}
    </div>
  );
}
