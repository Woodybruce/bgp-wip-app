import { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import "leaflet.markercluster";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PropertyResolverBar } from "@/components/property-resolver-bar";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import {
  Search,
  X,
  MapPin,
  Loader2,
  Droplets,
  Landmark,
  TreePine,
  Zap,
  PoundSterling,
  ThermometerSun,
  AlertTriangle,
  ExternalLink,
  MousePointer,
  Pencil,
  Type,
  Square,
  Circle,
  Minus,
  Triangle,
  Slash,
  Hexagon,
  FileDown,
  BarChart3,
  TrendingUp,
  Activity,
  TrainFront,
  Building2,
  Shield,
  Globe,
  Construction,
  Waves,
  Leaf,
  GraduationCap,
  Wifi,
  UtensilsCrossed,
  Users,
  Home,
  Vote,
  Briefcase,
  Bus,
  ChevronDown,
  ChevronRight,
  Copy,
  Scan,
  Network,
  ShieldCheck,
  ShieldAlert,
  UserCheck,
  Crown,
  Link2,
  Sparkles,
  Download,
} from "lucide-react";

interface SearchResult {
  label: string;
  postcode: string;
  type: string;
  addressType?: string;
  lat?: number;
  lng?: number;
}

interface PropertyData {
  pricePaid: any[];
  voaRatings: any[];
  epc: any[];
  floodRisk: any;
  listedBuilding: any[];
  planningData: any;
  propertyDataCoUk: any;
  tflNearby: any;
}

function getEPCColor(rating: string): string {
  const colors: Record<string, string> = { A: "bg-green-600", B: "bg-green-500", C: "bg-yellow-500", D: "bg-amber-500", E: "bg-orange-500", F: "bg-red-500", G: "bg-red-700" };
  return colors[rating?.toUpperCase()] || "bg-gray-500";
}

function formatPrice(price: number): string {
  if (price >= 1_000_000) return `£${(price / 1_000_000).toFixed(2)}m`;
  if (price >= 1_000) return `£${(price / 1_000).toFixed(0)}k`;
  return `£${price.toLocaleString()}`;
}

async function loadImageAsDataUrl(src: string, invert = false): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      if (invert) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = 255 - d[i];
          d[i + 1] = 255 - d[i + 1];
          d[i + 2] = 255 - d[i + 2];
        }
        ctx.putImageData(imageData, 0, 0);
      }
      resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function generateStaticMapImage(lat: number, lng: number, zoom = 16, width = 600, height = 300): Promise<string | null> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) { resolve(null); return; }

    const tileSize = 256;
    const scale = Math.pow(2, zoom);
    const worldX = ((lng + 180) / 360) * scale;
    const worldY = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * scale;
    const centerTileX = Math.floor(worldX);
    const centerTileY = Math.floor(worldY);
    const offsetX = Math.round((worldX - centerTileX) * tileSize);
    const offsetY = Math.round((worldY - centerTileY) * tileSize);
    const tilesX = Math.ceil(width / tileSize) + 2;
    const tilesY = Math.ceil(height / tileSize) + 2;
    const startTileX = centerTileX - Math.floor(tilesX / 2);
    const startTileY = centerTileY - Math.floor(tilesY / 2);

    let loaded = 0;
    let resolved = false;
    const total = tilesX * tilesY;

    const drawMarkerAndResolve = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      const markerX = width / 2;
      const markerY = height / 2;
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.beginPath();
      ctx.ellipse(markerX, markerY + 6, 8, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(markerX, markerY - 12, 10, Math.PI, 0);
      ctx.lineTo(markerX, markerY + 4);
      ctx.closePath();
      ctx.fillStyle = "#dc2626";
      ctx.fill();
      ctx.strokeStyle = "#991b1b";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(markerX, markerY - 12, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      resolve(canvas.toDataURL("image/png"));
    };

    const tryResolve = () => {
      loaded++;
      if (loaded >= total) drawMarkerAndResolve();
    };

    for (let tx = 0; tx < tilesX; tx++) {
      for (let ty = 0; ty < tilesY; ty++) {
        const tileXi = startTileX + tx;
        const tileYi = startTileY + ty;
        const drawX = (tx - Math.floor(tilesX / 2)) * tileSize + (width / 2) - offsetX;
        const drawY = (ty - Math.floor(tilesY / 2)) * tileSize + (height / 2) - offsetY;
        const tileImg = new Image();
        tileImg.crossOrigin = "anonymous";
        tileImg.onload = () => { ctx.drawImage(tileImg, drawX, drawY, tileSize, tileSize); tryResolve(); };
        tileImg.onerror = () => tryResolve();
        tileImg.src = `https://tile.openstreetmap.org/${zoom}/${tileXi}/${tileYi}.png`;
      }
    }

    const timer = setTimeout(() => drawMarkerAndResolve(), 8000);
  });
}

async function generatePropertyPDF(data: PropertyData, postcode: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = 15;

  const addPage = () => { doc.addPage(); y = 15; };
  const checkPage = (needed: number) => { if (y + needed > 275) addPage(); };

  const sectionTitle = (text: string, color: [number, number, number] = [30, 30, 30]) => {
    checkPage(12);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(margin, y, contentW, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(text, margin + 3, y + 5);
    doc.setTextColor(30, 30, 30);
    y += 10;
  };

  const row = (label: string, value: string, indent = 0) => {
    checkPage(6);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(label, margin + 2 + indent, y);
    doc.setTextColor(30, 30, 30);
    doc.setFont("helvetica", "bold");
    const valW = doc.getTextWidth(value);
    doc.text(value, margin + contentW - 2 - valW, y);
    doc.setFont("helvetica", "normal");
    y += 5;
  };

  const textRow = (text: string, indent = 0, bold = false) => {
    checkPage(6);
    doc.setFontSize(8);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(30, 30, 30);
    const lines = doc.splitTextToSize(text, contentW - 4 - indent);
    for (const line of lines) {
      checkPage(5);
      doc.text(line, margin + 2 + indent, y);
      y += 4;
    }
    y += 1;
  };

  const logoResult = await loadImageAsDataUrl("/bgp-logo.png", true);

  const headerH = 55;
  doc.setFillColor(20, 20, 20);
  doc.rect(0, 0, pageW, headerH, "F");
  if (logoResult) {
    try {
      const logoW = contentW * 0.45;
      const logoH = logoW * (logoResult.height / logoResult.width);
      doc.addImage(logoResult.dataUrl, "PNG", pageW - margin - logoW, 6, logoW, logoH);
    } catch {}
  }
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Property Intelligence Report", margin, headerH - 20);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(postcode, margin, headerH - 13);
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text(`Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, margin, headerH - 6);
  y = headerH + 6;

  const coords = data.planningData?.coordinates || (data as any).floodRisk?.coordinates;
  if (coords?.lat && coords?.lng) {
    try {
      const mapImg = await generateStaticMapImage(coords.lat, coords.lng, 16, 800, 400);
      if (mapImg) {
        const mapH = contentW * (400 / 800);
        doc.addImage(mapImg, "PNG", margin, y, contentW, mapH);
        doc.setDrawColor(200, 200, 200);
        doc.rect(margin, y, contentW, mapH);
        doc.setFontSize(6);
        doc.setTextColor(150, 150, 150);
        doc.text(`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, margin + 2, y + mapH - 2);
        doc.text("© OpenStreetMap contributors", margin + contentW - 40, y + mapH - 2);
        y += mapH + 4;
      }
    } catch {}
  }

  const ward = (data as any).floodRisk?.postcodeData?.ward;
  const district = (data as any).floodRisk?.postcodeData?.district;
  const region = (data as any).floodRisk?.postcodeData?.region;
  if (ward || district || region) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    const parts = [ward, district, region].filter(Boolean).join(" · ");
    doc.text(parts, margin, y);
    y += 6;
  }

  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, margin + contentW, y);
  y += 4;

  const pricePaid = data.pricePaid || [];
  const voaRatings = data.voaRatings || [];
  const epcList = data.epc || [];
  const listedBuildings = data.listedBuilding || [];
  const floodRisk = data.floodRisk;

  const stats = [
    { label: "Transactions", value: String(pricePaid.length) },
    { label: "Business Rates", value: String(voaRatings.length) },
    { label: "EPCs", value: String(epcList.length) },
    { label: "Listed Buildings", value: String(listedBuildings.length) },
    { label: "Flood Warnings", value: floodRisk?.activeFloods > 0 ? `${floodRisk.activeFloods} ACTIVE` : "None" },
  ];
  const colW = contentW / stats.length;
  for (let i = 0; i < stats.length; i++) {
    const cx = margin + colW * i + colW / 2;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(30, 30, 30);
    const vw = doc.getTextWidth(stats[i].value);
    doc.text(stats[i].value, cx - vw / 2, y + 2);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(120, 120, 120);
    const lw = doc.getTextWidth(stats[i].label);
    doc.text(stats[i].label, cx - lw / 2, y + 7);
  }
  y += 14;

  if (pricePaid.length > 0) {
    sectionTitle("Transaction History", [16, 120, 80]);
    for (const tx of pricePaid.slice(0, 20)) {
      checkPage(6);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(30, 30, 30);
      const addrLines = doc.splitTextToSize(tx.address || "", contentW * 0.55);
      doc.text(addrLines[0] || "", margin + 2, y);
      doc.setFont("helvetica", "bold");
      const price = `£${tx.price?.toLocaleString() || "N/A"}`;
      const pw = doc.getTextWidth(price);
      doc.text(price, margin + contentW - 2 - pw, y);
      y += 4;
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(130, 130, 130);
      doc.text(`${tx.date || ""} · ${tx.propertyType || ""}${tx.newBuild ? " · New Build" : ""}`, margin + 2, y);
      y += 5;
    }
  }

  if (voaRatings.length > 0) {
    sectionTitle("Rateable Values (VOA)", [37, 99, 235]);
    for (const voa of voaRatings.slice(0, 15)) {
      const voaLabel = (voa.firmName || voa.address || "").substring(0, 60);
      row(voaLabel, `£${voa.rateableValue?.toLocaleString() || "N/A"}`);
      if (voa.description) {
        checkPage(5);
        doc.setFontSize(7);
        doc.setTextColor(130, 130, 130);
        const descLines = doc.splitTextToSize(voa.description, contentW - 8);
        doc.text(descLines[0] || "", margin + 4, y);
        y += 4;
      }
    }
  }

  if (epcList.length > 0) {
    sectionTitle("Energy Performance Certificates", [234, 120, 20]);
    for (const epc of epcList.slice(0, 10)) {
      checkPage(12);
      row(epc.address || "", `Rating: ${epc.rating || epc.ratingBand || "N/A"}`);
      const details: string[] = [];
      if (epc.propertyType) details.push(`Type: ${epc.propertyType}`);
      if (epc.floorArea) details.push(`Area: ${epc.floorArea}m²`);
      if (epc.co2Emissions) details.push(`CO₂: ${epc.co2Emissions} t/yr`);
      if (epc.inspectionDate) details.push(`Inspected: ${epc.inspectionDate}`);
      if (epc.score && epc.potentialScore) details.push(`Score: ${epc.score} → ${epc.potentialScore}`);
      if (details.length > 0) {
        doc.setFontSize(7);
        doc.setTextColor(130, 130, 130);
        doc.text(details.join(" · "), margin + 4, y);
        y += 4;
      }
      if (epc.heatingType) {
        doc.setFontSize(7);
        doc.setTextColor(130, 130, 130);
        doc.text(`Heating: ${epc.heatingType}`, margin + 4, y);
        y += 4;
      }
    }
  }

  sectionTitle("Flood Risk", [20, 150, 170]);
  if (floodRisk) {
    if (floodRisk.activeFloods > 0) {
      textRow(`WARNING: ${floodRisk.activeFloods} active flood warning(s)`, 0, true);
    } else {
      textRow("No active flood warnings", 0);
    }
    if (floodRisk.floodWarnings?.length > 0) {
      for (const w of floodRisk.floodWarnings) {
        textRow(`${w.description || ""} - Severity: ${w.severity || "Unknown"}`, 4);
      }
    }
    if (floodRisk.nearbyFloodAreas?.length > 0) {
      textRow("Nearby flood areas:", 0, true);
      for (const a of floodRisk.nearbyFloodAreas) {
        textRow(`- ${a.name || ""}${a.riverOrSea ? ` (${a.riverOrSea})` : ""}`, 4);
      }
    }
  } else {
    textRow("No flood risk data available.");
  }

  if (listedBuildings.length > 0) {
    sectionTitle("Listed Buildings", [190, 120, 20]);
    for (const lb of listedBuildings.slice(0, 15)) {
      const lbLabel = `Grade ${lb.grade || "?"}: ${(lb.name || "").substring(0, 50)}`;
      row(lbLabel, lb.listEntry ? `Entry: ${lb.listEntry}` : "");
    }
  }

  const pd = data.planningData;
  const pdKeys = ['conservationAreas','article4Directions','treePreservationZones','scheduledMonuments','worldHeritageSites','worldHeritageBufferZones','parksAndGardens','battlefields','heritageAtRisk','brownfieldLand','locallyListedBuildings','heritageCoast','specialAreasOfConservation','listedBuildingOutlines'];
  const hasPD = pd && pdKeys.some(k => pd[k]?.length > 0);
  if (hasPD) {
    sectionTitle("Planning Designations & Heritage", [120, 80, 200]);
    const pdEntries: [string, string][] = [
      ['conservationAreas', 'Conservation Areas'],
      ['article4Directions', 'Article 4 Directions'],
      ['listedBuildingOutlines', 'Listed Building Boundaries'],
      ['treePreservationZones', 'Tree Preservation Zones'],
      ['scheduledMonuments', 'Scheduled Monuments'],
      ['worldHeritageSites', 'World Heritage Sites'],
      ['worldHeritageBufferZones', 'World Heritage Buffer Zones'],
      ['parksAndGardens', 'Historic Parks & Gardens'],
      ['battlefields', 'Registered Battlefields'],
      ['heritageAtRisk', 'Heritage at Risk'],
      ['brownfieldLand', 'Brownfield Land'],
      ['locallyListedBuildings', 'Locally Listed Buildings'],
      ['heritageCoast', 'Heritage Coast'],
      ['specialAreasOfConservation', 'Special Areas of Conservation'],
    ];
    for (const [key, label] of pdEntries) {
      if (pd[key]?.length > 0) {
        textRow(`${label}:`, 0, true);
        for (const item of pd[key]) textRow(`- ${item.name || "Unnamed"}${item.designationDate ? ` (${item.designationDate})` : ""}`, 4);
      }
    }
  }

  const pdData = data.propertyDataCoUk;
  if (pdData) {
    const ks = pdData["postcode-key-stats"]?.data;
    const growth = pdData["growth"]?.data;
    const demand = pdData["demand"]?.data;
    const commercialRents = pdData["rents-commercial"]?.data;
    const soldPrices = pdData["sold-prices"]?.data;
    const planAppsRaw = pdData["planning-applications"]?.data;
    const planApps = Array.isArray(planAppsRaw) ? planAppsRaw : (planAppsRaw?.planning_applications || []);
    const floodPd = pdData["flood-risk"]?.data;

    sectionTitle("Market Overview (PropertyData)", [79, 70, 229]);
    if (ks) {
      if (ks.average_price) row("Average Price", `£${Number(ks.average_price).toLocaleString()}`);
      if (ks.average_rent) row("Average Rent (pcm)", `£${ks.average_rent}`);
      if (ks.average_yield) row("Average Yield", ks.average_yield);
      if (ks.turnover) row("Annual Turnover", ks.turnover);
      if (ks.council_tax_band) row("Council Tax Band", ks.council_tax_band);
      y += 2;
    }
    const pdPrices = pdData["prices"]?.data;
    if (pdPrices?.average) row("Asking Price (avg)", `£${Number(pdPrices.average).toLocaleString()}`);
    const pdPsf = pdData["prices-per-sqf"]?.data;
    if (pdPsf?.average) row("Asking Price /sqft", `£${Number(pdPsf.average).toLocaleString()}`);
    const pdSoldPsf = pdData["sold-prices-per-sqf"]?.data;
    if (pdSoldPsf?.average) row("Sold Price /sqft", `£${Number(pdSoldPsf.average).toLocaleString()}`);
    if (growth) {
      textRow("Price Growth:", 0, true);
      const parts: string[] = [];
      if (growth.growth_1y !== undefined) parts.push(`1yr: ${growth.growth_1y}%`);
      if (growth.growth_3y !== undefined) parts.push(`3yr: ${growth.growth_3y}%`);
      if (growth.growth_5y !== undefined) parts.push(`5yr: ${growth.growth_5y}%`);
      if (parts.length > 0) textRow(parts.join(" · "), 4);
    }
    const pdGrowthPsf = pdData["growth-psf"]?.data;
    if (pdGrowthPsf?.length > 0) {
      textRow("Growth /sqft:", 0, true);
      textRow(pdGrowthPsf.slice(-3).map((g: any) => `${g[0]}: ${g[2] || "N/A"}`).join(" · "), 4);
    }
    const pdYields = pdData["yields"]?.data;
    if (pdYields) {
      if (pdYields.long_let?.yield) row("Long Let Yield", pdYields.long_let.yield);
      if (pdYields.short_let?.yield) row("Short Let Yield", pdYields.short_let.yield);
    }
    if (soldPrices?.length > 0) {
      textRow("Recent Sales:", 0, true);
      for (const sp of soldPrices.slice(0, 5)) {
        row(sp.address || "N/A", `£${Number(sp.price || sp.result || 0).toLocaleString()}`, 4);
      }
    }

    checkPage(20);
    sectionTitle("Rental Market", [37, 99, 235]);
    if (commercialRents) {
      textRow("Commercial Rents:", 0, true);
      if (commercialRents.average_rent) textRow(`Average: £${commercialRents.average_rent}/sq ft`, 4);
      if (commercialRents.min_rent) textRow(`Range: £${commercialRents.min_rent} – £${commercialRents.max_rent}/sq ft`, 4);
    }
    const pdRents = pdData["rents"]?.data;
    if (pdRents?.long_let) {
      textRow("Residential Rents:", 0, true);
      textRow(`Average: £${pdRents.long_let.average}/wk (${pdRents.long_let.points_analysed || 0} listings)`, 4);
    }
    const pdRentsHmo = pdData["rents-hmo"]?.data;
    if (pdRentsHmo?.["double-ensuite"]?.average) {
      textRow("HMO Room Rents:", 0, true);
      textRow(`Double ensuite: £${pdRentsHmo["double-ensuite"].average}/wk`, 4);
    }
    if (demand) {
      textRow("Sales Demand:", 0, true);
      const parts: string[] = [];
      if (demand.demand_score !== undefined) parts.push(`Score: ${demand.demand_score}/100`);
      if (demand.supply !== undefined) parts.push(`Supply: ${demand.supply}`);
      if (demand.demand !== undefined) parts.push(`Demand: ${demand.demand}`);
      if (parts.length > 0) textRow(parts.join(" · "), 4);
    }
    const pdDemandRent = pdData["demand-rent"];
    if (pdDemandRent) {
      textRow("Rental Demand:", 0, true);
      if (pdDemandRent.rental_demand_rating) textRow(`Rating: ${pdDemandRent.rental_demand_rating}`, 4);
      if (pdDemandRent.days_on_market) textRow(`Days on market: ${pdDemandRent.days_on_market}`, 4);
    }

    checkPage(20);
    sectionTitle("Demographics & Area", [130, 80, 200]);
    const pdAreaType = pdData["area-type"];
    if (pdAreaType?.area_type) row("Area Type", pdAreaType.area_type);
    const pdPop = pdData["population"]?.result;
    if (pdPop) {
      if (pdPop.population) row("Population", pdPop.population);
      if (pdPop.households) row("Households", pdPop.households);
      if (pdPop.density) row("Density /km²", pdPop.density);
    }
    const pdIncome = pdData["household-income"]?.result;
    if (pdIncome?.average_household_income) row("Avg Household Income", `£${Number(pdIncome.average_household_income).toLocaleString()}`);
    const pdDemog = pdData["demographics"]?.data;
    if (pdDemog?.average_age) row("Average Age", pdDemog.average_age);
    const pdTenure = pdData["tenure-types"]?.data;
    if (pdTenure) {
      textRow("Tenure Types:", 0, true);
      const parts: string[] = [];
      if (pdTenure.owned_outright) parts.push(`Owned: ${pdTenure.owned_outright}%`);
      if (pdTenure.owned_mortgage) parts.push(`Mortgage: ${pdTenure.owned_mortgage}%`);
      if (pdTenure.private_rented) parts.push(`Private rent: ${pdTenure.private_rented}%`);
      if (pdTenure.social_rented) parts.push(`Social rent: ${pdTenure.social_rented}%`);
      textRow(parts.join(" · "), 4);
    }
    const pdPropTypes = pdData["property-types"]?.data;
    if (pdPropTypes) {
      textRow("Property Types:", 0, true);
      const parts: string[] = [];
      if (pdPropTypes.flat_purpose_built) parts.push(`Flats: ${pdPropTypes.flat_purpose_built}%`);
      if (pdPropTypes.terraced) parts.push(`Terraced: ${pdPropTypes.terraced}%`);
      if (pdPropTypes.semi_detached) parts.push(`Semi: ${pdPropTypes.semi_detached}%`);
      if (pdPropTypes.detached) parts.push(`Detached: ${pdPropTypes.detached}%`);
      textRow(parts.join(" · "), 4);
    }
    const pdPolitics = pdData["politics"]?.data;
    if (pdPolitics?.constituency) row("Constituency", pdPolitics.constituency);

    checkPage(20);
    sectionTitle("Local Amenities", [16, 150, 100]);
    const pdPtal = pdData["ptal"];
    if (pdPtal?.ptal) row("Public Transport (PTAL)", pdPtal.ptal);
    const pdCrime = pdData["crime"];
    if (pdCrime) {
      if (pdCrime.crime_rating) row("Crime Rating", pdCrime.crime_rating);
      if (pdCrime.crimes_per_thousand) row("Crimes per 1,000", String(pdCrime.crimes_per_thousand));
    }
    const pdSchools = pdData["schools"]?.data;
    if (pdSchools?.state?.nearest?.length > 0) {
      textRow("Nearest Schools:", 0, true);
      for (const s of pdSchools.state.nearest.slice(0, 5)) {
        textRow(`${s.name} (${s.phase}) — ${s.postcode}`, 4);
      }
    }
    const pdInternet = pdData["internet-speed"]?.internet;
    if (pdInternet) {
      row("Superfast Broadband", `${pdInternet.SFBB_availability}%`);
      if (pdInternet.gigabit_availability) row("Gigabit Available", `${pdInternet.gigabit_availability}%`);
    }
    const pdRestaurants = pdData["restaurants"]?.data;
    if (pdRestaurants) {
      if (pdRestaurants.rating) row("Restaurant Hygiene", pdRestaurants.rating);
      if (pdRestaurants.average_hygiene) row("Avg Hygiene Score", `${pdRestaurants.average_hygiene}/5`);
    }
    const pdAgents = pdData["agents"]?.data;
    const agentSale = pdAgents?.["zoopla.co.uk"]?.sale || pdAgents?.zoopla?.sale;
    if (agentSale?.length > 0) {
      textRow("Local Estate Agents:", 0, true);
      for (const a of agentSale.slice(0, 5)) {
        textRow(`${a.rank}. ${a.agent} (${a.units_offered} listings)`, 4);
      }
    }

    checkPage(20);
    sectionTitle("Planning & Constraints", [180, 130, 50]);
    const pdConservation = pdData["conservation-area"];
    if (pdConservation) row("Conservation Area", pdConservation.conservation_area ? (pdConservation.conservation_area_name || "Yes") : "No");
    const pdGreenBelt = pdData["green-belt"];
    if (pdGreenBelt) row("Green Belt", pdGreenBelt.green_belt ? (pdGreenBelt.green_belt_name || "Yes") : "No");
    const pdAonb = pdData["aonb"];
    if (pdAonb) row("AONB", pdAonb.aonb ? (pdAonb.aonb_name || "Yes") : "No");
    const pdNationalPark = pdData["national-park"];
    if (pdNationalPark) row("National Park", pdNationalPark.national_park ? (pdNationalPark.national_park_name || "Yes") : "No");
    const pdListedBldgs = pdData["listed-buildings"]?.data?.listed_buildings;
    if (pdListedBldgs?.length > 0) {
      textRow("Listed Buildings (nearby):", 0, true);
      for (const lb of pdListedBldgs.slice(0, 5)) {
        textRow(`Grade ${lb.grade}: ${lb.name} (${lb.distance}km)`, 4);
      }
    }
    if (planApps?.length > 0) {
      textRow("Planning Applications:", 0, true);
      for (const pa of planApps.slice(0, 5)) {
        textRow(`${pa.description || "Application"} (${pa.status || "N/A"}) — ${pa.date || ""}`, 4);
      }
    }
    if (floodPd) {
      textRow("Flood Risk:", 0, true);
      if (floodPd.flood_risk) textRow(`Risk level: ${floodPd.flood_risk}`, 4);
      if (floodPd.surface_water) textRow(`Surface water: ${floodPd.surface_water}`, 4);
    }

    checkPage(20);
    sectionTitle("Property Intelligence", [80, 80, 80]);
    const pdCouncilTax = pdData["council-tax"];
    if (pdCouncilTax) {
      row("Council", pdCouncilTax.council || "N/A");
      if (pdCouncilTax.council_rating) row("Council Tax Rating", pdCouncilTax.council_rating);
      if (pdCouncilTax.council_tax?.band_d) row("Band D Council Tax", `£${pdCouncilTax.council_tax.band_d}`);
    }
    const pdFloorAreas = pdData["floor-areas"]?.data;
    if (pdFloorAreas?.average) row("Average Floor Area", `${pdFloorAreas.average} sqft`);
    const uprnsPd = pdData["uprns"]?.data;
    if (uprnsPd?.length > 0) {
      checkPage(20);
      textRow("Registered Addresses (UPRNs):", 0, true);
      textRow(`Total registered: ${uprnsPd.length}`, 4);
      const classCounts: Record<string, number> = {};
      for (const u of uprnsPd) {
        const cls = u.classificationCodeDesc || "Other";
        classCounts[cls] = (classCounts[cls] || 0) + 1;
      }
      const sorted = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
      for (const [cls, cnt] of sorted.slice(0, 8)) {
        textRow(`${cls}: ${cnt}`, 6);
      }
    }
    const eePd = pdData["energy-efficiency"]?.energy_efficiency;
    if (eePd?.length > 0) {
      checkPage(16);
      textRow("Energy Efficiency:", 0, true);
      const ratings: Record<string, number> = {};
      let total = 0;
      for (const e of eePd) {
        if (e.rating) ratings[e.rating] = (ratings[e.rating] || 0) + 1;
        if (e.score) total += e.score;
      }
      textRow(`Average EPC score: ${Math.round(total / eePd.length)} (${eePd.length} inspections)`, 4);
      const ratingStr = Object.entries(ratings).sort((a, b) => a[0].localeCompare(b[0])).map(([r, c]) => `${r}: ${c}`).join(", ");
      textRow(`Rating distribution: ${ratingStr}`, 4);
    }
    const pdHmoReg = pdData["national-hmo-register"]?.data?.hmos;
    if (pdHmoReg?.length > 0) {
      textRow("HMO Register:", 0, true);
      for (const h of pdHmoReg.slice(0, 5)) {
        textRow(`${h.address} (exp: ${h.licence_expiry || "N/A"})`, 4);
      }
    }
    const pdfTitles = [
      ...(pdData["freeholds"]?.data || []).map((f: any) => ({ ...f, _tenure: "Freehold" })),
      ...(pdData["leaseholds"]?.data || []).map((f: any) => ({ ...f, _tenure: "Leasehold" })),
    ];
    if (pdfTitles.length > 0) {
      const fCount = pdData["freeholds"]?.data?.length || 0;
      const lCount = pdData["leaseholds"]?.data?.length || 0;
      checkPage(20);
      sectionTitle("Ownership / Title Register", [100, 60, 140]);
      row("Registered Titles", `${pdfTitles.length} (${fCount} freehold, ${lCount} leasehold)`);
      y += 2;
      for (const f of pdfTitles.slice(0, 20)) {
        checkPage(16);
        const owner = f.proprietor_name_1 || f.proprietor || "Unknown";
        textRow(owner, 0, true);
        if (f.proprietor_name_2) textRow(f.proprietor_name_2, 4);
        const addr = f.address || f.property_address || "N/A";
        textRow(addr, 4);
        if (f.proprietor_address) textRow(f.proprietor_address, 4);
        const details = [
          f.title_number ? `Title: ${f.title_number}` : null,
          f.company_reg ? `Co. ${f.company_reg}` : null,
          f.proprietor_category || null,
          f.tenure || f._tenure || null,
          f.property_class || f.class_title || null,
          f.plot_size ? `Plot: ${f.plot_size} acres` : null,
          f.date_proprietor_added ? `Owner since: ${f.date_proprietor_added}` : null,
          f.price_paid ? `Price paid: £${Number(f.price_paid).toLocaleString()}` : null,
        ].filter(Boolean).join(" · ");
        if (details) textRow(details, 4);
        y += 2;
      }
    }
  }

  if (data.tflNearby?.stations?.length > 0) {
    checkPage(14 + data.tflNearby.stations.length * 8);
    sectionTitle("Transport Links (TfL)", [37, 99, 235]);
    for (const s of data.tflNearby.stations) {
      const walkMins = Math.round(s.distance / 80);
      const modeStr = (s.modes || []).map((m: string) => m === "tube" ? "Tube" : m === "national-rail" ? "Rail" : m === "dlr" ? "DLR" : m === "overground" ? "Overground" : m === "elizabeth-line" ? "Elizabeth" : m).join(", ");
      const lineStr = s.lines?.length > 0 ? ` — ${s.lines.join(", ")}` : "";
      textRow(`${s.name} — ${s.distance}m (~${walkMins} min walk) [${modeStr}]${lineStr}`, 4);
    }
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.setFont("helvetica", "normal");
    doc.text(`Bruce Gillingham Pollard · Property Intelligence Report · ${postcode}`, margin, 290);
    const pageText = `Page ${p} of ${pages}`;
    const ptw = doc.getTextWidth(pageText);
    doc.text(pageText, pageW - margin - ptw, 290);
  }

  doc.save(`Property-Report-${postcode.replace(/\s/g, "-")}.pdf`);
}

// Leasehold → superior freehold. PropertyData has no structured
// leasehold→freehold link, so the reliable path is to order the leasehold's
// official register (£3–4, cached server-side) — its property section names
// the lessor / superior freehold title. One click, reuses the existing
// purchase-title endpoint.
// HMLR fallback picker — shown in the polygon-context drawer when no
// titles matched the clicked unit's address. Hits the OS Places postcode
// endpoint (returns every UPRN-keyed building in the postcode), lets the
// user pick the right one, and bubbles the choice back so the parent
// re-fetches polygon-context against the corrected address.
function HmlrFallbackPicker({ postcode, onPick }: { postcode: string; onPick: (addr: { uprn: string; number: string | null; street: string | null; postcode: string }) => void }) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Array<{ uprn: string; address: string; postcode: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!postcode) { setErr("No postcode known for this polygon."); return; }
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/os/places/postcode/${encodeURIComponent(postcode)}`, { credentials: "include" });
      if (!r.ok) throw new Error(`OS Places returned ${r.status}`);
      const j: any = await r.json();
      setResults(j.results || []);
      setOpen(true);
    } catch (e: any) {
      setErr(e?.message || "OS Places lookup failed");
    } finally {
      setLoading(false);
    }
  };

  // Heuristic: split "43 Curzon Street, Mayfair, London, W1J 7UF" into
  // number + street so the picked row can re-key polygon-context.
  const splitAddress = (addr: string): { number: string | null; street: string | null } => {
    const m = addr.match(/^(\d+[a-z\-]*)\s+([^,]+?)(?:,|$)/i);
    if (m) return { number: m[1], street: m[2].toUpperCase().trim() };
    return { number: null, street: addr.split(",")[0]?.toUpperCase().trim() || null };
  };

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
      {!open ? (
        <button
          type="button"
          onClick={load}
          disabled={loading || !postcode}
          className="text-[11px] font-medium text-blue-700 hover:underline disabled:opacity-40"
          data-testid="button-hmlr-fallback-picker"
        >
          {loading ? "Loading addresses…" : `Try a different address in ${postcode || "this postcode"} →`}
        </button>
      ) : (
        <>
          <div className="text-[10px] text-gray-600 mb-1">
            Pick the right building in {postcode} ({results?.length || 0} found):
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {(results || []).map((r) => {
              const split = splitAddress(r.address);
              return (
                <button
                  key={r.uprn}
                  type="button"
                  onClick={() => { onPick({ uprn: r.uprn, number: split.number, street: split.street, postcode: r.postcode }); setOpen(false); }}
                  className="w-full text-left px-1.5 py-1 rounded hover:bg-white border border-transparent hover:border-gray-200 text-[10px]"
                  data-testid={`button-hmlr-fallback-pick-${r.uprn}`}
                >
                  <div className="text-gray-900 truncate">{r.address}</div>
                  <div className="text-gray-400 font-mono text-[9px]">UPRN {r.uprn}</div>
                </button>
              );
            })}
            {(results || []).length === 0 && (
              <p className="text-[10px] text-gray-500 italic">OS Places returned no addresses for {postcode}.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[10px] text-gray-500 hover:text-gray-700 mt-1"
          >
            Cancel
          </button>
        </>
      )}
      {err && <p className="text-[10px] text-red-600 mt-1">{err}</p>}
    </div>
  );
}

function LeaseholdFreeholdFinder({ titleNumber }: { titleNumber?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!titleNumber) return null;
  const run = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/land-registry/purchase-title", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ title: titleNumber, documents: "register", extract_proprietor_data: true }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setErr(j?.error || `HTTP ${r.status}`);
        return;
      }
      setResult(j?.data || j);
    } catch (e: any) {
      setErr(e?.message || "request failed");
    } finally {
      setLoading(false);
    }
  };
  if (err) {
    return <p className="mt-1 text-[10px] text-red-600">Freehold lookup failed: {err}</p>;
  }
  if (result) {
    const reg = result.document_url || result.register_url || result.register?.url || null;
    const prop = result.proprietor || result.extracted || null;
    return (
      <div className="mt-1 text-[10px] text-gray-600 space-y-0.5">
        {reg && (
          <a href={reg} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline block">
            Open title register →
          </a>
        )}
        {prop && (
          <div className="[overflow-wrap:anywhere]">{typeof prop === "string" ? prop : JSON.stringify(prop)}</div>
        )}
        <p className="italic text-gray-400">Read the register's property section for the superior freehold title.</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={run}
      disabled={loading}
      className="mt-1 text-[10px] text-blue-700 hover:underline disabled:opacity-50"
    >
      {loading ? "Ordering register…" : "Find freehold (order register £3–4)"}
    </button>
  );
}

function RawDataToggle({ data }: { data: any }) {
  const [showRaw, setShowRaw] = useState(false);
  const HIDDEN_KEYS = new Set(["_tenure"]);
  const entries = Object.entries(data).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== null && v !== undefined && v !== "");
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
      <button
        onClick={() => setShowRaw(!showRaw)}
        className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
        data-testid="raw-data-toggle"
      >
        {showRaw ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Source Data ({entries.length} fields)
      </button>
      {showRaw && (
        <div className="mt-1.5 bg-gray-50 rounded border p-2 max-h-[200px] overflow-y-auto">
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
            {entries.map(([key, val]) => (
              <div key={key} className="contents">
                <span className="text-gray-400 font-mono whitespace-nowrap">{key}</span>
                <span className="text-gray-700 break-all">{typeof val === "object" ? JSON.stringify(val) : String(val)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function titleMatchesAddress(title: any, searchAddr: string): boolean {
  // New server-tagged matches beat the weak string-match heuristic. The
  // /api/land-registry/resolve endpoint tags titles as "uprn" (exact),
  // "street" (likely), or "postcode" (neighbour) — anything better than
  // postcode is a true match to the subject.
  if (title?._match === "uprn" || title?._match === "street") return true;
  if (title?._match === "postcode") return false;
  if (!searchAddr) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const search = norm(searchAddr);
  const searchWords = search.split(" ").filter(w => w.length > 2);
  const titleAddr = norm(title.address || title.property_address || "");
  const titleOwner = norm(title.proprietor_name_1 || title.proprietor || "");
  const combined = titleAddr + " " + titleOwner;
  if (searchWords.length === 0) return false;
  const matchCount = searchWords.filter(w => combined.includes(w)).length;
  return matchCount >= Math.max(1, Math.ceil(searchWords.length * 0.5));
}

function OwnershipTitleList({ titles, searchAddress }: { titles: any[]; searchAddress?: string }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const sortedTitles = searchAddress
    ? [...titles].sort((a, b) => {
        const aMatch = titleMatchesAddress(a, searchAddress) ? 1 : 0;
        const bMatch = titleMatchesAddress(b, searchAddress) ? 1 : 0;
        return bMatch - aMatch;
      })
    : titles;

  const matchCount = searchAddress ? sortedTitles.filter(t => titleMatchesAddress(t, searchAddress)).length : 0;

  return (
    <div className="space-y-1.5">
      {searchAddress && titles.length > 0 && (
        <div className="text-[10px] text-gray-500 px-1 mb-1">
          {matchCount > 0
            ? <><span className="font-medium text-indigo-600">{matchCount}</span> matching "{searchAddress}" · {titles.length - matchCount} other titles at this postcode</>
            : <>No exact matches for "{searchAddress}" — showing all {titles.length} titles at this postcode</>
          }
        </div>
      )}
      {sortedTitles.map((f: any, i: number) => {
        const isExpanded = expandedIdx === i;
        const owner = f.proprietor_name_1 || f.proprietor || "Unknown owner";
        const address = f.address || f.property_address || "N/A";
        const isMatch = searchAddress ? titleMatchesAddress(f, searchAddress) : false;
        return (
          <div key={i} className={`text-xs border rounded overflow-hidden ${isMatch ? "bg-indigo-50 border-indigo-200" : "bg-gray-50"}`}>
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className={`w-full text-left p-2 flex items-center gap-1.5 transition-colors cursor-pointer ${isMatch ? "hover:bg-indigo-100" : "hover:bg-gray-100"}`}
              data-testid={`ownership-row-${i}`}
            >
              {isExpanded ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
              <span className={`text-[8px] font-bold px-1 py-0.5 rounded ${f._tenure === "Freehold" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{f._tenure === "Freehold" ? "F" : "L"}</span>
              <div className="min-w-0 flex-1">
                <span className="font-medium text-[11px] truncate block">{owner}</span>
                {address !== "N/A" && <span className="text-[9px] text-gray-400 truncate block">{address}</span>}
              </div>
              {isMatch && <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded font-medium shrink-0">MATCH</span>}
              {f.price_paid && <span className="text-[9px] text-gray-400 shrink-0">£{Number(f.price_paid).toLocaleString()}</span>}
            </button>

            {isExpanded && (
              <div className="px-3 pb-2.5 pt-0.5 border-t border-gray-200 bg-white space-y-2">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
                  <span className="text-gray-400 font-medium">Owner</span>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-800 font-medium">{owner}</span>
                    <button onClick={() => copyToClipboard(owner)} className="text-gray-300 hover:text-gray-600 p-0.5" title="Copy"><Copy className="w-3 h-3" /></button>
                  </div>

                  {f.proprietor_name_2 && (
                    <>
                      <span className="text-gray-400 font-medium">Owner 2</span>
                      <span className="text-gray-700">{f.proprietor_name_2}</span>
                    </>
                  )}

                  <span className="text-gray-400 font-medium">Address</span>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-700">{address}</span>
                    <button onClick={() => copyToClipboard(address)} className="text-gray-300 hover:text-gray-600 p-0.5" title="Copy"><Copy className="w-3 h-3" /></button>
                  </div>

                  {f.proprietor_address && (
                    <>
                      <span className="text-gray-400 font-medium">Owner Addr</span>
                      <span className="text-gray-700">{f.proprietor_address}</span>
                    </>
                  )}

                  {f.title_number && (
                    <>
                      <span className="text-gray-400 font-medium">Title No.</span>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-800 font-mono">{f.title_number}</span>
                        <button onClick={() => copyToClipboard(f.title_number)} className="text-gray-300 hover:text-gray-600 p-0.5" title="Copy"><Copy className="w-3 h-3" /></button>
                      </div>
                    </>
                  )}

                  {f.tenure && (
                    <>
                      <span className="text-gray-400 font-medium">Tenure</span>
                      <span className="text-gray-700 capitalize">{f.tenure}</span>
                    </>
                  )}

                  {f.company_reg && (
                    <>
                      <span className="text-gray-400 font-medium">Company No.</span>
                      <div className="flex items-center gap-1">
                        <a
                          href={`https://find-and-update.company-information.service.gov.uk/company/${f.company_reg}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono"
                        >
                          {f.company_reg}
                        </a>
                        <ExternalLink className="w-3 h-3 text-blue-400" />
                      </div>
                    </>
                  )}

                  {f.proprietor_category && (
                    <>
                      <span className="text-gray-400 font-medium">Category</span>
                      <span className="text-gray-700">{f.proprietor_category}</span>
                    </>
                  )}

                  {f.property_class && (
                    <>
                      <span className="text-gray-400 font-medium">Class</span>
                      <span className="text-gray-700">{f.property_class}</span>
                    </>
                  )}

                  {f.plot_size && (
                    <>
                      <span className="text-gray-400 font-medium">Plot Size</span>
                      <span className="text-gray-700">{f.plot_size} acres</span>
                    </>
                  )}

                  {f.date_proprietor_added && (
                    <>
                      <span className="text-gray-400 font-medium">Owner Since</span>
                      <span className="text-gray-700">{f.date_proprietor_added}</span>
                    </>
                  )}

                  {f.price_paid && (
                    <>
                      <span className="text-gray-400 font-medium">Price Paid</span>
                      <span className="text-gray-800 font-medium">£{Number(f.price_paid).toLocaleString()}</span>
                    </>
                  )}

                  {f.multiple_address_indicator && (
                    <>
                      <span className="text-gray-400 font-medium">Multi-addr</span>
                      <span className="text-gray-700">{f.multiple_address_indicator}</span>
                    </>
                  )}
                </div>

                <RawDataToggle data={f} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OwnershipIntelligencePanel({ titles, address, postcode }: { titles: any[]; address?: string; postcode: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    try {
      const resp = await fetch("/api/ownership-intelligence", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("bgp_token")}`,
        },
        body: JSON.stringify({ titles, address, postcode }),
      });
      if (resp.ok) {
        setResult(await resp.json());
      }
    } catch (e) {
      console.error("Ownership intelligence error:", e);
    }
    setLoading(false);
  };

  if (!result) {
    return (
      <div className="mt-3 p-3 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <Network className="w-4 h-4 text-indigo-600" />
          <span className="text-xs font-semibold text-indigo-800">Ownership Intelligence</span>
        </div>
        <p className="text-[10px] text-indigo-600 mb-2.5">
          Trace corporate ownership chains via Companies House, identify the beneficial owner and building manager using AI analysis.
        </p>
        <Button
          size="sm"
          onClick={runAnalysis}
          disabled={loading}
          className="h-7 text-[11px] gap-1.5 bg-indigo-600 hover:bg-indigo-700"
          data-testid="button-ownership-intelligence"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scan className="w-3 h-3" />}
          {loading ? "Analysing ownership..." : "Run Ownership Analysis"}
        </Button>
      </div>
    );
  }

  const ai = result.aiAnalysis;
  const riskColor = ai?.kycRisk === "low" ? "text-green-700 bg-green-50 border-green-200" : ai?.kycRisk === "medium" ? "text-amber-700 bg-amber-50 border-amber-200" : "text-red-700 bg-red-50 border-red-200";
  const riskIcon = ai?.kycRisk === "low" ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <Network className="w-4 h-4 text-indigo-600" />
        <span className="text-xs font-semibold text-indigo-800">Ownership Intelligence</span>
        <Badge variant="secondary" className="text-[9px] h-4 ml-auto">{result.companies?.length || 0} companies traced</Badge>
      </div>

      {ai && (
        <div className="space-y-2">
          <div className="p-2.5 bg-white border rounded-lg text-[11px] text-gray-700 leading-relaxed">
            {ai.summary}
          </div>

          {ai.ownershipStructure && (
            <div className="p-2 bg-purple-50 border border-purple-200 rounded text-[10px] text-purple-800">
              <span className="font-medium">Structure:</span> {ai.ownershipStructure}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {ai.beneficialOwner?.name && (
              <div className="p-2 bg-white border rounded-lg">
                <div className="flex items-center gap-1 mb-1">
                  <Crown className="w-3 h-3 text-amber-600" />
                  <span className="text-[9px] font-medium text-gray-500">Beneficial Owner</span>
                </div>
                <p className="text-[11px] font-semibold text-gray-800">{ai.beneficialOwner.name}</p>
                {ai.beneficialOwner.companyNumber && (
                  <a href={`https://find-and-update.company-information.service.gov.uk/company/${ai.beneficialOwner.companyNumber}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 hover:underline flex items-center gap-0.5">
                    <Link2 className="w-2.5 h-2.5" />{ai.beneficialOwner.companyNumber}
                  </a>
                )}
                <Badge variant="outline" className={`text-[8px] mt-1 h-3.5 ${ai.beneficialOwner.confidence === "high" ? "text-green-700 border-green-300" : ai.beneficialOwner.confidence === "medium" ? "text-amber-700 border-amber-300" : "text-gray-500"}`}>
                  {ai.beneficialOwner.confidence} confidence
                </Badge>
              </div>
            )}

            {ai.buildingManager?.name && (
              <div className="p-2 bg-white border rounded-lg">
                <div className="flex items-center gap-1 mb-1">
                  <UserCheck className="w-3 h-3 text-blue-600" />
                  <span className="text-[9px] font-medium text-gray-500">Building Manager</span>
                </div>
                <p className="text-[11px] font-semibold text-gray-800">{ai.buildingManager.name}</p>
                {ai.buildingManager.companyNumber && (
                  <a href={`https://find-and-update.company-information.service.gov.uk/company/${ai.buildingManager.companyNumber}`} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-600 hover:underline flex items-center gap-0.5">
                    <Link2 className="w-2.5 h-2.5" />{ai.buildingManager.companyNumber}
                  </a>
                )}
                <Badge variant="outline" className={`text-[8px] mt-1 h-3.5 ${ai.buildingManager.confidence === "high" ? "text-green-700 border-green-300" : ai.buildingManager.confidence === "medium" ? "text-amber-700 border-amber-300" : "text-gray-500"}`}>
                  {ai.buildingManager.confidence} confidence
                </Badge>
              </div>
            )}
          </div>

          <div className={`p-2 border rounded-lg flex items-center gap-2 ${riskColor}`}>
            {riskIcon}
            <div>
              <span className="text-[10px] font-semibold">KYC Risk: {(ai.kycRisk || "unknown").toUpperCase()}</span>
              {ai.kycFlags?.length > 0 && (
                <ul className="text-[9px] mt-0.5 space-y-0.5">
                  {ai.kycFlags.map((flag: string, i: number) => (
                    <li key={i}>• {flag}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {ai.keyContacts?.length > 0 && (
            <div className="p-2 bg-white border rounded-lg">
              <p className="text-[9px] font-medium text-gray-500 mb-1.5">Key Contacts</p>
              <div className="space-y-1">
                {ai.keyContacts.map((c: any, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <Users className="w-3 h-3 text-gray-400 shrink-0" />
                    <span className="font-medium text-gray-800">{c.name}</span>
                    <span className="text-gray-400">·</span>
                    <span className="text-gray-500">{c.role}</span>
                    {c.company && <span className="text-gray-400 text-[9px]">({c.company})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result.companies?.length > 0 && (
        <div>
          <p className="text-[9px] font-medium text-gray-500 mb-1.5">Companies House Details</p>
          <div className="space-y-1.5">
            {result.companies.map((c: any, i: number) => {
              const isExp = expanded === c.companyNumber;
              return (
                <div key={i} className="border rounded overflow-hidden bg-gray-50 text-xs">
                  <button
                    onClick={() => setExpanded(isExp ? null : c.companyNumber)}
                    className="w-full text-left p-2 flex items-center gap-1.5 hover:bg-gray-100 cursor-pointer"
                    data-testid={`ownership-company-${i}`}
                  >
                    {isExp ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-[11px] truncate block">{c.companyName}</span>
                      <span className="text-[9px] text-gray-400">{c.companyNumber} · {c.tenure}</span>
                    </div>
                    <Badge variant="outline" className={`text-[8px] h-3.5 shrink-0 ${c.companyStatus === "active" ? "text-green-700 border-green-300" : "text-red-700 border-red-300"}`}>
                      {c.companyStatus || "unknown"}
                    </Badge>
                  </button>
                  {isExp && !c.error && (
                    <div className="px-3 pb-2.5 pt-0.5 border-t bg-white space-y-2">
                      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px]">
                        {c.companyType && <><span className="text-gray-400">Type</span><span>{c.companyType}</span></>}
                        {c.dateOfCreation && <><span className="text-gray-400">Created</span><span>{c.dateOfCreation}</span></>}
                        {c.sicCodes?.length > 0 && <><span className="text-gray-400">SIC</span><span>{c.sicCodes.join(", ")}</span></>}
                        {c.registeredAddress && <><span className="text-gray-400">Reg. Address</span><span>{[c.registeredAddress.address_line_1, c.registeredAddress.address_line_2, c.registeredAddress.locality, c.registeredAddress.postal_code].filter(Boolean).join(", ")}</span></>}
                        {c.hasCharges && <><span className="text-gray-400">Charges</span><span className="text-amber-600 font-medium">Yes (charges registered)</span></>}
                        {c.hasInsolvencyHistory && <><span className="text-gray-400">Insolvency</span><span className="text-red-600 font-medium">Yes</span></>}
                      </div>

                      {c.officers?.length > 0 && (
                        <div>
                          <p className="text-[9px] font-medium text-gray-500 mb-0.5">Active Officers</p>
                          {c.officers.slice(0, 5).map((o: any, j: number) => (
                            <div key={j} className="text-[10px] text-gray-700 ml-2">• {o.name} <span className="text-gray-400">({o.role})</span></div>
                          ))}
                        </div>
                      )}

                      {c.pscs?.length > 0 && (
                        <div>
                          <p className="text-[9px] font-medium text-gray-500 mb-0.5">Persons with Significant Control</p>
                          {c.pscs.slice(0, 5).map((p: any, j: number) => (
                            <div key={j} className="text-[10px] text-gray-700 ml-2">
                              • {p.name}
                              {p.registrationNumber && <span className="text-gray-400 ml-1">(#{p.registrationNumber})</span>}
                              {p.naturesOfControl?.length > 0 && <span className="text-[9px] text-indigo-500 ml-1">[{p.naturesOfControl.map((n: string) => n.replace(/-/g, " ")).join(", ")}]</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {c.ownershipChain?.length > 0 && (
                        <div>
                          <p className="text-[9px] font-medium text-gray-500 mb-0.5">Ownership Chain</p>
                          <div className="ml-2 space-y-0.5">
                            {c.ownershipChain.map((ch: any, j: number) => (
                              <div key={j} className="text-[10px] flex items-center gap-1">
                                <span className="text-gray-300">→</span>
                                <a href={`https://find-and-update.company-information.service.gov.uk/company/${ch.number}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                                  {ch.name}
                                </a>
                                <span className="text-[9px] text-gray-400">({ch.number})</span>
                              </div>
                            ))}
                          </div>
                          {c.ultimateParent && (
                            <div className="mt-1 text-[10px] flex items-center gap-1 ml-2 text-purple-700 font-medium">
                              <Crown className="w-3 h-3" /> Ultimate: {c.ultimateParent.name}
                            </div>
                          )}
                          {c.brandParent && (
                            <div className="mt-0.5 text-[10px] flex items-center gap-1 ml-2 text-indigo-700 font-medium">
                              <Building2 className="w-3 h-3" /> Brand: {c.brandParent.name}
                            </div>
                          )}
                        </div>
                      )}

                      <a
                        href={`https://find-and-update.company-information.service.gov.uk/company/${c.companyNumber}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-blue-600 hover:underline flex items-center gap-0.5 mt-1"
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> View on Companies House
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {result.individualOwners?.length > 0 && (
        <div>
          <p className="text-[9px] font-medium text-gray-500 mb-1">Individual Owners</p>
          {result.individualOwners.map((o: any, i: number) => (
            <div key={i} className="text-[10px] text-gray-700 ml-1 mb-0.5">
              • {o.name} <span className="text-gray-400">({o.tenure}) — {o.address || "N/A"}</span>
            </div>
          ))}
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        onClick={runAnalysis}
        disabled={loading}
        className="h-6 text-[10px] gap-1"
        data-testid="button-rerun-ownership"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scan className="w-3 h-3" />}
        {loading ? "Re-analysing..." : "Re-run Analysis"}
      </Button>
    </div>
  );
}

function FullReportView({ data, postcode, searchAddress }: { data: PropertyData; postcode: string; searchAddress?: string }) {
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const planningData = data.planningData;
  const planningKeys = ['conservationAreas','article4Directions','listedBuildingOutlines','treePreservationZones','scheduledMonuments','worldHeritageSites','worldHeritageBufferZones','parksAndGardens','battlefields','heritageAtRisk','brownfieldLand','locallyListedBuildings','heritageCoast','specialAreasOfConservation'];
  const hasPlanningData = planningData && planningKeys.some(k => planningData[k]?.length > 0);

  const handleDownloadPdf = async () => {
    setGeneratingPdf(true);
    try {
      await generatePropertyPDF(data, postcode);
    } catch (e) {
      console.error("PDF generation error:", e);
    }
    setGeneratingPdf(false);
  };

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px] px-2 py-0.5">
            <MapPin className="w-3 h-3 mr-1" />{postcode}
          </Badge>
        {(data as any).floodRisk?.postcodeData?.ward && (
          <Badge variant="secondary" className="text-[10px] h-5">{(data as any).floodRisk.postcodeData.ward}</Badge>
        )}
        {(data as any).floodRisk?.postcodeData?.district && (
          <Badge variant="secondary" className="text-[10px] h-5">{(data as any).floodRisk.postcodeData.district}</Badge>
        )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px] gap-1 shrink-0"
          onClick={handleDownloadPdf}
          disabled={generatingPdf}
          data-testid="button-download-pdf"
        >
          {generatingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
          {generatingPdf ? "Generating..." : "Download PDF"}
        </Button>
      </div>

      {data.pricePaid.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <PoundSterling className="w-3.5 h-3.5 text-emerald-600" />
            <h4 className="font-semibold text-xs">Transaction History</h4>
            <Badge variant="secondary" className="text-[10px] ml-auto h-4">{data.pricePaid.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[250px] overflow-y-auto">
            {data.pricePaid.slice(0, 15).map((tx: any, i: number) => (
              <div key={i} className="text-xs border rounded p-2 flex justify-between items-center bg-gray-50">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{tx.address}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-gray-400">{tx.date}</span>
                    {tx.propertyType && <Badge variant="outline" className="text-[9px] h-3.5 px-1">{tx.propertyType}</Badge>}
                    {tx.newBuild && <Badge className="text-[9px] h-3.5 px-1 bg-blue-600 text-white">New</Badge>}
                  </div>
                </div>
                <span className="font-semibold text-emerald-700 whitespace-nowrap ml-2">{formatPrice(tx.price)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.voaRatings.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <PoundSterling className="w-3.5 h-3.5 text-blue-600" />
            <h4 className="font-semibold text-xs">Rateable Values (VOA)</h4>
            <Badge variant="secondary" className="text-[10px] ml-auto h-4">{data.voaRatings.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[250px] overflow-y-auto">
            {data.voaRatings.slice(0, 10).map((voa: any, i: number) => (
              <div key={i} className="text-xs border rounded p-2 bg-gray-50">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{voa.firmName || voa.address}</p>
                    {voa.firmName && <p className="text-gray-400 truncate">{voa.address}</p>}
                  </div>
                  <span className="font-semibold whitespace-nowrap">£{voa.rateableValue?.toLocaleString() || "N/A"}</span>
                </div>
                {voa.description && <p className="text-gray-400 mt-0.5">{voa.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.epc.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ThermometerSun className="w-3.5 h-3.5 text-orange-500" />
            <h4 className="font-semibold text-xs">Energy Performance (EPC)</h4>
            <Badge variant="secondary" className="text-[10px] ml-auto h-4">{data.epc.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[250px] overflow-y-auto">
            {data.epc.slice(0, 5).map((epc: any, i: number) => (
              <div key={i} className="text-xs border rounded p-2 bg-gray-50 space-y-1">
                <div className="flex items-center gap-2">
                  <span className={`${getEPCColor(epc.rating || epc.ratingBand)} text-white text-[10px] font-bold px-1.5 py-0 rounded`}>
                    {epc.rating || epc.ratingBand || "?"}
                  </span>
                  <p className="font-medium truncate flex-1">{epc.address}</p>
                  <Badge variant="outline" className="text-[9px] h-3.5 px-1">{epc.type}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-3 text-[10px] text-gray-400">
                  {epc.propertyType && <span>Type: {epc.propertyType}</span>}
                  {epc.floorArea && <span>Area: {epc.floorArea}m²</span>}
                  {epc.co2Emissions && <span>CO₂: {epc.co2Emissions} t/yr</span>}
                  {epc.inspectionDate && <span>Inspected: {epc.inspectionDate}</span>}
                  {epc.heatingType && <span className="col-span-2 truncate">Heating: {epc.heatingType}</span>}
                  {epc.score && epc.potentialScore && <span>Score: {epc.score} → {epc.potentialScore}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <Droplets className="w-3.5 h-3.5 text-cyan-600" />
          <h4 className="font-semibold text-xs">Flood Risk</h4>
        </div>
        {data.floodRisk ? (
          <div className="space-y-1.5">
            {data.floodRisk.activeFloods > 0 ? (
              <div className="flex items-center gap-2 text-xs p-2 bg-red-50 rounded border border-red-200">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                <span className="font-medium text-red-700">{data.floodRisk.activeFloods} active warning(s)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs p-2 bg-green-50 rounded border border-green-200">
                <span className="text-green-700">No active flood warnings</span>
              </div>
            )}
            {data.floodRisk.floodWarnings?.length > 0 && data.floodRisk.floodWarnings.map((w: any, i: number) => (
              <div key={i} className="text-[10px] p-2 bg-amber-50 rounded">
                <p className="font-medium">{w.description}</p>
                <p className="text-gray-500">Severity: {w.severity}</p>
              </div>
            ))}
            {data.floodRisk.nearbyFloodAreas?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium mb-0.5">Nearby flood areas:</p>
                {data.floodRisk.nearbyFloodAreas.map((a: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 flex items-center gap-1">
                    <Droplets className="w-2.5 h-2.5 text-blue-400" />
                    {a.name}{a.riverOrSea ? ` (${a.riverOrSea})` : ""}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">No flood risk data available.</p>
        )}
      </div>

      {data.listedBuilding.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Landmark className="w-3.5 h-3.5 text-amber-600" />
            <h4 className="font-semibold text-xs">Listed Buildings</h4>
            <Badge variant="secondary" className="text-[10px] ml-auto h-4">{data.listedBuilding.length}</Badge>
          </div>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {data.listedBuilding.slice(0, 10).map((lb: any, i: number) => (
              <div key={i} className="text-xs border rounded p-2 bg-gray-50 flex items-start gap-2">
                <Badge className={`text-[9px] shrink-0 ${lb.grade === "I" ? "bg-red-600 text-white" : lb.grade === "II*" ? "bg-amber-600 text-white" : "bg-gray-600 text-white"}`}>
                  {lb.grade}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-tight">{lb.name}</p>
                  {lb.listEntry && <p className="text-[10px] text-gray-400">Entry: {lb.listEntry}</p>}
                </div>
                {lb.link && (
                  <a href={lb.link} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <ExternalLink className="w-3 h-3 text-gray-400 hover:text-gray-700" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {hasPlanningData && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Landmark className="w-3.5 h-3.5 text-violet-600" />
            <h4 className="font-semibold text-xs">Planning Designations & Heritage</h4>
          </div>
          <div className="space-y-2">
            {planningData.conservationAreas?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><MapPin className="w-2.5 h-2.5 text-emerald-600" /> Conservation Areas</p>
                {planningData.conservationAreas.map((ca: any, i: number) => (
                  <div key={i} className="text-[10px] text-gray-500 ml-3.5 flex items-center gap-1">
                    <Badge className="bg-emerald-600 text-white text-[9px] h-3.5 px-1">CA</Badge>
                    {ca.name}{ca.designationDate ? ` (${ca.designationDate})` : ""}
                    {ca.documentUrl && <a href={ca.documentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-2.5 h-2.5 text-gray-400 hover:text-gray-700" /></a>}
                  </div>
                ))}
              </div>
            )}
            {planningData.worldHeritageSites?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Globe className="w-2.5 h-2.5 text-blue-700" /> World Heritage Sites</p>
                {planningData.worldHeritageSites.map((wh: any, i: number) => (
                  <div key={i} className="text-[10px] text-gray-500 ml-3.5 flex items-center gap-1">
                    <Badge className="bg-blue-700 text-white text-[9px] h-3.5 px-1">WHS</Badge>
                    {wh.name}{wh.designationDate ? ` (${wh.designationDate})` : ""}
                    {wh.documentUrl && <a href={wh.documentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-2.5 h-2.5 text-gray-400 hover:text-gray-700" /></a>}
                  </div>
                ))}
              </div>
            )}
            {planningData.worldHeritageBufferZones?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Globe className="w-2.5 h-2.5 text-blue-500" /> World Heritage Buffer Zones</p>
                {planningData.worldHeritageBufferZones.map((wh: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-blue-500 text-white text-[9px] h-3.5 px-1 mr-1">WH-BZ</Badge>
                    {wh.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.parksAndGardens?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><TreePine className="w-2.5 h-2.5 text-emerald-700" /> Historic Parks & Gardens</p>
                {planningData.parksAndGardens.map((pg: any, i: number) => (
                  <div key={i} className="text-[10px] text-gray-500 ml-3.5 flex items-center gap-1">
                    <Badge className="bg-emerald-700 text-white text-[9px] h-3.5 px-1">PG</Badge>
                    {pg.name}{pg.designationDate ? ` (${pg.designationDate})` : ""}
                  </div>
                ))}
              </div>
            )}
            {planningData.article4Directions?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Zap className="w-2.5 h-2.5 text-amber-600" /> Article 4 Directions</p>
                {planningData.article4Directions.map((a4: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-amber-600 text-white text-[9px] h-3.5 px-1 mr-1">A4</Badge>
                    {a4.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.treePreservationZones?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><TreePine className="w-2.5 h-2.5 text-green-600" /> Tree Preservation</p>
                {planningData.treePreservationZones.map((tp: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-green-600 text-white text-[9px] h-3.5 px-1 mr-1">TPO</Badge>
                    {tp.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.scheduledMonuments?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Landmark className="w-2.5 h-2.5 text-red-600" /> Scheduled Monuments</p>
                {planningData.scheduledMonuments.map((sm: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-red-600 text-white text-[9px] h-3.5 px-1 mr-1">SM</Badge>
                    {sm.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.heritageAtRisk?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><AlertTriangle className="w-2.5 h-2.5 text-orange-600" /> Heritage at Risk</p>
                {planningData.heritageAtRisk.map((hr: any, i: number) => (
                  <div key={i} className="text-[10px] text-gray-500 ml-3.5 flex items-center gap-1">
                    <Badge className="bg-orange-600 text-white text-[9px] h-3.5 px-1">HAR</Badge>
                    {hr.name}
                    {hr.documentUrl && <a href={hr.documentUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="w-2.5 h-2.5 text-gray-400 hover:text-gray-700" /></a>}
                  </div>
                ))}
              </div>
            )}
            {planningData.brownfieldLand?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Construction className="w-2.5 h-2.5 text-yellow-700" /> Brownfield Land</p>
                {planningData.brownfieldLand.map((bf: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-yellow-700 text-white text-[9px] h-3.5 px-1 mr-1">BF</Badge>
                    {bf.name || bf.reference}
                  </p>
                ))}
              </div>
            )}
            {planningData.locallyListedBuildings?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Building2 className="w-2.5 h-2.5 text-indigo-600" /> Locally Listed Buildings</p>
                {planningData.locallyListedBuildings.map((ll: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-indigo-600 text-white text-[9px] h-3.5 px-1 mr-1">LL</Badge>
                    {ll.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.battlefields?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Shield className="w-2.5 h-2.5 text-gray-700" /> Registered Battlefields</p>
                {planningData.battlefields.map((bf: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-gray-700 text-white text-[9px] h-3.5 px-1 mr-1">RB</Badge>
                    {bf.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.heritageCoast?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Waves className="w-2.5 h-2.5 text-cyan-600" /> Heritage Coast</p>
                {planningData.heritageCoast.map((hc: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-cyan-600 text-white text-[9px] h-3.5 px-1 mr-1">HC</Badge>
                    {hc.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.specialAreasOfConservation?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Leaf className="w-2.5 h-2.5 text-lime-600" /> Special Areas of Conservation</p>
                {planningData.specialAreasOfConservation.map((sac: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-lime-600 text-white text-[9px] h-3.5 px-1 mr-1">SAC</Badge>
                    {sac.name}
                  </p>
                ))}
              </div>
            )}
            {planningData.listedBuildingOutlines?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5"><Building2 className="w-2.5 h-2.5 text-purple-600" /> Listed Building Boundaries</p>
                {planningData.listedBuildingOutlines.map((lb: any, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                    <Badge className="bg-purple-600 text-white text-[9px] h-3.5 px-1 mr-1">LB</Badge>
                    {lb.name}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {(() => {
        const allTitles = [
          ...(data.propertyDataCoUk?.["freeholds"]?.data || []).map((f: any) => ({ ...f, _tenure: "Freehold" })),
          ...(data.propertyDataCoUk?.["leaseholds"]?.data || []).map((f: any) => ({ ...f, _tenure: "Leasehold" })),
        ];
        if (allTitles.length === 0) return null;
        const fCount = data.propertyDataCoUk?.["freeholds"]?.data?.length || 0;
        const lCount = data.propertyDataCoUk?.["leaseholds"]?.data?.length || 0;
        return (
          <div className="mb-4">
            <h3 className="text-sm font-bold mb-2 flex items-center gap-1">
              <Building2 className="w-4 h-4 text-purple-700" />
              Ownership / Title Register ({fCount} freehold, {lCount} leasehold)
            </h3>
            <OwnershipTitleList titles={allTitles.slice(0, 25)} searchAddress={searchAddress} />
            {allTitles.some((t: any) => t.company_reg) && (
              <OwnershipIntelligencePanel titles={allTitles} address={searchAddress} postcode={postcode} />
            )}
          </div>
        );
      })()}

      {data.propertyDataCoUk && <PropertyDataSection data={data.propertyDataCoUk} />}

      {data.tflNearby?.stations?.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-bold mb-2 flex items-center gap-1">
            <TrainFront className="w-4 h-4 text-blue-700" />
            Transport Links (TfL)
          </h3>
          <div className="space-y-1">
            {data.tflNearby.stations.map((s: any, i: number) => {
              const walkMins = Math.round(s.distance / 80);
              return (
                <div key={i} className="text-xs border rounded p-2 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-gray-400 text-[10px]">{s.distance}m · ~{walkMins} min walk</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {s.modes?.map((m: string, j: number) => (
                      <Badge key={j} variant="outline" className={`text-[9px] px-1 py-0 ${m === "tube" ? "border-red-300 text-red-700" : m === "national-rail" ? "border-blue-300 text-blue-700" : "border-gray-300"}`}>
                        {m === "tube" ? "Tube" : m === "national-rail" ? "Rail" : m === "dlr" ? "DLR" : m === "overground" ? "Overground" : m === "elizabeth-line" ? "Elizabeth" : m}
                      </Badge>
                    ))}
                  </div>
                  {s.lines?.length > 0 && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{s.lines.join(", ")}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.epc.length === 0 && data.voaRatings.length === 0 && data.pricePaid.length === 0 &&
       data.listedBuilding.length === 0 && !data.floodRisk && !hasPlanningData && !data.propertyDataCoUk && !data.tflNearby && (
        <p className="text-xs text-gray-400 text-center py-8">No data found for this location.</p>
      )}
    </div>
  );
}

function PropertyPanel({
  postcode,
  data,
  loading,
  onClose,
  activeLayers,
  onLoadLayer,
  loadingLayer,
  address,
  onSearchSaved,
}: {
  postcode: string;
  data: PropertyData | null;
  loading: boolean;
  onClose: () => void;
  activeLayers: string[];
  onLoadLayer: (layer: string) => void;
  loadingLayer: string | null;
  address?: string;
  onSearchSaved?: (search: any) => void;
}) {
  const [fullTitleData, setFullTitleData] = useState<any[] | null>(null);
  const [fullTitleLoading, setFullTitleLoading] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [savedSearchId, setSavedSearchId] = useState<number | null>(null);
  // Per-title purchases — keyed by title number, stores either "loading" or
  // the purchase record from /api/land-registry/purchase-title
  const [titlePurchases, setTitlePurchases] = useState<Record<string, any>>({});

  // Load already-purchased titles so we don't re-charge BGP for the same register
  useEffect(() => {
    fetch("/api/land-registry/purchases", {
      credentials: "include",
      headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: any[]) => {
        if (!Array.isArray(rows)) return;
        const map: Record<string, any> = {};
        for (const row of rows) {
          map[(row.title_number || row.titleNumber || "").toUpperCase()] = {
            ...row,
            cached: true,
          };
        }
        setTitlePurchases(map);
      })
      .catch(() => {});
  }, []);

  const purchaseDocs = async (titleNumber: string, documents: "register" | "plan" | "both") => {
    const key = titleNumber.toUpperCase();
    setTitlePurchases((prev) => ({ ...prev, [key]: { loading: true, documents } }));
    try {
      const res = await fetch("/api/land-registry/purchase-title", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("bgp_token")}`,
        },
        body: JSON.stringify({ title: titleNumber, documents, extract_proprietor_data: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        setTitlePurchases((prev) => ({ ...prev, [key]: { error: body.error || `Purchase failed (${res.status})` } }));
        return;
      }
      const d = body.data || {};
      setTitlePurchases((prev) => ({
        ...prev,
        [key]: {
          register_url: d.document_url || d.register_url || d.register?.url || prev[key]?.register_url,
          plan_url: d.plan_url || d.plan?.url || prev[key]?.plan_url,
          proprietor_data: d.proprietor || d.extracted || prev[key]?.proprietor_data,
          cached: body.cached,
        },
      }));
    } catch (err: any) {
      setTitlePurchases((prev) => ({ ...prev, [key]: { error: err?.message || "Network error" } }));
    }
  };

  // Auto-save this search when data first loads
  useEffect(() => {
    if (!data || loading || savedSearchId !== null) return;
    const freeholds = data.propertyDataCoUk?.["freeholds"]?.data || [];
    const leaseholds = data.propertyDataCoUk?.["leaseholds"]?.data || [];
    const intelligence: any = {};
    if (data.floodRisk) {
      const coords = (data.floodRisk as any).postcodeData;
      if (coords?.latitude && coords?.longitude) {
        intelligence.flood = { coordinates: { lat: coords.latitude, lng: coords.longitude } };
      }
    }
    const headers: Record<string, string> = {
      ...getAuthHeaders(),
      "Content-Type": "application/json",
    };
    const token = localStorage.getItem("bgp_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch("/api/land-registry/searches", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({
        address: address || postcode,
        postcode,
        freeholds,
        leaseholds,
        intelligence,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(saved => {
        if (saved?.id) {
          setSavedSearchId(saved.id);
          onSearchSaved?.(saved);
        }
      })
      .catch(() => {});
  }, [data, loading]);

  // Update saved search when full title search completes
  useEffect(() => {
    if (!fullTitleData || savedSearchId === null) return;
    const freeholds = fullTitleData.filter(t => t._tenure === "Freehold");
    const leaseholds = fullTitleData.filter(t => t._tenure === "Leasehold");
    const headers: Record<string, string> = {
      ...getAuthHeaders(),
      "Content-Type": "application/json",
    };
    const token = localStorage.getItem("bgp_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch(`/api/land-registry/searches/${savedSearchId}`, {
      method: "PATCH",
      credentials: "include",
      headers,
      body: JSON.stringify({ freeholds, leaseholds }),
    }).catch(() => {});
  }, [fullTitleData, savedSearchId]);

  const runFullTitleSearch = useCallback(async (freeholds: any[]) => {
    if (fullTitleLoading) return;
    setFullTitleLoading(true);
    try {
      const allResults: any[] = [];
      for (const fh of freeholds.slice(0, 10)) {
        if (!fh.title_number) continue;
        try {
          const lhRes = await fetch(`/api/title-search/leaseholds/${encodeURIComponent(fh.title_number)}`);
          if (!lhRes.ok) continue;
          const lhData = await lhRes.json();
          const freeholdEntry = {
            title_number: fh.title_number,
            _tenure: "Freehold",
            proprietor_name_1: fh.proprietor_name_1 || lhData.freeholdOwnership?.details?.owner || null,
            proprietor_category: fh.proprietor_category || lhData.freeholdOwnership?.type || null,
            company_reg: fh.company_reg || lhData.freeholdOwnership?.details?.company_reg || null,
            proprietor_address: fh.proprietor_address || lhData.freeholdOwnership?.details?.owner_address || null,
            plot_size: fh.plot_size,
            class: fh.class,
            leaseholdCount: lhData.leaseholdCount || 0,
          };
          allResults.push(freeholdEntry);

          if (lhData.leaseholds?.length > 0) {
            const detailRes = await fetch("/api/title-search/leasehold-details", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ titles: lhData.leaseholds.slice(0, 20) }),
            });
            if (detailRes.ok) {
              const detailData = await detailRes.json();
              for (const ld of (detailData.results || [])) {
                if (ld.error) continue;
                allResults.push({
                  title_number: ld.titleNumber,
                  _tenure: "Leasehold",
                  proprietor_name_1: ld.ownership?.details?.owner || null,
                  proprietor_category: ld.ownership?.type || null,
                  company_reg: ld.ownership?.details?.company_reg || null,
                  proprietor_address: ld.ownership?.details?.owner_address || null,
                  plot_size: ld.plotSize,
                  class: ld.class,
                  _parentTitle: fh.title_number,
                });
              }
            }
          }
        } catch {}
      }
      setFullTitleData(allResults);
    } catch {
      setFullTitleData([]);
    } finally {
      setFullTitleLoading(false);
    }
  }, [fullTitleLoading]);

  if (!postcode) return null;

  const summaryStats = data ? {
    epcCount: data.epc.length,
    voaCount: data.voaRatings.length,
    txCount: data.pricePaid.length,
    listedCount: data.listedBuilding.length,
    hasFlood: data.floodRisk?.activeFloods > 0,
    hasPlanning: !!(data.planningData && ['conservationAreas','article4Directions','listedBuildingOutlines','treePreservationZones','scheduledMonuments','worldHeritageSites','worldHeritageBufferZones','parksAndGardens','battlefields','heritageAtRisk','brownfieldLand','locallyListedBuildings','heritageCoast','specialAreasOfConservation'].some(k => data.planningData[k]?.length > 0)),
    hasPropertyData: !!(data.propertyDataCoUk),
    avgPrice: data.propertyDataCoUk?.["postcode-key-stats"]?.data?.average_price,
    demandScore: data.propertyDataCoUk?.["demand"]?.data?.demand_score,
  } : null;

  return (
    <div className="absolute top-0 right-0 h-full w-[400px] bg-white border-l shadow-xl z-[1001] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
        <div className="min-w-0 flex-1 mr-2">
          <h3 className="font-semibold text-sm" data-testid="panel-title">Property Intelligence</h3>
          {address && <p className="text-xs text-gray-700 font-medium truncate">{address}</p>}
          <p className="text-xs text-gray-500">{postcode}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!loading && data && (
            <button
              onClick={async () => {
                setGeneratingPdf(true);
                try { await generatePropertyPDF(data, postcode); } catch {}
                setGeneratingPdf(false);
              }}
              disabled={generatingPdf}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-gray-300 hover:border-indigo-400 hover:text-indigo-600 text-gray-600 transition-colors disabled:opacity-50"
              title="Download PDF report"
            >
              {generatingPdf ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileDown className="w-3 h-3" />}
              {generatingPdf ? "..." : "PDF"}
            </button>
          )}
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded" data-testid="panel-close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : data ? (
          (
            <div className="p-3 space-y-4">
              {/* Pathway linkage strip — "gold" data if a run exists, or a prompt to launch one */}
              {(data as any)._pathwayRun ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Pathway intelligence</p>
                      <p className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
                        Verified · {new Date((data as any)._pathwayRun.updatedAt).toLocaleDateString("en-GB")}
                      </p>
                    </div>
                  </div>
                  <a href={`/property-pathway?runId=${(data as any)._pathwayRun.id}`} className="text-[10px] text-emerald-700 dark:text-emerald-400 hover:underline shrink-0">Open full →</a>
                </div>
              ) : (address || postcode) ? (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-300">No Pathway run yet</p>
                      <p className="text-[10px] text-indigo-700 dark:text-indigo-400">Run for verified titles, planning, KYC &amp; business plan</p>
                    </div>
                  </div>
                  <a
                    href={`/property-pathway?address=${encodeURIComponent(address || "")}&postcode=${encodeURIComponent(postcode || "")}`}
                    className="text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded shrink-0"
                  >
                    Run Pathway
                  </a>
                </div>
              ) : null}

              {summaryStats && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="text-center p-2 bg-indigo-50 rounded border border-indigo-100">
                    <div className="text-lg font-bold text-indigo-700">
                      {(data.propertyDataCoUk?.["freeholds"]?.data?.length || 0) + (data.propertyDataCoUk?.["leaseholds"]?.data?.length || 0)}
                    </div>
                    <div className="text-[10px] text-indigo-600">Titles</div>
                  </div>
                  <div className="text-center p-2 bg-blue-50 rounded border border-blue-100">
                    <div className="text-lg font-bold text-blue-700">{summaryStats.voaCount}</div>
                    <div className="text-[10px] text-blue-600">Rates</div>
                  </div>
                  <div className="text-center p-2 bg-violet-50 rounded border border-violet-100">
                    <div className="text-lg font-bold text-violet-700">
                      {(() => {
                        const govApps = (data.planningData as any)?.planningApplications?.length || 0;
                        const raw = data.propertyDataCoUk?.["planning-applications"]?.data;
                        const pdCount = (Array.isArray(raw) ? raw.length : raw?.planning_applications?.length) || 0;
                        return govApps + pdCount;
                      })()}
                    </div>
                    <div className="text-[10px] text-violet-600">Planning Apps</div>
                  </div>
                </div>
              )}

              {(() => {
                const freeholdsRaw = data.propertyDataCoUk?.["freeholds"]?.data || [];
                const leaseholdsRaw = data.propertyDataCoUk?.["leaseholds"]?.data || [];
                // Show every title PropertyData returned, even if proprietor data
                // is missing — the title number + tenure + address is still useful
                // signal. Only drop completely empty rows (no title, no address).
                const hasAnyInfo = (t: any) =>
                  t.title_number || t.title || t.proprietor_name_1 || t.proprietor_address ||
                  (Array.isArray(t.property) ? t.property.length > 0 : !!t.property);
                const freeholds = freeholdsRaw.filter(hasAnyInfo);
                const leaseholds = leaseholdsRaw.filter(hasAnyInfo);
                const hiddenEmpty = 0;
                const allTitles = [
                  ...freeholds.map((f: any) => ({ ...f, _tenure: "Freehold" })),
                  ...leaseholds.map((l: any) => ({ ...l, _tenure: "Leasehold" })),
                ];
                if (allTitles.length === 0) {
                  // Only show the empty-state if we actually queried (postcode present)
                  if (!postcode) return null;
                  const pdErrors = (data as any)?._landRegistryResolve?.pdErrors || (data as any)?.pdErrors || [];
                  const hadError = Array.isArray(pdErrors) && pdErrors.length > 0;
                  return (
                    <DataSection title={`Ownership`} icon={Building2} color="text-indigo-600">
                      <p className="text-xs text-gray-600 mb-1.5">
                        {hadError
                          ? "PropertyData could not return Land Registry titles for this postcode (API error — see below)."
                          : "PropertyData returned no Land Registry titles for this postcode."}
                      </p>
                      {hadError && (
                        <div className="mb-1.5 space-y-0.5">
                          {pdErrors.slice(0, 3).map((e: any, i: number) => (
                            <p key={i} className="text-[10px] text-red-600 font-mono truncate">
                              {e.endpoint} {e.status ? `HTTP ${e.status}` : ""} — {e.body || "unknown"}
                            </p>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-500">Run a Pathway investigation (top of panel) for a deeper search including title register purchases and KYC.</p>
                    </DataSection>
                  );
                }
                const sorted = address
                  ? [...allTitles].sort((a, b) => {
                      const aM = titleMatchesAddress(a, address) ? 1 : 0;
                      const bM = titleMatchesAddress(b, address) ? 1 : 0;
                      return bM - aM;
                    })
                  : allTitles;
                const matchCount = address ? sorted.filter(t => titleMatchesAddress(t, address)).length : 0;
                return (
                  <DataSection title={`Ownership (${freeholds.length}F / ${leaseholds.length}L)`} icon={Building2} color="text-indigo-600">
                    {address && allTitles.length > 0 && (
                      <div className="text-[10px] text-gray-500 mb-1.5">
                        {matchCount > 0
                          ? <><span className="font-medium text-indigo-600">{matchCount}</span> matching "{address}"{hiddenEmpty > 0 && <> · {hiddenEmpty} empty rows hidden</>}</>
                          : <>No exact matches for "{address}" — showing all {allTitles.length} titles at this postcode{hiddenEmpty > 0 && <> · {hiddenEmpty} empty rows hidden</>}</>
                        }
                      </div>
                    )}
                    {sorted.slice(0, 8).map((t: any, i: number) => {
                      const isMatch = address ? titleMatchesAddress(t, address) : false;
                      const tn = (t.title_number || "").toUpperCase();
                      const purchase = tn ? titlePurchases[tn] : null;
                      const proprietorFromBuy = purchase?.proprietor_data;
                      return (
                        <div key={i} className={`text-xs border rounded p-2 space-y-0.5 overflow-hidden ${isMatch ? "bg-indigo-50 border-indigo-200" : "bg-gray-50"}`}>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${t._tenure === "Freehold" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-blue-300 text-blue-700 bg-blue-50"}`}>
                              {t._tenure === "Freehold" ? "F" : "L"}
                            </Badge>
                            <span className="font-medium truncate flex-1 min-w-0">
                              {t.proprietor_name_1 || proprietorFromBuy?.name_1 || proprietorFromBuy?.proprietor_name_1 || t.address || (purchase?.cached || purchase?.register_url ? "Owner — see register" : "Unknown")}
                            </span>
                            {isMatch && <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded font-medium shrink-0">MATCH</span>}
                            {t.proprietor_category && <span className="text-[9px] text-gray-400 shrink-0">{t.proprietor_category}</span>}
                          </div>
                          {t.title_number && <p className="text-gray-400 text-[10px] truncate">Title: {t.title_number}{t.company_reg ? ` · Co. ${t.company_reg}` : ""}</p>}
                          {t.proprietor_address && <p className="text-gray-400 text-[10px] truncate">{t.proprietor_address}</p>}
                          {t.plot_size && <p className="text-gray-400 text-[10px]">Plot: {t.plot_size} acres</p>}
                          {t.price_paid && <p className="text-gray-400 text-[10px]">Price: £{Number(t.price_paid).toLocaleString()}</p>}
                          {tn && (
                            <div className="flex items-center gap-1 pt-1.5 border-t border-gray-200/70 mt-1">
                              {purchase?.loading ? (
                                <span className="text-[10px] text-gray-500 flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" /> Buying {purchase.documents}...</span>
                              ) : purchase?.error ? (
                                <span className="text-[10px] text-red-600">{purchase.error}</span>
                              ) : (
                                <>
                                  {purchase?.register_url ? (
                                    <a href={purchase.register_url} target="_blank" rel="noopener" className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded hover:bg-emerald-100 inline-flex items-center gap-0.5">
                                      <ExternalLink className="w-2.5 h-2.5" /> Register
                                    </a>
                                  ) : (
                                    <button onClick={() => purchaseDocs(tn, "register")} className="text-[10px] bg-white border border-indigo-200 text-indigo-700 px-1.5 py-0.5 rounded hover:bg-indigo-50">
                                      Buy Register £4
                                    </button>
                                  )}
                                  {purchase?.plan_url ? (
                                    <a href={purchase.plan_url} target="_blank" rel="noopener" className="text-[10px] bg-emerald-50 border border-emerald-200 text-emerald-700 px-1.5 py-0.5 rounded hover:bg-emerald-100 inline-flex items-center gap-0.5">
                                      <ExternalLink className="w-2.5 h-2.5" /> Plan
                                    </a>
                                  ) : (
                                    <button onClick={() => purchaseDocs(tn, "plan")} className="text-[10px] bg-white border border-indigo-200 text-indigo-700 px-1.5 py-0.5 rounded hover:bg-indigo-50">
                                      Buy Plan £3
                                    </button>
                                  )}
                                  {purchase?.cached && <span className="text-[9px] text-gray-400 ml-auto">cached</span>}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {allTitles.length > 8 && <p className="text-[10px] text-gray-400 text-center">+{allTitles.length - 8} more titles</p>}

                    {freeholds.length > 0 && !fullTitleData && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2 text-[11px] h-7 border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                        onClick={() => runFullTitleSearch(freeholds)}
                        disabled={fullTitleLoading}
                        data-testid="btn-full-title-search"
                      >
                        {fullTitleLoading ? (
                          <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Running Full Title Search...</>
                        ) : (
                          <><Search className="w-3 h-3 mr-1" /> Full Title Search (incl. all leases)</>
                        )}
                      </Button>
                    )}

                    {fullTitleData && fullTitleData.length > 0 && (
                      <div className="mt-2 border-t pt-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-semibold text-indigo-700 truncate">
                            Full Title Search — {fullTitleData.filter(t => t._tenure === "Freehold").length}F / {fullTitleData.filter(t => t._tenure === "Leasehold").length}L
                          </p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={() => {
                                const rows = [
                                  ["Tenure","Title Number","Proprietor","Category","Company Reg","Address","Plot Size (acres)","Parent Title","Leasehold Count"],
                                  ...fullTitleData.map(t => [
                                    t._tenure || "",
                                    t.title_number || "",
                                    t.proprietor_name_1 || "",
                                    t.proprietor_category || "",
                                    t.company_reg || "",
                                    t.proprietor_address || "",
                                    t.plot_size || "",
                                    t._parentTitle || "",
                                    t.leaseholdCount || "",
                                  ])
                                ];
                                const csv = rows.map(r => r.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
                                const blob = new Blob([csv], { type: "text/csv" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `Title_Search_${(address || postcode).replace(/[^a-zA-Z0-9]/g, "_")}.csv`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="flex items-center gap-0.5 text-[9px] text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-1.5 py-0.5 hover:bg-indigo-50 transition-colors"
                              title="Download all title search results as CSV"
                            >
                              <Download className="w-2.5 h-2.5" /> CSV
                            </button>
                            <button onClick={() => setFullTitleData(null)} className="text-[9px] text-gray-400 hover:text-gray-600" data-testid="btn-close-full-titles">Clear</button>
                          </div>
                        </div>
                        {fullTitleData.map((t: any, i: number) => (
                          <div key={i} className={`text-xs border rounded p-2 space-y-0.5 overflow-hidden ${t._tenure === "Leasehold" ? "bg-blue-50/50 ml-3 border-blue-200" : "bg-emerald-50/50 border-emerald-200"}`}>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${t._tenure === "Freehold" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-blue-300 text-blue-700 bg-blue-50"}`}>
                                {t._tenure === "Freehold" ? "F" : "L"}
                              </Badge>
                              <span className="font-medium truncate flex-1 min-w-0 text-[11px]">{t.proprietor_name_1 || "Unknown"}</span>
                              {t.proprietor_category && <span className="text-[9px] text-gray-400 shrink-0">{t.proprietor_category}</span>}
                            </div>
                            <p className="text-gray-400 text-[10px] truncate">
                              Title: {t.title_number}
                              {t.company_reg ? ` · Co. ${t.company_reg}` : ""}
                              {t.leaseholdCount ? ` · ${t.leaseholdCount} leases` : ""}
                            </p>
                            {t.proprietor_address && <p className="text-gray-400 text-[10px] truncate">{t.proprietor_address}</p>}
                            {t.plot_size && <p className="text-gray-400 text-[10px]">Plot: {t.plot_size} acres</p>}
                            {t._parentTitle && <p className="text-blue-400 text-[9px] truncate">Under freehold: {t._parentTitle}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {fullTitleData && fullTitleData.length === 0 && (
                      <p className="text-[10px] text-gray-400 text-center mt-2">No additional lease data found.</p>
                    )}
                    {allTitles.some((t: any) => t.company_reg) && (
                      <OwnershipIntelligencePanel titles={allTitles} address={address} postcode={postcode} />
                    )}
                  </DataSection>
                );
              })()}

              {data.voaRatings.length > 0 && (
                <DataSection title="Business Rates (VOA)" icon={PoundSterling} color="text-blue-600">
                  {data.voaRatings.slice(0, 5).map((v: any, i: number) => (
                    <div key={i} className="text-xs border rounded p-2 space-y-0.5 bg-gray-50">
                      <p className="font-medium">{v.firmName || "Vacant"}</p>
                      <p className="text-gray-400">{v.address}</p>
                      <p>{v.description} · RV: <span className="font-semibold">£{v.rateableValue?.toLocaleString()}</span></p>
                    </div>
                  ))}
                </DataSection>
              )}

              {(() => {
                // Merge from planning.data.gov.uk (via planningData) + PropertyData API
                const govApps: any[] = (data.planningData as any)?.planningApplications || [];
                const pdRaw = data.propertyDataCoUk?.["planning-applications"]?.data;
                const pdApps: any[] = Array.isArray(pdRaw) ? pdRaw : (pdRaw?.planning_applications || []);
                // Normalise PropertyData format to match gov format
                const pdNormalised = pdApps.map((pa: any) => ({
                  reference: pa.application_number || pa.reference,
                  address: pa.address || pa.site_address || "",
                  description: pa.proposal || pa.description || "",
                  status: pa.status || pa.decision || "",
                  type: pa.application_type || pa.type || "",
                  decidedAt: pa.dates?.decision || pa.decision_date || "",
                  receivedAt: pa.dates?.received_at || pa.received_date || "",
                  decision: pa.decision || "",
                  documentUrl: pa.url || "",
                }));
                // Deduplicate by reference, gov data takes priority
                const govRefs = new Set(govApps.map((a: any) => a.reference).filter(Boolean));
                const merged = [...govApps, ...pdNormalised.filter((a: any) => !a.reference || !govRefs.has(a.reference))];
                if (merged.length === 0) return null;
                return (
                  <DataSection title={`Planning Applications — last 10 yrs (${merged.length})`} icon={Landmark} color="text-violet-600">
                    {merged.slice(0, 10).map((pa: any, i: number) => (
                      <div key={i} className="text-xs border rounded p-2 space-y-0.5 bg-gray-50 overflow-hidden">
                        <p className="font-medium truncate">{pa.description || pa.address || pa.reference || "Application"}</p>
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px] min-w-0">
                          {pa.status && (
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 shrink-0 ${
                              /approv|grant|permit/i.test(pa.status || pa.decision) ? "border-emerald-300 text-emerald-700 bg-emerald-50" :
                              /refus|reject/i.test(pa.status || pa.decision) ? "border-red-300 text-red-700 bg-red-50" : ""
                            }`}>
                              {pa.status}
                            </Badge>
                          )}
                          {pa.type && <span className="text-gray-500 truncate">{pa.type}</span>}
                          {(pa.receivedAt || pa.decidedAt) && (
                            <span className="text-gray-400 shrink-0">{pa.receivedAt || pa.decidedAt}</span>
                          )}
                        </div>
                        {pa.reference && <p className="text-[10px] text-gray-400">Ref: {pa.reference}</p>}
                        {pa.address && pa.description && <p className="text-[10px] text-gray-400 truncate">{pa.address}</p>}
                        {pa.documentUrl && (
                          <a href={pa.documentUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-indigo-500 hover:underline inline-flex items-center gap-0.5">
                            View <ExternalLink className="w-2.5 h-2.5" />
                          </a>
                        )}
                      </div>
                    ))}
                    {merged.length > 10 && <p className="text-[10px] text-gray-400 text-center">+{merged.length - 10} more</p>}
                  </DataSection>
                );
              })()}

              {data.planningData && <PlanningSection data={data.planningData} />}

              {data.pricePaid.length > 0 && (
                <DataSection title="Price Paid" icon={PoundSterling} color="text-emerald-600">
                  {data.pricePaid.slice(0, 8).map((t: any, i: number) => (
                    <div key={i} className="text-xs border rounded p-2 flex justify-between items-center bg-gray-50">
                      <div>
                        <p className="font-medium">{t.address}</p>
                        <p className="text-gray-400">{t.date} · {t.propertyType}</p>
                      </div>
                      <span className="font-semibold text-emerald-700 whitespace-nowrap ml-2">£{t.price?.toLocaleString()}</span>
                    </div>
                  ))}
                </DataSection>
              )}

              {data.epc.length > 0 && (
                <DataSection title="EPC Ratings" icon={ThermometerSun} color="text-orange-500">
                  {data.epc.slice(0, 5).map((e: any, i: number) => (
                    <div key={i} className="text-xs border rounded p-2 space-y-0.5 bg-gray-50">
                      <p className="font-medium truncate">{e.address}</p>
                      <div className="flex gap-2 items-center">
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${epcColor(e.rating || e.ratingBand)}`}>
                          {e.rating || e.ratingBand || "N/A"}
                        </Badge>
                        <span className="text-gray-400">{e.type}</span>
                      </div>
                    </div>
                  ))}
                </DataSection>
              )}

              {data.floodRisk && (
                <DataSection title="Flood Risk" icon={Droplets} color="text-cyan-600">
                  {data.floodRisk.activeFloods > 0 ? (
                    <div className="flex items-center gap-2 text-xs text-red-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      {data.floodRisk.activeFloods} active warning(s)
                    </div>
                  ) : (
                    <p className="text-xs text-green-600">No active flood warnings</p>
                  )}
                </DataSection>
              )}

              {data.listedBuilding.length > 0 && (
                <DataSection title="Listed Buildings" icon={Landmark} color="text-amber-600">
                  {data.listedBuilding.slice(0, 5).map((lb: any, i: number) => (
                    <div key={i} className="text-xs border rounded p-2 space-y-0.5 bg-gray-50">
                      <p className="font-medium">{lb.name}</p>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">Grade {lb.grade}</Badge>
                    </div>
                  ))}
                </DataSection>
              )}

              {data.propertyDataCoUk && (activeLayers.includes("market") || activeLayers.includes("area") || activeLayers.includes("planning") || activeLayers.includes("residential")) && <PropertyDataSection data={data.propertyDataCoUk} />}

              {data.tflNearby?.stations?.length > 0 && (
                <DataSection title="Transport Links (TfL)" icon={TrainFront} color="text-blue-700">
                  {data.tflNearby.stations.slice(0, 5).map((s: any, i: number) => {
                    const walkMins = Math.round(s.distance / 80);
                    return (
                      <div key={i} className="text-xs border rounded p-2 space-y-0.5 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-gray-400 text-[10px] whitespace-nowrap ml-2">{s.distance}m · ~{walkMins} min</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {s.modes?.map((m: string, j: number) => (
                            <Badge key={j} variant="outline" className={`text-[9px] px-1 py-0 ${m === "tube" ? "border-red-300 text-red-700" : m === "national-rail" ? "border-blue-300 text-blue-700" : "border-gray-300"}`}>
                              {m === "tube" ? "Tube" : m === "national-rail" ? "Rail" : m === "dlr" ? "DLR" : m === "overground" ? "Overground" : m === "elizabeth-line" ? "Elizabeth" : m}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </DataSection>
              )}

              <div className="border-t pt-3 mt-3">
                <p className="text-[10px] font-medium text-gray-500 mb-2 uppercase tracking-wider">Load additional data</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: "market", label: "Market & Pricing", loaded: activeLayers.includes("market") },
                    { key: "area", label: "Area & Demographics", loaded: activeLayers.includes("area") },
                    { key: "planning", label: "Conservation & Heritage", loaded: activeLayers.includes("planning") },
                    { key: "residential", label: "Residential", loaded: activeLayers.includes("residential") },
                  ].map(layer => (
                    <button
                      key={layer.key}
                      disabled={layer.loaded || loadingLayer !== null}
                      onClick={() => onLoadLayer(layer.key)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                        layer.loaded
                          ? "bg-gray-100 text-gray-400 border-gray-200 cursor-default"
                          : loadingLayer === layer.key
                          ? "bg-indigo-50 text-indigo-600 border-indigo-200 animate-pulse"
                          : "bg-white text-gray-700 border-gray-300 hover:border-indigo-400 hover:text-indigo-600 cursor-pointer"
                      }`}
                      data-testid={`layer-toggle-${layer.key}`}
                    >
                      {loadingLayer === layer.key ? "Loading..." : layer.loaded ? `${layer.label} ✓` : `+ ${layer.label}`}
                    </button>
                  ))}
                </div>
              </div>

              {data.voaRatings.length === 0 && !data.propertyDataCoUk && !data.planningData && (
                <p className="text-xs text-gray-400 text-center py-8">No data found for this location.</p>
              )}
            </div>
          )
        ) : null}
      </ScrollArea>
    </div>
  );
}

function DataSection({ title, icon: Icon, color, children }: {
  title: string;
  icon: any;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <h4 className="font-semibold text-xs">{title}</h4>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function PlanningSection({ data }: { data: any }) {
  const sections = [
    { key: "conservationAreas", label: "Conservation Areas", icon: Landmark },
    { key: "worldHeritageSites", label: "World Heritage Sites", icon: Globe },
    { key: "worldHeritageBufferZones", label: "World Heritage Buffer Zones", icon: Globe },
    { key: "parksAndGardens", label: "Historic Parks & Gardens", icon: TreePine },
    { key: "article4Directions", label: "Article 4 Directions", icon: Zap },
    { key: "listedBuildingOutlines", label: "Listed Building Boundaries", icon: Building2 },
    { key: "locallyListedBuildings", label: "Locally Listed Buildings", icon: Building2 },
    { key: "treePreservationZones", label: "Tree Preservation Zones", icon: TreePine },
    { key: "scheduledMonuments", label: "Scheduled Monuments", icon: Landmark },
    { key: "heritageAtRisk", label: "Heritage at Risk", icon: AlertTriangle },
    { key: "battlefields", label: "Registered Battlefields", icon: Shield },
    { key: "brownfieldLand", label: "Brownfield Land", icon: Construction },
    { key: "heritageCoast", label: "Heritage Coast", icon: Waves },
    { key: "specialAreasOfConservation", label: "Special Areas of Conservation", icon: Leaf },
  ];

  const hasData = sections.some(s => data[s.key]?.length > 0);
  if (!hasData) return null;

  return (
    <DataSection title="Planning Designations & Heritage" icon={Landmark} color="text-violet-600">
      {sections.map(({ key, label, icon: Icon }) =>
        data[key]?.length > 0 ? (
          <div key={key}>
            <p className="text-[10px] font-medium flex items-center gap-1 mb-0.5">
              <Icon className="w-2.5 h-2.5" /> {label}
            </p>
            {data[key].map((item: any, i: number) => (
              <p key={i} className="text-[10px] text-gray-500 ml-3.5">
                · {item.name}{item.designationDate ? ` (${item.designationDate})` : ""}
              </p>
            ))}
          </div>
        ) : null
      )}
    </DataSection>
  );
}

function PropertyDataSection({ data }: { data: any }) {
  if (!data) return null;
  const ks = data["postcode-key-stats"]?.data;
  const growth = data["growth"]?.data;
  const demand = data["demand"]?.data;
  const soldPrices = data["sold-prices"]?.data;
  const commercialRents = data["rents-commercial"]?.data;
  const planningRaw = data["planning-applications"]?.data;
  const planning = Array.isArray(planningRaw) ? planningRaw : (planningRaw?.planning_applications || null);
  const flood = data["flood-risk"]?.data;
  const uprns = data["uprns"]?.data;
  const energyEff = data["energy-efficiency"]?.energy_efficiency;
  const prices = data["prices"]?.data;
  const pricesPsf = data["prices-per-sqf"]?.data;
  const rents = data["rents"]?.data;
  const soldPsf = data["sold-prices-per-sqf"]?.data;
  const demandRent = data["demand-rent"];
  const growthPsf = data["growth-psf"]?.data;
  const ptal = data["ptal"];
  const crime = data["crime"];
  const schools = data["schools"]?.data;
  const internet = data["internet-speed"]?.internet;
  const restaurants = data["restaurants"]?.data;
  const conservation = data["conservation-area"];
  const greenBelt = data["green-belt"];
  const aonb = data["aonb"];
  const nationalPark = data["national-park"];
  const listedBldgs = data["listed-buildings"]?.data;
  const householdIncome = data["household-income"]?.result;
  const population = data["population"]?.result;
  const tenureTypes = data["tenure-types"]?.data;
  const propertyTypes = data["property-types"]?.data;
  const councilTax = data["council-tax"];
  const rentsHmo = data["rents-hmo"]?.data;
  const hmoRegister = data["national-hmo-register"]?.data;
  const freeholds = data["freeholds"]?.data;
  const politics = data["politics"]?.data;
  const agents = data["agents"]?.data;
  const areaType = data["area-type"];
  const demographics = data["demographics"]?.data;
  const yields = data["yields"]?.data;
  const floorAreas = data["floor-areas"]?.data;

  const uprnClassCounts: Record<string, number> = {};
  if (uprns?.length > 0) {
    for (const u of uprns) {
      const cls = u.classificationCodeDesc || "Other";
      uprnClassCounts[cls] = (uprnClassCounts[cls] || 0) + 1;
    }
  }
  const sortedClasses = Object.entries(uprnClassCounts).sort((a, b) => b[1] - a[1]);

  const eeRatings: Record<string, number> = {};
  let eeAvgScore = 0;
  if (energyEff?.length > 0) {
    let total = 0;
    for (const e of energyEff) {
      if (e.rating) eeRatings[e.rating] = (eeRatings[e.rating] || 0) + 1;
      if (e.score) total += e.score;
    }
    eeAvgScore = Math.round(total / energyEff.length);
  }

  return (
    <>
      <DataSection title="Market Overview" icon={BarChart3} color="text-indigo-600">
        {ks && (
          <div className="text-xs border rounded p-2 bg-indigo-50/50 space-y-1">
            <p className="font-medium text-[10px] text-indigo-700 uppercase tracking-wide">Key Stats</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {ks.average_price && <span>Avg Price: <b>£{Number(ks.average_price).toLocaleString()}</b></span>}
              {ks.average_rent && <span>Avg Rent: <b>£{ks.average_rent} pcm</b></span>}
              {ks.average_yield && <span>Yield: <b>{ks.average_yield}</b></span>}
              {ks.turnover && <span>Turnover: <b>{ks.turnover}</b></span>}
              {ks.council_tax_band && <span>Council Tax: <b>Band {ks.council_tax_band}</b></span>}
              {ks.number_of_properties && <span>Properties: <b>{ks.number_of_properties}</b></span>}
            </div>
          </div>
        )}
        {prices && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Asking Prices</p>
            <div className="text-[11px]">
              {prices.average && <span>Average: <b>£{Number(prices.average).toLocaleString()}</b></span>}
              {prices["70pc_range"] && <span className="ml-2 text-gray-400">70% range: £{Number(prices["70pc_range"][0]).toLocaleString()} – £{Number(prices["70pc_range"][1]).toLocaleString()}</span>}
            </div>
          </div>
        )}
        {pricesPsf && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Asking Prices /sqft</p>
            <div className="text-[11px]">
              {pricesPsf.average && <span>Average: <b>£{Number(pricesPsf.average).toLocaleString()}/sqft</b></span>}
            </div>
          </div>
        )}
        {soldPsf && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Sold Prices /sqft</p>
            <div className="text-[11px]">
              {soldPsf.average && <span>Average: <b>£{Number(soldPsf.average).toLocaleString()}/sqft</b></span>}
              {soldPsf.points_analysed && <span className="ml-2 text-gray-400">({soldPsf.points_analysed} sales)</span>}
            </div>
          </div>
        )}
        {growth && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px] flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5 text-green-600" /> Price Growth</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {growth.growth_1y !== undefined && <div><div className={`font-bold text-sm ${Number(growth.growth_1y) >= 0 ? "text-green-700" : "text-red-600"}`}>{growth.growth_1y}%</div><div className="text-[9px] text-gray-400">1 Year</div></div>}
              {growth.growth_3y !== undefined && <div><div className={`font-bold text-sm ${Number(growth.growth_3y) >= 0 ? "text-green-700" : "text-red-600"}`}>{growth.growth_3y}%</div><div className="text-[9px] text-gray-400">3 Year</div></div>}
              {growth.growth_5y !== undefined && <div><div className={`font-bold text-sm ${Number(growth.growth_5y) >= 0 ? "text-green-700" : "text-red-600"}`}>{growth.growth_5y}%</div><div className="text-[9px] text-gray-400">5 Year</div></div>}
            </div>
          </div>
        )}
        {growthPsf && Array.isArray(growthPsf) && growthPsf.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px] flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5 text-teal-600" /> Growth /sqft</p>
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              {growthPsf.slice(-3).map((item: any, i: number) => (
                <div key={i}>
                  <div className={`font-bold ${item[2] && Number(String(item[2]).replace("%","")) >= 0 ? "text-green-700" : "text-red-600"}`}>{item[2] || "N/A"}</div>
                  <div className="text-[9px] text-gray-400">{item[0]}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {yields && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Rental Yields</p>
            <div className="text-[11px]">
              {yields.long_let?.yield && <span>Long Let: <b>{yields.long_let.yield}</b></span>}
              {yields.short_let?.yield && <span className="ml-2">Short Let: <b>{yields.short_let.yield}</b></span>}
            </div>
          </div>
        )}
        {soldPrices?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px]">Recent Sales</p>
            {soldPrices.slice(0, 3).map((sp: any, i: number) => (
              <div key={i} className="flex justify-between items-center text-[11px]">
                <span className="truncate flex-1 mr-2">{sp.address || "N/A"}</span>
                <span className="font-semibold text-emerald-700 whitespace-nowrap">£{Number(sp.price || sp.result || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </DataSection>

      <DataSection title="Rental Market" icon={Home} color="text-blue-600">
        {commercialRents && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Commercial Rents</p>
            <div className="text-[11px]">
              {commercialRents.average_rent && <span>Average: <b>£{commercialRents.average_rent}/sq ft</b></span>}
              {commercialRents.min_rent && <span className="ml-3">Range: £{commercialRents.min_rent} – £{commercialRents.max_rent}/sq ft</span>}
            </div>
          </div>
        )}
        {rents?.long_let && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Residential Rents</p>
            <div className="text-[11px]">
              <span>Average: <b>£{rents.long_let.average}/wk</b></span>
              {rents.long_let.points_analysed && <span className="ml-2 text-gray-400">({rents.long_let.points_analysed} listings)</span>}
            </div>
          </div>
        )}
        {rentsHmo && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">HMO Room Rents</p>
            <div className="text-[11px]">
              {rentsHmo["double-ensuite"]?.average && <span>Double ensuite: <b>£{rentsHmo["double-ensuite"].average}/wk</b></span>}
              {rentsHmo["double-shared"]?.average && <span className="ml-2">Double shared: <b>£{rentsHmo["double-shared"]?.average}/wk</b></span>}
            </div>
          </div>
        )}
        {demand && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px] flex items-center gap-1"><Activity className="w-2.5 h-2.5 text-purple-600" /> Sales Demand</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {demand.demand_score !== undefined && <span>Score: <b>{demand.demand_score}/100</b></span>}
              {demand.supply !== undefined && <span>Supply: <b>{demand.supply}</b></span>}
              {demand.demand !== undefined && <span>Demand: <b>{demand.demand}</b></span>}
              {demand.turnover !== undefined && <span>Turnover: <b>{demand.turnover}</b></span>}
            </div>
          </div>
        )}
        {demandRent && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><Activity className="w-2.5 h-2.5 text-orange-600" /> Rental Demand</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {demandRent.rental_demand_rating && <span className="col-span-2">Rating: <b>{demandRent.rental_demand_rating}</b></span>}
              {demandRent.total_for_rent !== undefined && <span>Listed: <b>{demandRent.total_for_rent}</b></span>}
              {demandRent.transactions_per_month !== undefined && <span>Lettings/mo: <b>{demandRent.transactions_per_month}</b></span>}
              {demandRent.days_on_market !== undefined && <span>Days on market: <b>{demandRent.days_on_market}</b></span>}
            </div>
          </div>
        )}
      </DataSection>

      <DataSection title="Demographics & Area" icon={Users} color="text-violet-600">
        {areaType && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Area Classification</p>
            <p className="text-[11px] font-semibold">{areaType.area_type}</p>
          </div>
        )}
        {population && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Population</p>
            <div className="grid grid-cols-3 gap-1 text-[11px] text-center">
              {population.population && <div><div className="font-bold">{population.population}</div><div className="text-[9px] text-gray-400">People</div></div>}
              {population.households && <div><div className="font-bold">{population.households}</div><div className="text-[9px] text-gray-400">Households</div></div>}
              {population.density && <div><div className="font-bold">{population.density}</div><div className="text-[9px] text-gray-400">Density/km²</div></div>}
            </div>
          </div>
        )}
        {householdIncome && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Household Income</p>
            <p className="text-[11px]">Average: <b>£{Number(householdIncome.average_household_income).toLocaleString()}</b></p>
          </div>
        )}
        {demographics && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Demographics</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {demographics.average_age && <span>Avg Age: <b>{demographics.average_age}</b></span>}
              {demographics.population_density && <span>Density: <b>{demographics.population_density}</b></span>}
            </div>
          </div>
        )}
        {tenureTypes && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Tenure Types</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {tenureTypes.owned_outright && <span>Owned: <b>{tenureTypes.owned_outright}%</b></span>}
              {tenureTypes.owned_mortgage && <span>Mortgaged: <b>{tenureTypes.owned_mortgage}%</b></span>}
              {tenureTypes.private_rented && <span>Private rent: <b>{tenureTypes.private_rented}%</b></span>}
              {tenureTypes.social_rented && <span>Social rent: <b>{tenureTypes.social_rented}%</b></span>}
            </div>
          </div>
        )}
        {propertyTypes && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Property Types</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
              {propertyTypes.flat_purpose_built && <span>Flats (built): <b>{propertyTypes.flat_purpose_built}%</b></span>}
              {propertyTypes.terraced && <span>Terraced: <b>{propertyTypes.terraced}%</b></span>}
              {propertyTypes.semi_detached && <span>Semi: <b>{propertyTypes.semi_detached}%</b></span>}
              {propertyTypes.detached && <span>Detached: <b>{propertyTypes.detached}%</b></span>}
              {propertyTypes.flat_converted && <span>Flats (conv): <b>{propertyTypes.flat_converted}%</b></span>}
              {propertyTypes.flat_commercial && <span>Flats (comm): <b>{propertyTypes.flat_commercial}%</b></span>}
            </div>
          </div>
        )}
        {politics && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><Vote className="w-2.5 h-2.5 text-blue-600" /> Politics</p>
            <p className="text-[11px]">{politics.constituency}</p>
            {politics.last_result?.vote_counts && (
              <div className="text-[10px] text-gray-400">
                {Object.entries(politics.last_result.vote_counts).slice(0, 3).map(([party, votes]: any) => (
                  <span key={party} className="mr-2">{party}: {Number(votes).toLocaleString()}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </DataSection>

      <DataSection title="Local Amenities" icon={MapPin} color="text-emerald-600">
        {ptal && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><Bus className="w-2.5 h-2.5 text-blue-600" /> Public Transport (PTAL)</p>
            <p className="text-[11px]">PTAL Level: <b className="text-lg">{ptal.ptal}</b></p>
          </div>
        )}
        {crime && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><Shield className="w-2.5 h-2.5 text-red-600" /> Crime</p>
            <div className="text-[11px]">
              {crime.crime_rating && <span>Rating: <b>{crime.crime_rating}</b></span>}
              {crime.crimes_per_thousand !== undefined && <span className="ml-2">Per 1000: <b>{crime.crimes_per_thousand}</b></span>}
            </div>
          </div>
        )}
        {schools?.state?.nearest?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><GraduationCap className="w-2.5 h-2.5 text-blue-600" /> Nearest Schools</p>
            {schools.state.nearest.slice(0, 3).map((s: any, i: number) => (
              <p key={i} className="text-[11px] truncate">{s.name} <span className="text-gray-400">({s.phase})</span></p>
            ))}
          </div>
        )}
        {internet && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><Wifi className="w-2.5 h-2.5 text-cyan-600" /> Internet Speed</p>
            <div className="text-[11px]">
              <span>Superfast: <b>{internet.SFBB_availability}%</b></span>
              {internet.gigabit_availability && <span className="ml-2">Gigabit: <b>{internet.gigabit_availability}%</b></span>}
            </div>
          </div>
        )}
        {restaurants && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><UtensilsCrossed className="w-2.5 h-2.5 text-amber-600" /> Restaurants</p>
            <div className="text-[11px]">
              {restaurants.rating && <span>Hygiene: <b>{restaurants.rating}</b></span>}
              {restaurants.average_hygiene && <span className="ml-2">Avg score: <b>{restaurants.average_hygiene}/5</b></span>}
            </div>
          </div>
        )}
        {(agents?.["zoopla.co.uk"]?.sale?.length > 0 || agents?.zoopla?.sale?.length > 0) && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px] flex items-center gap-1"><Briefcase className="w-2.5 h-2.5 text-gray-600" /> Local Agents</p>
            {(agents["zoopla.co.uk"]?.sale || agents.zoopla?.sale)?.slice(0, 3).map((a: any, i: number) => (
              <p key={i} className="text-[11px] truncate">{a.rank}. {a.agent} <span className="text-gray-400">({a.units_offered} listings)</span></p>
            ))}
          </div>
        )}
      </DataSection>

      <DataSection title="Planning & Constraints" icon={Landmark} color="text-amber-600">
        {conservation && (
          <div className={`text-xs border rounded p-2 space-y-0.5 ${conservation.conservation_area ? "bg-amber-50 border-amber-200" : "bg-gray-50"}`}>
            <p className="font-medium text-[10px]">Conservation Area</p>
            <p className="text-[11px]">{conservation.conservation_area ? <b className="text-amber-700">{conservation.conservation_area_name || "Yes"}</b> : "No"}</p>
          </div>
        )}
        {greenBelt && (
          <div className={`text-xs border rounded p-2 space-y-0.5 ${greenBelt.green_belt ? "bg-green-50 border-green-200" : "bg-gray-50"}`}>
            <p className="font-medium text-[10px]">Green Belt</p>
            <p className="text-[11px]">{greenBelt.green_belt ? <b className="text-green-700">{greenBelt.green_belt_name || "Yes"}</b> : "No"}</p>
          </div>
        )}
        {aonb && (
          <div className={`text-xs border rounded p-2 space-y-0.5 ${aonb.aonb ? "bg-emerald-50 border-emerald-200" : "bg-gray-50"}`}>
            <p className="font-medium text-[10px]">AONB</p>
            <p className="text-[11px]">{aonb.aonb ? <b className="text-emerald-700">{aonb.aonb_name || "Yes"}</b> : "No"}</p>
          </div>
        )}
        {nationalPark && (
          <div className={`text-xs border rounded p-2 space-y-0.5 ${nationalPark.national_park ? "bg-teal-50 border-teal-200" : "bg-gray-50"}`}>
            <p className="font-medium text-[10px]">National Park</p>
            <p className="text-[11px]">{nationalPark.national_park ? <b className="text-teal-700">{nationalPark.national_park_name || "Yes"}</b> : "No"}</p>
          </div>
        )}
        {listedBldgs?.listed_buildings?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Listed Buildings (PropertyData)</p>
            {listedBldgs.listed_buildings.slice(0, 3).map((lb: any, i: number) => (
              <div key={i} className="text-[11px] flex items-center gap-1">
                <Badge variant="outline" className={`text-[9px] px-1 py-0 ${lb.grade === "I" ? "border-red-400 text-red-700" : lb.grade === "II*" ? "border-amber-400 text-amber-700" : "border-gray-400"}`}>{lb.grade}</Badge>
                <span className="truncate">{lb.name}</span>
                <span className="text-gray-400 shrink-0">{lb.distance}km</span>
              </div>
            ))}
          </div>
        )}
        {planning?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px]">Planning Applications</p>
            {planning.slice(0, 3).map((pa: any, i: number) => (
              <div key={i} className="text-[11px]">
                <p className="truncate">{pa.description || "Application"}</p>
                <p className="text-gray-400">{pa.status || ""} · {pa.date || ""}</p>
              </div>
            ))}
          </div>
        )}
        {flood && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Flood Risk</p>
            <div className="text-[11px]">
              {flood.flood_risk && <span>Risk: <b>{flood.flood_risk}</b></span>}
              {flood.surface_water && <span className="ml-3">Surface water: <b>{flood.surface_water}</b></span>}
            </div>
          </div>
        )}
      </DataSection>

      <DataSection title="Property Intelligence" icon={Building2} color="text-slate-600">
        {councilTax && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Council Tax ({councilTax.council})</p>
            <div className="text-[11px]">
              {councilTax.council_rating && <span>Rating: <b>{councilTax.council_rating}</b></span>}
              {councilTax.council_tax?.band_d && <span className="ml-2">Band D: <b>£{councilTax.council_tax.band_d}</b></span>}
            </div>
          </div>
        )}
        {floorAreas && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">Floor Areas</p>
            <div className="text-[11px]">
              {floorAreas.average && <span>Average: <b>{floorAreas.average} sqft</b></span>}
              {floorAreas.points_analysed && <span className="ml-2 text-gray-400">({floorAreas.points_analysed} properties)</span>}
            </div>
          </div>
        )}
        {uprns?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px] flex items-center gap-1"><Building2 className="w-2.5 h-2.5 text-slate-600" /> Registered Addresses (UPRNs)</p>
            <p className="text-[11px]">Total: <b>{uprns.length}</b> registered properties</p>
            <div className="flex flex-wrap gap-1">
              {sortedClasses.slice(0, 6).map(([cls, count], i) => (
                <Badge key={i} variant="outline" className="text-[9px] px-1.5 py-0">{cls}: {count}</Badge>
              ))}
            </div>
          </div>
        )}
        {energyEff?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
            <p className="font-medium text-[10px] flex items-center gap-1"><Zap className="w-2.5 h-2.5 text-amber-500" /> Energy Efficiency</p>
            <div className="flex items-center gap-3 text-[11px]">
              <span>Avg Score: <b>{eeAvgScore}</b></span>
              <span>Inspections: <b>{energyEff.length}</b></span>
            </div>
            <div className="flex gap-1">
              {Object.entries(eeRatings).sort((a, b) => a[0].localeCompare(b[0])).map(([rating, count]) => (
                <Badge key={rating} variant="outline" className={`text-[9px] px-1.5 py-0 ${epcColor(rating)}`}>{rating}: {count}</Badge>
              ))}
            </div>
          </div>
        )}
        {hmoRegister?.hmos?.length > 0 && (
          <div className="text-xs border rounded p-2 bg-gray-50 space-y-0.5">
            <p className="font-medium text-[10px]">HMO Register</p>
            {hmoRegister.hmos.slice(0, 3).map((h: any, i: number) => (
              <p key={i} className="text-[11px] truncate">{h.address} <span className="text-gray-400">(exp: {h.licence_expiry})</span></p>
            ))}
          </div>
        )}
        {(() => {
          const leaseholds = data["leaseholds"]?.data || [];
          const allPanelTitles = [
            ...(freeholds || []).map((f: any) => ({ ...f, _tenure: "Freehold" })),
            ...leaseholds.map((f: any) => ({ ...f, _tenure: "Leasehold" })),
          ];
          if (allPanelTitles.length === 0) return null;
          return (
            <div className="text-xs border rounded p-2 bg-gray-50 space-y-1">
              <p className="font-medium text-[10px]">Ownership / Titles ({(freeholds?.length || 0)} freehold, {leaseholds.length} leasehold)</p>
              {allPanelTitles.slice(0, 6).map((f: any, i: number) => (
                <div key={i} className="border-b border-gray-100 pb-1 last:border-0 last:pb-0">
                  <div className="flex items-center gap-1">
                    <span className={`text-[7px] font-bold px-0.5 rounded ${f._tenure === "Freehold" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{f._tenure === "Freehold" ? "F" : "L"}</span>
                    <p className="text-[11px] truncate font-medium">{f.proprietor_name_1 || f.proprietor || "Unknown owner"}</p>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate ml-3">{f.address || f.property_address || "N/A"}</p>
                  <div className="flex gap-2 text-[9px] text-gray-400 ml-3">
                    {f.title_number && <span>Title: {f.title_number}</span>}
                    {f.date_proprietor_added && <span>Since: {f.date_proprietor_added}</span>}
                  </div>
                </div>
              ))}
              {allPanelTitles.length > 6 && <p className="text-[9px] text-gray-400">+{allPanelTitles.length - 6} more</p>}
            </div>
          );
        })()}
      </DataSection>
    </>
  );
}

function epcColor(rating: string): string {
  const r = (rating || "").toUpperCase();
  if (r === "A" || r === "B") return "border-green-500 text-green-700";
  if (r === "C" || r === "D") return "border-yellow-500 text-yellow-700";
  if (r === "E" || r === "F") return "border-orange-500 text-orange-700";
  if (r === "G") return "border-red-500 text-red-700";
  return "";
}

function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0], xi = polygon[i][1];
    const yj = polygon[j][0], xj = polygon[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function getLabelFromTags(tags: Record<string, string>): { label: string; houseNum: string; isVacant: boolean } {
  let label = tags.name || tags["brand"] || "";
  if (!label && tags.shop) label = tags.shop === "vacant" ? "VAC" : tags.shop;
  if (!label && tags.amenity) label = tags.amenity;
  if (!label && tags.office) label = tags.office;
  if (!label && tags.craft) label = tags.craft;
  if (!label && tags.leisure) label = tags.leisure;
  if (!label && tags.tourism) label = tags.tourism;
  if (!label && tags.healthcare) label = tags.healthcare;
  if (!label && tags.club) label = tags.club;
  const houseNum = tags["addr:housenumber"] || "";
  const isVacant = !label || label.toUpperCase() === "VACANT" || label.toUpperCase() === "VAC" ||
    tags.shop === "vacant" || tags.disused === "yes" || tags["disused:shop"] !== undefined;
  if (isVacant && !label) label = "";
  return { label, houseNum, isVacant };
}

function formatLabel(label: string): string {
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c: string) => c.toUpperCase())
    .trim();
}

function polygonAreaSqM(latLngs: [number, number][]): number {
  let area = 0;
  for (let i = 0, j = latLngs.length - 1; i < latLngs.length; j = i++) {
    area += (latLngs[j][1] + latLngs[i][1]) * (latLngs[j][0] - latLngs[i][0]);
  }
  const avgLat = latLngs.reduce((s, c) => s + c[0], 0) / latLngs.length;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(avgLat * Math.PI / 180);
  return Math.abs(area / 2) * mPerDegLat * mPerDegLng;
}

function polygonBBoxPixels(latLngs: [number, number][], map: L.Map): { w: number; h: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const ll of latLngs) {
    const pt = map.latLngToContainerPoint([ll[0], ll[1]]);
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

// Oriented bounding box — finds the polygon's principal axis (longest edge)
// and returns the dims of the tightest rectangle aligned to it, plus the
// rotation (deg) that should be applied to text so it runs along that axis.
// This is what makes narrow-but-rotated rectangles (common on subdivided
// OS NGD shopfronts) show readable labels like Goad does instead of
// horizontal text overflowing the polygon.
function polygonOBBPixels(latLngs: [number, number][], map: L.Map): { w: number; h: number; rotationDeg: number } {
  if (latLngs.length < 3) {
    const ab = polygonBBoxPixels(latLngs, map);
    return { w: ab.w, h: ab.h, rotationDeg: 0 };
  }
  const points = latLngs.map(ll => {
    const p = map.latLngToContainerPoint([ll[0], ll[1]]);
    return { x: p.x, y: p.y };
  });

  // Candidate axes: use each edge's direction as an axis and measure the
  // bounding box aligned to it. Pick the one with smallest area (classic
  // rotating-calipers OBB, simplified — edge-aligned is optimal for most
  // building footprints).
  let best = { w: Infinity, h: Infinity, area: Infinity, angle: 0 };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const angle = Math.atan2(dy, dx);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of points) {
      const u = p.x * cos - p.y * sin;
      const v = p.x * sin + p.y * cos;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < best.area) best = { w, h, area, angle };
  }

  // Ensure width is the longer side (text runs along width).
  let w = best.w, h = best.h;
  let rotationDeg = (best.angle * 180) / Math.PI;
  if (h > w) { const t = w; w = h; h = t; rotationDeg += 90; }
  // Keep text right-side-up (avoid upside-down labels).
  rotationDeg = ((rotationDeg + 180) % 360) - 180;   // wrap to [-180, 180)
  if (rotationDeg > 90) rotationDeg -= 180;
  if (rotationDeg < -90) rotationDeg += 180;

  return { w, h, rotationDeg };
}

function fitTextToBuilding(label: string, houseNum: string, isVacant: boolean, pixelW: number, pixelH: number): { text: string; fontSize: number } | null {
  const charWidthAtSize = (size: number) => size * 0.55;
  const lineHeight = (size: number) => size * 1.3;

  let displayText = "";
  if (isVacant && !label) {
    displayText = houseNum || "VAC";
  } else if (label) {
    const cleanLabel = formatLabel(label);
    displayText = houseNum ? `${houseNum} ${cleanLabel}` : cleanLabel;
  } else if (houseNum) {
    displayText = houseNum;
  }

  if (!displayText) return null;

  displayText = displayText.toUpperCase();

  const padW = pixelW * 0.8;
  const padH = pixelH * 0.75;

  if (padW < 26 || padH < 16) return null;

  const tryFit = (size: number, text: string): string | null => {
    const cw = charWidthAtSize(size);
    const lh = lineHeight(size);
    const maxCharsPerLine = Math.floor(padW / cw);
    if (maxCharsPerLine < 3) return null;

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      // Never truncate mid-word — that's the scruffy Goad-destroying
      // behaviour. If a single word doesn't fit on a line, fail the
      // fit and let the caller try a smaller font size (or drop the
      // label entirely).
      if (word.length > maxCharsPerLine) return null;
      if (currentLine && (currentLine.length + 1 + word.length) > maxCharsPerLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }
    if (currentLine) lines.push(currentLine);

    const maxLines = Math.floor(padH / lh);
    if (maxLines < 1 || lines.length > maxLines) return null;

    return lines.join("\n");
  };

  for (const size of [11, 10, 9, 8, 7]) {
    const result = tryFit(size, displayText);
    if (result) {
      return { text: result, fontSize: size };
    }
  }

  // If the full tenant name + number won't fit cleanly at any size, try just
  // the house number on its own (still cleaner than a truncated name that
  // ends mid-word). If even that doesn't fit, drop the label entirely —
  // that's how Goad plans look: empty box rather than scruffy truncation.
  if (houseNum && houseNum !== displayText) {
    for (const size of [11, 10, 9, 8, 7]) {
      const result = tryFit(size, houseNum.toUpperCase());
      if (result) {
        return { text: result, fontSize: size };
      }
    }
  }

  return null;
}

// Fetch OS NGD building polygons via our server proxy. NGD gives subdivided
// MasterMap-equivalent footprints — individual shop units inside shopping
// centres, separate parts of office blocks, etc. — which is what makes a
// Goad-style plan possible. Returns [] if the endpoint fails or the tier
// doesn't cover it, in which case the caller falls back to OSM.
async function fetchNgdBuildings(bounds: L.LatLngBounds): Promise<any[]> {
  const bboxParam = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  try {
    const resp = await fetch(`/api/os/mastermap-buildings?bbox=${bboxParam}`, {
      credentials: "include",
      headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
    });
    if (!resp.ok) return [];
    const body = await resp.json();
    const features: any[] = body?.data?.features || [];
    const out: any[] = [];
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      // Normalise Polygon and MultiPolygon to arrays of rings
      const polys: number[][][] = g.type === "MultiPolygon" ? g.coordinates.flat(1) : g.type === "Polygon" ? g.coordinates : [];
      for (const ring of polys) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        const latLngs = ring.map((c: number[]) => [c[1], c[0]] as [number, number]);
        const areaSqM = polygonAreaSqM(latLngs);
        // NGD 'Sites' will be huge polygons — filter those out of the per-unit
        // building layer so they don't blanket the map.
        if (areaSqM > 20000) continue;
        out.push({
          latLngs,
          label: "",
          houseNum: "",
          isVacant: false,
          areaSqM,
          isUnit: areaSqM < 500,
          _toid: f.properties?.toid || null,
          _osid: f.properties?.osid || null,
          _source: "ngd",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchBuildings(map: L.Map): Promise<any[]> {
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  if (zoom < 16) return [];

  // Prefer NGD polygons (subdivided, Goad-style). Fall back to OSM if NGD
  // returns nothing. Overpass still runs in parallel to harvest POI labels.
  const ngdPromise = fetchNgdBuildings(bounds);

  const s = bounds.getSouth();
  const w = bounds.getWest();
  const n = bounds.getNorth();
  const e = bounds.getEast();

  const query = `[out:json][timeout:15];
(
  way["building"](${s},${w},${n},${e});
  way["shop"](${s},${w},${n},${e});
  way["amenity"~"restaurant|cafe|bar|pub|fast_food|bank|pharmacy|clinic|dentist|doctors"](${s},${w},${n},${e});
  way["craft"](${s},${w},${n},${e});
  way["office"](${s},${w},${n},${e});
  node["shop"](${s},${w},${n},${e});
  node["amenity"](${s},${w},${n},${e});
  node["office"](${s},${w},${n},${e});
  node["craft"](${s},${w},${n},${e});
  node["leisure"](${s},${w},${n},${e});
  node["tourism"](${s},${w},${n},${e});
  node["healthcare"](${s},${w},${n},${e});
  node["addr:housenumber"](${s},${w},${n},${e});
);
out body;>;out skel qt;`;

  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();

    const geometryNodes = new Map<number, [number, number]>();
    const poiNodes: Array<{ lat: number; lng: number; tags: Record<string, string> }> = [];

    for (const el of data.elements) {
      if (el.type === "node") {
        if (el.lat !== undefined && el.lon !== undefined) {
          geometryNodes.set(el.id, [el.lon, el.lat]);
          if (el.tags && (el.tags.shop || el.tags.amenity || el.tags.office || el.tags.name ||
              el.tags.craft || el.tags.leisure || el.tags.tourism || el.tags.healthcare ||
              el.tags["addr:housenumber"])) {
            poiNodes.push({ lat: el.lat, lng: el.lon, tags: el.tags });
          }
        }
      }
    }

    const buildingWayIds = new Set<number>();
    const buildings: any[] = [];

    for (const el of data.elements) {
      if (el.type === "way" && el.tags?.building) {
        buildingWayIds.add(el.id);
      }
    }

    for (const el of data.elements) {
      if (el.type !== "way") continue;
      const tags = el.tags || {};

      const isBuilding = tags.building;
      const isShopWay = !isBuilding && (tags.shop || tags.amenity || tags.craft || tags.office);

      if (!isBuilding && !isShopWay) continue;

      const coords = (el.nodes || []).map((nid: number) => geometryNodes.get(nid)).filter(Boolean);
      if (coords.length >= 3) {
        const latLngs = coords.map((c: [number, number]) => [c[1], c[0]] as [number, number]);

        let { label, houseNum, isVacant } = getLabelFromTags(tags);

        if (isBuilding && !label && !houseNum) {
          for (const poi of poiNodes) {
            if (pointInPolygon(poi.lat, poi.lng, latLngs)) {
              const poiInfo = getLabelFromTags(poi.tags);
              if (poiInfo.label || poiInfo.houseNum) {
                label = poiInfo.label;
                houseNum = houseNum || poiInfo.houseNum;
                isVacant = poiInfo.isVacant && !poiInfo.label;
                break;
              }
            }
          }
        }

        if (!houseNum) {
          for (const poi of poiNodes) {
            if (poi.tags["addr:housenumber"] && pointInPolygon(poi.lat, poi.lng, latLngs)) {
              houseNum = poi.tags["addr:housenumber"];
              break;
            }
          }
        }

        const areaSqM = polygonAreaSqM(latLngs);

        buildings.push({
          latLngs,
          label,
          houseNum,
          isVacant,
          areaSqM,
          isUnit: isShopWay && !isBuilding,
        });
      }
    }

    // Wait for NGD (fired in parallel at the top of the function). If NGD
    // returned polygons, use those instead of OSM — NGD is subdivided and
    // authoritative — but keep OSM's POIs to hydrate labels for each polygon.
    const ngd = await ngdPromise;
    if (ngd.length > 0) {
      for (const nb of ngd) {
        // Label / house-number fallback from OSM POIs inside this polygon.
        let label = "";
        let houseNum = "";
        let isVacant = false;
        for (const poi of poiNodes) {
          if (pointInPolygon(poi.lat, poi.lng, nb.latLngs)) {
            const info = getLabelFromTags(poi.tags);
            if (info.label || info.houseNum) {
              label = label || info.label;
              houseNum = houseNum || info.houseNum;
              isVacant = info.isVacant && !info.label;
              if (label && houseNum) break;
            }
          }
        }
        nb.label = label;
        nb.houseNum = houseNum;
        nb.isVacant = isVacant;
      }
      return ngd;
    }

    return buildings;
  } catch (err) {
    console.error("[edozo] Overpass error:", err);
    // If Overpass failed, still try to return whatever NGD gave us
    try { return await ngdPromise; } catch { return []; }
  }
}

export default function EdozoMap({ initialSearch, onSearchConsumed, onResolveProperty }: { initialSearch?: { address: string; postcode: string | null } | null; onSearchConsumed?: () => void; onResolveProperty?: (p: { id: string; name: string; postcode: string | null }) => void } = {}) {
  const { toast } = useToast();
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // Google Places autocomplete input rendered as an overlay on the map.
  // The autocomplete instance + the marker we drop on the selected place
  // both live in refs so we can clear them imperatively without re-rendering
  // the entire map.
  const placesSearchInputRef = useRef<HTMLInputElement>(null);
  const placesAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const placesMarkerRef = useRef<L.Marker | null>(null);
  const [placesSearchValue, setPlacesSearchValue] = useState("");
  const buildingLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const lastBoundsRef = useRef("");
  const loadCounterRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [postcode, setSelectedPostcode] = useState("");
  const [propertyData, setPropertyData] = useState<PropertyData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  // Starts blank — the PDF export reverse-geocodes the current map
  // centre at export time so the header reflects what the user is
  // actually looking at, not a hardcoded default.
  const [currentArea, setCurrentArea] = useState("");
  const [activeTool, setActiveTool] = useState<string>("select");
  const [saveToOrg, setSaveToOrg] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const suppressSearchRef = useRef(false);

  // Search history & CRM layers
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const [crmProperties, setCrmProperties] = useState<any[]>([]);
  // Landing-on-map defaults: every useful layer on so the operator
  // sees everything BGP knows about an area at a glance. Street View
  // stays off because turning it on hijacks the click handler.
  const [showSearchHistory, setShowSearchHistory] = useState(true);
  const [showCrmLayer, setShowCrmLayer] = useState(true);
  // Investment comps were bulk-loaded into crm_properties (~553 rows) and
  // clutter "CRM Properties". Split them onto their own default-off layer so
  // CRM Properties only shows properties BGP is directly involved with.
  const [showInvestmentComps, setShowInvestmentComps] = useState(false);
  const searchMarkersRef = useRef<L.LayerGroup | null>(null);
  const crmMarkersRef = useRef<L.LayerGroup | null>(null);
  const investmentCompsMarkersRef = useRef<L.LayerGroup | null>(null);

  // A crm_property row that is really an investment comparable, not one of our
  // own properties. Excluded from the CRM Properties layer/views.
  const isInvestmentComp = (p: any) => p?.status === "Investment Comp" || p?.groupName === "Investment Comps";

  // OS Data layers
  const [showOSBuildings, setShowOSBuildings] = useState(true);
  const [showOSUprns, setShowOSUprns] = useState(false);
  const [showOSSites, setShowOSSites] = useState(true);
  const osBuildingLayerRef = useRef<L.LayerGroup | null>(null);
  const osUprnLayerRef = useRef<L.LayerGroup | null>(null);
  const osSiteLayerRef = useRef<L.LayerGroup | null>(null);
  const osLastBboxRef = useRef<{ buildings: string; uprns: string; sites: string }>({ buildings: "", uprns: "", sites: "" });
  const osDebounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [mapZoom, setMapZoom] = useState(17);

  // CRM data layers — Deals, Comps, Lease Events. All default-on so
  // landing on the map shows every signal at once.
  const [showDeals, setShowDeals] = useState(true);
  const [showComps, setShowComps] = useState(true);
  const [showLeaseEvents, setShowLeaseEvents] = useState(true);
  const [showPathway, setShowPathway] = useState(true);
  const pathwayMarkersRef = useRef<L.LayerGroup | null>(null);
  // Available Properties layer — market listings (external_properties: PIPnet /
  // emailed / WhatsApp flyers) + BGP's own available units, shown together.
  const [showAvailable, setShowAvailable] = useState(true);
  const [availableProps, setAvailableProps] = useState<any[]>([]);
  const availableMarkersRef = useRef<L.LayerGroup | null>(null);
  // ── Annotations layer ───────────────────────────────────────────────────
  // User-drawn pins + text labels saved to /api/map-annotations. When
  // annotateMode is "pin" or "label" the next map click drops one.
  // Postcode highlight is the orange/red rectangle for an outcode or
  // unit postcode fetched from /api/postcode-boundary/:postcode.
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [annotations, setAnnotations] = useState<any[]>([]);
  const annotationsLayerRef = useRef<L.LayerGroup | null>(null);
  type AnnotMode = null | "pin" | "label" | "polygon" | "drive_time";
  const [annotateMode, setAnnotateMode] = useState<AnnotMode>(null);
  const [annotateColor, setAnnotateColor] = useState<string>("#ef4444");
  const annotateModeRef = useRef<{ mode: AnnotMode; color: string }>({ mode: null, color: "#ef4444" });
  useEffect(() => { annotateModeRef.current = { mode: annotateMode, color: annotateColor }; }, [annotateMode, annotateColor]);
  // In-progress polygon vertices + drive-time waypoint. Cleared when
  // mode changes or the user double-clicks to finalise.
  const polygonPointsRef = useRef<L.LatLng[]>([]);
  const polygonGhostRef = useRef<L.Polyline | null>(null);
  const driveOriginRef = useRef<L.LatLng | null>(null);
  const driveOriginMarkerRef = useRef<L.CircleMarker | null>(null);

  const [postcodeQuery, setPostcodeQuery] = useState("");
  const [postcodeBoundary, setPostcodeBoundary] = useState<any>(null);
  const postcodeLayerRef = useRef<L.LayerGroup | null>(null);

  // HMLR title polygons overlay — fetched per viewport.
  const [showHmlrTitles, setShowHmlrTitles] = useState(false);
  const [hmlrPolygons, setHmlrPolygons] = useState<any>(null);
  const hmlrLayerRef = useRef<L.LayerGroup | null>(null);

  // ── Named layers ───────────────────────────────────────────────────────
  // Group annotations into named layers ("Brent Cross deck", "Old Street
  // catchment") so they can be toggled, shared, deleted as one unit.
  interface MapLayer { id: string; name: string; color: string | null; ownerId: string | null; sharedWithTeam: boolean; annotationCount: number; mine: boolean; }
  const [mapLayers, setMapLayers] = useState<MapLayer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string>>(new Set());
  const [newLayerName, setNewLayerName] = useState("");

  // ── Street View on-click ───────────────────────────────────────────────────
  // When toggled on, clicking the map opens an embedded Google Street View
  // panorama at that lat/lng in a popup. Reuses the GOOGLE_API_KEY already
  // wired through /api/config/maps-key.
  const [showStreetView, setShowStreetView] = useState(false);
  const [googleMapsKey, setGoogleMapsKey] = useState<string | null>(null);
  const streetViewClickRef = useRef<((e: L.LeafletMouseEvent) => void) | null>(null);

  // ── Tenancy Plans layer ──────────────────────────────────────────────────
  // Phase 1 of the 'upload any plan' flow — fetches geo-tagged tenancy
  // plans (GeoJSON) for the current viewport and renders them as a layer.
  // Each polygon is later clickable; for now they just sit on the map
  // as an outline pass.
  const [showTenancyPlans, setShowTenancyPlans] = useState(true);
  const [tenancyPlanCount, setTenancyPlanCount] = useState(0);
  const tenancyPlansLayerRef = useRef<L.LayerGroup | null>(null);
  // ── Retail Context layer (real Experian Goad polygons) ────────────────────
  // When toggled on, loads the licensed Goad GeoJSON layers for the West End
  // (centre 9033MM, ~10,600 unit footprints across LG/GF/F1/F2) and renders
  // them as colour-coded polygons. The previous synthesised version (CRM +
  // VOA + Places mash-up) is retained server-side for the Goad-plan PDF
  // export but is no longer the source of truth for the live map layer.
  // Default-on: the Goad layer is the single most useful overlay so
  // it loads on first landing. The ~9.6MB GeoJSON fetch is cached for
  // the rest of the session.
  const [showRetailContext, setShowRetailContext] = useState(true);
  // Mirror state into a ref so closures captured in the map-init effect
  // (renderBuildings, fetchOSData, …) can read the live value without
  // being recreated on every toggle.
  const showRetailContextRef = useRef(true);
  useEffect(() => { showRetailContextRef.current = showRetailContext; }, [showRetailContext]);
  const [goadFeatures, setGoadFeatures] = useState<any[]>([]);
  const [retailFetching, setRetailFetching] = useState(false);
  const [excludedRetailCategories, setExcludedRetailCategories] = useState<Set<string>>(new Set());
  const retailMarkersRef = useRef<L.LayerGroup | null>(null);
  const retailLabelLayerRef = useRef<L.LayerGroup | null>(null);
  // Goad polygon → combined side panel. Holds the clicked feature's
  // properties plus any joined context fetched via /api/goad/polygon-context.
  const [goadPanelUnit, setGoadPanelUnit] = useState<any | null>(null);
  const [goadPanelContext, setGoadPanelContext] = useState<{ crmProperties: any[]; deals: any[]; parentCompany: any | null; parentCompanyCandidates: any[]; landRegistry: any | null; rates: any[]; planningApplications: any[]; pathwayRun: any | null; tenantCompany: any | null; tenantCompanyCandidates: any[]; tenantPlace: { name: string; website: string | null; phone: string | null; placeId: string; address: string | null; businessStatus: string | null } | null; diagnostics?: { voaAvailable: boolean; propertyDataKeyAvailable: boolean; landRegistryRan: boolean; landRegistryError: string | null; postcodeUsed?: string | null; postcodeRecoveredFromGeocode?: boolean } } | null>(null);
  // Tenant-resolver state for the polygon drawer. Separate from the
  // polygon context so a click → verify → create lifecycle doesn't
  // re-render the entire panel.
  const [tenantVerifyState, setTenantVerifyState] = useState<{
    loading: boolean;
    result: { scraped: { entityName: string | null; chNumber: string | null; sourceUrl: string | null }; chProfile: any | null; verifyError?: string } | null;
    error: string | null;
  }>({ loading: false, result: null, error: null });
  const [tenantCreateState, setTenantCreateState] = useState<{ loading: boolean; companyId: string | null; error: string | null }>({ loading: false, companyId: null, error: null });
  const [goadPanelStartingPathway, setGoadPanelStartingPathway] = useState(false);
  const [goadPanelLoading, setGoadPanelLoading] = useState(false);
  const dealsLayerRef = useRef<any>(null);
  const compsLayerRef = useRef<any>(null);
  const leaseEventsLayerRef = useRef<any>(null);
  const [mapPins, setMapPins] = useState<{ deals: any[]; comps: any[]; leaseEvents: any[]; pathway?: any[] } | null>(null);

  // Land Registry title boundaries — always-on red-line layer
  const titleBoundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const centreTenantLayerRef = useRef<L.LayerGroup | null>(null);
  const titleBoundaryBboxRef = useRef<string>("");
  const baseLayerRef = useRef<{ map: L.LayerGroup; sat: L.LayerGroup } | null>(null);
  const [baseLayer, setBaseLayer] = useState<"map" | "sat">("map");
  const [exportingPlan, setExportingPlan] = useState(false);

  // Swap base layers atomically when the toggle changes.
  // Runs after the map init effect has populated baseLayerRef.
  useEffect(() => {
    const map = mapRef.current;
    const layers = baseLayerRef.current;
    if (!map || !layers) return;
    const { map: mapLG, sat: satLG } = layers;
    if (baseLayer === "map") {
      if (map.hasLayer(satLG)) map.removeLayer(satLG);
      if (!map.hasLayer(mapLG)) mapLG.addTo(map);
    } else {
      if (map.hasLayer(mapLG)) map.removeLayer(mapLG);
      if (!map.hasLayer(satLG)) satLG.addTo(map);
    }
  }, [baseLayer]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [51.5014, -0.1419],
      zoom: 17,
      zoomControl: false,
    });

    const buildingPane = map.createPane("buildingPane");
    buildingPane.style.zIndex = "450";

    const labelPane = map.createPane("labelPane");
    labelPane.style.zIndex = "500";

    // Base layers: a clean light map (CARTO) and a satellite view (Esri
    // World Imagery — free for reasonable use). Each is bundled with its
    // own labels overlay on labelPane so the labels stay above buildings,
    // UPRN dots, and site outlines in the other panes.
    const mapTiles = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; OSM &copy; CARTO',
      subdomains: "abcd",
      maxZoom: 20,
    });
    const mapLabels = L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20,
      pane: "labelPane",
    });
    const satTiles = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri",
      maxZoom: 20,
    });
    // For satellite we overlay roads (World_Transportation) AND place names
    // (World_Boundaries_and_Places) — together they give street names AND
    // area / neighbourhood labels so you're not staring at unlabelled aerial.
    const satRoads = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 20,
      pane: "labelPane",
    });
    const satPlaces = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 20,
      pane: "labelPane",
    });

    const mapBase = L.layerGroup([mapTiles, mapLabels]);
    const satBase = L.layerGroup([satTiles, satRoads, satPlaces]);
    mapBase.addTo(map);
    baseLayerRef.current = { map: mapBase, sat: satBase };

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 100 }).addTo(map);

    buildingLayerRef.current = L.layerGroup([], { pane: "buildingPane" }).addTo(map);

    // OS Data layer groups
    const osPane = map.createPane("osPane");
    osPane.style.zIndex = "440";
    const osUprnPane = map.createPane("osUprnPane");
    osUprnPane.style.zIndex = "445";
    const osSitePane = map.createPane("osSitePane");
    osSitePane.style.zIndex = "443";
    osBuildingLayerRef.current = L.layerGroup([], { pane: "osPane" }).addTo(map);
    osUprnLayerRef.current = L.layerGroup([], { pane: "osUprnPane" }).addTo(map);
    osSiteLayerRef.current = L.layerGroup([], { pane: "osSitePane" }).addTo(map);

    // Land Registry title boundaries — always-on red-line layer. Sits above
    // buildings so proprietor polygons are the most visible feature.
    const titlePane = map.createPane("titlePane");
    titlePane.style.zIndex = "455";
    titleBoundaryLayerRef.current = L.layerGroup([], { pane: "titlePane" }).addTo(map);
    centreTenantLayerRef.current = L.layerGroup().addTo(map);

    // CRM data layer groups — clustered (Deals / Comps / Lease Events)
    const crmPane = map.createPane("crmPane");
    crmPane.style.zIndex = "460";

    // Goad polygons need to sit above the auto-classified buildings
    // (zIndex 450) AND the CRM markers (460) so clicking a Goad unit
    // opens the new polygon-context side panel rather than firing
    // loadPropertyData() via an underlying CRM/building click.
    const goadPane = map.createPane("goadPane");
    goadPane.style.zIndex = "475";
    const goadLabelPane = map.createPane("goadLabelPane");
    goadLabelPane.style.zIndex = "476";
    const clusterOpts = { maxClusterRadius: 40, disableClusteringAtZoom: 17 };
    dealsLayerRef.current = (L as any).markerClusterGroup(clusterOpts);
    compsLayerRef.current = (L as any).markerClusterGroup(clusterOpts);
    leaseEventsLayerRef.current = (L as any).markerClusterGroup(clusterOpts);

    // Track zoom for OS layer visibility
    map.on("zoomend", () => {
      setMapZoom(map.getZoom());
    });

    const renderBuildings = (_buildings: any[]) => {
      // Retired. The auto-classified pale-yellow building layer is
      // superseded by the real Experian Goad polygons on the Retail
      // Context toggle. Stub kept so existing callers don't need
      // surgery — it just clears the layer and exits.
      if (buildingLayerRef.current) buildingLayerRef.current.clearLayers();
    };

    const loadBuildings = async () => {
      const bounds = map.getBounds();
      const boundsKey = `${bounds.getSouth().toFixed(3)},${bounds.getWest().toFixed(3)},${bounds.getNorth().toFixed(3)},${bounds.getEast().toFixed(3)}`;
      if (boundsKey === lastBoundsRef.current) return;
      lastBoundsRef.current = boundsKey;

      loadCounterRef.current += 1;
      const thisLoad = loadCounterRef.current;

      const bboxParam = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

      // Prefer the occupier plan (Goad/Edozo) — names live on the polygons, so
      // no OSM/NGD label-guessing is needed where we have coverage. Only at
      // street zoom, matching the label-render gate.
      if (map.getZoom() >= 17) {
        try {
          const opResp = await fetch(`/api/map/occupier-plan?bbox=${bboxParam}`, {
            credentials: "include",
            headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
          });
          if (opResp.ok) {
            const fc = await opResp.json();
            if (loadCounterRef.current !== thisLoad) return;
            const feats: any[] = fc?.features || [];
            if (feats.length > 0) {
              const geomToRings = (g: any): number[][][] => {
                if (!g) return [];
                if (g.type === "Polygon") return [g.coordinates[0]];
                if (g.type === "MultiPolygon") return g.coordinates.map((p: number[][][]) => p[0]);
                return [];
              };
              const occBuildings: any[] = [];
              for (const f of feats) {
                for (const ring of geomToRings(f.geometry)) {
                  if (!Array.isArray(ring) || ring.length < 3) continue;
                  const latLngs = ring.map((c: number[]) => [c[1], c[0]] as [number, number]);
                  const p = f.properties || {};
                  occBuildings.push({
                    latLngs,
                    label: p.name || "",
                    houseNum: p.streetNum || "",
                    isVacant: p.classification === "vacant",
                    areaSqM: polygonAreaSqM(latLngs),
                    isUnit: true,
                    _source: "occupier",
                    _category: p.category || null,
                  });
                }
              }
              renderBuildings(occBuildings);
              return;
            }
          }
        } catch {
          // fall through to the OSM/NGD path below
        }
      }

      // Fetch buildings (OSM) and label overrides (CRM > Comps > Google) in parallel
      const labelsPromise = fetch(`/api/map/labels?bbox=${bboxParam}`, {
        credentials: "include",
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

      // Known London shopping centres — when the viewport overlaps one of
      // these, fetch its interior tenant directory via Claude web search
      // (cached 30 days server-side). Tenants merge into the labels pipeline
      // below as another override source — ranked below CRM/Comps but
      // above generic Google Places.
      const KNOWN_CENTRES = [
        { name: "Cardinal Place, London", lat: 51.4975, lng: -0.1370, radiusKm: 0.2 },
        { name: "Nova Victoria, London", lat: 51.4965, lng: -0.1396, radiusKm: 0.2 },
        { name: "Westfield London, Shepherds Bush", lat: 51.5074, lng: -0.2216, radiusKm: 0.4 },
        { name: "Westfield Stratford City", lat: 51.5437, lng: -0.0063, radiusKm: 0.4 },
        { name: "Brent Cross Shopping Centre", lat: 51.5768, lng: -0.2244, radiusKm: 0.4 },
        { name: "Canary Wharf Shopping", lat: 51.5055, lng: -0.0206, radiusKm: 0.3 },
        { name: "One New Change, London", lat: 51.5141, lng: -0.0961, radiusKm: 0.15 },
      ];
      const mapCentre = bounds.getCenter();
      const centreHaversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
        const R = 6371; const φ1 = lat1*Math.PI/180; const φ2 = lat2*Math.PI/180;
        const Δφ = (lat2-lat1)*Math.PI/180; const Δλ = (lng2-lng1)*Math.PI/180;
        const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
        return 2*R*Math.asin(Math.sqrt(a));
      };
      const centresInView = KNOWN_CENTRES.filter(c => centreHaversine(mapCentre.lat, mapCentre.lng, c.lat, c.lng) < c.radiusKm + 0.3);
      const centreDirectoriesPromise = Promise.all(centresInView.map(c =>
        fetch(`/api/map/centre-directory?name=${encodeURIComponent(c.name)}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
        }).then(r => r.ok ? r.json() : null).catch(() => null).then(d => d ? { ...d, _centreLat: c.lat, _centreLng: c.lng, _radiusKm: c.radiusKm } : null)
      )).then(rs => rs.filter(Boolean));

      // Auto-classified building layer is retired — superseded by real
      // Goad polygons on the Retail Context layer. We still keep the
      // sibling fetches (centre directories, search-label cache) because
      // the rest of this effect uses them.
      const [labelsResp, centreDirectories] = await Promise.all([
        labelsPromise,
        centreDirectoriesPromise,
      ]);
      const buildings: any[] = []; // retired — see renderBuildings() below
      if (loadCounterRef.current !== thisLoad) return;

      // Flatten centre directory tenants into label points. We don't know
      // each tenant's exact position inside the centre, so we space them
      // evenly around the centre point — the label-snap finds the nearest
      // polygon and adopts the tenant name. Good enough to put "Boots",
      // "Pret", "Costa" etc. into Cardinal Place's subdivided NGD parts.
      const centreLabels: Array<{ lat: number; lng: number; label: string }> = [];
      // Also draw each tenant as an independent on-map text marker so
      // centres that NGD doesn't subdivide (Cardinal Place shows as one
      // big polygon) still get every tenant's name rendered. These
      // markers live on centreTenantLayerRef and are refreshed on every
      // moveend.
      if (centreTenantLayerRef.current && mapRef.current) {
        centreTenantLayerRef.current.clearLayers();
      }
      for (const c of (centreDirectories || []) as any[]) {
        const tenants: any[] = Array.isArray(c?.tenants) ? c.tenants : [];
        if (!tenants.length) continue;
        // Spread tenants in a ring inside the centre radius
        const R = c._radiusKm * 0.6;
        tenants.forEach((t, i) => {
          if (!t?.name) return;
          const angle = (2 * Math.PI * i) / Math.max(tenants.length, 1);
          const dLat = (R / 111) * Math.cos(angle);
          const dLng = (R / (111 * Math.cos(c._centreLat * Math.PI / 180))) * Math.sin(angle);
          const labelText = t.unit ? `${t.unit} ${t.name}` : t.name;
          centreLabels.push({ lat: c._centreLat + dLat, lng: c._centreLng + dLng, label: labelText });
          // Also drop an independent label marker at this ring position
          // so the tenant name shows even when NGD gives us one big
          // polygon for the whole centre.
          if (centreTenantLayerRef.current && mapRef.current && mapRef.current.getZoom() >= 17) {
            const icon = L.divIcon({
              html: `<div class="centre-tenant-label">${labelText.replace(/</g, "&lt;")}</div>`,
              className: "centre-tenant-icon",
              iconSize: [80, 14],
              iconAnchor: [40, 7],
            });
            L.marker([c._centreLat + dLat, c._centreLng + dLng], { icon, interactive: false }).addTo(centreTenantLayerRef.current);
          }
        });
      }

      // Merge labels into buildings — CRM beats Comp beats Google. For each
      // building, snap to the nearest label point within ~25m and override.
      const overrideLabel = (b: any) => {
        if (!labelsResp) return b;
        const center = b.center || (b.latLngs?.[0] ? { lat: b.latLngs[0][0], lng: b.latLngs[0][1] } : null);
        if (!center) return b;
        const distM = (lat1: number, lng1: number, lat2: number, lng2: number) => {
          const R = 6371000;
          const φ1 = (lat1 * Math.PI) / 180;
          const φ2 = (lat2 * Math.PI) / 180;
          const Δφ = ((lat2 - lat1) * Math.PI) / 180;
          const Δλ = ((lng2 - lng1) * Math.PI) / 180;
          const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
          return 2 * R * Math.asin(Math.sqrt(a));
        };
        const findClosest = (pts: any[]) => {
          let best: any = null;
          let bestD = 25; // max metres
          for (const p of pts) {
            const d = distM(center.lat, center.lng, p.lat, p.lng);
            if (d < bestD) { best = p; bestD = d; }
          }
          return best;
        };
        const crm = findClosest(labelsResp.crm || []);
        if (crm) return { ...b, label: crm.label, _labelSource: "crm" };
        const comp = findClosest(labelsResp.comps || []);
        if (comp) return { ...b, label: comp.label, _labelSource: "comp" };
        // Shopping centre directory beats generic VOA/Google because it's
        // the centre's own authoritative tenant list. Bigger match radius
        // (40m) because the ring-spreading is approximate.
        const centreFinder = (pts: any[]) => {
          let best: any = null; let bestD = 40;
          for (const p of pts) {
            const d = distM(center.lat, center.lng, p.lat, p.lng);
            if (d < bestD) { best = p; bestD = d; }
          }
          return best;
        };
        const centre = centreFinder(centreLabels);
        if (centre) return { ...b, label: centre.label, _labelSource: "centre" };
        const voa = findClosest(labelsResp.voa || []);
        if (voa) return { ...b, label: voa.label, _labelSource: "voa" };
        const google = findClosest(labelsResp.google || []);
        if (google) return { ...b, label: google.label, _labelSource: "google" };
        return b;
      };

      const enriched = buildings.map(overrideLabel);

      // Deduplicate labels across NGD building-parts that share a TOID or
      // that got matched to the same VOA/CRM/Comp/Google record. Without
      // this, a single Boots shopfront made of five NGD parts gets
      // "BOOTS OPTICIANS" printed five times, each overflowing its sliver.
      // Keep the label on the largest polygon of each group; blank the
      // others so their polygons render without text.
      const groupBy = new Map<string, any[]>();
      for (const b of enriched) {
        if (!b.label) continue;
        const key = `${(b.label || "").toLowerCase().trim()}|${b._toid || ""}`;
        if (!groupBy.has(key)) groupBy.set(key, []);
        groupBy.get(key)!.push(b);
      }
      for (const group of groupBy.values()) {
        if (group.length <= 1) continue;
        group.sort((a, b) => (b.areaSqM || 0) - (a.areaSqM || 0));
        for (let i = 1; i < group.length; i++) {
          group[i].label = "";
          group[i].houseNum = "";
          group[i]._dedupedFrom = group[0].label;
        }
      }

      renderBuildings(enriched);
    };

    const debouncedLoad = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(loadBuildings, 300);
    };

    map.on("moveend", debouncedLoad);
    loadBuildings();

    map.on("click", (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      handleMapClick(lat, lng);
    });

    mapRef.current = map;

    // Leaflet measures its container once at init. This page mounts inside a
    // lazy tab and shares the row with collapsible chrome (sidebar, ChatBGP
    // rail), so the container often settles at a different width after init —
    // leaving tiles frozen at the stale size with dead space beside them.
    // Re-measure on any container resize.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Google Places autocomplete on the in-map search box. Loads the
  // Google Maps JS API the same way the rest of the app does (shared
  // singleton loader), then attaches an Autocomplete to the input ref.
  // When the user picks a suggestion we flyTo the Leaflet map and drop a
  // marker — no map provider change needed, Places works standalone.
  useEffect(() => {
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;
    let inputChangeListener: ((e: Event) => void) | null = null;

    (async () => {
      const ok = await loadGoogleMaps();
      if (cancelled || !ok || !placesSearchInputRef.current) return;
      if (typeof google === "undefined" || !google.maps?.places) return;

      const ac = new google.maps.places.Autocomplete(placesSearchInputRef.current, {
        types: ["geocode", "establishment"],
        componentRestrictions: { country: "gb" },
        fields: ["geometry", "formatted_address", "name", "place_id"],
      });
      placesAutocompleteRef.current = ac;

      // Reflect the typed value into state so we know when to show the
      // clear (X) button. Google's autocomplete writes back to the input
      // imperatively on select, so we listen to native input events.
      inputChangeListener = () => {
        setPlacesSearchValue(placesSearchInputRef.current?.value || "");
      };
      placesSearchInputRef.current.addEventListener("input", inputChangeListener);

      listener = ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        const loc = place?.geometry?.location;
        if (!loc || !mapRef.current) return;
        const lat = loc.lat();
        const lng = loc.lng();

        mapRef.current.flyTo([lat, lng], 17, { duration: 0.8 });

        if (placesMarkerRef.current) {
          mapRef.current.removeLayer(placesMarkerRef.current);
        }
        placesMarkerRef.current = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "places-search-pin",
            html: `<div style="width:18px;height:18px;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        }).addTo(mapRef.current);
        const label = place.name || place.formatted_address || "Location";
        placesMarkerRef.current.bindPopup(`<strong>${label}</strong>${place.formatted_address && place.name !== place.formatted_address ? `<br/><span style="color:#666;font-size:11px">${place.formatted_address}</span>` : ""}`, { closeButton: false, offset: L.point(0, -8) }).openPopup();
        setPlacesSearchValue(placesSearchInputRef.current?.value || "");
      });
    })();

    return () => {
      cancelled = true;
      if (listener) listener.remove();
      if (inputChangeListener && placesSearchInputRef.current) {
        placesSearchInputRef.current.removeEventListener("input", inputChangeListener);
      }
      placesAutocompleteRef.current = null;
    };
  }, []);

  // Fetch recent searches and CRM properties on mount
  useEffect(() => {
    const headers = { ...getAuthHeaders(), Authorization: `Bearer ${localStorage.getItem("bgp_token")}` };
    fetch("/api/land-registry/searches/recent", { credentials: "include", headers })
      .then(r => r.ok ? r.json() : [])
      .then(data => setRecentSearches(Array.isArray(data) ? data : []))
      .catch(() => {
        fetch("/api/land-registry/searches", { credentials: "include", headers })
          .then(r => r.ok ? r.json() : [])
          .then(data => setRecentSearches(Array.isArray(data) ? data.slice(0, 20) : []))
          .catch(() => {});
      });

    fetch("/api/crm/properties", { credentials: "include", headers })
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const props = Array.isArray(data) ? data : (data.data ?? []);
        setCrmProperties(props);
      })
      .catch(() => {});

    // Available Properties layer data — external (scraped/emailed/WhatsApp)
    // listings + BGP's own available units, normalised to {kind,lat,lng,...}.
    Promise.all([
      fetch("/api/external-properties", { credentials: "include", headers }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch("/api/available-units", { credentials: "include", headers }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([ext, units]) => {
      const out: any[] = [];
      for (const p of (Array.isArray(ext) ? ext : [])) {
        const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ kind: "market", lat, lng, ...p });
      }
      for (const u of (Array.isArray(units) ? units : [])) {
        let addr: any = u.propertyAddress;
        if (typeof addr === "string") { try { addr = JSON.parse(addr); } catch { addr = null; } }
        const lat = parseFloat(addr?.lat), lng = parseFloat(addr?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) out.push({ kind: "bgp", lat, lng, address: addr?.address, ...u });
      }
      setAvailableProps(out);
    }).catch(() => {});
  }, []);

  // Fetch CRM map pins (Deals, Comps, Lease Events) on mount
  useEffect(() => {
    const headers = { ...getAuthHeaders(), Authorization: `Bearer ${localStorage.getItem("bgp_token")}` };
    fetch("/api/map/pins", { credentials: "include", headers })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setMapPins(data); })
      .catch(err => {
        console.error("[map] failed to load CRM pins:", err?.message);
        toast({ title: "Map layers unavailable", description: "Couldn't load Deals / Comps / Lease Events pins. Check your connection and try again.", variant: "destructive" });
      });
  }, [toast]);

  // Render Deals layer
  useEffect(() => {
    const map = mapRef.current;
    const layer = dealsLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showDeals || !mapPins?.deals.length) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
    for (const d of mapPins.deals) {
      const marker = L.circleMarker([d.lat, d.lng], {
        radius: 7, fillColor: "#f59e0b", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9,
      });
      const statusColor = d.status === "Complete" || d.status === "Completed" ? "#10b981"
        : d.status === "Live" || d.status === "Active" ? "#3b82f6"
        : d.status === "SOLs" ? "#8b5cf6"
        : "#f59e0b";
      marker.bindPopup(`
        <div style="min-width:190px;font-family:sans-serif;font-size:12px">
          <p style="font-weight:700;margin:0 0 4px">${d.label}</p>
          ${d.addressLabel && d.addressLabel !== d.label ? `<p style="color:#666;margin:0 0 4px;font-size:11px">${d.addressLabel}</p>` : ""}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">
            ${d.dealType ? `<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:10px">${d.dealType}</span>` : ""}
            ${d.status ? `<span style="background:${statusColor}22;color:${statusColor};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600">${d.status}</span>` : ""}
          </div>
          ${d.pricing ? `<p style="margin:2px 0;font-size:11px;color:#333">£${Number(d.pricing).toLocaleString()}</p>` : ""}
          ${d.areaSqft ? `<p style="margin:2px 0;font-size:11px;color:#666">${Number(d.areaSqft).toLocaleString()} sq ft</p>` : ""}
          <a href="/deals" style="display:inline-block;margin-top:8px;font-size:11px;color:#6366f1;text-decoration:none;border:1px solid #e0e7ff;padding:3px 8px;border-radius:4px">Open Deals →</a>
        </div>
      `, { maxWidth: 260 });
      layer.addLayer(marker);
    }
  }, [showDeals, mapPins]);

  // Render Comps layer
  useEffect(() => {
    const map = mapRef.current;
    const layer = compsLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showComps || !mapPins?.comps.length) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
    for (const c of mapPins.comps) {
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 6, fillColor: "#8b5cf6", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.85,
      });
      marker.bindPopup(`
        <div style="min-width:190px;font-family:sans-serif;font-size:12px">
          <p style="font-weight:700;margin:0 0 4px">${c.label || c.postcode || "Comp"}</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">
            ${c.compType ? `<span style="background:#ede9fe;color:#5b21b6;padding:2px 6px;border-radius:4px;font-size:10px">${c.compType}</span>` : ""}
            ${c.dealType ? `<span style="background:#f3f4f6;color:#374151;padding:2px 6px;border-radius:4px;font-size:10px">${c.dealType}</span>` : ""}
          </div>
          ${c.tenant ? `<p style="margin:2px 0;font-size:11px;color:#333"><strong>Tenant:</strong> ${c.tenant}</p>` : ""}
          ${c.headlineRent ? `<p style="margin:2px 0;font-size:11px;color:#333"><strong>Rent:</strong> ${c.headlineRent}</p>` : ""}
          ${c.areaSqft ? `<p style="margin:2px 0;font-size:11px;color:#666">${c.areaSqft} sq ft</p>` : ""}
          ${c.completionDate ? `<p style="margin:2px 0;font-size:10px;color:#999">${c.completionDate}</p>` : ""}
          <a href="/comps/${c.id}" style="display:inline-block;margin-top:8px;font-size:11px;color:#6366f1;text-decoration:none;border:1px solid #e0e7ff;padding:3px 8px;border-radius:4px">Open Comp →</a>
        </div>
      `, { maxWidth: 260 });
      layer.addLayer(marker);
    }
  }, [showComps, mapPins]);

  // Render Pathway runs layer — pins for active investigations.
  useEffect(() => {
    if (!mapRef.current) return;
    if (!pathwayMarkersRef.current) {
      pathwayMarkersRef.current = L.layerGroup().addTo(mapRef.current);
    }
    pathwayMarkersRef.current.clearLayers();
    if (!showPathway || !mapPins?.pathway?.length) return;
    for (const r of mapPins.pathway) {
      if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
      const stage = r.currentStage || 0;
      const stageLabel = stage > 0 ? `Stage ${stage}` : "Not started";
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 7,
        fillColor: "#10b981", // emerald — pathway = active investigation
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      });
      marker.bindPopup(`
        <div style="font-size:12px;max-width:240px">
          <strong>${r.label || "Pathway run"}</strong>
          ${r.postcode ? `<br/><span style="color:#666">${r.postcode}</span>` : ""}
          ${r.tenant ? `<br/><span style="color:#666">Tenant: ${r.tenant}</span>` : ""}
          <br/><span style="font-size:10px;background:#10b981;color:white;padding:1px 6px;border-radius:8px;display:inline-block;margin-top:3px">${stageLabel}</span>
          <br/><a href="/property-pathway?runId=${r.id}" style="display:inline-block;margin-top:8px;font-size:11px;color:#10b981;text-decoration:none;border:1px solid #d1fae5;padding:3px 8px;border-radius:4px">Open run →</a>
        </div>
      `, { closeButton: false, offset: L.point(0, -5), maxWidth: 260 });
      pathwayMarkersRef.current.addLayer(marker);
    }
  }, [showPathway, mapPins]);

  // Render Available Properties layer — market listings (cyan) + BGP's own
  // available units (emerald), with rent / service charge / area in the popup.
  useEffect(() => {
    if (!mapRef.current) return;
    if (!availableMarkersRef.current) availableMarkersRef.current = L.layerGroup().addTo(mapRef.current);
    availableMarkersRef.current.clearLayers();
    if (!showAvailable || !availableProps.length) return;
    const money = (v: any) => { const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, "")); return isNaN(n) ? null : `£${n.toLocaleString()}`; };
    for (const p of availableProps) {
      const isBgp = p.kind === "bgp";
      const color = isBgp ? "#10b981" : "#06b6d4";
      const marker = L.circleMarker([p.lat, p.lng], { radius: 7, fillColor: color, color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9 });
      let pack: any = null; try { pack = p.landlord_pack ? JSON.parse(p.landlord_pack) : null; } catch {}
      const rent = isBgp ? p.askingRent : p.rent;
      const sc = isBgp ? p.serviceChargePa : p.service_charge;
      const area = isBgp ? p.sqft : p.area_sqft;
      const use = isBgp ? p.useClass : p.use_category;
      const statusTxt = isBgp ? p.marketingStatus : p.availability;
      const rows = [
        area ? `${Number(area).toLocaleString()} sq ft` : null,
        rent ? `Rent: ${money(rent) || rent}${isBgp ? " pa" : " pa"}` : null,
        sc ? `Service charge: ${money(sc) || sc}` : null,
        use ? `Use: ${use}` : null,
        !isBgp && p.tenure ? `Tenure: ${p.tenure}` : null,
        statusTxt ? `${statusTxt}` : null,
        !isBgp && p.agent ? `Agent: ${p.agent}` : null,
      ].filter(Boolean).map((t) => `<p style="margin:2px 0;font-size:11px;color:#555">${t}</p>`).join("");
      const title = isBgp ? `${p.propertyName || "Property"}${p.unitName ? " — " + p.unitName : ""}` : (p.address || "Available property");
      const badge = isBgp
        ? `<span style="background:#10b981;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px">BGP available</span>`
        : `<span style="background:#06b6d4;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px">Market listing</span>`;
      const link = isBgp
        ? `<a href="/properties/${p.propertyId}" style="display:inline-block;margin-top:8px;font-size:11px;color:#10b981;text-decoration:none;border:1px solid #d1fae5;padding:3px 8px;border-radius:4px">View property →</a>`
        : (pack?.url ? `<div style="margin-top:8px;display:flex;gap:6px;align-items:center">
             <a href="${pack.url}" target="_blank" rel="noopener" style="font-size:11px;color:#0891b2;text-decoration:none;border:1px solid #cffafe;padding:3px 8px;border-radius:4px">📄 View pack</a>
             <a href="${pack.url}${pack.url.includes('?') ? '&' : '?'}download=1" style="font-size:11px;color:#64748b;text-decoration:none">Download</a>
           </div>` : "");
      marker.bindPopup(`<div style="font-size:12px;max-width:250px"><strong>${title}</strong><br/>${badge}${rows}${link}</div>`, { closeButton: false, offset: L.point(0, -5), maxWidth: 270 });
      availableMarkersRef.current.addLayer(marker);
    }
  }, [showAvailable, availableProps]);

  // Render Lease Events layer
  useEffect(() => {
    const map = mapRef.current;
    const layer = leaseEventsLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!showLeaseEvents || !mapPins?.leaseEvents.length) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      return;
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
    for (const e of mapPins.leaseEvents) {
      const urgencyColor = e.eventDate
        ? new Date(e.eventDate) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
          ? "#ef4444" : "#ec4899"
        : "#ec4899";
      const marker = L.circleMarker([e.lat, e.lng], {
        radius: 6, fillColor: urgencyColor, color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9,
      });
      const dateStr = e.eventDate ? new Date(e.eventDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
      marker.bindPopup(`
        <div style="min-width:190px;font-family:sans-serif;font-size:12px">
          <p style="font-weight:700;margin:0 0 4px">${e.eventType || "Lease Event"}</p>
          ${e.label ? `<p style="color:#666;margin:0 0 4px;font-size:11px">${e.label}</p>` : ""}
          ${e.tenant ? `<p style="margin:2px 0;font-size:11px;color:#333"><strong>Tenant:</strong> ${e.tenant}</p>` : ""}
          ${dateStr ? `<p style="margin:2px 0;font-size:11px;color:#333"><strong>Date:</strong> ${dateStr}</p>` : ""}
          ${e.currentRent ? `<p style="margin:2px 0;font-size:11px;color:#333"><strong>Rent:</strong> ${e.currentRent}</p>` : ""}
          ${e.status ? `<span style="background:#fce7f3;color:#9d174d;padding:2px 6px;border-radius:4px;font-size:10px;display:inline-block;margin-top:2px">${e.status}</span>` : ""}
          <a href="/lease-events" style="display:inline-block;margin-top:8px;font-size:11px;color:#6366f1;text-decoration:none;border:1px solid #e0e7ff;padding:3px 8px;border-radius:4px">Open Lease Events →</a>
        </div>
      `, { maxWidth: 260 });
      layer.addLayer(marker);
    }
  }, [showLeaseEvents, mapPins]);

  // Land Registry title boundaries — always-on red-line layer.
  // Fetches the polygons for the visible postcode district on each map move
  // (cached 30d server-side), draws them as crisp red outlines. No toggle —
  // these are the core of a property plan.
  useEffect(() => {
    if (!mapRef.current || !titleBoundaryLayerRef.current) return;
    const map = mapRef.current;
    const layer = titleBoundaryLayerRef.current;

    const refresh = async () => {
      // Don't fetch / repaint title boundaries while Retail Context is on
      // — the always-on red lines compete visually with the Goad colours
      // and made the map feel busy.
      if (showRetailContextRef.current) {
        layer.clearLayers();
        titleBoundaryBboxRef.current = "";
        return;
      }
      const bounds = map.getBounds();
      const bbox = `${bounds.getSouth().toFixed(4)},${bounds.getWest().toFixed(4)},${bounds.getNorth().toFixed(4)},${bounds.getEast().toFixed(4)}`;
      if (bbox === titleBoundaryBboxRef.current) return;
      titleBoundaryBboxRef.current = bbox;
      try {
        const res = await fetch(`/api/map/title-boundaries?bbox=${bbox}`, {
          credentials: "include",
          headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        layer.clearLayers();

        const drawTitle = (t: any, tenure: "F" | "L") => {
          const geo = t.polygons;
          if (!geo) return;
          const style = {
            color: tenure === "F" ? "#dc2626" : "#2563eb",
            weight: 1.4,
            fillOpacity: 0,
            opacity: 0.85,
            dashArray: tenure === "F" ? undefined : "4,3",
            pane: "titlePane",
          };
          try {
            const geojson = L.geoJSON(geo, { style } as any);
            geojson.bindTooltip(
              `<div style="font-family:sans-serif;font-size:11px;max-width:240px">
                 <strong>${t.proprietor || "Title " + (t.titleNumber || "")}</strong><br/>
                 <span style="color:#666">${tenure === "F" ? "Freehold" : "Leasehold"}${t.titleNumber ? " · " + t.titleNumber : ""}</span>
                 ${t.proprietorCategory ? `<br/><span style="color:#888;font-size:10px">${t.proprietorCategory}</span>` : ""}
                 ${t.pricePaid ? `<br/><span style="color:#888;font-size:10px">£${Number(t.pricePaid).toLocaleString()}${t.dateOfPurchase ? " · " + t.dateOfPurchase : ""}</span>` : ""}
               </div>`,
              { sticky: true, direction: "top", opacity: 0.95 }
            );
            layer.addLayer(geojson);
          } catch (err) {
            // Malformed polygon — skip silently
          }
        };

        for (const t of data.freeholds || []) drawTitle(t, "F");
        for (const t of data.leaseholds || []) drawTitle(t, "L");
      } catch (err) {
        // Non-fatal — the layer just won't have new polygons
      }
    };

    refresh();
    const onMoveEnd = () => { setTimeout(refresh, 400); };
    map.on("moveend", onMoveEnd);
    return () => { map.off("moveend", onMoveEnd); };
  }, []);

  // Render search history pins on map
  useEffect(() => {
    if (!mapRef.current) return;
    if (!searchMarkersRef.current) {
      searchMarkersRef.current = L.layerGroup().addTo(mapRef.current);
    }
    searchMarkersRef.current.clearLayers();

    if (!showSearchHistory) return;

    for (const s of recentSearches) {
      // Try to get lat/lng from intelligence data or skip
      const coords = s.intelligence?.flood?.coordinates || s.intelligence?.planning?.coordinates;
      if (!coords?.lat || !coords?.lng) continue;

      const isAcquired = s.status === "Acquired";
      const pinColor = isAcquired ? "#10b981" : "#ef4444"; // green for acquired, red for searches
      const ownerName = s.ownership?.freeholders?.[0]?.name || "";

      const marker = L.circleMarker([coords.lat, coords.lng], {
        radius: 7,
        fillColor: pinColor,
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      });

      const popupContent = `
        <div style="font-size:12px;max-width:220px">
          <strong>${s.address || "Unknown"}</strong>
          ${s.postcode ? `<br/><span style="color:#666">${s.postcode}</span>` : ""}
          ${ownerName ? `<br/><span style="color:#3b82f6;font-size:11px">Owner: ${ownerName}</span>` : ""}
          ${s.status ? `<br/><span style="font-size:10px;background:${pinColor};color:white;padding:1px 6px;border-radius:8px;display:inline-block;margin-top:3px">${s.status}</span>` : ""}
          <br/><span style="color:#999;font-size:10px">${new Date(s.created_at || s.createdAt).toLocaleDateString("en-GB")}</span>
        </div>
      `;

      marker.bindPopup(popupContent, { closeButton: false, offset: L.point(0, -5) });
      searchMarkersRef.current.addLayer(marker);
    }
  }, [showSearchHistory, recentSearches]);

  // Render CRM property pins on map
  useEffect(() => {
    if (!mapRef.current) return;
    if (!crmMarkersRef.current) {
      crmMarkersRef.current = L.layerGroup().addTo(mapRef.current);
    }
    crmMarkersRef.current.clearLayers();

    if (!showCrmLayer) return;

    for (const p of crmProperties) {
      if (isInvestmentComp(p)) continue; // shown on the separate Investment Comps layer
      if (!p.latitude || !p.longitude) continue;

      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 7,
        fillColor: "#3b82f6", // blue for CRM
        color: "#fff",
        weight: 2,
        opacity: 1,
        fillOpacity: 0.85,
      });

      const popupContent = `
        <div style="font-size:12px;max-width:220px">
          <strong>${p.name || "CRM Property"}</strong>
          ${p.address ? `<br/><span style="color:#666">${p.address}</span>` : ""}
          ${p.postcode ? `<br/><span style="color:#666">${p.postcode}</span>` : ""}
          <br/><span style="font-size:10px;background:#3b82f6;color:white;padding:1px 6px;border-radius:8px;display:inline-block;margin-top:3px">CRM Property</span>
        </div>
      `;

      marker.bindPopup(popupContent, { closeButton: false, offset: L.point(0, -5) });
      marker.on("click", () => {
        if (p.postcode) {
          setSelectedPostcode(p.postcode);
          setCurrentArea(p.name || p.address || p.postcode);
          loadPropertyData(p.postcode, undefined, p.address || undefined, { lat: p.latitude, lng: p.longitude });
        }
      });
      crmMarkersRef.current.addLayer(marker);
    }
  }, [showCrmLayer, crmProperties]);

  // Render Investment Comps layer (the bulk-loaded comparables) — default-off,
  // purple, so the data is still reachable but doesn't clutter CRM Properties.
  useEffect(() => {
    if (!mapRef.current) return;
    if (!investmentCompsMarkersRef.current) {
      investmentCompsMarkersRef.current = L.layerGroup().addTo(mapRef.current);
    }
    investmentCompsMarkersRef.current.clearLayers();
    if (!showInvestmentComps) return;
    for (const p of crmProperties) {
      if (!isInvestmentComp(p) || !p.latitude || !p.longitude) continue;
      const marker = L.circleMarker([p.latitude, p.longitude], {
        radius: 6, fillColor: "#8b5cf6", color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.85,
      });
      marker.bindPopup(`
        <div style="font-size:12px;max-width:220px">
          <strong>${p.name || "Investment comp"}</strong>
          ${p.postcode ? `<br/><span style="color:#666">${p.postcode}</span>` : ""}
          ${p.assetClass ? `<br/><span style="color:#666">${String(p.assetClass).replace(/[{}]/g, "")}</span>` : ""}
          <br/><span style="font-size:10px;background:#8b5cf6;color:white;padding:1px 6px;border-radius:8px;display:inline-block;margin-top:3px">Investment comp</span>
        </div>
      `, { closeButton: false, offset: L.point(0, -5) });
      investmentCompsMarkersRef.current.addLayer(marker);
    }
  }, [showInvestmentComps, crmProperties]);

  // When Retail Context is on, suppress the legacy layers underneath it:
  //   - buildingLayerRef: pale-yellow auto-classified buildings with dark
  //     #1a1a1a outlines that bleed through Goad polygons
  //   - titleBoundaryLayerRef: always-on red Land Registry boundary lines
  //   - centreTenantLayerRef: old centre tenant text markers
  // All three are superseded by the real Goad data — keeping them painted
  // underneath just creates the 'messy lines' Woody flagged.
  useEffect(() => {
    if (!showRetailContext) return;
    buildingLayerRef.current?.clearLayers();
    titleBoundaryLayerRef.current?.clearLayers();
    centreTenantLayerRef.current?.clearLayers();
  }, [showRetailContext, goadFeatures.length]);

  // ─── Retail Context layer (Goad GeoJSON loader) ─────────────────────
  // Loads all four floor layers (LG/GF/F1/F2) once on first toggle-on and
  // caches them in component state. The data is static — no pan-refetch
  // needed. The render effect below picks up changes to goadFeatures
  // (initial load) or excludedRetailCategories (band-filter changes).
  // Loads the harvested occupier units (all 76 licensed areas, from goad_units)
  // for the current viewport, and re-fetches on pan/zoom. Replaces the old
  // static West-End-only /api/goad/{floor} files so the Retail Context layer
  // covers everywhere. Fetches only at street zoom (units are tiny above that).
  useEffect(() => {
    if (!showRetailContext) {
      retailMarkersRef.current?.clearLayers();
      retailLabelLayerRef.current?.clearLayers();
      return;
    }
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = "";

    const fetchUnits = async () => {
      if (map.getZoom() < 16) return; // too far out — units unreadable
      const b = map.getBounds();
      const bbox = `${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}`;
      const key = `${b.getSouth().toFixed(3)},${b.getWest().toFixed(3)},${b.getNorth().toFixed(3)},${b.getEast().toFixed(3)}`;
      if (key === lastKey) return;
      lastKey = key;
      setRetailFetching(true);
      try {
        const r = await fetch(`/api/map/retail-units?bbox=${bbox}`, { credentials: "include" });
        const gj = r.ok ? await r.json() : null;
        if (cancelled) return;
        setGoadFeatures(gj?.features || []);
      } catch {
        /* swallow — toggle still works, just no data this pan */
      } finally {
        if (!cancelled) setRetailFetching(false);
      }
    };

    const onMove = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchUnits, 300);
    };
    map.on("moveend", onMove);
    fetchUnits();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      map.off("moveend", onMove);
    };
  }, [showRetailContext]);

  // ── Persist last map centre to localStorage ───────────────────────────────
  // Lets sibling components (e.g. the MAP BGP "🌐 3D View" button) pick up
  // wherever the user last looked, even though they live outside this map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onMove = () => {
      try {
        const c = map.getCenter();
        localStorage.setItem(
          "bgp_map_last_centre",
          JSON.stringify({ lat: c.lat, lng: c.lng, zoom: map.getZoom(), ts: Date.now() }),
        );
      } catch { /* localStorage may be disabled */ }
    };
    map.on("moveend", onMove);
    onMove();
    return () => { map.off("moveend", onMove); };
  }, []);

  // ── Street View on-click toggle ────────────────────────────────────────────
  // Fetch Google Maps API key once so we can build embed URLs.
  useEffect(() => {
    if (googleMapsKey !== null) return;
    fetch("/api/config/maps-key", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => setGoogleMapsKey(d?.key || ""))
      .catch(() => setGoogleMapsKey(""));
  }, [googleMapsKey]);

  // Bind a map-click handler when the toggle is on; clean up on toggle off.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (!showStreetView) {
      container.style.cursor = "";
      if (streetViewClickRef.current) {
        map.off("click", streetViewClickRef.current);
        streetViewClickRef.current = null;
      }
      return;
    }
    container.style.cursor = "crosshair";
    const handler = (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      const key = googleMapsKey || "";
      // Embed URL works with any key that has Maps Embed enabled. If the
      // key is missing, fall back to a public Maps link.
      const embedSrc = key
        ? `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${lat},${lng}&heading=0&pitch=0&fov=90`
        : "";
      const fallback = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
      const html = embedSrc
        ? `<div style="width:360px"><iframe src="${embedSrc}" width="360" height="240" style="border:0;border-radius:6px" allow="fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>
            <div style="text-align:right;margin-top:4px"><a href="${fallback}" target="_blank" rel="noreferrer" style="font-size:11px;color:#1a73e8">Open in Maps ↗</a></div></div>`
        : `<div style="width:240px;font-size:12px"><p>Google Maps key not configured.</p><a href="${fallback}" target="_blank" rel="noreferrer" style="font-size:11px;color:#1a73e8">Open Street View in Maps ↗</a></div>`;
      L.popup({ maxWidth: 380, closeButton: true })
        .setLatLng(e.latlng)
        .setContent(html)
        .openOn(map);
    };
    streetViewClickRef.current = handler;
    map.on("click", handler);
    return () => {
      map.off("click", handler);
      container.style.cursor = "";
      streetViewClickRef.current = null;
    };
  }, [showStreetView, googleMapsKey]);

  // ── Annotations layer ──────────────────────────────────────────────────
  // Fetch + render pins / labels stored in map_annotations. Click handler
  // is bound when annotateMode is set; click drops a new pin or label.
  const loadAnnotations = useCallback(async () => {
    try {
      const r = await fetch("/api/map-annotations", { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setAnnotations(Array.isArray(data) ? data : []);
    } catch {}
  }, []);
  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  const loadMapLayers = useCallback(async () => {
    try {
      const r = await fetch("/api/map-layers", { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      const list: MapLayer[] = Array.isArray(data) ? data : [];
      setMapLayers(list);
      // Pick the first owned layer as active by default. Falls back
      // to the first shared layer, then no layer (annotations go to
      // the "unfiled" bucket — still visible, just not in a layer).
      setActiveLayerId((cur) => {
        if (cur && list.some((l) => l.id === cur)) return cur;
        const mine = list.find((l) => l.mine);
        if (mine) return mine.id;
        const any = list[0];
        return any ? any.id : null;
      });
    } catch {}
  }, []);
  useEffect(() => { loadMapLayers(); }, [loadMapLayers]);

  const createMapLayer = useCallback(async () => {
    const name = newLayerName.trim();
    if (!name) return;
    const r = await fetch("/api/map-layers", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: annotateColor }),
    });
    const body = await r.json().catch(() => ({} as any));
    if (r.ok && body?.id) {
      setNewLayerName("");
      await loadMapLayers();
      setActiveLayerId(body.id);
    }
  }, [newLayerName, annotateColor, loadMapLayers]);

  const deleteMapLayer = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete layer "${name}" and all its annotations?`)) return;
    await fetch(`/api/map-layers/${id}`, { method: "DELETE", credentials: "include" });
    await loadMapLayers();
    await loadAnnotations();
    if (activeLayerId === id) setActiveLayerId(null);
  }, [activeLayerId, loadMapLayers, loadAnnotations]);

  const toggleLayerVisibility = useCallback((id: string) => {
    setHiddenLayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Reset in-progress polygon / drive-time when mode changes.
  useEffect(() => {
    polygonPointsRef.current = [];
    if (polygonGhostRef.current && mapRef.current) {
      mapRef.current.removeLayer(polygonGhostRef.current);
      polygonGhostRef.current = null;
    }
    driveOriginRef.current = null;
    if (driveOriginMarkerRef.current && mapRef.current) {
      mapRef.current.removeLayer(driveOriginMarkerRef.current);
      driveOriginMarkerRef.current = null;
    }
  }, [annotateMode]);

  // Bind click handlers for every annotate mode. Pin/label = single
  // click. Polygon = multiple clicks + double-click to finish. Drive
  // time = two clicks (origin, destination).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const container = map.getContainer();
    if (!annotateMode) {
      container.style.cursor = "";
      return;
    }
    container.style.cursor = "crosshair";

    const handler = async (e: L.LeafletMouseEvent) => {
      const { mode, color } = annotateModeRef.current;
      if (!mode) return;
      const { lat, lng } = e.latlng;

      if (mode === "pin" || mode === "label") {
        let label: string | null = null;
        if (mode === "label") {
          label = window.prompt("Label text:") || null;
          if (!label) return;
        } else {
          label = window.prompt("Note for this pin (optional):") || null;
        }
        const resp = await fetch("/api/map-annotations", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: mode, label, color, lat, lng, layerId: activeLayerId }),
        });
        if (resp.ok) { await loadAnnotations(); await loadMapLayers(); setAnnotateMode(null); }
        return;
      }

      if (mode === "polygon") {
        polygonPointsRef.current.push(e.latlng);
        if (polygonGhostRef.current) map.removeLayer(polygonGhostRef.current);
        polygonGhostRef.current = L.polyline(polygonPointsRef.current, {
          color, weight: 3, dashArray: "6 4", opacity: 0.9,
        }).addTo(map);
        return;
      }

      if (mode === "drive_time") {
        if (!driveOriginRef.current) {
          driveOriginRef.current = e.latlng;
          driveOriginMarkerRef.current = L.circleMarker(e.latlng, {
            radius: 7, fillColor: color, color: "#fff", weight: 2, opacity: 1, fillOpacity: 0.9,
          }).addTo(map);
          return;
        }
        // Second click → request directions
        const origin = driveOriginRef.current;
        const destination = e.latlng;
        if (driveOriginMarkerRef.current) map.removeLayer(driveOriginMarkerRef.current);
        driveOriginRef.current = null;
        driveOriginMarkerRef.current = null;
        try {
          const r = await fetch("/api/maps/directions", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ origin: { lat: origin.lat, lng: origin.lng }, destination: { lat: destination.lat, lng: destination.lng } }),
          });
          const data = await r.json();
          if (!r.ok || !data.polyline) {
            window.alert(`Directions failed: ${data?.error || r.status}`);
            return;
          }
          // Save the drive-time as a polygon annotation with geometry
          // = the decoded polyline (LineString GeoJSON), label = duration.
          const coords = decodeGooglePolyline(data.polyline);
          const geometry = {
            type: "LineString",
            coordinates: coords.map((p) => [p[1], p[0]]),     // [lng,lat]
          };
          const label = `${data.durationText || "?"} · ${data.distanceText || ""}`.trim();
          const resp = await fetch("/api/map-annotations", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "drive_time", label, color, lat: origin.lat, lng: origin.lng, geometry, layerId: activeLayerId }),
          });
          if (resp.ok) { await loadAnnotations(); await loadMapLayers(); setAnnotateMode(null); }
        } catch (err: any) {
          window.alert(`Couldn't fetch route: ${err?.message}`);
        }
      }
    };

    const dblHandler = async () => {
      const { color } = annotateModeRef.current;
      if (annotateModeRef.current.mode !== "polygon") return;
      const pts = polygonPointsRef.current;
      if (pts.length < 3) {
        window.alert("Click at least 3 points before double-clicking to close the shape.");
        return;
      }
      const geometry = {
        type: "Polygon",
        coordinates: [[...pts, pts[0]].map((p) => [p.lng, p.lat])],
      };
      const label = window.prompt("Name this redline (optional):") || null;
      const resp = await fetch("/api/map-annotations", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "polygon", label, color, lat: pts[0].lat, lng: pts[0].lng, geometry, layerId: activeLayerId }),
      });
      if (resp.ok) { await loadAnnotations(); await loadMapLayers(); setAnnotateMode(null); }
    };

    map.on("click", handler);
    map.on("dblclick", dblHandler);
    // Disable Leaflet's default double-click-to-zoom while in polygon
    // mode so it doesn't fight the finish gesture.
    if (annotateMode === "polygon") map.doubleClickZoom.disable();
    return () => {
      map.off("click", handler);
      map.off("dblclick", dblHandler);
      map.doubleClickZoom.enable();
      container.style.cursor = "";
    };
  }, [annotateMode, loadAnnotations]);

  // Render annotations whenever the list or visibility changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!annotationsLayerRef.current) {
      annotationsLayerRef.current = L.layerGroup().addTo(map);
    }
    const layer = annotationsLayerRef.current;
    layer.clearLayers();
    if (!showAnnotations) return;
    for (const a of annotations) {
      if (a.lat == null || a.lng == null) continue;
      if (a.layerId && hiddenLayerIds.has(a.layerId)) continue;
      const color = a.color || "#ef4444";
      if (a.kind === "pin") {
        const marker = L.circleMarker([a.lat, a.lng], {
          radius: 8,
          fillColor: color,
          color: "#ffffff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        });
        const popup = `<div style="min-width:160px"><div style="font-weight:600;margin-bottom:4px">${(a.label || "Pin").replace(/</g, "&lt;")}</div><button id="del-${a.id}" style="font-size:11px;color:#dc2626;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0">Delete pin</button></div>`;
        marker.bindPopup(popup);
        marker.on("popupopen", () => {
          const btn = document.getElementById(`del-${a.id}`);
          if (btn) btn.onclick = async () => {
            await fetch(`/api/map-annotations/${a.id}`, { method: "DELETE", credentials: "include" });
            map.closePopup();
            loadAnnotations();
          };
        });
        layer.addLayer(marker);
      } else if (a.kind === "label") {
        const icon = L.divIcon({
          className: "",
          iconSize: undefined as any,
          html: `<div style="background:${color};color:#ffffff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.2);transform:translate(-50%,-50%);" data-ann="${a.id}">${(a.label || "Label").replace(/</g, "&lt;")}</div>`,
        });
        const marker = L.marker([a.lat, a.lng], { icon });
        marker.on("click", async () => {
          if (window.confirm(`Delete label "${a.label}"?`)) {
            await fetch(`/api/map-annotations/${a.id}`, { method: "DELETE", credentials: "include" });
            loadAnnotations();
          }
        });
        layer.addLayer(marker);
      } else if (a.kind === "polygon" && a.geometry?.type === "Polygon") {
        const poly = L.geoJSON(a.geometry, {
          style: { color, weight: 3, fillColor: color, fillOpacity: 0.18 },
        } as any);
        const safeLabel = (a.label || "Redline").replace(/</g, "&lt;");
        const popup = `<div style="min-width:160px"><div style="font-weight:600;margin-bottom:4px">${safeLabel}</div><button id="del-${a.id}" style="font-size:11px;color:#dc2626;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0">Delete redline</button></div>`;
        poly.bindPopup(popup);
        poly.on("popupopen", () => {
          const btn = document.getElementById(`del-${a.id}`);
          if (btn) btn.onclick = async () => {
            await fetch(`/api/map-annotations/${a.id}`, { method: "DELETE", credentials: "include" });
            map.closePopup();
            loadAnnotations();
          };
        });
        layer.addLayer(poly);
      } else if (a.kind === "drive_time" && a.geometry?.type === "LineString") {
        const line = L.geoJSON(a.geometry, {
          style: { color, weight: 4, opacity: 0.85 },
        } as any);
        const safeLabel = (a.label || "Drive time").replace(/</g, "&lt;");
        const popup = `<div style="min-width:160px"><div style="font-weight:600;margin-bottom:4px">${safeLabel}</div><button id="del-${a.id}" style="font-size:11px;color:#dc2626;text-decoration:underline;cursor:pointer;background:none;border:0;padding:0">Delete route</button></div>`;
        line.bindPopup(popup);
        line.on("popupopen", () => {
          const btn = document.getElementById(`del-${a.id}`);
          if (btn) btn.onclick = async () => {
            await fetch(`/api/map-annotations/${a.id}`, { method: "DELETE", credentials: "include" });
            map.closePopup();
            loadAnnotations();
          };
        });
        layer.addLayer(line);
        // Duration label at the midpoint
        const coords = a.geometry.coordinates as [number, number][];
        if (coords.length > 1) {
          const mid = coords[Math.floor(coords.length / 2)];
          const icon = L.divIcon({
            className: "",
            html: `<div style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.2);transform:translate(-50%,-50%);">${safeLabel}</div>`,
          });
          layer.addLayer(L.marker([mid[1], mid[0]], { icon }));
        }
      }
    }
  }, [annotations, showAnnotations, hiddenLayerIds, loadAnnotations]);

  // ── HMLR title polygons overlay ─────────────────────────────────────────
  // Fetches polygons in the current viewport when the layer is on; debounced
  // so panning around doesn't hammer Postgres. Server caps at 500 polygons
  // and returns nothing if the bbox is too wide (zoom-in nudge).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showHmlrTitles) {
      if (hmlrLayerRef.current) {
        map.removeLayer(hmlrLayerRef.current);
        hmlrLayerRef.current = null;
      }
      setHmlrPolygons(null);
      return;
    }
    let cancelled = false;
    const fetchForBounds = async () => {
      const b = map.getBounds();
      try {
        const url = `/api/hmlr-polygons-in-bbox?n=${b.getNorth()}&s=${b.getSouth()}&e=${b.getEast()}&w=${b.getWest()}`;
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setHmlrPolygons(data);
      } catch {}
    };
    fetchForBounds();
    const onMove = () => { window.clearTimeout((map as any)._hmlrDebounce); (map as any)._hmlrDebounce = window.setTimeout(fetchForBounds, 600); };
    map.on("moveend", onMove);
    return () => { cancelled = true; map.off("moveend", onMove); };
  }, [showHmlrTitles]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (hmlrLayerRef.current) {
      map.removeLayer(hmlrLayerRef.current);
      hmlrLayerRef.current = null;
    }
    if (!showHmlrTitles || !hmlrPolygons?.features?.length) return;
    const group = L.layerGroup().addTo(map);
    // Colour by tenure — freehold = blue, leasehold = orange, unknown = grey.
    // Matches the legend below the layer toggle in the sidebar.
    const styleFor = (tenure: string) => {
      if (tenure === "freehold") return { color: "#1e40af", weight: 1.5, fillColor: "#3b82f6", fillOpacity: 0.12 };
      if (tenure === "leasehold") return { color: "#c2410c", weight: 1.5, fillColor: "#f97316", fillOpacity: 0.12 };
      return { color: "#6b7280", weight: 1.2, fillColor: "#9ca3af", fillOpacity: 0.06, dashArray: "3 3" };
    };
    const gj = L.geoJSON(hmlrPolygons, {
      style: (feat: any) => styleFor(feat?.properties?.tenure || "unknown") as any,
      onEachFeature: (feat: any, lyr: any) => {
        const title = feat?.properties?.titleNumber || "Title";
        const tenure = feat?.properties?.tenure || "unknown";
        const tenurePill = tenure === "freehold"
          ? `<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">FREEHOLD</span>`
          : tenure === "leasehold"
            ? `<span style="background:#ffedd5;color:#c2410c;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">LEASEHOLD</span>`
            : `<span style="background:#f3f4f6;color:#374151;padding:1px 6px;border-radius:3px;font-size:10px;font-weight:600">UNKNOWN</span>`;
        lyr.bindPopup(`<div style="font-weight:600">${title}</div><div style="margin-top:4px">${tenurePill}</div><div style="font-size:11px;color:#6b7280;margin-top:4px">Region: ${feat?.properties?.region || "—"}</div>`);
      },
    } as any);
    group.addLayer(gj);
    hmlrLayerRef.current = group;
  }, [hmlrPolygons, showHmlrTitles]);

  // ── Postcode boundary highlight ────────────────────────────────────────
  // Type a postcode → red rectangle on the map. Calls postcodes.io via
  // /api/postcode-boundary/:postcode, which returns the centroid + bbox.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (postcodeLayerRef.current) {
      map.removeLayer(postcodeLayerRef.current);
      postcodeLayerRef.current = null;
    }
    if (!postcodeBoundary?.geojson) return;
    const group = L.layerGroup().addTo(map);
    const gj = L.geoJSON(postcodeBoundary.geojson, {
      style: { color: "#dc2626", weight: 3, fillColor: "#dc2626", fillOpacity: 0.08, dashArray: "6 4" },
    } as any);
    group.addLayer(gj);
    // Postcode label at the centroid
    const labelIcon = L.divIcon({
      className: "",
      html: `<div style="background:#dc2626;color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.3);transform:translate(-50%,-50%);">${postcodeBoundary.postcode}</div>`,
    });
    group.addLayer(L.marker([postcodeBoundary.lat, postcodeBoundary.lng], { icon: labelIcon }));
    postcodeLayerRef.current = group;
    map.flyToBounds(
      [[postcodeBoundary.south, postcodeBoundary.west], [postcodeBoundary.north, postcodeBoundary.east]],
      { padding: [40, 40], duration: 0.8 } as any,
    );
  }, [postcodeBoundary]);

  // Decode a Google Maps "overview_polyline" string into [lat,lng] pairs.
  // Pure-JS implementation of the algorithm from Google's docs — no
  // external dependency.
  function decodeGooglePolyline(str: string): [number, number][] {
    const out: [number, number][] = [];
    let lat = 0, lng = 0, i = 0;
    while (i < str.length) {
      let b: number, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lat * 1e-5, lng * 1e-5]);
    }
    return out;
  }

  const highlightPostcode = useCallback(async () => {
    const q = postcodeQuery.trim();
    if (!q) return;
    try {
      const r = await fetch(`/api/postcode-boundary/${encodeURIComponent(q)}`, { credentials: "include" });
      if (!r.ok) { setPostcodeBoundary(null); return; }
      const data = await r.json();
      setPostcodeBoundary(data);
    } catch {}
  }, [postcodeQuery]);

  // Map Experian Goad `Category` strings onto the 6-band palette below.
  // Kept in this file (not goad-taxonomy.ts) because the server-side
  // taxonomy operates on synthesised data with different field names.
  const classifyGoadCategory = useCallback((rawCategory: string, activity: string): string => {
    const c = (rawCategory || "").toUpperCase();
    const a = (activity || "").toUpperCase();
    if (a === "VACANT" || c.startsWith("VACANT")) return "vacant";
    if (c === "OFFICES" || c.includes("BANK") || c.includes("BUILDING SOC") || c.includes("ESTATE AGENT") ||
        c.includes("SOLICITOR") || c.includes("POST OFFICE") || c.includes("TRAVEL AGENT") ||
        c.includes("INSURANCE") || c.includes("ACCOUNTANT") || c.includes("EMPLOYMENT") ||
        c.includes("BUREAU") || c.includes("REPAIRS") || c.includes("CAR PARK")) return "services";
    if (c.includes("RESTAURANT") || c.includes("CAFE") || c.includes("PUB") || c === "BARS & WINE BARS" ||
        c.includes("TAKE AWAY") || c.includes("BAKER") || c.includes("FAST FOOD") || c.includes("WINE")) return "fnb";
    if (c.includes("HEALTH & BEAUTY") || c.includes("COSMETICS") || c.includes("HAIRDRESS") ||
        c.includes("BARBER") || c.includes("BEAUTY SALON") || c.includes("SPA")) return "beauty";
    if (c.includes("LADIES") || c.includes("MENS WEAR") || c.includes("FOOTWEAR") || c.includes("JEWEL") ||
        c.includes("ART ") || c === "ART & ART DEALERS" || c.includes("CHILDREN") ||
        c.includes("HANDBAGS") || c.includes("SPORTS GOODS") || c.includes("TOYS") ||
        c.includes("HOUSEHOLD GOODS") || c.includes("FURNITURE") || c.includes("ELECTRICAL") ||
        c.includes("CHARITY") || c.includes("BOOKS") || c.includes("MUSIC")) return "fashion";
    if (c.includes("SUPERMARKET") || c.includes("GROCER") || c.includes("BUTCHER") || c.includes("FISHMONGER") ||
        c.includes("CONVENIENCE") || c.includes("OFF LICEN") || c.includes("NEWSAGENT") ||
        c.includes("CHEMIST") || c.includes("PHARMACY") || c.includes("FRUIT") || c.includes("VEGET")) return "convenience";
    return "other";
  }, []);

  // Render the licensed Goad polygons. Re-runs when the dataset arrives
  // or the user toggles a band filter. Polygons live in retailMarkersRef
  // (despite the legacy name — kept so the panel toggle still binds).
  useEffect(() => {
    if (!mapRef.current) return;
    if (!retailMarkersRef.current) {
      retailMarkersRef.current = L.layerGroup({ pane: "goadPane" } as any).addTo(mapRef.current);
    }
    if (!retailLabelLayerRef.current) {
      retailLabelLayerRef.current = L.layerGroup({ pane: "goadLabelPane" } as any).addTo(mapRef.current);
    }
    retailMarkersRef.current.clearLayers();
    retailLabelLayerRef.current.clearLayers();
    if (!showRetailContext) return;

    const COLOURS: Record<string, { fill: string; stroke: string; label: string }> = {
      fashion:     { fill: "#C9A961", stroke: "#8A7237", label: "Fashion & Comparison" },
      convenience: { fill: "#7FA99B", stroke: "#4F7064", label: "Convenience & Food Retail" },
      fnb:         { fill: "#D08F6E", stroke: "#8A5A3F", label: "Food & Beverage" },
      services:    { fill: "#8B9DC3", stroke: "#5C6E94", label: "Services" },
      beauty:      { fill: "#B8A4B6", stroke: "#7C6A7A", label: "Beauty & Personal Care" },
      vacant:      { fill: "#FF7D00", stroke: "#B25600", label: "Vacant" },
      other:       { fill: "#A8A8A8", stroke: "#707070", label: "Other / Unknown" },
    };

    const currentZoom = mapRef.current?.getZoom() ?? 0;
    // West End polygons are tiny — labels only become readable at 18+.
    const showLabels = currentZoom >= 18;

    for (const feature of goadFeatures) {
      const props = feature.properties || {};
      const category = props._group || classifyGoadCategory(props.Category || "", props.Activity || "");
      if (excludedRetailCategories.has(category)) continue;
      const style = COLOURS[category] || COLOURS.other;

      const polygon = L.geoJSON(feature, {
        pane: "goadPane",
        style: () => ({
          fillColor: style.fill,
          color: style.stroke,
          weight: 0.8,
          opacity: 1,
          fillOpacity: 0.7,
        }),
      } as any);

      const fascia = (props.FasciaMas || props.Fascia || "").trim();
      const activity = (props.PrimaryAc || props.Activity || "").trim();
      const tenant = fascia || activity || "(no fascia)";
      const isVacant = category === "vacant";
      const num = (props.StreetNum || "").trim();
      const street = (props.StreetName || "").trim();
      const postcode = (props.Postcode || "").trim();
      const holding = (props.HoldingCo || "").trim();
      const useClass = (props.UseClass || "").trim();
      const sqft = props.Area_ft2;
      const subclass = props.Subclass || "";
      const floor =
        subclass === "Retailgf" ? "Ground" :
        subclass === "Retaillg" ? "Lower Ground" :
        subclass === "Retailf1" ? "First Floor" :
        subclass === "Retailf2" ? "Second Floor" : "";

      const centroidLng = parseFloat(props.Centroid_X);
      const centroidLat = parseFloat(props.Centroid_Y);
      polygon.on("click", (e: L.LeafletMouseEvent) => {
        // Stop the click bubbling to the map's general click handler —
        // otherwise both the polygon panel (Goad data) and the map-click
        // panel (reverse-geocoded) would fight to open the side panel.
        L.DomEvent.stopPropagation(e);
        setGoadPanelUnit({
          tenant,
          activity,
          category: props.Category,
          band: style.label,
          bandFill: style.fill,
          useClass,
          floor,
          sqft,
          holding,
          num,
          street,
          postcode,
          isVacant,
          goadNumber: props.GoadNumber,
          precName: props.PrecName,
          surveyDate: props.SurveyDate,
          lat: Number.isFinite(centroidLat) ? centroidLat : undefined,
          lng: Number.isFinite(centroidLng) ? centroidLng : undefined,
        });
      });

      retailMarkersRef.current.addLayer(polygon);

      // Fascia label — Goad-plan style, constrained to the polygon's
      // actual on-screen bounding box. No more labels overflowing into
      // adjacent units: we measure the polygon in pixels at the current
      // zoom and clamp font + width to that. If the text won't fit even
      // at the smallest readable size, we hide the label entirely.
      const ft2Raw = Number(sqft) || 0;
      const map = mapRef.current;
      if (showLabels && map && fascia && !isVacant && ft2Raw >= 80) {
        const ring: [number, number][] | undefined = feature.geometry?.coordinates?.[0];
        const cx = parseFloat(props.Centroid_X);
        const cy = parseFloat(props.Centroid_Y);
        if (Array.isArray(ring) && ring.length > 2 && Number.isFinite(cx) && Number.isFinite(cy)) {
          // 1) Project every vertex to screen pixels at the current zoom.
          //    Working in screen space (where Y points DOWN) means PCA
          //    angle plugs straight into CSS rotate() without sign
          //    gymnastics — that was the bug in the previous attempts.
          const screenPts = (ring.slice(0, -1) as [number, number][]).map(
            ([lng, lat]) => map.latLngToLayerPoint([lat, lng]),
          );
          if (screenPts.length < 3) continue;

          // Axis-aligned bbox — only used to decide whether the unit is
          // big enough to bother labelling.
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of screenPts) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          const widthPx = Math.max(0, maxX - minX);
          const heightPx = Math.max(0, maxY - minY);
          if (Math.min(widthPx, heightPx) < 14 || Math.max(widthPx, heightPx) < 30) {
            // too small — no label
          } else {
            // 2) PCA on the screen-pixel vertices → angle of the long
            //    axis. Because we're in screen space, this angle plugs
            //    straight into CSS transform: rotate() with no sign flip.
            let mx = 0, my = 0;
            for (const p of screenPts) { mx += p.x; my += p.y; }
            mx /= screenPts.length; my /= screenPts.length;
            let cxx = 0, cxy = 0, cyy = 0;
            for (const p of screenPts) {
              const dx = p.x - mx;
              const dy = p.y - my;
              cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
            }
            const angleRad = 0.5 * Math.atan2(2 * cxy, cxx - cyy);

            // 3) Project every vertex onto (long axis, short axis) so we
            //    know the true space available for text along the shop's
            //    length, not the wider axis-aligned bbox.
            const ca = Math.cos(angleRad);
            const sa = Math.sin(angleRad);
            let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
            for (const p of screenPts) {
              const u = (p.x - mx) * ca + (p.y - my) * sa;       // along long axis
              const v = -(p.x - mx) * sa + (p.y - my) * ca;      // perpendicular
              if (u < minU) minU = u; if (u > maxU) maxU = u;
              if (v < minV) minV = v; if (v > maxV) maxV = v;
            }
            const longPx = maxU - minU;
            const shortPx = maxV - minV;

            // 4) Keep text right-side-up — never upside-down. CSS rotation
            //    is CW positive (screen-y points down), so the angle in
            //    radians from atan2 maps directly to degrees here.
            let deg = (angleRad * 180) / Math.PI;
            if (deg > 90) deg -= 180;
            if (deg < -90) deg += 180;

            // 4b) HORIZONTAL FIRST. Even on a clearly elongated narrow
            //     strip, a short fascia like 'VERTEX' or 'MISTO' reads
            //     better horizontally than rotated 90°. Only commit to
            //     a rotated label when horizontal genuinely can't fit.
            const fontFor = (long: number, short: number) => {
              const safeLong = Math.max(0, long - 6);
              const safeShort = Math.max(6, short - 2);
              const byLength = (safeLong / Math.max(fascia.length, 1)) / 0.55;
              const byHeight = safeShort * 0.9;
              return Math.floor(Math.min(13, Math.min(byLength, byHeight)));
            };
            const horizontalFont = fontFor(widthPx, heightPx);
            const rotatedFont = fontFor(longPx, shortPx);
            // Prefer horizontal whenever it gives ≥ 7px AND isn't dramatically
            // smaller than the rotated alternative (within 2px). The PCA
            // angle is only used when rotating actually buys us a much bigger,
            // readable font — typically the case for very long fascias on
            // very narrow strips ('CHARLES TYRWHITT, BAR DES PRES' etc.).
            // Never run a fascia near-vertical — that's the "names in the
            // wrong direction" bug (deep narrow units whose PCA long-axis is
            // the depth, perpendicular to the street). Goad keeps names along
            // the frontage, so for steep angles prefer a horizontal label —
            // smaller / truncated if need be — over rotating it upright.
            // ALWAYS horizontal. Rotating to the polygon's principal axis kept
            // producing wrong-angle / near-vertical labels on narrow + angled
            // units (the "names in the wrong direction" complaint, 7 attempts
            // deep). Horizontal-with-truncation is predictable and readable —
            // long fascias ellipsis-clip via the wrapper below. We accept the
            // odd truncated name over ever rendering one sideways.
            void rotatedFont; void longPx; void shortPx; // rotation deliberately unused now
            deg = 0;
            let fontPx: number = horizontalFont >= 5 ? horizontalFont : 0; // hide only if unreadably small

            const textBudget = deg === 0 ? widthPx : longPx;
            const shortBudget = deg === 0 ? heightPx : shortPx;
            const safeLong = Math.max(0, textBudget - 6);
            const safeShort = Math.max(6, shortBudget - 2);
            // Skip entirely if the smallest readable font won't fit —
            // better than overflow.
            if (fontPx >= 7) {
              void safeShort; // size already chosen above; keep for future use
              const innerWidth = Math.round(safeLong);
              // Outer wrapper matches the polygon's screen bbox so
              // overflow:hidden tightly clips anything that escapes.
              const outerW = Math.round(widthPx + 2);
              const outerH = Math.round(Math.max(heightPx, fontPx + 2) + 2);
              const label = L.marker([cy, cx], {
                interactive: false,
                pane: "goadLabelPane",
                icon: L.divIcon({
                  className: "",
                  html: `<div data-goad-label-v5="1" style="width:${outerW}px;height:${outerH}px;display:flex;align-items:center;justify-content:center;pointer-events:none;overflow:hidden;"><div style="font-family:'Helvetica Neue Condensed','Arial Narrow','Helvetica',sans-serif;font-size:${fontPx}px;font-weight:600;letter-spacing:-0.2px;color:#0a0a0a;text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 2px #fff;text-align:center;white-space:nowrap;width:${innerWidth}px;max-width:${innerWidth}px;overflow:hidden;text-overflow:ellipsis;transform:rotate(${deg.toFixed(1)}deg);transform-origin:center;text-transform:uppercase;line-height:1;">${fascia}</div></div>`,
                  iconSize: [outerW, outerH],
                  iconAnchor: [outerW / 2, outerH / 2],
                }),
              });
              retailLabelLayerRef.current.addLayer(label);
            }
          }
        }
      }
    }
  }, [showRetailContext, goadFeatures, excludedRetailCategories, classifyGoadCategory, mapZoom]);

  // When a Goad polygon is clicked, fetch BGP context (CRM properties at
  // this address, recent deals, parent-company match by HoldingCo).
  useEffect(() => {
    if (!goadPanelUnit) {
      setGoadPanelContext(null);
      setTenantVerifyState({ loading: false, result: null, error: null });
      setTenantCreateState({ loading: false, companyId: null, error: null });
      return;
    }
    let cancelled = false;
    setGoadPanelLoading(true);
    // Reset the per-click tenant-resolver lifecycle whenever the user
    // opens a different polygon.
    setTenantVerifyState({ loading: false, result: null, error: null });
    setTenantCreateState({ loading: false, companyId: null, error: null });
    const params = new URLSearchParams();
    if (goadPanelUnit.postcode) params.set("postcode", goadPanelUnit.postcode);
    if (goadPanelUnit.num) params.set("streetNum", goadPanelUnit.num);
    if (goadPanelUnit.street) params.set("street", goadPanelUnit.street);
    if (goadPanelUnit.holding) params.set("holding", goadPanelUnit.holding);
    if (goadPanelUnit.tenant) params.set("fascia", goadPanelUnit.tenant);
    if (goadPanelUnit.lat) params.set("lat", String(goadPanelUnit.lat));
    if (goadPanelUnit.lng) params.set("lng", String(goadPanelUnit.lng));
    fetch(`/api/goad/polygon-context?${params}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setGoadPanelContext(data || { crmProperties: [], deals: [], parentCompany: null, parentCompanyCandidates: [], landRegistry: null, rates: [], planningApplications: [], pathwayRun: null, tenantCompany: null, tenantCompanyCandidates: [] });
      })
      .catch(() => { /* swallow — panel still shows raw Goad data */ })
      .finally(() => { if (!cancelled) setGoadPanelLoading(false); });
    return () => { cancelled = true; };
  }, [goadPanelUnit]);

  // ─── OS Data Layers: fetch buildings / sites on map move ─────────
  const [highlightedBuildingLayer, setHighlightedBuildingLayer] = useState<L.GeoJSON | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const fetchOSData = () => {
      if (osDebounceRef.current) clearTimeout(osDebounceRef.current);
      osDebounceRef.current = setTimeout(() => {
        const bounds = map.getBounds();
        const zoom = map.getZoom();
        const bboxStr = `${bounds.getSouth().toFixed(4)},${bounds.getWest().toFixed(4)},${bounds.getNorth().toFixed(4)},${bounds.getEast().toFixed(4)}`;
        const headers: Record<string, string> = { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` };

        // ── Buildings (zoom >= 16) ──
        // Suppress OS Buildings while Retail Context is on — Goad polygons
        // already outline every building and stacking the two produces the
        // blue-tinted double-border that Woody flagged.
        if (showOSBuildings && !showRetailContext && zoom >= 16) {
          if (bboxStr !== osLastBboxRef.current.buildings) {
            osLastBboxRef.current.buildings = bboxStr;
            fetch(`/api/os/buildings?bbox=${bboxStr}`, { headers })
              .then(r => r.ok ? r.json() : null)
              .then(geojson => {
                if (!geojson?.features || !osBuildingLayerRef.current) return;
                osBuildingLayerRef.current.clearLayers();
                const layer = L.geoJSON(geojson, {
                  pane: "osPane",
                  style: () => ({
                    fillColor: "#3b82f6",
                    fillOpacity: 0.15,
                    color: "#2563eb",
                    weight: 1.5,
                    opacity: 0.6,
                  }),
                  onEachFeature: (_feature: any, featureLayer: any) => {
                    featureLayer.on("click", (e: any) => {
                      L.DomEvent.stopPropagation(e);
                      // Highlight clicked building
                      if (highlightedBuildingLayer) {
                        highlightedBuildingLayer.setStyle({
                          fillOpacity: 0.15,
                        });
                      }
                      featureLayer.setStyle({ fillOpacity: 0.4 });
                      setHighlightedBuildingLayer(featureLayer);

                      // Calculate area from geometry
                      const geom = _feature.geometry;
                      let areaSqm = 0;
                      if (geom?.type === "Polygon" || geom?.type === "MultiPolygon") {
                        const coords = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
                        for (const poly of coords) {
                          const ring = poly[0];
                          if (!ring) continue;
                          const latLngs = ring.map((c: number[]) => [c[1], c[0]] as [number, number]);
                          areaSqm += polygonAreaSqM(latLngs);
                        }
                      }
                      areaSqm = Math.round(areaSqm);

                      // Compute centroid
                      const bounds = featureLayer.getBounds();
                      const center = bounds.getCenter();

                      const popupContent = document.createElement("div");
                      popupContent.innerHTML = `
                        <div style="font-size:12px;max-width:250px">
                          <strong>Building</strong> &middot; ${areaSqm > 0 ? `${areaSqm}m&sup2;` : "area unknown"}
                          <br/><span style="color:#666;font-size:10px">${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}</span>
                          <br/><button id="os-investigate-btn" style="margin-top:6px;padding:4px 10px;background:#4f46e5;color:white;border:none;border-radius:4px;font-size:11px;cursor:pointer">Investigate ownership</button>
                        </div>
                      `;
                      const popup = L.popup({ closeButton: true, offset: L.point(0, -5) })
                        .setLatLng(center)
                        .setContent(popupContent)
                        .openOn(map);

                      // Attach click handler for investigate button
                      setTimeout(() => {
                        const btn = document.getElementById("os-investigate-btn");
                        if (btn) {
                          btn.addEventListener("click", async () => {
                            popup.close();
                            // Reverse geocode centroid to get postcode
                            try {
                              const rgResp = await fetch(`/api/reverse-geocode?lat=${center.lat}&lng=${center.lng}`, { headers });
                              if (!rgResp.ok) return;
                              const rgData = await rgResp.json();
                              if (rgData.postcode) {
                                setSelectedPostcode(rgData.postcode);
                                setCurrentArea(rgData.displayAddr || rgData.postcode);
                                loadPropertyData(rgData.postcode, undefined, rgData.displayAddr || undefined, { lat: center.lat, lng: center.lng });
                              }
                            } catch (err) {
                              console.error("[os-buildings] Reverse geocode error:", err);
                            }
                          });
                        }
                      }, 50);
                    });
                  },
                });
                osBuildingLayerRef.current.addLayer(layer);
              })
              .catch(err => console.error("[os-buildings] fetch error:", err));
          }
        } else if (osBuildingLayerRef.current) {
          osBuildingLayerRef.current.clearLayers();
          osLastBboxRef.current.buildings = "";
        }

        // ── Named Sites (zoom >= 14) ──
        if (showOSSites && zoom >= 14) {
          if (bboxStr !== osLastBboxRef.current.sites) {
            osLastBboxRef.current.sites = bboxStr;
            fetch(`/api/os/sites?bbox=${bboxStr}`, { headers })
              .then(r => r.ok ? r.json() : null)
              .then(geojson => {
                if (!geojson?.features || !osSiteLayerRef.current) return;
                osSiteLayerRef.current.clearLayers();
                for (const feature of geojson.features) {
                  const props = feature.properties || {};
                  const theme = (props.SiteTheme || props.Theme || "").toLowerCase();
                  const name = props.DistinctiveName1 || props.SiteName || props.Name || "Site";

                  let color = "#6b7280"; // gray default
                  if (theme.includes("transport")) color = "#3b82f6";
                  else if (theme.includes("education")) color = "#22c55e";
                  else if (theme.includes("health")) color = "#ef4444";
                  else if (theme.includes("water")) color = "#06b6d4";

                  // Get a center point from the geometry
                  let center: L.LatLng | null = null;
                  if (feature.geometry?.type === "Point") {
                    center = L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
                  } else {
                    try {
                      const gj = L.geoJSON(feature);
                      center = gj.getBounds().getCenter();
                    } catch { continue; }
                  }
                  if (!center) continue;

                  const marker = L.circleMarker(center, {
                    radius: 5,
                    fillColor: color,
                    color: "#fff",
                    weight: 1.5,
                    opacity: 1,
                    fillOpacity: 0.85,
                    pane: "osSitePane",
                  });
                  marker.bindTooltip(name, {
                    permanent: zoom >= 16,
                    direction: "top",
                    offset: L.point(0, -6),
                    className: "text-[10px]",
                  });
                  marker.bindPopup(`
                    <div style="font-size:12px;max-width:220px">
                      <strong>${name}</strong>
                      ${theme ? `<br/><span style="color:${color};font-size:10px;text-transform:capitalize">${theme}</span>` : ""}
                    </div>
                  `, { closeButton: false, offset: L.point(0, -5) });
                  osSiteLayerRef.current.addLayer(marker);
                }
              })
              .catch(err => console.error("[os-sites] fetch error:", err));
          }
        } else if (osSiteLayerRef.current) {
          osSiteLayerRef.current.clearLayers();
          osLastBboxRef.current.sites = "";
        }
      }, 500);
    };

    // Fetch on mount and on map move
    fetchOSData();
    map.on("moveend", fetchOSData);

    return () => {
      map.off("moveend", fetchOSData);
      if (osDebounceRef.current) clearTimeout(osDebounceRef.current);
    };
  }, [showOSBuildings, showOSSites, showRetailContext, mapZoom]);

  // ─── Tenancy Plans layer fetch + render ────────────────────────────────
  // Refetches on map move. Polygons are drawn with a thick red stroke
  // so they read as 'BGP tenancy data' rather than generic OS shapes.
  // Click handler is wired the same way as Goad polygons — opens the
  // unified side panel via setGoadPanelUnit with the plan's metadata.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!tenancyPlansLayerRef.current) {
      tenancyPlansLayerRef.current = L.layerGroup({ pane: "goadPane" } as any).addTo(map);
    }
    const layer = tenancyPlansLayerRef.current;
    if (!showTenancyPlans) {
      layer.clearLayers();
      setTenancyPlanCount(0);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const bounds = map.getBounds();
      const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
      try {
        const r = await fetch(`/api/property-plans/in-viewport?bbox=${bbox}`, {
          credentials: "include",
          headers: getAuthHeaders(),
        });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        layer.clearLayers();
        let count = 0;
        for (const plan of (data.plans || []) as any[]) {
          const gj = plan.geojson;
          if (!gj?.features) continue;
          const gjLayer = L.geoJSON(gj, {
            pane: "goadPane",
            style: () => ({
              fillColor: "#fee2e2",
              fillOpacity: 0.35,
              color: "#dc2626",
              weight: 1.4,
              opacity: 0.95,
            }),
            onEachFeature: (feature: any, lyr: any) => {
              const props = feature?.properties || {};
              const unitRef = props.unit_ref || props.UNIT_REF || props.Unit || props.unit_number || "";
              lyr.bindTooltip(
                `<div style="font-family:sans-serif;font-size:11px"><strong>${unitRef || plan.property_name || "Unit"}</strong>${plan.floor ? `<br/><span style="color:#666">${plan.floor}</span>` : ""}</div>`,
                { sticky: true, opacity: 0.95 },
              );
              lyr.on("click", (e: any) => {
                L.DomEvent.stopPropagation(e);
                setGoadPanelUnit({
                  tenant: unitRef || plan.property_name || "Tenancy plan unit",
                  activity: "",
                  category: "Tenancy plan",
                  band: plan.floor || "Plan",
                  bandFill: "#fee2e2",
                  useClass: "",
                  floor: plan.floor || "",
                  sqft: props.sqft || props.area_ft2 || 0,
                  holding: "",
                  num: "",
                  street: "",
                  postcode: "",
                  isVacant: false,
                  goadNumber: "",
                  precName: plan.property_name || "",
                  surveyDate: "",
                  lat: e?.latlng?.lat,
                  lng: e?.latlng?.lng,
                  source: "tenancy-plan",
                  unitRef,
                  planId: plan.id,
                  propertyId: plan.property_id,
                });
              });
            },
          });
          gjLayer.addTo(layer);
          count += Array.isArray(gj.features) ? gj.features.length : 0;
        }
        if (!cancelled) setTenancyPlanCount(count);
      } catch { /* ignore */ }
    };
    refresh();
    const onMove = () => refresh();
    map.on("moveend", onMove);
    return () => { cancelled = true; map.off("moveend", onMove); };
  }, [showTenancyPlans]);

  const handleSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const resp = await fetch(`/api/address-search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setSearchResults(data.results || []);
      }
    } catch (e) {
      console.error("Search error:", e);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    if (suppressSearchRef.current) {
      suppressSearchRef.current = false;
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => handleSearch(searchQuery), 400);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [searchQuery, handleSearch]);

  const selectSearchResult = (result: SearchResult) => {
    if (result.lat && result.lng && mapRef.current) {
      mapRef.current.flyTo([result.lat, result.lng], 18, { duration: 0.8 });
      const areaName = result.label.split(",")[0]?.split("—")[0]?.trim() || result.postcode;
      setCurrentArea(areaName);
      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.circleMarker([result.lat, result.lng], {
        radius: 8, fillColor: "#6366f1", color: "#fff", weight: 2.5, opacity: 1, fillOpacity: 0.9,
      }).addTo(mapRef.current).bindPopup(`<strong>${areaName}</strong><br/><span style="color:#666;font-size:11px">${result.postcode}</span>`, { closeButton: false, offset: L.point(0, -5) }).openPopup();
    }
    const addressPart = result.label.split("—")[0]?.trim() || "";
    setSelectedPostcode(result.postcode);
    loadPropertyData(result.postcode, undefined, addressPart || undefined, result.lat && result.lng ? { lat: result.lat, lng: result.lng } : null);
    setSearchResults([]);
    suppressSearchRef.current = true;
    setSearchQuery(result.label);
  };

  // Auto-search when navigating from Investigation Board
  useEffect(() => {
    if (!initialSearch?.address && !initialSearch?.postcode) return;
    const query = initialSearch.address || initialSearch.postcode || "";
    if (!query) return;

    // If we have a postcode, load property data directly
    if (initialSearch.postcode) {
      suppressSearchRef.current = true;
      setSearchQuery(query);
      setSelectedPostcode(initialSearch.postcode);
      loadPropertyData(initialSearch.postcode, undefined, initialSearch.address || undefined);
    } else {
      // Otherwise trigger an address search
      suppressSearchRef.current = false;
      setSearchQuery(query);
    }
    onSearchConsumed?.();
  }, [initialSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const [activePdLayers, setActivePdLayers] = useState<string[]>(["core"]);
  const [loadingLayer, setLoadingLayer] = useState<string | null>(null);

  const loadPropertyData = async (postcode: string, pdLayers?: string[], address?: string, coords?: { lat: number; lng: number } | null) => {
    setLoadingData(true);
    setPropertyData(null);
    const layersParam = pdLayers || ["core"];
    setActivePdLayers(layersParam);
    try {
      let url = `/api/property-lookup?postcode=${encodeURIComponent(postcode)}&layers=core&propertyDataLayers=${layersParam.join(",")}`;
      if (address) url += `&address=${encodeURIComponent(address)}`;
      const authHeaders = { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` };

      // Three-way parallel fetch. Priority order:
      //   1. Stored Pathway run (gold — curated titles with verified proprietors)
      //   2. Live Land Registry resolve (UPRN-first match, fallback to street/postcode)
      //   3. Legacy property-lookup (still provides VOA, planning, prices, EPC)
      // If a Pathway run exists, its title data overrides the raw resolve output.
      const pathwayParams = new URLSearchParams();
      if (address) pathwayParams.set("address", address);
      if (postcode) pathwayParams.set("postcode", postcode);
      const [propResp, resolveResp, pathwayResp] = await Promise.all([
        fetch(url, { headers: authHeaders }),
        (address || coords)
          ? fetch("/api/land-registry/resolve", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", ...authHeaders },
              body: JSON.stringify({ address, postcode, lat: coords?.lat, lng: coords?.lng }),
            }).catch(() => null)
          : Promise.resolve(null),
        (address || postcode)
          ? fetch(`/api/property-pathway/latest?${pathwayParams.toString()}`, { headers: authHeaders }).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (propResp.ok) {
        const data = await propResp.json();

        // Layer 1: stored Pathway run (highest fidelity — already AI-verified).
        let pathwayRun: any = null;
        if (pathwayResp && pathwayResp.ok) {
          try { pathwayRun = await pathwayResp.json(); } catch {}
        }
        if (pathwayRun) {
          data._pathwayRun = pathwayRun;
          const stage4 = pathwayRun?.stageResults?.stage4 || {};
          const stage1 = pathwayRun?.stageResults?.stage1 || {};
          const pathwayTitles: any[] = [];
          for (const t of (stage4.titleRegisters || [])) {
            pathwayTitles.push({
              title_number: t.titleNumber,
              proprietor_name_1: t.proprietorName || stage1?.initialOwnership?.proprietorName,
              property: t.address ? [t.address] : undefined,
              _match: "uprn" as const,
              _source: "pathway" as const,
            });
          }
          if (stage1?.initialOwnership?.titleNumber && pathwayTitles.length === 0) {
            pathwayTitles.push({
              title_number: stage1.initialOwnership.titleNumber,
              proprietor_name_1: stage1.initialOwnership.proprietorName,
              property: stage1.initialOwnership.address ? [stage1.initialOwnership.address] : undefined,
              _match: "uprn" as const,
              _source: "pathway" as const,
            });
          }
          if (pathwayTitles.length > 0) {
            if (!data.propertyDataCoUk) data.propertyDataCoUk = {};
            data.propertyDataCoUk["freeholds"] = { data: pathwayTitles };
            data.propertyDataCoUk["leaseholds"] = data.propertyDataCoUk["leaseholds"] || { data: [] };
          }
        }

        // Layer 2: live Land Registry resolve (only used if Pathway data didn't
        // populate titles). Tags each row with uprn/street/postcode match quality.
        if (!pathwayRun && resolveResp && resolveResp.ok) {
          try {
            const r = await resolveResp.json();
            const taggedFreeholds = [
              ...(r?.matched?.freeholds || []).map((f: any) => ({ ...f, _match: "uprn" as const })),
              ...(r?.fallback?.freeholds || []).map((f: any) => ({ ...f, _match: "street" as const })),
              ...(r?.context?.freeholds || []).map((f: any) => ({ ...f, _match: "postcode" as const })),
            ];
            const taggedLeaseholds = [
              ...(r?.matched?.leaseholds || []).map((l: any) => ({ ...l, _match: "uprn" as const })),
              ...(r?.fallback?.leaseholds || []).map((l: any) => ({ ...l, _match: "street" as const })),
              ...(r?.context?.leaseholds || []).map((l: any) => ({ ...l, _match: "postcode" as const })),
            ];
            if (!data.propertyDataCoUk) data.propertyDataCoUk = {};
            data.propertyDataCoUk["freeholds"] = { data: taggedFreeholds };
            data.propertyDataCoUk["leaseholds"] = { data: taggedLeaseholds };
            data._landRegistryResolve = {
              matchedCount: (r?.matched?.freeholds?.length || 0) + (r?.matched?.leaseholds?.length || 0),
              fallbackCount: (r?.fallback?.freeholds?.length || 0) + (r?.fallback?.leaseholds?.length || 0),
              contextCount: (r?.context?.freeholds?.length || 0) + (r?.context?.leaseholds?.length || 0),
              source: r?.source || null,
              pdErrors: r?.pdErrors || [],
            };
          } catch (e) {
            console.warn("[edozo-map] Land Registry resolve merge failed:", e);
          }
        }
        setPropertyData(data);
      }
    } catch (e: any) {
      console.error("Property lookup error:", e);
      toast({ title: "Property lookup failed", description: e?.message || "Couldn't fetch property data. Try again.", variant: "destructive" });
    }
    setLoadingData(false);
  };

  const loadAdditionalLayer = async (layer: string) => {
    if (!postcode || !propertyData) return;
    const newLayers = [...activePdLayers, layer];
    setActivePdLayers(newLayers);
    setLoadingLayer(layer);
    try {
      const extendedLayers = layer === "market" || layer === "area" || layer === "residential" ? "core,extended" : "core";
      const url = `/api/property-lookup?postcode=${encodeURIComponent(postcode)}&layers=${extendedLayers}&propertyDataLayers=${newLayers.join(",")}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setPropertyData(data);
      }
    } catch (e) {
      console.error("Layer load error:", e);
    }
    setLoadingLayer(null);
  };

  const handleMapClick = async (lat: number, lng: number) => {
    // Street View has its own click handler — let it own clicks while on.
    if (showStreetView) return;
    try {
      const resp = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const { displayAddr, postcode } = data;
      if (!postcode) return;

      // Pull a street number + street out of the formatted address so the
      // polygon-context endpoint can narrow VOA rates / LR resolver / planning
      // apps to the right building rather than the whole postcode.
      let num = "";
      let street = "";
      if (displayAddr) {
        const m = displayAddr.match(/^(\d+[A-Z]?(?:\s*-\s*\d+[A-Z]?)?)\s+(.+?)(?:,|$)/);
        if (m) {
          num = m[1].trim();
          street = m[2].trim();
        } else {
          street = displayAddr.split(",")[0]?.trim() || "";
        }
      }

      // Open the new polygon side panel with synthesised "click-point" data.
      // Goad-specific fields are left empty; everything downstream (BGP CRM,
      // Rates, Land Registry, Planning, Pathway) still works off postcode +
      // street + lat/lng — which is what the operator actually wants when
      // clicking an OS-only building outside the West End Goad coverage.
      setGoadPanelUnit({
        tenant: displayAddr || postcode,
        activity: "",
        category: "Map click",
        band: "Click point",
        bandFill: "#94a3b8",
        useClass: "",
        floor: "",
        sqft: 0,
        holding: "",
        num,
        street: street.toUpperCase(),
        postcode,
        isVacant: false,
        goadNumber: "",
        precName: "",
        surveyDate: "",
        lat,
        lng,
      });
    } catch (e) {
      console.error("Reverse geocode error:", e);
    }
  };

  // Export the current map view as a BGP-branded PDF plan
  const exportGoadPlanPdf = async () => {
    const map = mapRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;
    setExportingPlan(true);
    try {
      // Reverse-geocode the current map centre so the header reflects
      // where the user is *now*, not the stale 'Belgravia' default
      // (or whatever address was last searched).
      let areaLabel = currentArea || postcode || "London";
      try {
        const c = map.getCenter();
        const rgResp = await fetch(`/api/reverse-geocode?lat=${c.lat}&lng=${c.lng}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
        });
        if (rgResp.ok) {
          const rg = await rgResp.json();
          // Use a sensible short label — neighbourhood / locality, not the full
          // formatted address (which can be a 100-char string). Falls back to
          // postcode then displayAddr.
          areaLabel = rg.neighbourhood || rg.locality || rg.postcode || rg.displayAddr || areaLabel;
        }
      } catch { /* offline / no key — keep existing label */ }

      const { toPng } = await import("html-to-image");
      const { jsPDF } = await import("jspdf");
      const dataUrl = await toPng(container, { cacheBust: true, pixelRatio: 2, backgroundColor: "#faf8f2" });
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;

      pdf.setFillColor(26, 26, 26);
      pdf.rect(0, 0, pageW, 14, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(11);
      pdf.setFont("helvetica", "bold");
      pdf.text("BRUCE GILLINGHAM POLLARD", margin, 9);
      pdf.setFontSize(9);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${areaLabel}  ·  Intelligence Plan  ·  ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, pageW - margin, 9, { align: "right" });

      const imgW = pageW - margin * 2;
      const imgH = pageH - 14 - margin * 2;
      pdf.addImage(dataUrl, "PNG", margin, 14 + margin, imgW, imgH, undefined, "FAST");

      pdf.setTextColor(80, 80, 80);
      pdf.setFontSize(7);
      pdf.text("Data: OS Zoomstack, OpenStreetMap, Valuation Office Agency, HM Land Registry, Google Places, Experian Goad. BGP Intelligence Map.", margin, pageH - 4);

      const filename = `BGP_Plan_${areaLabel.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`;
      pdf.save(filename);
    } catch (err: any) {
      console.error("[map] export PDF failed:", err);
      toast({ title: "Export failed", description: err?.message || "Couldn't export the plan as a PDF.", variant: "destructive" });
    } finally {
      setExportingPlan(false);
    }
  };

  const tools = [
    { key: "select", icon: MousePointer, label: "Select" },
    { key: "polygon", icon: Hexagon, label: "Polygon" },
    { key: "line", icon: Slash, label: "Line" },
    { key: "text", icon: Type, label: "Text" },
    { key: "rect", icon: Square, label: "Rectangle" },
    { key: "circle", icon: Circle, label: "Circle" },
  ];

  // Mobile bottom-sheet: the right detail panel becomes a slide-up sheet.
  // The drag handle toggles between a peek (header only) and expanded.
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  // Selecting a new unit should always open the sheet expanded.
  useEffect(() => { if (goadPanelUnit) setSheetCollapsed(false); }, [goadPanelUnit]);

  return (
    <div className="relative w-full h-full flex font-sans">
      <style>{`
        .edozo-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: #0a0a0a !important;
          font-size: 10px !important;
          font-weight: 700 !important;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.3px !important;
          white-space: pre-line !important;
          padding: 0 !important;
          text-align: center !important;
          line-height: 1.15 !important;
          /* overflow: visible so CSS-rotated labels inside the tooltip
             wrapper render past the non-rotated wrapper box; the polygon
             OBB fit check already guarantees the text stays inside the
             polygon. */
          overflow: visible !important;
          text-shadow: 0 0 2px rgba(255,255,255,0.9), 0 0 2px rgba(255,255,255,0.9), 0 0 3px rgba(255,255,255,0.7) !important;
          pointer-events: none !important;
        }
        .edozo-fs-11 { font-size: 11px !important; letter-spacing: 0.4px !important; }
        .edozo-fs-10 { font-size: 10px !important; letter-spacing: 0.3px !important; }
        .edozo-fs-9 { font-size: 9px !important; letter-spacing: 0.2px !important; }
        .edozo-fs-8 { font-size: 8px !important; letter-spacing: 0.1px !important; }
        .edozo-fs-7 { font-size: 7px !important; font-weight: 600 !important; letter-spacing: 0.05px !important; }
        .edozo-label-vacant {
          color: #555 !important;
          font-weight: 600 !important;
          font-style: italic !important;
        }
        .edozo-label::before {
          display: none !important;
        }
        .centre-tenant-icon {
          background: transparent !important;
          border: none !important;
        }
        .centre-tenant-label {
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.2px;
          color: #0a0a0a;
          text-align: center;
          line-height: 1.1;
          white-space: nowrap;
          text-shadow: 0 0 2px rgba(255,255,255,0.95), 0 0 3px rgba(255,255,255,0.8);
          pointer-events: none;
        }
        .leaflet-control-attribution {
          font-size: 9px !important;
          background: rgba(255,255,255,0.8) !important;
        }
        .leaflet-control-scale-line {
          border-color: #333 !important;
          background: rgba(255,255,255,0.7) !important;
          font-size: 10px !important;
        }
        .leaflet-container {
          background: #faf8f2 !important;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
        }
        .leaflet-tile-container img { filter: grayscale(0.35) brightness(1.02); }
      `}</style>

      <div className="w-[220px] border-r bg-white hidden lg:flex flex-col z-[1001] relative shrink-0">
        <div className="px-3 pt-3 pb-2">
          <p className="text-xs text-gray-500 mb-2.5">
            Current area: <span className="font-semibold text-gray-900">{currentArea}</span>
          </p>

          <p className="text-[11px] font-semibold mb-1.5 text-gray-700">Search new plan</p>
          {/* New resolver — same engine the Property Intelligence page-level
              bar used to call (Address Resolver: autocomplete → resolve →
              canonical crm_property). Replaces the legacy /api/address-search
              dropdown that fed loadPropertyData with stale postcode-only
              hits. When a property resolves we both navigate the map AND
              bubble the resolution up so other Property Intelligence tabs
              prefill via PropertyContext. */}
          <PropertyResolverBar
            placeholder="Address, postcode, UPRN, or title number…"
            onResolve={(id, prop) => {
              if (prop.postcode) {
                setSelectedPostcode(prop.postcode);
                loadPropertyData(prop.postcode, undefined, prop.name || undefined, null);
              }
              onResolveProperty?.({ id, name: prop.name, postcode: prop.postcode });
            }}
          />
        </div>

        <div className="border-t" />

        <div className="px-3 py-3">
          <p className="text-[11px] font-semibold text-gray-700 mb-2.5">Map Layers</p>
          <div className="space-y-2.5">
            {[
              { key: "search", label: "Search History", count: recentSearches.length, dot: "#ef4444", on: showSearchHistory, set: setShowSearchHistory },
              { key: "crm",    label: "CRM Properties", count: crmProperties.filter((p: any) => !isInvestmentComp(p)).length, dot: "#3b82f6", on: showCrmLayer, set: setShowCrmLayer },
              { key: "icomps", label: "Investment Comps", count: crmProperties.filter((p: any) => isInvestmentComp(p)).length, dot: "#8b5cf6", on: showInvestmentComps, set: setShowInvestmentComps },
              { key: "deals",  label: "Deals",          count: mapPins?.deals.length ?? 0, dot: "#f59e0b", on: showDeals, set: setShowDeals },
              { key: "comps",  label: "Comps",          count: mapPins?.comps.length ?? 0, dot: "#8b5cf6", on: showComps, set: setShowComps },
              { key: "lease",  label: "Lease Events",   count: mapPins?.leaseEvents.length ?? 0, dot: "#ec4899", on: showLeaseEvents, set: setShowLeaseEvents },
              { key: "pathway",label: "Pathway runs",   count: mapPins?.pathway?.length ?? 0, dot: "#10b981", on: showPathway, set: setShowPathway },
              { key: "avail",  label: "Available Properties", count: availableProps.length, dot: "#06b6d4", on: showAvailable, set: setShowAvailable },
              { key: "retail", label: retailFetching ? "Retail Context (loading…)" : "Retail Context", count: goadFeatures.length, dot: "#15616D", on: showRetailContext, set: setShowRetailContext },
              { key: "sv",     label: showStreetView ? "Street View (click map)" : "Street View",      count: 0, dot: "#FBBC04", on: showStreetView, set: setShowStreetView },
              { key: "osb",    label: showOSBuildings && showRetailContext ? "OS Buildings (hidden — Goad on)" : (mapZoom < 16 && showOSBuildings ? "OS Buildings (zoom 16+)" : "OS Buildings"),     count: 0, dot: "#3b82f6", on: showOSBuildings, set: setShowOSBuildings },
              { key: "oss",    label: mapZoom < 14 && showOSSites ? "Named Sites (zoom 14+)" : "Named Sites", count: 0, dot: "#15616D", on: showOSSites,     set: setShowOSSites },
              { key: "tp",     label: "Tenancy Plans",  count: tenancyPlanCount, dot: "#dc2626", on: showTenancyPlans, set: setShowTenancyPlans },
              { key: "annot",  label: "Annotations",     count: annotations.length, dot: "#a855f7", on: showAnnotations, set: setShowAnnotations },
              { key: "hmlr",   label: "HMLR Titles", count: hmlrPolygons?.features?.length ?? 0, dot: "#1e40af", on: showHmlrTitles, set: setShowHmlrTitles },
            ].map((row) => (
              <button
                key={row.key}
                onClick={() => row.set(!row.on)}
                className={`w-full flex items-center justify-between px-2 py-1.5 rounded border transition-colors ${
                  row.on ? "bg-gray-900 border-gray-900 text-white" : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
                }`}
                data-testid={`layer-toggle-${row.key}`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: row.dot }} />
                  <span className="text-[11px] font-medium">{row.label}</span>
                  {row.count > 0 && (
                    <span className={`text-[9px] ${row.on ? "text-gray-300" : "text-gray-400"}`}>({row.count})</span>
                  )}
                </div>
                <span className={`text-[9px] font-semibold ${row.on ? "text-white" : "text-gray-400"}`}>{row.on ? "ON" : "OFF"}</span>
              </button>
            ))}
          </div>
          {/* Category filter for the Retail Context layer — only shown
              when the layer is on. Click to exclude / include a band. */}
          {showRetailContext && (
            <div className="mt-3 pt-2.5 border-t">
              <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wide mb-1.5">Retail bands</p>
              {!retailFetching && goadFeatures.length === 0 && (
                <p className="text-[10px] text-gray-500 italic mb-1.5 leading-snug">
                  Loading the Goad dataset… If this persists, the layer files may be missing from data/goad/.
                </p>
              )}
              {goadFeatures.length > 0 && mapZoom < 17 && (
                <p className="text-[10px] text-gray-500 italic mb-1.5 leading-snug">
                  Zoom in (≥ 17) to see fascia labels on each unit.
                </p>
              )}
              <div className="grid grid-cols-2 gap-1">
                {[
                  { k: "fashion",     l: "Fashion",     c: "#C9A961" },
                  { k: "convenience", l: "Convenience", c: "#7FA99B" },
                  { k: "fnb",         l: "Food & Drink",c: "#D08F6E" },
                  { k: "services",    l: "Services",    c: "#8B9DC3" },
                  { k: "beauty",      l: "Beauty",      c: "#B8A4B6" },
                  { k: "vacant",      l: "Vacant",      c: "#FF7D00" },
                  { k: "other",       l: "Other",       c: "#A8A8A8" },
                ].map((cat) => {
                  const showing = !excludedRetailCategories.has(cat.k);
                  return (
                    <button
                      key={cat.k}
                      onClick={() => setExcludedRetailCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(cat.k)) next.delete(cat.k); else next.add(cat.k);
                        return next;
                      })}
                      className={`flex items-center gap-1.5 text-[10px] rounded px-1.5 py-0.5 border ${
                        showing ? "bg-white border-gray-200" : "bg-gray-100 border-gray-200 opacity-50 line-through"
                      }`}
                    >
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: cat.c }} />
                      <span>{cat.l}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* HMLR tenure legend — only shown when the layer is on. */}
        {showHmlrTitles && (
          <div className="px-3 pb-2 pt-1 flex items-center gap-3 text-[10px] text-gray-600">
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#3b82f6" }} />Freehold</div>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#f97316" }} />Leasehold</div>
            <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#9ca3af" }} />Unknown</div>
          </div>
        )}

        {/* Named annotation layers — group pins / labels / polygons /
            drive-times into a coherent set (e.g. "Brent Cross deck"),
            toggle visibility, share with the team. */}
        <div className="border-t" />
        <div className="px-3 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-700">Annotation layers</p>
            <span className="text-[10px] text-gray-400">{mapLayers.length}</span>
          </div>
          {mapLayers.length > 0 && (
            <div className="space-y-1">
              {mapLayers.map((layer) => {
                const hidden = hiddenLayerIds.has(layer.id);
                const active = activeLayerId === layer.id;
                return (
                  <div key={layer.id} className={`flex items-center gap-1.5 px-1.5 py-1 rounded border ${active ? "border-gray-900 bg-gray-50" : "border-transparent"}`}>
                    <button
                      type="button"
                      onClick={() => toggleLayerVisibility(layer.id)}
                      className="w-3 h-3 rounded-full shrink-0 border-2"
                      style={{ background: hidden ? "transparent" : (layer.color || "#a855f7"), borderColor: layer.color || "#a855f7" }}
                      aria-label={hidden ? "Show layer" : "Hide layer"}
                      title={hidden ? "Show" : "Hide"}
                    />
                    <button
                      type="button"
                      onClick={() => setActiveLayerId(layer.id)}
                      className="flex-1 min-w-0 text-left text-[11px] truncate"
                      title={`Set as active layer for new annotations · ${layer.annotationCount} item${layer.annotationCount === 1 ? "" : "s"}`}
                      data-testid={`layer-pick-${layer.id}`}
                    >
                      <span className={hidden ? "text-gray-400 line-through" : "text-gray-800"}>{layer.name}</span>
                      <span className="ml-1 text-gray-400">{layer.annotationCount}</span>
                      {layer.sharedWithTeam && <span className="ml-1 text-[9px] uppercase tracking-wider text-emerald-600">shared</span>}
                    </button>
                    {layer.mine && (
                      <button
                        type="button"
                        onClick={() => deleteMapLayer(layer.id, layer.name)}
                        className="text-[11px] text-red-500 hover:text-red-700"
                        title="Delete layer + its annotations"
                        data-testid={`layer-delete-${layer.id}`}
                      >×</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-1">
            <input
              value={newLayerName}
              onChange={(e) => setNewLayerName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createMapLayer(); } }}
              placeholder='+ new layer'
              className="flex-1 min-w-0 h-7 px-2 text-[11px] rounded border border-gray-200 focus:border-gray-400 outline-none"
              data-testid="new-layer-input"
            />
            <button
              type="button"
              onClick={createMapLayer}
              disabled={!newLayerName.trim()}
              className="h-7 px-2 rounded bg-gray-900 text-white text-[11px] font-medium disabled:opacity-40"
              data-testid="new-layer-btn"
            >Add</button>
          </div>
          {activeLayerId && (
            <p className="text-[10px] text-gray-500">
              New annotations land in {mapLayers.find((l) => l.id === activeLayerId)?.name || "current layer"}.
            </p>
          )}
        </div>

        {/* Annotation tools — drop coloured pins / text labels, plus a
            postcode-highlight box. Saves to map_annotations. */}
        <div className="border-t" />
        <div className="px-3 py-3 space-y-2.5">
          <p className="text-[11px] font-semibold text-gray-700">Annotate</p>
          <div className="flex flex-wrap gap-1.5 items-center">
            {["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#111827"].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setAnnotateColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform ${annotateColor === c ? "border-gray-900 scale-110" : "border-white"}`}
                style={{ background: c }}
                aria-label={`Pick ${c}`}
                data-testid={`annot-color-${c.slice(1)}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setAnnotateMode(annotateMode === "pin" ? null : "pin")}
              className={`px-2 py-1.5 rounded border text-[11px] font-medium ${
                annotateMode === "pin" ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:border-gray-300"
              }`}
              data-testid="annot-mode-pin"
            >
              {annotateMode === "pin" ? "Click map to drop…" : "Drop pin"}
            </button>
            <button
              type="button"
              onClick={() => setAnnotateMode(annotateMode === "label" ? null : "label")}
              className={`px-2 py-1.5 rounded border text-[11px] font-medium ${
                annotateMode === "label" ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:border-gray-300"
              }`}
              data-testid="annot-mode-label"
            >
              {annotateMode === "label" ? "Click map to place…" : "Add label"}
            </button>
            <button
              type="button"
              onClick={() => setAnnotateMode(annotateMode === "polygon" ? null : "polygon")}
              className={`px-2 py-1.5 rounded border text-[11px] font-medium ${
                annotateMode === "polygon" ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:border-gray-300"
              }`}
              data-testid="annot-mode-polygon"
            >
              {annotateMode === "polygon" ? "Click vertices · dbl-click to close" : "Redline area"}
            </button>
            <button
              type="button"
              onClick={() => setAnnotateMode(annotateMode === "drive_time" ? null : "drive_time")}
              className={`px-2 py-1.5 rounded border text-[11px] font-medium ${
                annotateMode === "drive_time" ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:border-gray-300"
              }`}
              data-testid="annot-mode-drive-time"
            >
              {annotateMode === "drive_time" ? (driveOriginRef.current ? "Click destination…" : "Click origin…") : "Drive time"}
            </button>
          </div>
          <p className="text-[10px] text-gray-500 leading-snug">
            Tap any annotation on the map to delete it. Saved per user.
          </p>
        </div>

        {/* Postcode boundary highlight — quick red rectangle around an
            outcode or unit postcode via postcodes.io. Outcodes get the
            exact bounding box; unit postcodes synth a ~250m box. */}
        <div className="border-t" />
        <div className="px-3 py-3 space-y-2">
          <p className="text-[11px] font-semibold text-gray-700">Highlight postcode</p>
          <div className="flex gap-1.5">
            <input
              value={postcodeQuery}
              onChange={(e) => setPostcodeQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); highlightPostcode(); } }}
              placeholder="SW1Y or SW1Y 4DG"
              className="flex-1 min-w-0 h-7 px-2 text-[11px] rounded border border-gray-200 focus:border-gray-400 outline-none"
              data-testid="postcode-highlight-input"
            />
            <button
              type="button"
              onClick={highlightPostcode}
              disabled={!postcodeQuery.trim()}
              className="h-7 px-2.5 rounded bg-gray-900 text-white text-[11px] font-medium disabled:opacity-50"
              data-testid="postcode-highlight-btn"
            >
              Show
            </button>
          </div>
          {postcodeBoundary && (
            <button
              type="button"
              onClick={() => { setPostcodeBoundary(null); setPostcodeQuery(""); }}
              className="text-[11px] text-red-600 hover:underline"
            >
              Clear {postcodeBoundary.postcode} highlight
            </button>
          )}
        </div>

        {/* Recent Searches — capped at a sensible chunk of the sidebar
            so it doesn't run all the way to the bottom, and tightly
            clipped so long addresses don't bleed across the divider. */}
        <div className="border-t flex flex-col overflow-hidden max-h-64">
          <div className="px-3 pt-2.5 pb-1 shrink-0">
            <p className="text-[11px] font-semibold text-gray-700">
              Recent Searches {recentSearches.length > 0 && <span className="font-normal text-gray-400">(last 10 of {recentSearches.length})</span>}
            </p>
          </div>
          <ScrollArea className="flex-1 min-h-0 overflow-hidden">
            <div className="px-3 pb-2.5">
            {recentSearches.length === 0 ? (
              <p className="text-[10px] text-gray-400 py-3 text-center">No recent searches yet.</p>
            ) : (
              <div className="space-y-1">
                {recentSearches.slice(0, 10).map((s: any) => {
                  const isAcquired = s.status === "Acquired";
                  const pinColor = isAcquired ? "text-emerald-500" : "text-red-400";
                  const ownerName = s.ownership?.freeholders?.[0]?.name;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        const coords = s.intelligence?.flood?.coordinates || s.intelligence?.planning?.coordinates;
                        if (coords?.lat && coords?.lng && mapRef.current) {
                          mapRef.current.flyTo([coords.lat, coords.lng], 17, { duration: 0.8 });
                        }
                        if (s.postcode) {
                          setSelectedPostcode(s.postcode);
                          setCurrentArea(s.address || s.postcode);
                          loadPropertyData(s.postcode, undefined, s.address || undefined, coords?.lat && coords?.lng ? { lat: coords.lat, lng: coords.lng } : null);
                        }
                      }}
                      className="w-full max-w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 transition-colors group/item overflow-hidden"
                      data-testid={`map-search-history-${s.id}`}
                    >
                      <div className="flex items-start gap-1.5 min-w-0">
                        <MapPin className={`w-3 h-3 mt-0.5 shrink-0 ${pinColor}`} />
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="text-[11px] font-medium text-gray-800 truncate leading-tight max-w-full">{s.address}</p>
                          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                            {s.postcode && <span className="text-[9px] text-gray-400 font-mono truncate">{s.postcode}</span>}
                            {s.status && s.status !== "New" && (
                              <span className={`text-[8px] px-1 py-0.5 rounded font-medium shrink-0 ${
                                isAcquired ? "bg-emerald-100 text-emerald-700" :
                                s.status === "Investigating" ? "bg-blue-100 text-blue-700" :
                                s.status === "Contacted Owner" ? "bg-amber-100 text-amber-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>{s.status}</span>
                            )}
                          </div>
                          {ownerName && (
                            <p className="text-[9px] text-gray-400 truncate mt-0.5 max-w-full">{ownerName}</p>
                          )}
                        </div>
                        <span className="text-[8px] text-gray-300 shrink-0 mt-0.5">
                          {new Date(s.created_at || s.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </ScrollArea>
        </div>
      </div>

      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full" data-testid="edozo-map" />

        {/* Google Places search — top-left so it doesn't collide with the
            Download Plan + base-layer pills at top-right. Lets Woody jump
            the map to any UK address from his phone instead of pinching
            around. On mobile this sits at ~calc(100% - 240px) width so the
            existing pills still fit on the same row; on desktop it's a
            fixed 320px. The Leaflet flyTo + marker happen via the
            handlePlaceSelected callback wired up in a useEffect. */}
        <div className="absolute top-3 left-3 z-[1000] w-[calc(100%-260px)] sm:w-[320px] max-w-[420px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              ref={placesSearchInputRef}
              type="search"
              placeholder="Search any address or place…"
              className="w-full h-10 pl-9 pr-9 rounded-full bg-white border border-border/60 shadow-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="map-places-search"
              autoComplete="off"
            />
            {placesSearchValue && (
              <button
                type="button"
                onClick={() => {
                  if (placesSearchInputRef.current) placesSearchInputRef.current.value = "";
                  setPlacesSearchValue("");
                  if (placesMarkerRef.current && mapRef.current) {
                    mapRef.current.removeLayer(placesMarkerRef.current);
                    placesMarkerRef.current = null;
                  }
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Map / Satellite base-layer pill toggle — top-right of the map */}
        <div className="absolute top-3 right-3 z-[1000] flex items-center gap-2" data-testid="base-layer-toggle">
          <button
            onClick={exportGoadPlanPdf}
            disabled={exportingPlan}
            className="bg-black text-white rounded-full shadow-lg px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 hover:bg-gray-800 disabled:opacity-60 disabled:cursor-wait"
            data-testid="export-goad-plan"
            title="Download the current map view as a BGP-branded PDF plan"
          >
            {exportingPlan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
            {exportingPlan ? "Exporting..." : "Download Plan"}
          </button>
          <div className="bg-white rounded-full shadow-lg border border-border/60 flex p-0.5">
            <button
              onClick={() => setBaseLayer("map")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${baseLayer === "map" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-50"}`}
              data-testid="base-layer-map"
            >
              Map
            </button>
            <button
              onClick={() => setBaseLayer("sat")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${baseLayer === "sat" ? "bg-black text-white" : "text-gray-700 hover:bg-gray-50"}`}
              data-testid="base-layer-sat"
            >
              Satellite
            </button>
          </div>
        </div>

        {/* Goad polygon side-panel — slides in from the right when a unit
            on the Retail Context layer is clicked. Shows Goad attributes
            up top, joins in BGP CRM + recent deals + parent company below. */}
        {goadPanelUnit && (
          <div
            className={`absolute z-[1001] bg-white shadow-2xl border border-gray-200 flex flex-col overflow-hidden transition-[max-height] duration-200 inset-x-2 bottom-2 rounded-2xl ${sheetCollapsed ? "max-h-[4.5rem]" : "max-h-[65vh]"} lg:inset-x-auto lg:top-3 lg:right-3 lg:bottom-3 lg:max-h-none lg:w-[340px] lg:rounded-lg`}
            data-testid="goad-polygon-panel"
          >
            {/* Drag handle — mobile only. Tap to peek/expand the sheet. */}
            <button
              type="button"
              onClick={() => setSheetCollapsed(v => !v)}
              className="lg:hidden w-full flex items-center justify-center pt-2 pb-1 shrink-0 touch-manipulation"
              aria-label={sheetCollapsed ? "Expand details" : "Collapse details"}
              data-testid="goad-panel-sheet-handle"
            >
              <span className="w-10 h-1.5 rounded-full bg-gray-300" />
            </button>
            <div className="px-4 py-3 border-b flex items-start gap-2" style={{ background: goadPanelUnit.bandFill + "22" }}>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {goadPanelUnit.isVacant ? "Vacant unit" : goadPanelUnit.band || "Retail"}
                </div>
                <div className="text-base font-bold text-gray-900 truncate mt-0.5">
                  {goadPanelUnit.tenant}
                </div>
                {goadPanelUnit.activity && goadPanelUnit.activity !== goadPanelUnit.tenant && (
                  <div className="text-xs text-gray-600 truncate">{goadPanelUnit.activity}</div>
                )}
              </div>
              <button
                onClick={() => setGoadPanelUnit(null)}
                className="text-gray-400 hover:text-gray-700 p-0.5"
                aria-label="Close"
                data-testid="goad-panel-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
              <div className="px-4 py-3 space-y-3 min-w-0 [overflow-wrap:anywhere]">
                {/* Address + Goad attributes */}
                <section>
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                    Goad
                  </div>
                  <div className="space-y-1 text-[12px]">
                    {(goadPanelUnit.num || goadPanelUnit.street) && (
                      <div className="text-gray-800">
                        {goadPanelUnit.num} {goadPanelUnit.street}
                      </div>
                    )}
                    {goadPanelUnit.postcode && (
                      <div className="font-mono text-gray-700">{goadPanelUnit.postcode}</div>
                    )}
                    {goadPanelUnit.precName && (
                      <div className="text-gray-600 italic">{goadPanelUnit.precName}</div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2">
                      {goadPanelUnit.category && (
                        <div>
                          <span className="text-gray-500">Category:</span>{" "}
                          <span className="text-gray-800">{goadPanelUnit.category}</span>
                        </div>
                      )}
                      {goadPanelUnit.useClass && (
                        <div>
                          <span className="text-gray-500">Use class:</span>{" "}
                          <span className="text-gray-800">{goadPanelUnit.useClass}</span>
                        </div>
                      )}
                      {goadPanelUnit.floor && (
                        <div>
                          <span className="text-gray-500">Floor:</span>{" "}
                          <span className="text-gray-800">{goadPanelUnit.floor}</span>
                        </div>
                      )}
                      {goadPanelUnit.sqft && (
                        <div>
                          <span className="text-gray-500">Area:</span>{" "}
                          <span className="text-gray-800">{Number(goadPanelUnit.sqft).toLocaleString()} sqft</span>
                        </div>
                      )}
                    </div>
                    {goadPanelUnit.holding && goadPanelUnit.holding !== "NON MULTIPLE" && (
                      <div className="pt-1.5">
                        <span className="text-gray-500">Parent: </span>
                        <span className="text-gray-800 font-medium">{goadPanelUnit.holding}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* BGP CRM matches */}
                <section className="border-t pt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center justify-between">
                    <span>BGP CRM</span>
                    {goadPanelLoading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
                  </div>
                  {!goadPanelLoading && goadPanelContext && goadPanelContext.crmProperties.length === 0 && (
                    <p className="text-[11px] text-gray-500 italic">No BGP property at this postcode.</p>
                  )}
                  {goadPanelContext?.crmProperties.map((p) => (
                    <div key={p.id} className="bg-emerald-50 border border-emerald-200 rounded p-2 mb-1.5">
                      <a href={`/properties/${p.id}`} className="block hover:underline">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-medium text-gray-900 truncate flex-1">{p.name}</span>
                          {p.status && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white text-emerald-700 border border-emerald-200 font-medium">
                              {p.status}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5">
                          {[p.asset_class, p.sqft ? `${Number(p.sqft).toLocaleString()} sqft` : null].filter(Boolean).join(" · ")}
                        </div>
                      </a>
                      {(p.landlord_id || p.freeholder_id) && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5 pt-1.5 border-t border-emerald-100">
                          {p.landlord_id && p.landlord_name && (
                            <a
                              href={`/companies/${p.landlord_id}`}
                              className="text-[10px] inline-flex items-center gap-1 bg-white border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-50"
                            >
                              <span className="text-gray-500">Landlord:</span>
                              <span className="font-medium text-gray-800 truncate max-w-[150px]">{p.landlord_name}</span>
                            </a>
                          )}
                          {p.freeholder_id && p.freeholder_name && p.freeholder_id !== p.landlord_id && (
                            <a
                              href={`/companies/${p.freeholder_id}`}
                              className="text-[10px] inline-flex items-center gap-1 bg-white border border-emerald-200 rounded px-1.5 py-0.5 hover:bg-emerald-50"
                            >
                              <span className="text-gray-500">Freeholder:</span>
                              <span className="font-medium text-gray-800 truncate max-w-[150px]">{p.freeholder_name}</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </section>

                {/* Tenant CRM match — looks up the fascia (the brand
                    currently trading) in crm_companies. Distinct from the
                    Parent company section below, which uses HoldingCo. */}
                {goadPanelContext?.tenantCompany && (
                  <section className="border-t pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                      Tenant (CRM)
                    </div>
                    <a
                      href={`/companies/${goadPanelContext.tenantCompany.id}`}
                      className="block bg-rose-50 border border-rose-200 rounded p-2 hover:bg-rose-100"
                    >
                      <div className="text-[12px] font-medium text-gray-900">{goadPanelContext.tenantCompany.name}</div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {[
                          goadPanelContext.tenantCompany.company_type,
                          goadPanelContext.tenantCompany.company_number,
                          goadPanelContext.tenantCompany.status,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </a>
                    {goadPanelContext.tenantCompanyCandidates.length > 1 && (
                      <p className="text-[9px] text-gray-400 italic mt-1">
                        +{goadPanelContext.tenantCompanyCandidates.length - 1} other possible match{goadPanelContext.tenantCompanyCandidates.length > 2 ? "es" : ""}
                      </p>
                    )}
                  </section>
                )}

                {/* Tenant resolver — fires when fascia is set but no CRM
                    match. Two explicit buttons: Verify (website footer
                    scrape + CH lookup, no DB write), Add (creates the
                    brand + fires auto-KYC + RocketReach property contacts). */}
                {goadPanelContext && !goadPanelContext.tenantCompany && goadPanelContext.tenantPlace && (
                  <section className="border-t pt-3" data-testid="goad-tenant-resolver">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                      Tenant brand · not in CRM
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-1.5">
                      <div className="text-[12px] font-medium text-gray-900">{goadPanelContext.tenantPlace.name}</div>
                      {goadPanelContext.tenantPlace.website && (
                        <a href={goadPanelContext.tenantPlace.website} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline block truncate">
                          {goadPanelContext.tenantPlace.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                      )}
                      {goadPanelContext.tenantPlace.phone && (
                        <div className="text-[10px] text-gray-600">{goadPanelContext.tenantPlace.phone}</div>
                      )}

                      {/* Stage 1 — Verify on Companies House */}
                      {!tenantVerifyState.result && !tenantCreateState.companyId && (
                        <div className="pt-1.5">
                          <button
                            type="button"
                            disabled={tenantVerifyState.loading || !goadPanelContext.tenantPlace.website}
                            onClick={async () => {
                              setTenantVerifyState({ loading: true, result: null, error: null });
                              try {
                                const r = await fetch("/api/goad/tenant-verify", {
                                  method: "POST",
                                  credentials: "include",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    website: goadPanelContext.tenantPlace!.website,
                                    fascia: goadPanelContext.tenantPlace!.name,
                                  }),
                                });
                                const j = await r.json();
                                if (!r.ok) throw new Error(j.error || "Verify failed");
                                setTenantVerifyState({ loading: false, result: j, error: null });
                              } catch (e: any) {
                                setTenantVerifyState({ loading: false, result: null, error: e?.message || "Verify failed" });
                              }
                            }}
                            className="text-[11px] font-medium px-2 py-1 rounded bg-gray-900 text-white disabled:opacity-40"
                            data-testid="button-tenant-verify"
                          >
                            {tenantVerifyState.loading ? "Verifying…" : "Verify on Companies House"}
                          </button>
                          {!goadPanelContext.tenantPlace.website && (
                            <p className="text-[9px] text-gray-500 italic mt-1">No website on Google Places — can't auto-verify.</p>
                          )}
                          {tenantVerifyState.error && (
                            <p className="text-[9px] text-red-600 mt-1">{tenantVerifyState.error}</p>
                          )}
                        </div>
                      )}

                      {/* Stage 2 — Verify result + Add to CRM */}
                      {tenantVerifyState.result && !tenantCreateState.companyId && (
                        <div className="pt-1.5 space-y-1.5">
                          {tenantVerifyState.result.chProfile ? (
                            <div className="text-[10px] bg-white border border-gray-200 rounded p-1.5">
                              <div className="font-medium text-gray-900">{tenantVerifyState.result.chProfile.company_name}</div>
                              <div className="text-gray-600 mt-0.5">
                                CH #{tenantVerifyState.result.chProfile.company_number} · {tenantVerifyState.result.chProfile.company_status}
                                {tenantVerifyState.result.chProfile.date_of_creation && ` · Incorp ${tenantVerifyState.result.chProfile.date_of_creation}`}
                              </div>
                              {tenantVerifyState.result.scraped.sourceUrl && (
                                <div className="text-gray-400 mt-0.5 truncate">via {tenantVerifyState.result.scraped.sourceUrl}</div>
                              )}
                            </div>
                          ) : tenantVerifyState.result.scraped.entityName ? (
                            <div className="text-[10px] bg-white border border-gray-200 rounded p-1.5">
                              <div className="font-medium text-gray-900">{tenantVerifyState.result.scraped.entityName}</div>
                              <div className="text-gray-500 mt-0.5">No CH number found in footer · will resolve on add</div>
                            </div>
                          ) : (
                            <div className="text-[10px] text-gray-600 italic">
                              Website didn't disclose UK entity. Can still add as brand — KYC will run Perplexity fallback.
                            </div>
                          )}
                          <button
                            type="button"
                            disabled={tenantCreateState.loading}
                            onClick={async () => {
                              setTenantCreateState({ loading: true, companyId: null, error: null });
                              try {
                                const r = await fetch("/api/goad/tenant-create", {
                                  method: "POST",
                                  credentials: "include",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    fascia: goadPanelContext.tenantPlace!.name,
                                    website: goadPanelContext.tenantPlace!.website,
                                    chNumber: tenantVerifyState.result?.scraped?.chNumber || null,
                                    entityName: tenantVerifyState.result?.scraped?.entityName || null,
                                    goadCategory: goadPanelUnit?.category || null,
                                    headOfficeAddress: goadPanelContext.tenantPlace!.address,
                                    phone: goadPanelContext.tenantPlace!.phone,
                                  }),
                                });
                                const j = await r.json();
                                if (!r.ok) throw new Error(j.error || "Create failed");
                                setTenantCreateState({ loading: false, companyId: j.companyId, error: null });
                              } catch (e: any) {
                                setTenantCreateState({ loading: false, companyId: null, error: e?.message || "Create failed" });
                              }
                            }}
                            className="text-[11px] font-medium px-2 py-1 rounded bg-emerald-600 text-white disabled:opacity-40"
                            data-testid="button-tenant-create"
                          >
                            {tenantCreateState.loading ? "Adding…" : "Add to CRM"}
                          </button>
                          {tenantCreateState.error && (
                            <p className="text-[9px] text-red-600">{tenantCreateState.error}</p>
                          )}
                        </div>
                      )}

                      {/* Stage 3 — Created */}
                      {tenantCreateState.companyId && (
                        <div className="pt-1.5 bg-emerald-50 border border-emerald-200 rounded p-1.5">
                          <div className="text-[11px] font-medium text-emerald-900">✓ Added to CRM</div>
                          <div className="text-[9px] text-emerald-700 mt-0.5">KYC + RocketReach running in background</div>
                          <a
                            href={`/companies/${tenantCreateState.companyId}`}
                            className="inline-block text-[10px] text-emerald-700 underline mt-1"
                            data-testid="link-tenant-view"
                          >
                            View brand profile →
                          </a>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* Recent deals at this address */}
                {goadPanelContext && goadPanelContext.deals.length > 0 && (
                  <section className="border-t pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                      Recent deals ({goadPanelContext.deals.length})
                    </div>
                    {goadPanelContext.deals.slice(0, 5).map((d) => (
                      <a
                        key={d.id}
                        href={`/deals/${d.id}`}
                        className="block text-[11px] py-1 border-b last:border-b-0 hover:bg-gray-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-800 truncate">{d.name}</span>
                          {d.deal_type && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">{d.deal_type}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">
                          {d.status} {d.completed_at ? `· ${new Date(d.completed_at).toLocaleDateString("en-GB")}` : ""}
                        </div>
                      </a>
                    ))}
                  </section>
                )}

                {/* Parent company match */}
                {goadPanelContext?.parentCompany && (
                  <section className="border-t pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                      Parent company
                    </div>
                    <a
                      href={`/companies/${goadPanelContext.parentCompany.id}`}
                      className="block bg-violet-50 border border-violet-200 rounded p-2 hover:bg-violet-100"
                    >
                      <div className="text-[12px] font-medium text-gray-900">{goadPanelContext.parentCompany.name}</div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {[
                          goadPanelContext.parentCompany.company_number,
                          goadPanelContext.parentCompany.company_type,
                          goadPanelContext.parentCompany.status,
                        ].filter(Boolean).join(" · ")}
                      </div>
                    </a>
                  </section>
                )}

                {/* Rates — actual unit-level rateable values from the
                    VOA snapshot, narrowed by the Goad street number.
                    Always shown so the user knows whether VOA was even
                    consulted. */}
                {goadPanelContext && (
                  <section className="border-t pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center justify-between">
                      <span>Rates {goadPanelContext.rates.length > 0 ? `(${goadPanelContext.rates.length})` : ""}</span>
                      {!goadPanelContext.diagnostics?.voaAvailable && (
                        <span className="text-[9px] text-amber-600 normal-case">VOA file not on server</span>
                      )}
                    </div>
                    {goadPanelContext.rates.length === 0 && (
                      <p className="text-[11px] text-gray-500 italic mb-1.5">
                        {goadPanelContext.diagnostics?.voaAvailable
                          ? "No rateable values matched at this address."
                          : "VOA snapshot not deployed — rates lookup skipped."}
                      </p>
                    )}
                    {goadPanelContext.rates.slice(0, 5).map((r: any, i: number) => (
                      <div key={`rt-${i}`} className="bg-amber-50/40 border border-amber-100 rounded p-2 mb-1 text-[11px]">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-gray-900 truncate flex-1">{r.firmName || r.address}</span>
                          {r.rateableValue != null && (
                            <span className="font-mono text-[12px] text-amber-700 font-semibold">£{Number(r.rateableValue).toLocaleString()}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-gray-600 truncate">{r.address}</div>
                        {r.description && (
                          <div className="text-[10px] text-gray-500 italic">{r.description}</div>
                        )}
                        {(r.baRef || r.uarn || r.effectiveDate) && (
                          <div className="text-[9px] text-gray-400 font-mono mt-0.5">
                            {[r.baRef, r.uarn, r.effectiveDate].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                    ))}
                    {goadPanelContext.rates.length > 5 && (
                      <p className="text-[10px] text-gray-500 italic">+{goadPanelContext.rates.length - 5} more rating entries on this postcode</p>
                    )}
                  </section>
                )}

                {/* Land Registry — via the real LR API through
                    resolveBuildingTitles(). Always shown so the user can
                    tell whether the resolver ran. */}
                {goadPanelContext && (
                  <section className="border-t pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center justify-between">
                      <span>Land Registry</span>
                      {goadPanelContext.landRegistry ? (
                        <span className={`text-[9px] normal-case font-medium ${
                          goadPanelContext.landRegistry.source === "uprn" ? "text-emerald-600" :
                          goadPanelContext.landRegistry.source === "street_number" ? "text-amber-600" : "text-gray-500"
                        }`}>
                          {goadPanelContext.landRegistry.source === "uprn" ? "UPRN-matched" :
                           goadPanelContext.landRegistry.source === "street_number" ? "by street number" :
                           "postcode-only"}
                        </span>
                      ) : (
                        <span className="text-[9px] text-amber-600 normal-case">
                          {goadPanelContext.diagnostics?.landRegistryError ? `failed: ${goadPanelContext.diagnostics.landRegistryError.slice(0, 40)}` : "no result"}
                        </span>
                      )}
                    </div>
                    {!goadPanelContext.landRegistry && (
                      <p className="text-[11px] text-gray-500 italic">
                        {goadPanelContext.diagnostics?.propertyDataKeyAvailable === false
                          ? "PropertyData key not configured on server — LR lookup skipped."
                          : "Resolver returned no result for this address."}
                      </p>
                    )}
                    {goadPanelContext.landRegistry && (() => {
                      const lr = goadPanelContext.landRegistry;
                      const fhs = (lr.matched?.freeholds || []).length > 0 ? lr.matched.freeholds : lr.fallback?.freeholds || [];
                      const lhs = (lr.matched?.leaseholds || []).length > 0 ? lr.matched.leaseholds : lr.fallback?.leaseholds || [];
                      // Postcode-level (estate) freeholds — surfaced when the unit
                      // match found no freehold of its own (typical in Mayfair etc.
                      // where the freehold is a blanket Grosvenor estate title).
                      const ctxFhs = (lr.context?.freeholds || []);
                      if (fhs.length === 0 && lhs.length === 0 && ctxFhs.length === 0) {
                        // Fallback: HMLR doesn't have a registered title against
                        // this exact address (could be unregistered land, an
                        // individual-owned residence, a sublet that never had
                        // its own title, or the address resolved to the wrong
                        // building). Offer an OS Places picker of every
                        // building in the postcode — clicking one re-fires
                        // the polygon-context lookup against that address.
                        return (
                          <div className="space-y-1.5">
                            <p className="text-[11px] text-gray-600 italic">No HMLR title matched this exact building. Resolver source: {lr.source || "n/a"}.</p>
                            <HmlrFallbackPicker
                              postcode={goadPanelUnit?.postcode || ""}
                              onPick={(addr) => {
                                // Re-key the polygon drawer to the picked
                                // address: update the unit's number + street
                                // + postcode and the parent effect will re-
                                // fetch polygon-context with the new keys.
                                setGoadPanelUnit((prev: any) => prev ? {
                                  ...prev,
                                  num: addr.number || prev.num,
                                  street: addr.street || prev.street,
                                  postcode: addr.postcode || prev.postcode,
                                  uprn: addr.uprn,
                                } : prev);
                              }}
                            />
                          </div>
                        );
                      }
                      // Click a proprietor → jump to the Investigator (KYC Clouseau)
                      // tab pre-loaded with that company name. We push the URL and
                      // fire popstate so the Property Intelligence hub re-reads its
                      // tab from the query string (it listens for popstate).
                      const openInvestigator = (n?: string | null) => {
                        if (!n) return;
                        const url = new URL(window.location.href);
                        url.pathname = "/property-intelligence";
                        url.searchParams.set("tab", "investigator");
                        url.searchParams.set("name", n);
                        window.history.pushState({}, "", url.toString());
                        window.dispatchEvent(new PopStateEvent("popstate"));
                      };
                      // Ranked chain — freeholder + head-leaseholder picked
                      // from postcode-wide titles. Rendered above the raw
                      // freehold/leasehold lists so the user sees a clear
                      // answer first, with the detail still browsable below.
                      const chain = (lr as any).chain;
                      const renderChainRow = (label: string, accent: string, c: any) => {
                        if (!c) return null;
                        // ChatBGP narrative-research deep-link. Clouseau (the
                        // openInvestigator click) gives the structured CH +
                        // PSC + UBO chain. ChatBGP fills the gap by walking
                        // news/Perplexity/BGP CRM for the "who is this
                        // really" narrative — fund, family office, investor
                        // cluster, BGP relationship history.
                        const askChatBGP = () => {
                          const prompt =
                            `Investigate the ultimate ownership and BGP history of "${c.proprietorName}"` +
                            (c.companyRegistrationNo ? ` (Companies House #${c.companyRegistrationNo})` : ``) +
                            `, the ${label.toLowerCase()} of ${goadPanelUnit?.num || ""} ${goadPanelUnit?.street || ""} ${goadPanelUnit?.postcode || ""}.\n\n` +
                            `Walk the PSC + corporate chain via Companies House, then find the fund / family office / investor cluster behind it via Perplexity and BGP CRM. Output:\n` +
                            `- Who really controls this entity (1-2 sentences)\n` +
                            `- BGP relationship status (any deals, properties, contacts)\n` +
                            `- Other notable UK properties they hold\n` +
                            `- Risk flags`;
                          window.location.href = `/chatbgp?message=${encodeURIComponent(prompt)}`;
                        };
                        return (
                          <div className={`rounded p-2 mb-1.5 text-[11px] border ${accent}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[9px] uppercase tracking-wide text-gray-600 font-semibold">{label}</div>
                              <div className="text-[9px] text-gray-500">score {c.score}</div>
                            </div>
                            {c.crmCompanyId ? (
                              <a href={`/companies/${c.crmCompanyId}`} className="font-medium text-blue-700 hover:underline block mt-0.5">{c.proprietorName}</a>
                            ) : (
                              <button type="button" onClick={() => openInvestigator(c.proprietorName)} className="font-medium text-gray-900 text-left hover:text-blue-700 hover:underline">{c.proprietorName}</button>
                            )}
                            <div className="text-[10px] text-gray-600 mt-0.5 font-mono">{c.titleNumber}{c.companyRegistrationNo ? ` · CH ${c.companyRegistrationNo}` : ""}</div>
                            {c.reasons?.length > 0 && (
                              <div className="text-[10px] text-gray-500 mt-0.5 italic">{c.reasons.slice(0, 3).join(" · ")}</div>
                            )}
                            <button
                              type="button"
                              onClick={askChatBGP}
                              className="text-[10px] text-gray-700 hover:text-gray-900 hover:underline mt-1 inline-flex items-center gap-0.5"
                              data-testid={`button-chatbgp-${c.titleNumber}`}
                            >
                              💬 Ask ChatBGP who they really are
                            </button>
                          </div>
                        );
                      };
                      return (
                        <>
                          {chain && (chain.freeholder || chain.headLeaseholder) && (
                            <div className="mb-2 space-y-0.5">
                              {renderChainRow("Likely freeholder", "bg-amber-50 border-amber-300", chain.freeholder)}
                              {renderChainRow("Likely head-leaseholder", "bg-violet-50 border-violet-300", chain.headLeaseholder)}
                            </div>
                          )}
                          {fhs.length > 0 && (
                            <div className="mb-2">
                              <div className="text-[10px] text-gray-600 mb-0.5">Freehold ({fhs.length})</div>
                              {fhs.slice(0, 5).map((f: any, i: number) => (
                                <div key={`fh-${i}`} className="bg-amber-50 border border-amber-200 rounded p-2 mb-1 text-[11px]">
                                  <button type="button" onClick={() => openInvestigator(f.proprietor_name || f.proprietorName || f.proprietor_name_1)} className="font-medium text-gray-900 text-left hover:text-blue-700 hover:underline">{f.proprietor_name || f.proprietorName || f.proprietor_name_1 || "Unknown proprietor"}</button>
                                  {(f.title_number || f.titleNumber) && (
                                    <div className="text-gray-600 font-mono text-[10px] mt-0.5">{f.title_number || f.titleNumber}</div>
                                  )}
                                  {(f.proprietor_address || f.proprietorAddress) && (
                                    <div className="text-gray-500 text-[10px] mt-0.5 truncate">{f.proprietor_address || f.proprietorAddress}</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {lhs.length > 0 && (
                            <div>
                              <div className="text-[10px] text-gray-600 mb-0.5">Leasehold ({lhs.length})</div>
                              {lhs.slice(0, 3).map((l: any, i: number) => (
                                <div key={`lh-${i}`} className="bg-sky-50 border border-sky-200 rounded p-2 mb-1 text-[11px]">
                                  <button type="button" onClick={() => openInvestigator(l.proprietor_name || l.proprietorName || l.proprietor_name_1)} className="font-medium text-gray-900 truncate text-left hover:text-blue-700 hover:underline block w-full">{l.proprietor_name || l.proprietorName || l.proprietor_name_1 || "Unknown leaseholder"}</button>
                                  {(l.title_number || l.titleNumber) && (
                                    <div className="text-gray-600 font-mono text-[10px] mt-0.5">{l.title_number || l.titleNumber}</div>
                                  )}
                                  <LeaseholdFreeholdFinder titleNumber={l.title_number || l.titleNumber} />
                                </div>
                              ))}
                              {lhs.length > 3 && (
                                <p className="text-[10px] text-gray-500 italic">+{lhs.length - 3} more leaseholds</p>
                              )}
                            </div>
                          )}
                          {ctxFhs.length > 0 && fhs.length === 0 && (
                            <div className="mt-2">
                              <div className="text-[10px] text-gray-600 mb-0.5">Freeholds in this postcode ({ctxFhs.length})</div>
                              <p className="text-[10px] text-gray-500 italic mb-1">Estate-level titles — not matched to this exact unit. The superior freeholder is likely here.</p>
                              {ctxFhs.slice(0, 5).map((f: any, i: number) => (
                                <div key={`cfh-${i}`} className="bg-stone-50 border border-stone-200 rounded p-2 mb-1 text-[11px]">
                                  <button type="button" onClick={() => openInvestigator(f.proprietor_name || f.proprietorName || f.proprietor_name_1)} className="font-medium text-gray-900 text-left hover:text-blue-700 hover:underline">{f.proprietor_name || f.proprietorName || f.proprietor_name_1 || "Unknown proprietor"}</button>
                                  {(f.title_number || f.titleNumber) && (
                                    <div className="text-gray-600 font-mono text-[10px] mt-0.5">{f.title_number || f.titleNumber}</div>
                                  )}
                                  {Array.isArray(f.property) && f.property[0] && (
                                    <div className="text-gray-500 text-[10px] mt-0.5 truncate">{f.property[0]}</div>
                                  )}
                                </div>
                              ))}
                              {ctxFhs.length > 5 && (
                                <p className="text-[10px] text-gray-500 italic">+{ctxFhs.length - 5} more freeholds in postcode</p>
                              )}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </section>
                )}

                {/* Planning applications — last 10 years via PlanIt (planit.org.uk),
                    the same source the Pathway planning card uses. */}
                {goadPanelContext && (
                  <section className="border-t pt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5 flex items-center justify-between">
                      <span>Planning apps — last 10 yrs {goadPanelContext.planningApplications.length > 0 ? `(${goadPanelContext.planningApplications.length})` : ""}</span>
                      <span className="text-[9px] text-gray-400 normal-case">via PlanIt</span>
                    </div>
                    {goadPanelContext.planningApplications.length === 0 && (
                      <p className="text-[11px] text-gray-500 italic mb-1.5">
                        No planning applications found within ~200m in the last 10 years.
                      </p>
                    )}
                    {goadPanelContext.planningApplications.slice(0, 5).map((a: any, i: number) => {
                      const dec = (a.decision || a.status || "").toLowerCase();
                      const dot = dec.includes("approved") || dec.includes("permit") || dec.includes("granted") ? "#10b981" :
                                  dec.includes("refused") || dec.includes("dismissed") ? "#ef4444" :
                                  dec.includes("withdrawn") ? "#9ca3af" : "#f59e0b";
                      const dateStr = a.decided_date || a.received_date || a.date;
                      return (
                        <div key={`pa-${i}`} className="text-[11px] py-1 border-b last:border-b-0">
                          <div className="flex items-start gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1" style={{ background: dot }} />
                            <div className="min-w-0 flex-1">
                              <div className="text-gray-900 line-clamp-2 leading-tight">{a.description || a.proposal || "(no description)"}</div>
                              <div className="text-[10px] text-gray-500 mt-0.5">
                                {[a.decision || a.status, dateStr ? new Date(dateStr).toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : null, a.reference || a.ref].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {goadPanelContext.planningApplications.length > 5 && (
                      <p className="text-[10px] text-gray-500 italic mt-1">+{goadPanelContext.planningApplications.length - 5} more applications</p>
                    )}
                  </section>
                )}

                {/* Pathway run — link to existing run if one exists, else
                    offer to start one. Replaces the old 'Search in Pathway'
                    that just dumped the address into the postcode search. */}
                <section className="border-t pt-3">
                  {goadPanelContext?.pathwayRun ? (
                    <a
                      href={`/property-pathway?runId=${goadPanelContext.pathwayRun.id}`}
                      className="block w-full text-center text-[11px] bg-emerald-600 text-white rounded px-2 py-1.5 hover:bg-emerald-700"
                      data-testid="goad-panel-open-pathway"
                    >
                      Open Pathway run →
                      <span className="text-[9px] ml-1 opacity-75">
                        {goadPanelContext.pathwayRun.status || "in progress"}
                      </span>
                    </a>
                  ) : (
                    <button
                      disabled={goadPanelStartingPathway || !goadPanelUnit.postcode}
                      onClick={async () => {
                        if (!goadPanelUnit.postcode) return;
                        setGoadPanelStartingPathway(true);
                        try {
                          const fullAddress = `${goadPanelUnit.num} ${goadPanelUnit.street}, ${goadPanelUnit.postcode}`.replace(/\s+/g, " ").trim();
                          const resp = await fetch("/api/property-pathway/start", {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                            body: JSON.stringify({ address: fullAddress, postcode: goadPanelUnit.postcode }),
                          });
                          if (resp.ok) {
                            const run = await resp.json();
                            if (run?.id || run?.runId) {
                              const id = run.id || run.runId;
                              window.location.href = `/property-pathway?runId=${id}`;
                              return;
                            }
                          }
                        } catch { /* ignore */ }
                        setGoadPanelStartingPathway(false);
                      }}
                      className="w-full text-[11px] bg-gray-900 text-white rounded px-2 py-1.5 hover:bg-gray-800 disabled:opacity-60"
                      data-testid="goad-panel-start-pathway"
                    >
                      {goadPanelStartingPathway ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 animate-spin" /> Starting…
                        </span>
                      ) : (
                        "Start Pathway →"
                      )}
                    </button>
                  )}
                </section>

                {goadPanelUnit.surveyDate && (
                  <p className="text-[9px] text-gray-400 text-right">
                    Goad surveyed {new Date(goadPanelUnit.surveyDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* The old floating right-side "Building Key" panel was removed —
            its toggles (OS Buildings, Named Sites) now live in the unified
            Map Layers list on the left. The pastel auto-classifier legend
            it carried is no longer needed because Retail Context shows the
            real Goad data with the band filter directly below the toggle. */}

        {(postcode || loadingData) && (
          <PropertyPanel
            postcode={postcode}
            data={propertyData}
            loading={loadingData}
            activeLayers={activePdLayers}
            onLoadLayer={loadAdditionalLayer}
            loadingLayer={loadingLayer}
            address={currentArea !== postcode ? currentArea : undefined}
            onSearchSaved={(saved) => setRecentSearches(prev => [saved, ...prev.filter(s => s.id !== saved.id)])}
            onClose={() => {
              setSelectedPostcode("");
              setPropertyData(null);
              if (markerRef.current) {
                markerRef.current.remove();
                markerRef.current = null;
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
