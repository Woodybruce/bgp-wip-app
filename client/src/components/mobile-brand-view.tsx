// Phone-fit brand / landlord profile — the mobile answer to the desktop
// BrandProfilePanel, which rendered effectively blank at phone widths
// (Woody, 2026-08-04: "how the brands reflect" on the phone app). Stacked
// cards reusing the canonical components: chat, contacts board, covenant,
// compliance, menu, portfolio activity — so the phone shows the SAME
// intelligence as desktop, one structure everywhere.
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getAuthHeaders } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, TrendingUp, ClipboardList, Instagram } from "lucide-react";
import {
  CompanyMiniChat, MenuIntelCard, PortfolioActivityBlock, BrandComplianceCard,
} from "@/components/brand-profile-panel";
import { CompanyContactsBoard } from "@/components/company-contacts-board";
import { CovenantBadge, CovenantCommentary } from "@/components/covenant-badge";

export function MobileBrandView({ companyId }: { companyId: string }) {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/brand", companyId, "profile"],
    queryFn: async () => {
      const res = await fetch(`/api/brand/${companyId}/profile`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });
  const { data: trackerData } = useQuery<any>({
    queryKey: ["/api/brands", companyId, "tracker-comments"],
    queryFn: async () => {
      const res = await fetch(`/api/brands/${companyId}/tracker-comments`, { credentials: "include", headers: getAuthHeaders() });
      if (!res.ok) return { comments: [] };
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading || !data?.company) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const c = data.company;
  const isLandlord = /landlord|client/i.test(c.company_type || "");
  // Same hero cascade as the desktop banner: pinned "brand-hero" tag →
  // flagship street view (when stores have coords) → first gallery image.
  const srcFor = (img: any) => img.thumbnail_data
    ? (img.thumbnail_data.startsWith("data:") ? img.thumbnail_data : `data:${img.mime_type || "image/jpeg"};base64,${img.thumbnail_data}`)
    : `/api/brand/gallery-image/${img.id}`;
  const heroTagged = (data.images || []).find((i: any) => Array.isArray(i.tags) && i.tags.includes("brand-hero"));
  const hasStreetView = (data.stores || []).some((s: any) => typeof s.lat === "number" && typeof s.lng === "number");
  const firstImg = (data.images || [])[0];
  const heroSrc = heroTagged
    ? srcFor(heroTagged)
    : hasStreetView
      ? `/api/brand/${companyId}/flagship-image${firstImg ? `?exclude=${encodeURIComponent(firstImg.id)}` : ""}`
      : firstImg ? srcFor(firstImg) : null;
  const trackerComments: any[] = trackerData?.comments || [];
  const signals: any[] = (data.signals || []).slice(0, 6);

  return (
    <div className="p-4 space-y-3 pb-6">
      {/* Hero + identity */}
      {heroSrc && (
        <div className="h-44 rounded-xl overflow-hidden bg-muted">
          <img src={heroSrc} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {c.company_type && <Badge variant="outline" className="text-[11px]">{c.company_type}</Badge>}
        {c.industry && <Badge variant="outline" className="text-[11px]">{c.industry}</Badge>}
        {c.store_count != null && <Badge variant="outline" className="text-[11px] tabular-nums">{c.store_count} stores</Badge>}
        {(c as any).companies_house_number && <CovenantBadge companyNumber={(c as any).companies_house_number} />}
      </div>
      {c.description && <p className="text-sm leading-snug text-foreground/85">{c.description}</p>}

      {/* Chat — same thread as desktop and the main chat panel */}
      <div className="h-[320px]">
        <CompanyMiniChat companyId={companyId} companyName={c.name} fill />
      </div>

      {/* Key contacts — canonical board */}
      <CompanyContactsBoard
        companyId={companyId}
        companyName={c.name}
        contacts={data.contacts || []}
        pendingSenders={data.pendingContactSuggestions || []}
      />

      {/* Covenant */}
      <Card>
        <CardHeader className="p-3 pb-2">
          <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
            Covenant
            {(c as any).companies_house_number && <CovenantBadge companyNumber={(c as any).companies_house_number} />}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 pt-0">
          {(c as any).companies_house_number ? (
            <div className="max-h-[260px] overflow-y-auto pr-1">
              <CovenantCommentary companyNumber={(c as any).companies_house_number} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Waiting for the UK trading entity — the covenant engine unlocks once a Companies House match is set.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Compliance & KYC — same board as desktop (staff actions hide for clients inside) */}
      <BrandComplianceCard companyId={companyId} company={c} />

      {/* Menu / best sellers (brands only) */}
      {!isLandlord && (
        <MenuIntelCard
          companyId={companyId}
          companyName={c.name}
          industry={c.industry}
          companyType={c.company_type}
          intel={c.menu_intel}
          refreshedAt={c.menu_intel_at}
        />
      )}

      {/* Tracker comments */}
      {trackerComments.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <ClipboardList className="w-3.5 h-3.5" /> Tracker updates
              <Badge variant="outline" className="text-[10px]">{trackerComments.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5 max-h-[300px] overflow-y-auto">
            {trackerComments.map((cm: any, i: number) => (
              <div key={i} className="text-xs rounded-lg border border-border/50 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-0.5">
                  <span className="font-medium text-foreground/80">{cm.userName}</span>
                  {cm.at && <span>{new Date(cm.at).toLocaleDateString("en-GB")}</span>}
                </div>
                <p className="whitespace-pre-wrap break-words">{cm.text}</p>
                <Link href={`/properties/${cm.propertyId}`} className="text-[11px] text-primary hover:underline">
                  {cm.propertyName}{cm.unitName ? ` · ${cm.unitName}` : ""}
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Portfolio activity — tenant at / targeted / pitched / suggested */}
      <PortfolioActivityBlock companyId={companyId} />

      {/* Signals */}
      {signals.length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <TrendingUp className="w-3.5 h-3.5" /> Signals
              <Badge variant="outline" className="text-[10px]">{data.signals?.length || 0}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1.5">
            {signals.map((s: any) => (
              <div key={s.id} className="text-xs border-l-2 border-l-muted pl-2">
                <Badge variant="outline" className="text-[10px] mr-1.5">{(s.signal_type || "news").replace(/_/g, " ")}</Badge>
                {s.source && s.source.startsWith("http")
                  ? <a href={s.source} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{s.headline}</a>
                  : <span className="font-medium">{s.headline}</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Instagram handle shortcut */}
      {c.instagram_handle && (
        <a
          href={`https://instagram.com/${c.instagram_handle}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground px-1"
        >
          <Instagram className="w-4 h-4" /> @{c.instagram_handle}
        </a>
      )}

      {/* Live tenancies */}
      {(data.liveLocations || []).length > 0 && (
        <Card>
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-xs flex items-center gap-2 uppercase tracking-wider text-muted-foreground">
              <Building2 className="w-3.5 h-3.5" /> Live tenancies
              <Badge variant="outline" className="text-[10px]">{data.liveLocations.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 space-y-1">
            {data.liveLocations.map((p: any) => (
              <Link key={p.id} href={`/properties/${p.id}`} className="flex items-center justify-between gap-2 p-1.5 rounded border bg-card min-w-0">
                <span className="text-xs font-medium truncate">{p.name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">{p.units} unit{Number(p.units) === 1 ? "" : "s"}</Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
