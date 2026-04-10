import { useState, useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { getAuthHeaders } from "@/lib/queryClient";
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
}: {
  postcode: string;
  data: PropertyData | null;
  loading: boolean;
  onClose: () => void;
  activeLayers: string[];
  onLoadLayer: (layer: string) => void;
  loadingLayer: string | null;
  address?: string;
}) {
  const [viewMode, setViewMode] = useState<"summary" | "full">("summary");
  const [fullTitleData, setFullTitleData] = useState<any[] | null>(null);
  const [fullTitleLoading, setFullTitleLoading] = useState(false);

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
        <div>
          <h3 className="font-semibold text-sm" data-testid="panel-title">Property Intelligence</h3>
          {address && <p className="text-xs text-gray-700 font-medium">{address}</p>}
          <p className="text-xs text-gray-500">{postcode}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded" data-testid="panel-close">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!loading && data && (
        <div className="flex border-b">
          <button
            onClick={() => setViewMode("summary")}
            className={`flex-1 text-xs py-2 font-medium transition-colors ${viewMode === "summary" ? "border-b-2 border-indigo-500 text-indigo-700" : "text-gray-500 hover:text-gray-700"}`}
            data-testid="tab-summary"
          >
            Summary
          </button>
          <button
            onClick={() => setViewMode("full")}
            className={`flex-1 text-xs py-2 font-medium transition-colors ${viewMode === "full" ? "border-b-2 border-indigo-500 text-indigo-700" : "text-gray-500 hover:text-gray-700"}`}
            data-testid="tab-full-report"
          >
            Full Report
          </button>
        </div>
      )}

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : data ? (
          viewMode === "full" ? (
            <FullReportView data={data} postcode={postcode} searchAddress={address} />
          ) : (
            <div className="p-3 space-y-4">
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
                        const raw = data.propertyDataCoUk?.["planning-applications"]?.data;
                        return (Array.isArray(raw) ? raw.length : raw?.planning_applications?.length) || 0;
                      })()}
                    </div>
                    <div className="text-[10px] text-violet-600">Planning Apps</div>
                  </div>
                </div>
              )}

              {(() => {
                const freeholds = data.propertyDataCoUk?.["freeholds"]?.data || [];
                const leaseholds = data.propertyDataCoUk?.["leaseholds"]?.data || [];
                const allTitles = [
                  ...freeholds.map((f: any) => ({ ...f, _tenure: "Freehold" })),
                  ...leaseholds.map((l: any) => ({ ...l, _tenure: "Leasehold" })),
                ];
                if (allTitles.length === 0) return null;
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
                          ? <><span className="font-medium text-indigo-600">{matchCount}</span> matching "{address}" · {allTitles.length - matchCount} other titles at this postcode</>
                          : <>No exact matches for "{address}" — showing all {allTitles.length} titles at this postcode</>
                        }
                      </div>
                    )}
                    {sorted.slice(0, 8).map((t: any, i: number) => {
                      const isMatch = address ? titleMatchesAddress(t, address) : false;
                      return (
                        <div key={i} className={`text-xs border rounded p-2 space-y-0.5 ${isMatch ? "bg-indigo-50 border-indigo-200" : "bg-gray-50"}`}>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${t._tenure === "Freehold" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-blue-300 text-blue-700 bg-blue-50"}`}>
                              {t._tenure === "Freehold" ? "F" : "L"}
                            </Badge>
                            <span className="font-medium truncate">{t.proprietor_name_1 || t.address || "Unknown"}</span>
                            {isMatch && <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded font-medium shrink-0">MATCH</span>}
                            {t.proprietor_category && <span className="text-[9px] text-gray-400 ml-auto shrink-0">{t.proprietor_category}</span>}
                          </div>
                          {t.title_number && <p className="text-gray-400 text-[10px]">Title: {t.title_number}{t.company_reg ? ` · Co. ${t.company_reg}` : ""}</p>}
                          {t.proprietor_address && <p className="text-gray-400 text-[10px] truncate">{t.proprietor_address}</p>}
                          {t.plot_size && <p className="text-gray-400 text-[10px]">Plot: {t.plot_size} acres</p>}
                          {t.price_paid && <p className="text-gray-400 text-[10px]">Price: £{Number(t.price_paid).toLocaleString()}</p>}
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
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-semibold text-indigo-700">
                            Full Title Search — {fullTitleData.filter(t => t._tenure === "Freehold").length}F / {fullTitleData.filter(t => t._tenure === "Leasehold").length}L
                          </p>
                          <button onClick={() => setFullTitleData(null)} className="text-[9px] text-gray-400 hover:text-gray-600" data-testid="btn-close-full-titles">Clear</button>
                        </div>
                        {fullTitleData.map((t: any, i: number) => (
                          <div key={i} className={`text-xs border rounded p-2 space-y-0.5 ${t._tenure === "Leasehold" ? "bg-blue-50/50 ml-3 border-blue-200" : "bg-emerald-50/50 border-emerald-200"}`}>
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className={`text-[9px] px-1 py-0 ${t._tenure === "Freehold" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : "border-blue-300 text-blue-700 bg-blue-50"}`}>
                                {t._tenure === "Freehold" ? "F" : "L"}
                              </Badge>
                              <span className="font-medium truncate text-[11px]">{t.proprietor_name_1 || "Unknown"}</span>
                              {t.proprietor_category && <span className="text-[9px] text-gray-400 ml-auto shrink-0">{t.proprietor_category}</span>}
                            </div>
                            <p className="text-gray-400 text-[10px]">
                              Title: {t.title_number}
                              {t.company_reg ? ` · Co. ${t.company_reg}` : ""}
                              {t.leaseholdCount ? ` · ${t.leaseholdCount} leases` : ""}
                            </p>
                            {t.proprietor_address && <p className="text-gray-400 text-[10px] truncate">{t.proprietor_address}</p>}
                            {t.plot_size && <p className="text-gray-400 text-[10px]">Plot: {t.plot_size} acres</p>}
                            {t._parentTitle && <p className="text-blue-400 text-[9px]">Under freehold: {t._parentTitle}</p>}
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
                const raw = data.propertyDataCoUk?.["planning-applications"]?.data;
                const planningApps = Array.isArray(raw) ? raw : (raw?.planning_applications || []);
                if (!planningApps || planningApps.length === 0) return null;
                return (
                  <DataSection title={`Planning Applications (${planningApps.length})`} icon={Landmark} color="text-violet-600">
                    {planningApps.slice(0, 8).map((pa: any, i: number) => (
                      <div key={i} className="text-xs border rounded p-2 space-y-0.5 bg-gray-50">
                        <p className="font-medium truncate">{pa.proposal || pa.description || pa.address || "Application"}</p>
                        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
                          {pa.status && (
                            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${pa.decision?.rating === "positive" ? "border-emerald-300 text-emerald-700 bg-emerald-50" : pa.decision?.rating === "negative" ? "border-red-300 text-red-700 bg-red-50" : ""}`}>
                              {pa.status}
                            </Badge>
                          )}
                          {pa.type && <span className="text-gray-500">{pa.type}</span>}
                          {pa.dates?.received_at && <span className="text-gray-400">{pa.dates.received_at}</span>}
                        </div>
                        {pa.address && <p className="text-[10px] text-gray-400 truncate">{pa.address}</p>}
                      </div>
                    ))}
                    {planningApps.length > 8 && <p className="text-[10px] text-gray-400 text-center">+{planningApps.length - 8} more</p>}
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

  if (padW < 12 || padH < 8) return null;

  let fontSize = 9.5;

  const tryFit = (size: number, text: string): string | null => {
    const cw = charWidthAtSize(size);
    const lh = lineHeight(size);
    const maxCharsPerLine = Math.floor(padW / cw);
    if (maxCharsPerLine < 2) return null;

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      if (word.length > maxCharsPerLine) {
        if (currentLine) lines.push(currentLine);
        lines.push(word.substring(0, maxCharsPerLine));
        currentLine = "";
        continue;
      }
      if (currentLine && (currentLine.length + 1 + word.length) > maxCharsPerLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? `${currentLine} ${word}` : word;
      }
    }
    if (currentLine) lines.push(currentLine);

    const maxLines = Math.floor(padH / lh);
    if (maxLines < 1) return null;

    const visibleLines = lines.slice(0, maxLines);
    return visibleLines.join("\n");
  };

  for (const size of [9.5, 8, 7, 6]) {
    const result = tryFit(size, displayText);
    if (result) {
      return { text: result, fontSize: size };
    }
  }

  const cw = charWidthAtSize(6);
  const maxChars = Math.floor(padW / cw);
  if (maxChars >= 2) {
    const truncated = displayText.substring(0, maxChars);
    return { text: truncated, fontSize: 6 };
  }

  return null;
}

async function fetchBuildings(map: L.Map): Promise<any[]> {
  const bounds = map.getBounds();
  const zoom = map.getZoom();
  if (zoom < 16) return [];

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

    return buildings;
  } catch (err) {
    console.error("[edozo] Overpass error:", err);
    return [];
  }
}

export default function EdozoMap() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const buildingLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const lastBoundsRef = useRef("");
  const loadCounterRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPostcode, setSelectedPostcode] = useState("");
  const [propertyData, setPropertyData] = useState<PropertyData | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [currentArea, setCurrentArea] = useState("Belgravia");
  const [activeTool, setActiveTool] = useState<string>("select");
  const [saveToOrg, setSaveToOrg] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const suppressSearchRef = useRef(false);

  // Search history & CRM layers
  const [recentSearches, setRecentSearches] = useState<any[]>([]);
  const [crmProperties, setCrmProperties] = useState<any[]>([]);
  const [showSearchHistory, setShowSearchHistory] = useState(false);
  const [showCrmLayer, setShowCrmLayer] = useState(false);
  const searchMarkersRef = useRef<L.LayerGroup | null>(null);
  const crmMarkersRef = useRef<L.LayerGroup | null>(null);

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

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
    }).addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 20,
      pane: "labelPane",
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 100 }).addTo(map);

    buildingLayerRef.current = L.layerGroup({ pane: "buildingPane" }).addTo(map);

    const renderBuildings = (buildings: any[]) => {
      if (!buildingLayerRef.current || !mapRef.current) return;
      buildingLayerRef.current.clearLayers();

      for (const b of buildings) {
        const hasInfo = b.label || b.houseNum;
        const isUnit = b.isUnit;
        const polygon = L.polygon(b.latLngs, {
          color: isUnit ? "#333" : "#222",
          weight: isUnit ? 1.2 : 1,
          fillColor: hasInfo ? "#faf8f0" : "#f0eee6",
          fillOpacity: 0.95,
          opacity: 1,
          pane: "buildingPane",
        });

        const bbox = polygonBBoxPixels(b.latLngs, mapRef.current);
        const fitted = fitTextToBuilding(b.label, b.houseNum, b.isVacant, bbox.w, bbox.h);

        if (fitted) {
          const cssClass = b.isVacant && !b.label
            ? `edozo-label edozo-label-vacant edozo-fs-${fitted.fontSize}`
            : `edozo-label edozo-fs-${fitted.fontSize}`;
          polygon.bindTooltip(fitted.text, {
            permanent: true,
            direction: "center",
            className: cssClass,
          });
        }

        buildingLayerRef.current.addLayer(polygon);
      }
    };

    const loadBuildings = async () => {
      const bounds = map.getBounds();
      const boundsKey = `${bounds.getSouth().toFixed(3)},${bounds.getWest().toFixed(3)},${bounds.getNorth().toFixed(3)},${bounds.getEast().toFixed(3)}`;
      if (boundsKey === lastBoundsRef.current) return;
      lastBoundsRef.current = boundsKey;

      loadCounterRef.current += 1;
      const thisLoad = loadCounterRef.current;

      const buildings = await fetchBuildings(map);

      if (loadCounterRef.current !== thisLoad) return;
      if (buildings.length === 0 && buildingLayerRef.current && buildingLayerRef.current.getLayers().length > 0) return;

      renderBuildings(buildings);
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

    return () => {
      map.remove();
      mapRef.current = null;
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
          loadPropertyData(p.postcode, undefined, p.address || undefined);
        }
      });
      crmMarkersRef.current.addLayer(marker);
    }
  }, [showCrmLayer, crmProperties]);

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
    loadPropertyData(result.postcode, undefined, addressPart || undefined);
    setSearchResults([]);
    suppressSearchRef.current = true;
    setSearchQuery(result.label);
  };

  const [activePdLayers, setActivePdLayers] = useState<string[]>(["core"]);
  const [loadingLayer, setLoadingLayer] = useState<string | null>(null);

  const loadPropertyData = async (postcode: string, pdLayers?: string[], address?: string) => {
    setLoadingData(true);
    setPropertyData(null);
    const layersParam = pdLayers || ["core"];
    setActivePdLayers(layersParam);
    try {
      let url = `/api/property-lookup?postcode=${encodeURIComponent(postcode)}&layers=core&propertyDataLayers=${layersParam.join(",")}`;
      if (address) url += `&address=${encodeURIComponent(address)}`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setPropertyData(data);
      }
    } catch (e) {
      console.error("Property lookup error:", e);
    }
    setLoadingData(false);
  };

  const loadAdditionalLayer = async (layer: string) => {
    if (!selectedPostcode || !propertyData) return;
    const newLayers = [...activePdLayers, layer];
    setActivePdLayers(newLayers);
    setLoadingLayer(layer);
    try {
      const extendedLayers = layer === "market" || layer === "area" || layer === "residential" ? "core,extended" : "core";
      const url = `/api/property-lookup?postcode=${encodeURIComponent(selectedPostcode)}&layers=${extendedLayers}&propertyDataLayers=${newLayers.join(",")}`;
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
    try {
      const resp = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("bgp_token")}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const { displayAddr, postcode } = data;

      if (!postcode) return;

      if (markerRef.current) markerRef.current.remove();
      markerRef.current = L.circleMarker([lat, lng], {
        radius: 8, fillColor: "#6366f1", color: "#fff", weight: 2.5, opacity: 1, fillOpacity: 0.9,
      }).addTo(mapRef.current!).bindPopup(`<strong>${displayAddr || postcode}</strong><br/><span style="color:#666;font-size:11px">${postcode}</span>`, { closeButton: false, offset: L.point(0, -5) }).openPopup();

      setSelectedPostcode(postcode);
      setCurrentArea(displayAddr || postcode);
      loadPropertyData(postcode, undefined, displayAddr || undefined);
    } catch (e) {
      console.error("Reverse geocode error:", e);
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

  return (
    <div className="relative w-full h-full flex font-sans">
      <style>{`
        .edozo-label {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          color: #111 !important;
          font-size: 9px !important;
          font-weight: 700 !important;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
          text-transform: uppercase !important;
          letter-spacing: 0.1px !important;
          white-space: pre-line !important;
          padding: 0 !important;
          text-align: center !important;
          line-height: 1.2 !important;
          overflow: hidden !important;
        }
        .edozo-fs-9\\.5 { font-size: 9.5px !important; }
        .edozo-fs-8 { font-size: 8px !important; }
        .edozo-fs-7 { font-size: 7px !important; }
        .edozo-fs-6 { font-size: 6px !important; font-weight: 600 !important; }
        .edozo-label-vacant {
          color: #777 !important;
          font-weight: 600 !important;
        }
        .edozo-label::before {
          display: none !important;
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
          background: #e8e6de !important;
        }
      `}</style>

      <div className="w-[220px] border-r bg-white flex flex-col z-[1001] relative shrink-0">
        <div className="px-3 pt-3 pb-2">
          <p className="text-xs text-gray-500 mb-2.5">
            Current area: <span className="font-semibold text-gray-900">{currentArea}</span>
          </p>

          <p className="text-[11px] font-semibold mb-1.5 text-gray-700">Search new plan</p>
          <div className="relative">
            <Input
              placeholder="Search by area, address or grid ref"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-xs pr-7 bg-white border-gray-300 rounded"
              data-testid="map-search-input"
            />
            {searchQuery ? (
              <button onClick={() => { setSearchQuery(""); setSearchResults([]); }} className="absolute right-2 top-2">
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            ) : (
              <Search className="absolute right-2.5 top-2.5 w-3 h-3 text-gray-400" />
            )}
          </div>

          {searching && (
            <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Searching...
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="border rounded mt-1.5 max-h-64 overflow-auto bg-white shadow-lg">
              {searchResults.map((r, i) => {
                const isExact = r.addressType === "address" || r.type === "postcode";
                const parts = r.label.split(" — ");
                const mainAddr = parts[0] || "";
                const pcPart = parts[1] || r.postcode || "";
                return (
                  <button
                    key={i}
                    onClick={() => selectSearchResult(r)}
                    className="w-full text-left px-2.5 py-2 hover:bg-indigo-50 text-[11px] border-b last:border-0 flex items-start gap-2"
                    data-testid={`search-result-${i}`}
                  >
                    <MapPin className={`w-3 h-3 mt-0.5 flex-shrink-0 ${isExact ? "text-indigo-500" : "text-gray-300"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-800 leading-tight">{mainAddr}</div>
                      {pcPart && <div className="text-[10px] text-gray-400 mt-0.5">{pcPart}</div>}
                    </div>
                    {isExact && (
                      <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1 py-0.5 rounded font-medium shrink-0 mt-0.5">EXACT</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t" />

        <div className="px-3 py-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-gray-700">Edit data</p>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">Save to my organisation</span>
              <Switch
                checked={saveToOrg}
                onCheckedChange={setSaveToOrg}
                className="h-4 w-7"
                data-testid="save-org-toggle"
              />
            </div>
          </div>
        </div>

        <div className="border-t" />

        <div className="px-3 py-2.5">
          <p className="text-[11px] font-semibold text-gray-700 mb-2">Tools</p>
          <div className="flex flex-wrap gap-0.5">
            {tools.map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTool(key)}
                className={`w-[30px] h-[30px] rounded flex items-center justify-center transition-colors ${
                  activeTool === key
                    ? "bg-gray-200 text-gray-900"
                    : "hover:bg-gray-100 text-gray-500"
                }`}
                title={label}
                data-testid={`tool-${key}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
          <div className="flex gap-0.5 mt-1">
            <button className="w-[30px] h-[30px] rounded flex items-center justify-center hover:bg-gray-100 text-gray-500" title="Edit">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button className="w-[30px] h-[30px] rounded flex items-center justify-center hover:bg-gray-100 text-gray-500" title="Search">
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="border-t" />

        <div className="px-3 py-2.5">
          <p className="text-[11px] font-semibold text-gray-700 mb-1.5">Name your plan</p>
          <Input
            placeholder="Enter plan name..."
            className="h-8 text-xs bg-white border-gray-300 rounded"
            data-testid="plan-name-input"
          />
        </div>

        <div className="border-t" />

        <div className="px-3 py-2.5">
          <Button variant="outline" size="sm" className="w-full h-8 text-xs font-medium" data-testid="create-plan-btn">
            Create your plan
          </Button>
        </div>

        <div className="border-t" />

        <div className="px-3 py-2.5">
          <p className="text-[11px] font-semibold text-gray-700 mb-2">Map Layers</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span className="text-[10px] text-gray-600">Search History</span>
              </div>
              <Switch
                checked={showSearchHistory}
                onCheckedChange={setShowSearchHistory}
                className="h-4 w-7"
                data-testid="toggle-search-history"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                <span className="text-[10px] text-gray-600">CRM Properties</span>
              </div>
              <Switch
                checked={showCrmLayer}
                onCheckedChange={setShowCrmLayer}
                className="h-4 w-7"
                data-testid="toggle-crm-layer"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="text-[10px] text-gray-600">Acquired</span>
              </div>
              <span className="text-[9px] text-gray-400">via status</span>
            </div>
          </div>
        </div>

        <div className="border-t" />

        <ScrollArea className="flex-1">
          <div className="px-3 py-2.5">
            <p className="text-[11px] font-semibold text-gray-700 mb-2">
              Recent Searches {recentSearches.length > 0 && <span className="font-normal text-gray-400">({recentSearches.length})</span>}
            </p>
            {recentSearches.length === 0 ? (
              <p className="text-[10px] text-gray-400 py-3 text-center">No recent searches yet.</p>
            ) : (
              <div className="space-y-1">
                {recentSearches.slice(0, 20).map((s: any) => {
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
                          loadPropertyData(s.postcode, undefined, s.address || undefined);
                        }
                      }}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-gray-50 transition-colors group/item"
                      data-testid={`map-search-history-${s.id}`}
                    >
                      <div className="flex items-start gap-1.5">
                        <MapPin className={`w-3 h-3 mt-0.5 shrink-0 ${pinColor}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-gray-800 truncate leading-tight">{s.address}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {s.postcode && <span className="text-[9px] text-gray-400 font-mono">{s.postcode}</span>}
                            {s.status && s.status !== "New" && (
                              <span className={`text-[8px] px-1 py-0.5 rounded font-medium ${
                                isAcquired ? "bg-emerald-100 text-emerald-700" :
                                s.status === "Investigating" ? "bg-blue-100 text-blue-700" :
                                s.status === "Contacted Owner" ? "bg-amber-100 text-amber-700" :
                                "bg-gray-100 text-gray-600"
                              }`}>{s.status}</span>
                            )}
                          </div>
                          {ownerName && (
                            <p className="text-[9px] text-gray-400 truncate mt-0.5">{ownerName}</p>
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

      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="w-full h-full" data-testid="edozo-map" />

        {(selectedPostcode || loadingData) && (
          <PropertyPanel
            postcode={selectedPostcode}
            data={propertyData}
            loading={loadingData}
            activeLayers={activePdLayers}
            onLoadLayer={loadAdditionalLayer}
            loadingLayer={loadingLayer}
            address={currentArea !== selectedPostcode ? currentArea : undefined}
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
