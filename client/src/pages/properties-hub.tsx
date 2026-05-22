import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const Properties = lazy(() => import("@/pages/properties"));

function PageLoader() {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  );
}

// PropertiesHub used to mount Properties + the simple Google-Maps
// PropertyMap as tabs. Both maps are now one — Property Intelligence
// → Map (Edozo/Goad). This wrapper just renders Properties; the
// detail-page route (/properties/:id) is handled inside Properties.
export default function PropertiesHub() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Properties />
    </Suspense>
  );
}
