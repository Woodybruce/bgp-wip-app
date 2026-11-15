// Photos on a brand's page: "Add photos" takes several images at once and
// files each against the brand (the Images upload, then Attach to brand), and
// the phone page's Photos card shows what is saved. Adding is BGP staff's, as
// the attach is: the caller decides whether to draw the control.
import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BrandCard, brandCardAction } from "./brand-card";

export function BrandAddPhotos({ companyId, companyName }: { companyId: string; companyName: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const add = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData();
      for (const file of files) form.append("images", file);
      form.append("category", "Brands");
      form.append("brandName", companyName);
      const response = await fetch("/api/image-studio/upload", { method: "POST", credentials: "include", headers: getAuthHeaders(), body: form });
      const body = await response.json().catch(() => ({} as any));
      if (!response.ok) throw new Error(body?.error || "The photos could not be uploaded.");
      const saved: { id: string }[] = Array.isArray(body) ? body : body?.results || [];
      const failed: unknown[] = Array.isArray(body) ? [] : body?.failures || [];
      for (const image of saved) await apiRequest("POST", `/api/image-studio/${image.id}/attach`, { targetType: "brand", targetId: companyId });
      return { added: saved.length, failed: failed.length };
    },
    onSuccess: ({ added, failed }) => {
      toast({
        title: `${added} ${added === 1 ? "photo" : "photos"} added to ${companyName}`,
        description: failed ? `${failed} could not be read and ${failed === 1 ? "was" : "were"} left out.` : undefined,
      });
    },
    onError: (error: any) => toast({ title: "The photos were not added", description: error?.message, variant: "destructive" }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/brand", companyId, "profile"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/image-studio"] });
    },
  });
  return <>
    <button type="button" className={brandCardAction} disabled={add.isPending} onClick={() => input.current?.click()} data-testid="brand-add-photos">
      {add.isPending ? "Adding photos…" : "Add photos"}
    </button>
    <input
      ref={input}
      type="file"
      accept="image/*,.heic,.heif"
      multiple
      className="hidden"
      data-testid="brand-add-photos-input"
      onChange={event => {
        const files = Array.from(event.target.files || []);
        event.target.value = "";
        if (files.length) add.mutate(files);
      }}
    />
  </>;
}

const thumbnail = (image: any) => image.thumbnail_data
  ? (String(image.thumbnail_data).startsWith("data:") ? image.thumbnail_data : `data:${image.mime_type || "image/jpeg"};base64,${image.thumbnail_data}`)
  : `/api/brand/gallery-image/${encodeURIComponent(image.id)}`;

// The phone page's Photos card (News & media): every saved image, and Add
// photos for whoever may add them. With no image and no way to add, no card.
export function BrandPhotosCard({ companyId, companyName, images, canAdd }: { companyId: string; companyName: string; images: any[]; canAdd: boolean }) {
  if (!images.length && !canAdd) return null;
  return (
    <BrandCard title="Photos" count={images.length || null} action={canAdd ? <BrandAddPhotos companyId={companyId} companyName={companyName} /> : undefined} testId="brand-photos-card">
      {images.length === 0
        ? <p className="text-[13px] text-muted-foreground">No saved photos yet.</p>
        : <div className="grid grid-cols-3 gap-1.5" data-testid="brand-photos-grid">
            {images.map(image => (
              <img key={image.id} src={thumbnail(image)} alt={image.file_name || `${companyName} photo`} loading="lazy" decoding="async"
                className="block w-full aspect-square object-cover rounded-md bg-muted" data-testid={`brand-photo-${image.id}`} />
            ))}
          </div>}
    </BrandCard>
  );
}
