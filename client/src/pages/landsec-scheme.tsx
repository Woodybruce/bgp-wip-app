// One Landsec scheme: its units with status, tenant, rent, ERV and the live
// deal's stage and days, each opening the single unit page
// (docs/landsec-pitch-plan.md, item 2). The list itself is the shared one
// (components/landsec/scheme-units.tsx), which the property page's "Units and
// lettings" section also draws.
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RESTRICTED_LANDSEC_ROLES } from "@shared/landsec";
import { SchemeUnitsList, schemeUnitCounts, type SchemeData } from "@/components/landsec/scheme-units";

export default function LandsecScheme() {
  const { key } = useParams<{ key: string }>();
  const { data, isLoading, error } = useQuery<SchemeData>({ queryKey: [`/api/landsec/scheme/${key}`], staleTime: 60 * 1000 });
  // A joint agent login has no property record page; it has its own
  // tracker for the scheme instead.
  const { data: me } = useQuery<any>({ queryKey: ["/api/auth/me"] });
  const landsecRole = String(me?.landsecRole || "");
  const restricted = (RESTRICTED_LANDSEC_ROLES as string[]).includes(landsecRole);
  const counts = schemeUnitCounts(data?.units || []);

  if (error) {
    return <div className="p-4 md:p-6"><p className="text-sm text-muted-foreground">This scheme could not be loaded. {(error as any)?.message || ""}</p></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="landsec-scheme">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground"><Link href={restricted ? "/" : "/deals/properties"} className="hover:text-foreground">Properties</Link> › {data?.scheme.group || ""}</p>
          <h1 className="text-2xl font-bold tracking-tight">{data?.scheme.name || "Scheme"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? `${data.scheme.town} · ${counts.all} units · ${counts.vacant} vacant · ${counts.live} live lettings` : ""}
          </p>
        </div>
        {data?.scheme.propertyId && !restricted && (
          <Link href={`/properties/${data.scheme.propertyId}`}>
            <Button variant="outline" size="sm">Full property record <ChevronRight className="w-3 h-3 ml-1" /></Button>
          </Link>
        )}
        {landsecRole === "joint_agent" && (
          <Link href="/landsec/tracker">
            <Button variant="outline" size="sm" data-testid="landsec-scheme-tracker">Tracker <ChevronRight className="w-3 h-3 ml-1" /></Button>
          </Link>
        )}
      </div>

      {isLoading && <Skeleton className="h-64 rounded-lg" />}

      {data && <SchemeUnitsList data={data} />}
    </div>
  );
}
