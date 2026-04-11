import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  MapPin,
  Building2,
  X,
  Loader2,
  List,
  Map as MapIcon,
  Filter,
  ExternalLink,
  Circle,
  Ruler,
  Trash2,
  Crosshair,
} from "lucide-react";
import { Link } from "wouter";
import type { CrmProperty } from "@shared/schema";

const STATUS_COLORS: Record<string, string> = {
  "BGP Active": "bg-emerald-500",
  "BGP Targeting": "bg-amber-500",
  "Leasing Instruction": "bg-blue-500",
  "Lease Advisory Instruction": "bg-violet-500",
  "Sales Instruction": "bg-emerald-600",
  "Archive": "bg-zinc-400",
};

const MARKER_COLORS: Record<string, string> = {
  "BGP Active": "#10b981",
  "BGP Targeting": "#f59e0b",
  "Leasing Instruction": "#3b82f6",
  "Lease Advisory Instruction": "#8b5cf6",
  "Sales Instruction": "#059669",
  "Archive": "#a1a1aa",
};

const DEFAULT_CENTER = { lat: 51.4995, lng: -0.1527 };
const DEFAULT_ZOOM = 14;

const RADIUS_OPTIONS = [
  { label: "50m", value: 50 },
  { label: "100m", value: 100 },
  { label: "200m", value: 200 },
  { label: "250m", value: 250 },
  { label: "500m", value: 500 },
  { label: "1 km", value: 1000 },
  { label: "2 km", value: 2000 },
  { label: "Custom", value: 0 },
];

interface PropertyAddress {
  address: string;
  lat: string;
  lng: string;
  placeId?: string;
}

interface RadiusCircle {
  circle: google.maps.Circle;
  marker: google.maps.Marker;
  label: google.maps.InfoWindow;
}

interface DistanceLine {
  line: google.maps.Polyline;
  markers: google.maps.Marker[];
  label: google.maps.InfoWindow;
}

let googleScriptLoaded = false;
let googleScriptLoading = false;
let loadCallbacks: (() => void)[] = [];

function loadGoogleMapsScript(): Promise<void> {
  return new Promise((resolve) => {
    if (googleScriptLoaded) {
      resolve();
      return;
    }
    loadCallbacks.push(resolve);
    if (googleScriptLoading) return;
    googleScriptLoading = true;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      googleScriptLoading = false;
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks = [];
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.onload = () => {
      googleScriptLoaded = true;
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks = [];
    };
    script.onerror = () => {
      googleScriptLoading = false;
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks = [];
    };
    document.head.appendChild(script);
  });
}

function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)}m`;
  return `${(metres / 1000).toFixed(2)}km`;
}

function PropertyCard({ property }: { property: CrmProperty }) {
  const addr = property.address as PropertyAddress | null;
  return (
    <Link href={`/properties/${property.id}`}>
      <Card className="hover:bg-accent/50 transition-colors cursor-pointer" data-testid={`map-property-card-${property.id}`}>
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{property.name}</p>
              {addr?.address && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{addr.address}</span>
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              {property.status && (
                <Badge className={`text-[10px] px-1.5 py-0 text-white ${STATUS_COLORS[property.status] || "bg-gray-500"}`}>
                  {property.status}
                </Badge>
              )}
              {property.assetClass && (
                <span className="text-[10px] text-muted-foreground">{property.assetClass}</span>
              )}
            </div>
          </div>
          {property.sqft && (
            <p className="text-[10px] text-muted-foreground mt-1">{property.sqft.toLocaleString()} sqft</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

type MeasureTool = "none" | "radius" | "distance";

export default function PropertyMap() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedProperty, setSelectedProperty] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(googleScriptLoaded);
  const [viewMode, setViewMode] = useState<"map" | "split">("split");
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const mapSearchInputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<google.maps.places.Autocomplete | null>(null);
  const searchMarkerRef = useRef<google.maps.Marker | null>(null);

  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const MARKER_ZOOM_THRESHOLD = 12;

  const [activeTool, setActiveTool] = useState<MeasureTool>("none");
  const [selectedRadius, setSelectedRadius] = useState(200);
  const [customRadius, setCustomRadius] = useState("");
  const [radiusCircles, setRadiusCircles] = useState<RadiusCircle[]>([]);
  const [distanceLines, setDistanceLines] = useState<DistanceLine[]>([]);
  const [distanceClickCount, setDistanceClickCount] = useState(0);
  const distanceTempMarkerRef = useRef<google.maps.Marker | null>(null);
  const radiusClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const distanceClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);

  const { data: properties = [], isLoading } = useQuery<CrmProperty[]>({
    queryKey: ["/api/crm/properties"],
  });

  useEffect(() => {
    loadGoogleMapsScript().then(() => setScriptReady(true));
  }, []);

  const propertiesWithCoords = useMemo(() => {
    return properties.filter((p) => {
      const addr = p.address as PropertyAddress | null;
      return addr && addr.lat && addr.lng && !isNaN(parseFloat(addr.lat)) && !isNaN(parseFloat(addr.lng));
    });
  }, [properties]);

  const filteredProperties = useMemo(() => {
    let result = properties;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter((p) => {
        const addr = p.address as PropertyAddress | null;
        return (
          p.name.toLowerCase().includes(s) ||
          addr?.address?.toLowerCase().includes(s) ||
          p.status?.toLowerCase().includes(s) ||
          p.assetClass?.toLowerCase().includes(s)
        );
      });
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter);
    }
    return result;
  }, [properties, search, statusFilter]);

  const filteredWithCoords = useMemo(() => {
    return filteredProperties.filter((p) => {
      const addr = p.address as PropertyAddress | null;
      return addr && addr.lat && addr.lng && !isNaN(parseFloat(addr.lat)) && !isNaN(parseFloat(addr.lng));
    });
  }, [filteredProperties]);

  const initMap = useCallback(() => {
    if (!mapRef.current || !scriptReady || googleMapRef.current) return;

    const urlParams = new URLSearchParams(window.location.search);
    const qLat = parseFloat(urlParams.get("lat") || "");
    const qLng = parseFloat(urlParams.get("lng") || "");
    const qZoom = parseInt(urlParams.get("zoom") || "", 10);
    const initialCenter = (!isNaN(qLat) && !isNaN(qLng)) ? { lat: qLat, lng: qLng } : DEFAULT_CENTER;
    const initialZoom = !isNaN(qZoom) ? qZoom : DEFAULT_ZOOM;

    const map = new google.maps.Map(mapRef.current, {
      center: initialCenter,
      zoom: initialZoom,
      mapTypeControl: true,
      mapTypeControlOptions: {
        style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
        position: google.maps.ControlPosition.TOP_RIGHT,
      },
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      styles: [
        {
          featureType: "poi",
          elementType: "labels",
          stylers: [{ visibility: "off" }],
        },
      ],
    });

    googleMapRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();

    map.addListener("zoom_changed", () => {
      setMapZoom(map.getZoom() || DEFAULT_ZOOM);
    });

    if (mapSearchInputRef.current) {
      const autocomplete = new google.maps.places.Autocomplete(mapSearchInputRef.current, {
        types: ["address"],
        componentRestrictions: { country: "gb" },
        fields: ["geometry", "formatted_address", "name", "address_components", "place_id"],
      });
      searchBoxRef.current = autocomplete;

      autocomplete.bindTo("bounds", map);

      autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        if (place.geometry?.location) {
          map.setCenter(place.geometry.location);
          map.setZoom(18);

          const getComponent = (type: string) =>
            place.address_components?.find((c: any) => c.types.includes(type))?.long_name || "";
          const postcode = getComponent("postal_code");
          const streetNumber = getComponent("street_number");
          const route = getComponent("route");
          const locality = getComponent("postal_town") || getComponent("locality");
          const lat = place.geometry.location.lat().toFixed(6);
          const lng = place.geometry.location.lng().toFixed(6);

          const infoContent = `
            <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 13px; max-width: 280px; line-height: 1.5;">
              <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${place.formatted_address || place.name || ""}</div>
              ${postcode ? `<div style="color: #374151;"><strong>Postcode:</strong> ${postcode}</div>` : ""}
              ${locality ? `<div style="color: #374151;"><strong>Area:</strong> ${locality}</div>` : ""}
              <div style="color: #6b7280; font-size: 12px; margin-top: 4px;">${lat}, ${lng}</div>
            </div>
          `;

          if (searchMarkerRef.current) searchMarkerRef.current.setMap(null);
          searchMarkerRef.current = new google.maps.Marker({
            position: place.geometry.location,
            map,
            title: place.formatted_address || place.name || "Search result",
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: "#2563eb",
              fillOpacity: 1,
              strokeColor: "#fff",
              strokeWeight: 3,
            },
            zIndex: 9999,
          });

          const iw = infoWindowRef.current;
          if (iw) {
            iw.setContent(infoContent);
            iw.open(map, searchMarkerRef.current);
          }
        }
      });
    }
  }, [scriptReady]);

  useEffect(() => {
    initMap();
  }, [initMap]);

  // Create markers when filtered properties change
  useEffect(() => {
    if (!googleMapRef.current || !scriptReady) return;

    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    const bounds = new google.maps.LatLngBounds();
    let hasMarkers = false;
    const showMarkers = mapZoom >= MARKER_ZOOM_THRESHOLD;

    for (const prop of filteredWithCoords) {
      const addr = prop.address as PropertyAddress;
      const lat = parseFloat(addr.lat);
      const lng = parseFloat(addr.lng);
      if (isNaN(lat) || isNaN(lng)) continue;

      const color = MARKER_COLORS[prop.status || ""] || "#6b7280";

      const marker = new google.maps.Marker({
        position: { lat, lng },
        map: showMarkers ? googleMapRef.current! : null,
        title: prop.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
      });

      marker.addListener("click", () => {
        setSelectedProperty(prop.id);
        const content = `
          <div style="padding: 8px; max-width: 250px;">
            <p style="font-weight: 600; font-size: 14px; margin: 0 0 4px;">${prop.name}</p>
            ${addr.address ? `<p style="font-size: 12px; color: #666; margin: 0 0 4px;">${addr.address}</p>` : ""}
            ${prop.status ? `<span style="display: inline-block; background: ${color}; color: white; font-size: 10px; padding: 1px 6px; border-radius: 4px;">${prop.status}</span>` : ""}
            ${prop.sqft ? `<p style="font-size: 11px; color: #888; margin: 4px 0 0;">${prop.sqft.toLocaleString()} sqft</p>` : ""}
            <a href="/properties/${prop.id}" style="font-size: 11px; color: #3b82f6; text-decoration: none; display: block; margin-top: 6px;">View details →</a>
          </div>
        `;
        infoWindowRef.current!.setContent(content);
        infoWindowRef.current!.open(googleMapRef.current!, marker);
      });

      markersRef.current.push(marker);
      bounds.extend({ lat, lng });
      hasMarkers = true;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const hasUrlCoords = urlParams.has("lat") && urlParams.has("lng");

    if (hasUrlCoords) {
    } else if (hasMarkers && filteredWithCoords.length > 1) {
      googleMapRef.current.fitBounds(bounds, 60);
    } else if (hasMarkers && filteredWithCoords.length === 1) {
      const addr = filteredWithCoords[0].address as PropertyAddress;
      googleMapRef.current.setCenter({
        lat: parseFloat(addr.lat),
        lng: parseFloat(addr.lng),
      });
      googleMapRef.current.setZoom(16);
    }
  }, [filteredWithCoords, scriptReady]);

  // Toggle marker visibility based on zoom level to prevent overlap at low zoom
  useEffect(() => {
    if (!googleMapRef.current) return;
    const showMarkers = mapZoom >= MARKER_ZOOM_THRESHOLD;
    markersRef.current.forEach((m) => {
      m.setMap(showMarkers ? googleMapRef.current! : null);
    });
  }, [mapZoom]);

  useEffect(() => {
    if (selectedProperty && googleMapRef.current) {
      const prop = filteredWithCoords.find((p) => p.id === selectedProperty);
      if (prop) {
        const addr = prop.address as PropertyAddress;
        const lat = parseFloat(addr.lat);
        const lng = parseFloat(addr.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          googleMapRef.current.panTo({ lat, lng });
          googleMapRef.current.setZoom(17);

          const marker = markersRef.current.find(
            (m) => m.getTitle() === prop.name
          );
          if (marker) {
            google.maps.event.trigger(marker, "click");
          }
        }
      }
    }
  }, [selectedProperty]);

  const getEffectiveRadius = useCallback(() => {
    if (selectedRadius !== 0) return selectedRadius;
    const parsed = parseInt(customRadius);
    if (isNaN(parsed) || parsed < 10) return 10;
    if (parsed > 10000) return 10000;
    return parsed;
  }, [selectedRadius, customRadius]);

  useEffect(() => {
    const map = googleMapRef.current;
    if (!map) return;

    if (radiusClickListenerRef.current) {
      google.maps.event.removeListener(radiusClickListenerRef.current);
      radiusClickListenerRef.current = null;
    }
    if (distanceClickListenerRef.current) {
      google.maps.event.removeListener(distanceClickListenerRef.current);
      distanceClickListenerRef.current = null;
    }

    if (distanceTempMarkerRef.current) {
      distanceTempMarkerRef.current.setMap(null);
      distanceTempMarkerRef.current = null;
    }

    if (activeTool === "radius") {
      map.setOptions({ draggableCursor: "crosshair" });
      const radiusMetres = getEffectiveRadius();

      radiusClickListenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const center = e.latLng;

        const circle = new google.maps.Circle({
          map,
          center,
          radius: radiusMetres,
          fillColor: "#FF6900",
          fillOpacity: 0.12,
          strokeColor: "#FF6900",
          strokeWeight: 2,
          strokeOpacity: 0.8,
          clickable: false,
        });

        const centerMarker = new google.maps.Marker({
          position: center,
          map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#FF6900",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: 999,
        });

        const labelWindow = new google.maps.InfoWindow({
          content: `<div style="padding: 4px 8px; font-size: 12px; font-weight: 600; color: #232323;">${formatDistance(radiusMetres)} radius</div>`,
          position: center,
        });
        labelWindow.open(map, centerMarker);

        setRadiusCircles(prev => [...prev, { circle, marker: centerMarker, label: labelWindow }]);
      });
    } else if (activeTool === "distance") {
      map.setOptions({ draggableCursor: "crosshair" });

      distanceClickListenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;

        if (!distanceTempMarkerRef.current) {
          const m = new google.maps.Marker({
            position: e.latLng,
            map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#3b82f6",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            zIndex: 999,
          });
          distanceTempMarkerRef.current = m;
          setDistanceClickCount(1);
        } else {
          const startPos = distanceTempMarkerRef.current.getPosition()!;
          const endPos = e.latLng;

          const endMarker = new google.maps.Marker({
            position: endPos,
            map,
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: "#3b82f6",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            zIndex: 999,
          });

          const line = new google.maps.Polyline({
            path: [startPos, endPos],
            map,
            strokeColor: "#3b82f6",
            strokeWeight: 3,
            strokeOpacity: 0.8,
            geodesic: true,
          });

          const distance = google.maps.geometry.spherical.computeDistanceBetween(startPos, endPos);
          const midPoint = google.maps.geometry.spherical.interpolate(startPos, endPos, 0.5);

          const labelWindow = new google.maps.InfoWindow({
            content: `<div style="padding: 4px 8px; font-size: 12px; font-weight: 600; color: #232323;">${formatDistance(distance)}</div>`,
            position: midPoint,
          });
          labelWindow.open(map);

          const startMarker = distanceTempMarkerRef.current;
          distanceTempMarkerRef.current = null;

          setDistanceLines(prev => [...prev, { line, markers: [startMarker, endMarker], label: labelWindow }]);
          setDistanceClickCount(0);
        }
      });
    } else {
      map.setOptions({ draggableCursor: null });
    }

    return () => {
      if (radiusClickListenerRef.current) {
        google.maps.event.removeListener(radiusClickListenerRef.current);
        radiusClickListenerRef.current = null;
      }
      if (distanceClickListenerRef.current) {
        google.maps.event.removeListener(distanceClickListenerRef.current);
        distanceClickListenerRef.current = null;
      }
      if (map) map.setOptions({ draggableCursor: null });
    };
  }, [activeTool, selectedRadius, customRadius, getEffectiveRadius]);

  const clearAllMeasurements = useCallback(() => {
    radiusCircles.forEach(rc => {
      rc.circle.setMap(null);
      rc.marker.setMap(null);
      rc.label.close();
    });
    setRadiusCircles([]);

    distanceLines.forEach(dl => {
      dl.line.setMap(null);
      dl.markers.forEach(m => m.setMap(null));
      dl.label.close();
    });
    setDistanceLines([]);

    if (distanceTempMarkerRef.current) {
      distanceTempMarkerRef.current.setMap(null);
      distanceTempMarkerRef.current = null;
    }
    setDistanceClickCount(0);
  }, [radiusCircles, distanceLines]);

  const removeLastCircle = useCallback(() => {
    if (radiusCircles.length === 0) return;
    const last = radiusCircles[radiusCircles.length - 1];
    last.circle.setMap(null);
    last.marker.setMap(null);
    last.label.close();
    setRadiusCircles(prev => prev.slice(0, -1));
  }, [radiusCircles]);

  const removeLastLine = useCallback(() => {
    if (distanceLines.length === 0) return;
    const last = distanceLines[distanceLines.length - 1];
    last.line.setMap(null);
    last.markers.forEach(m => m.setMap(null));
    last.label.close();
    setDistanceLines(prev => prev.slice(0, -1));
  }, [distanceLines]);

  const toggleTool = useCallback((tool: MeasureTool) => {
    setActiveTool(prev => prev === tool ? "none" : tool);
    setDistanceClickCount(0);
    if (distanceTempMarkerRef.current) {
      distanceTempMarkerRef.current.setMap(null);
      distanceTempMarkerRef.current = null;
    }
  }, []);

  const statuses = useMemo(() => {
    const s = new Set<string>();
    properties.forEach((p) => p.status && s.add(p.status));
    return Array.from(s).sort();
  }, [properties]);

  useEffect(() => {
    return () => {
      radiusCircles.forEach(rc => {
        rc.circle.setMap(null);
        rc.marker.setMap(null);
        rc.label.close();
      });
      distanceLines.forEach(dl => {
        dl.line.setMap(null);
        dl.markers.forEach(m => m.setMap(null));
        dl.label.close();
      });
      if (distanceTempMarkerRef.current) {
        distanceTempMarkerRef.current.setMap(null);
        distanceTempMarkerRef.current = null;
      }
      if (radiusClickListenerRef.current) {
        google.maps.event.removeListener(radiusClickListenerRef.current);
        radiusClickListenerRef.current = null;
      }
      if (distanceClickListenerRef.current) {
        google.maps.event.removeListener(distanceClickListenerRef.current);
        distanceClickListenerRef.current = null;
      }
    };
  }, []);

  const cancelDistancePoint = useCallback(() => {
    if (distanceTempMarkerRef.current) {
      distanceTempMarkerRef.current.setMap(null);
      distanceTempMarkerRef.current = null;
    }
    setDistanceClickCount(0);
  }, []);

  const totalMeasurements = radiusCircles.length + distanceLines.length;

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4" data-testid="property-map-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-map-title">Property Map</h1>
          <p className="text-sm text-muted-foreground">
            {propertiesWithCoords.length} of {properties.length} properties mapped
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "split" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("split")}
            data-testid="button-view-split"
          >
            <List className="w-3.5 h-3.5 mr-1" /> Split
          </Button>
          <Button
            variant={viewMode === "map" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("map")}
            data-testid="button-view-map"
          >
            <MapIcon className="w-3.5 h-3.5 mr-1" /> Full Map
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search properties..."
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-map"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-8 text-sm" data-testid="select-status-filter">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="h-5 w-px bg-border mx-1" />

        <Button
          variant={activeTool === "radius" ? "default" : "outline"}
          size="sm"
          onClick={() => toggleTool("radius")}
          className={activeTool === "radius" ? "bg-orange-500 hover:bg-orange-600 text-white" : ""}
          data-testid="button-tool-radius"
        >
          <Circle className="w-3.5 h-3.5 mr-1" /> Radius
        </Button>
        <Button
          variant={activeTool === "distance" ? "default" : "outline"}
          size="sm"
          onClick={() => toggleTool("distance")}
          className={activeTool === "distance" ? "bg-blue-500 hover:bg-blue-600 text-white" : ""}
          data-testid="button-tool-distance"
        >
          <Ruler className="w-3.5 h-3.5 mr-1" /> Distance
        </Button>

        {activeTool === "radius" && (
          <Select
            value={selectedRadius.toString()}
            onValueChange={(v) => setSelectedRadius(parseInt(v))}
          >
            <SelectTrigger className="w-[100px] h-8 text-sm" data-testid="select-radius">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RADIUS_OPTIONS.map((r) => (
                <SelectItem key={r.value} value={r.value.toString()}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {activeTool === "radius" && selectedRadius === 0 && (
          <Input
            type="number"
            placeholder="Metres"
            className="w-[80px] h-8 text-sm"
            value={customRadius}
            onChange={(e) => setCustomRadius(e.target.value)}
            data-testid="input-custom-radius"
          />
        )}

        {totalMeasurements > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllMeasurements}
            className="text-destructive hover:text-destructive"
            data-testid="button-clear-measurements"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" /> Clear All ({totalMeasurements})
          </Button>
        )}

        {(search || statusFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("all");
            }}
            data-testid="button-clear-filters"
          >
            <X className="w-3.5 h-3.5 mr-1" /> Clear
          </Button>
        )}
      </div>

      {activeTool !== "none" && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border text-xs text-muted-foreground">
          <Crosshair className="w-3.5 h-3.5 shrink-0" />
          {activeTool === "radius" && (
            <span>
              Click anywhere on the map to draw a <strong>{formatDistance(getEffectiveRadius())}</strong> radius circle.
              {radiusCircles.length > 0 && (
                <Button variant="link" size="sm" className="h-auto p-0 ml-2 text-xs" onClick={removeLastCircle}>Undo last</Button>
              )}
            </span>
          )}
          {activeTool === "distance" && (
            <span>
              {distanceClickCount === 0
                ? "Click a start point on the map to begin measuring."
                : <>Now click an end point to see the distance. <Button variant="link" size="sm" className="h-auto p-0 ml-1 text-xs" onClick={cancelDistancePoint}>Cancel</Button></>}
              {distanceLines.length > 0 && (
                <Button variant="link" size="sm" className="h-auto p-0 ml-2 text-xs" onClick={removeLastLine}>Undo last</Button>
              )}
            </span>
          )}
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-auto shrink-0" onClick={() => toggleTool("none")} data-testid="button-dismiss-tool">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {Object.entries(STATUS_COLORS).map(([status, bg]) => (
          <div key={status} className="flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-full ${bg}`} />
            <span>{status}</span>
          </div>
        ))}
      </div>

      <div className={`flex gap-4 ${viewMode === "map" ? "" : "flex-col lg:flex-row"}`} style={{ height: "calc(100vh - 300px)" }}>
        {viewMode === "split" && (
          <div className="lg:w-[350px] w-full lg:h-full h-[300px] overflow-y-auto space-y-2 flex-shrink-0" data-testid="property-list-panel">
            <p className="text-xs text-muted-foreground sticky top-0 bg-background py-1 z-10">
              {filteredProperties.length} properties
              {filteredWithCoords.length !== filteredProperties.length && (
                <span> ({filteredWithCoords.length} on map)</span>
              )}
            </p>
            {filteredProperties.map((p) => {
              const addr = p.address as PropertyAddress | null;
              const hasCoords = addr && addr.lat && addr.lng;
              return (
                <div
                  key={p.id}
                  onClick={() => hasCoords && setSelectedProperty(p.id)}
                  className={`${selectedProperty === p.id ? "ring-2 ring-primary rounded-lg" : ""} ${hasCoords ? "cursor-pointer" : "opacity-60"}`}
                >
                  <PropertyCard property={p} />
                  {!hasCoords && (
                    <p className="text-[10px] text-muted-foreground pl-3 -mt-1 mb-1">No coordinates — set an address to show on map</p>
                  )}
                </div>
              );
            })}
            {filteredProperties.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No properties match your search
              </div>
            )}
          </div>
        )}

        <div className={`flex-1 relative rounded-lg overflow-hidden border ${viewMode === "map" ? "h-full" : "min-h-[400px]"}`}>
          {!scriptReady ? (
            <div className="flex items-center justify-center h-full bg-muted/50">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading Google Maps...</span>
            </div>
          ) : (
            <>
              <div className="absolute top-3 left-3 z-10 w-64">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    ref={mapSearchInputRef}
                    type="text"
                    placeholder="Search address or place..."
                    className="w-full pl-8 pr-3 py-2 text-sm bg-white border rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    data-testid="input-map-search"
                  />
                </div>
              </div>
              <div ref={mapRef} className="w-full h-full" data-testid="google-map-container" />
              {mapZoom < MARKER_ZOOM_THRESHOLD && filteredWithCoords.length > 0 && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-background/90 border rounded-lg px-4 py-2 shadow-sm text-xs text-muted-foreground flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5" />
                  Zoom in to see {filteredWithCoords.length} property markers
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
