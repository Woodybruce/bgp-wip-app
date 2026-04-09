import { lazy, Suspense, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2, MapPin, Globe } from "lucide-react";

const Properties = lazy(() => import("@/pages/properties"));
const PropertyMap = lazy(() => import("@/pages/property-map"));
const EdozoMap = lazy(() => import("@/pages/edozo-map"));

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

export default function PropertiesHub() {
  const [location, setLocation] = useLocation();

  const getInitialTab = () => {
    if (location.startsWith("/map")) return "map" as const;
    if (location.startsWith("/edozo")) return "edozo" as const;
    return "list" as const;
  };

  const [tab, setTab] = useState<"list" | "map" | "edozo">(getInitialTab);

  useEffect(() => {
    if (location.startsWith("/map")) setTab("map");
    else if (location.startsWith("/edozo")) setTab("edozo");
    else if (location.startsWith("/properties")) setTab("list");
  }, [location]);

  const switchTab = (t: "list" | "map" | "edozo") => {
    setTab(t);
    const routes = { list: "/properties", map: "/map", edozo: "/edozo" };
    const target = routes[t];
    if (!location.startsWith(target)) setLocation(target);
  };

  const allTabs = [
    { key: "list" as const, label: "Properties", icon: Building2 },
    { key: "map" as const, label: "Map", icon: MapPin },
    { key: "edozo" as const, label: "Intelligence", icon: Globe },
  ];

  const isFullHeight = tab === "edozo" || tab === "map";

  return (
    <div className={isFullHeight ? "relative h-[calc(100vh-48px)] flex flex-col" : ""}>
      <div className={`flex items-center gap-1 px-4 pt-4 md:px-6 md:pt-6 shrink-0 ${isFullHeight ? "pb-2" : ""}`}>
        <div className="inline-flex rounded-lg border bg-muted p-0.5" data-testid="toggle-properties-tabs">
          {allTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`toggle-properties-${key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <Suspense fallback={<PageLoader />}>
        {isFullHeight ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {tab === "map" ? <PropertyMap /> : <EdozoMap />}
          </div>
        ) : (
          <Properties />
        )}
      </Suspense>
    </div>
  );
}
