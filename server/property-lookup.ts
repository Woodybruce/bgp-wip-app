import { db } from "./db";
import { voaRatings } from "@shared/schema";
import { ilike, or, and, sql } from "drizzle-orm";
import { escapeLike } from "./utils/escape-like";

const LR_BASE = "https://landregistry.data.gov.uk/data";

interface PropertyLookupResult {
  address: string;
  postcode: string;
  pricePaid: any[];
  voaRatings: any[];
  epc: any[];
  floodRisk: any;
  listedBuilding: any[];
  planningData: any;
  propertyDataCoUk: any;
  tflNearby: any;
  companiesHouse: any[];
}

function extractLabel(obj: any): string {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj.prefLabel) {
    const pl = Array.isArray(obj.prefLabel) ? obj.prefLabel[0] : obj.prefLabel;
    return pl?._value || pl || "";
  }
  if (obj.label) {
    const lb = Array.isArray(obj.label) ? obj.label[0] : obj.label;
    return lb?._value || lb || "";
  }
  return "";
}

async function lookupPricePaid(postcode: string, street?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams();
    params.set("propertyAddress.postcode", postcode.toUpperCase());
    if (street) params.set("propertyAddress.street", street.toUpperCase());
    params.set("_pageSize", "20");
    params.set("_sort", "-transactionDate");

    const resp = await fetch(`${LR_BASE}/ppi/transaction-record.json?${params}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    const items = data.result?.items || [];

    return items.map((item: any) => ({
      price: item.pricePaid,
      date: item.transactionDate,
      address: [
        item.propertyAddress?.saon ? extractLabel(item.propertyAddress.saon) : "",
        item.propertyAddress?.paon ? extractLabel(item.propertyAddress.paon) : "",
        item.propertyAddress?.street ? extractLabel(item.propertyAddress.street) : "",
        item.propertyAddress?.town ? extractLabel(item.propertyAddress.town) : "",
      ].filter(Boolean).join(", "),
      postcode: item.propertyAddress?.postcode || "",
      propertyType: extractLabel(item.propertyType),
      estateType: extractLabel(item.estateType),
      newBuild: item.newBuild === true,
    }));
  } catch (e) {
    console.error("[property-lookup] Price paid error:", e);
    return [];
  }
}

async function lookupVOA(postcode: string, street?: string): Promise<any[]> {
  // VOA is now served by a local SQLite snapshot (server/voa-sqlite.ts).
  // If the file is missing, the SQLite reader returns [] and we fall through
  // to the legacy Postgres table as a safety net during rollout.
  try {
    const { voaSqliteAvailable, lookupVoaByPostcode } = await import("./voa-sqlite");
    if (voaSqliteAvailable()) {
      return lookupVoaByPostcode(postcode, street, 20);
    }
    // Fallback: legacy Postgres path (will be dropped in Phase 2)
    const normalizedPc = postcode.replace(/\s+/g, "").trim();
    const formattedPc = normalizedPc.length > 3
      ? normalizedPc.slice(0, -3) + " " + normalizedPc.slice(-3)
      : normalizedPc;
    const conditions = [ilike(voaRatings.postcode, formattedPc)];
    if (street) {
      conditions.push(ilike(voaRatings.street, `%${escapeLike(street)}%`));
    }

    const results = await db.select().from(voaRatings).where(and(...conditions)).limit(20);
    return results.map((r: any) => ({
      firmName: r.firmName,
      address: [r.numberOrName, r.street, r.town].filter(Boolean).join(", "),
      postcode: r.postcode,
      description: r.descriptionText,
      rateableValue: r.rateableValue,
      effectiveDate: r.effectiveDate,
    }));
  } catch (e) {
    console.error("[property-lookup] VOA error:", e);
    return [];
  }
}

async function lookupEPC(postcode: string, address?: string): Promise<any[]> {
  try {
    const email = process.env.EPC_EMAIL?.trim();
    const apiKey = process.env.EPC_API_KEY?.trim();
    if (!email || !apiKey) {
      console.log("[property-lookup] EPC credentials not configured");
      return [];
    }

    const token = Buffer.from(`${email}:${apiKey}`).toString("base64");

    const params = new URLSearchParams();
    params.set("postcode", postcode);
    if (address) params.set("address", address);
    params.set("size", "10");

    const domesticResp = await fetch(
      `https://epc.opendatacommunities.org/api/v1/domestic/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${token}`,
        },
      }
    );

    const nonDomesticResp = await fetch(
      `https://epc.opendatacommunities.org/api/v1/non-domestic/search?${params}`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${token}`,
        },
      }
    );

    const results: any[] = [];

    if (domesticResp.ok) {
      const data = await domesticResp.json();
      const rows = data.rows || [];
      results.push(...rows.map((r: any) => ({
        type: "Domestic",
        address: r.address,
        postcode: r.postcode,
        rating: r["current-energy-rating"],
        score: r["current-energy-efficiency"],
        potentialRating: r["potential-energy-rating"],
        potentialScore: r["potential-energy-efficiency"],
        propertyType: r["property-type"],
        builtForm: r["built-form"],
        floorArea: r["total-floor-area"],
        co2Emissions: r["co2-emissions-current"],
        heatingType: r["main-heat-description"],
        wallType: r["walls-description"],
        roofType: r["roof-description"],
        windowType: r["windows-description"],
        inspectionDate: r["inspection-date"],
        validUntil: r["lodgement-date"],
        transactionType: r["transaction-type"],
      })));
    }

    if (nonDomesticResp.ok) {
      const data = await nonDomesticResp.json();
      const rows = data.rows || [];
      results.push(...rows.map((r: any) => ({
        type: "Non-Domestic",
        address: r.address,
        postcode: r.postcode,
        rating: r["asset-rating"],
        ratingBand: r["asset-rating-band"],
        propertyType: r["property-type"],
        floorArea: r["floor-area"],
        buildingEnvironment: r["building-environment"],
        mainHeatingFuel: r["main-heating-fuel"],
        airConPresent: r["ac-present"],
        inspectionDate: r["lodgement-date"],
        transactionType: r["transaction-type"],
        buildingReferenceNumber: r["building-reference-number"],
      })));
    }

    return results;
  } catch (e) {
    console.error("[property-lookup] EPC error:", e);
    return [];
  }
}

async function lookupFloodRisk(lat: number, lng: number): Promise<any> {
  try {
    const resp = await fetch(
      `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${lat}&long=${lng}&dist=1`
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const items = data.items || [];

    const warningsResp = await fetch(
      `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${lat}&long=${lng}&dist=1`
    );
    let floodAreas: any[] = [];
    if (warningsResp.ok) {
      const wData = await warningsResp.json();
      floodAreas = (wData.items || []).map((a: any) => ({
        name: a.label || a.description,
        description: a.description,
        riverOrSea: a.riverOrSea,
      }));
    }

    return {
      activeFloods: items.length,
      floodWarnings: items.map((f: any) => ({
        severity: f.severityLevel,
        description: f.description,
        area: f.floodArea?.label,
        timeRaised: f.timeRaised,
      })),
      nearbyFloodAreas: floodAreas.slice(0, 5),
    };
  } catch (e) {
    console.error("[property-lookup] Flood risk error:", e);
    return null;
  }
}

async function lookupFloodRiskByPostcode(postcode: string): Promise<any> {
  try {
    const geocodeResp = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`
    );
    if (!geocodeResp.ok) return null;
    const geoData = await geocodeResp.json();
    const lat = geoData.result?.latitude;
    const lng = geoData.result?.longitude;
    if (!lat || !lng) return null;

    const floodData = await lookupFloodRisk(lat, lng);
    return {
      ...floodData,
      coordinates: { lat, lng },
      postcodeData: {
        parish: geoData.result?.parish,
        ward: geoData.result?.admin_ward,
        district: geoData.result?.admin_district,
        county: geoData.result?.admin_county,
        region: geoData.result?.region,
        country: geoData.result?.country,
      },
    };
  } catch (e) {
    console.error("[property-lookup] Flood risk by postcode error:", e);
    return null;
  }
}

async function lookupListedBuildings(postcode: string): Promise<any[]> {
  try {
    const geocodeResp = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`
    );
    if (!geocodeResp.ok) return [];
    const geoData = await geocodeResp.json();
    const lat = geoData.result?.latitude;
    const lng = geoData.result?.longitude;
    if (!lat || !lng) return [];

    const radius = 200;
    const url = `https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/ArcGIS/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&distance=${radius}&units=esriSRUnit_Meter&outFields=Name,Grade,ListDate,AmendDate,HyperLink,ListEntry&returnGeometry=false&f=json`;

    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();

    return (data.features || []).map((f: any) => ({
      name: f.attributes?.Name,
      grade: f.attributes?.Grade,
      listEntry: f.attributes?.ListEntry,
      listDate: f.attributes?.ListDate,
      link: f.attributes?.HyperLink,
    }));
  } catch (e) {
    console.error("[property-lookup] Listed buildings error:", e);
    return [];
  }
}

async function lookupPlanningData(postcode: string): Promise<any> {
  try {
    const geocodeResp = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`
    );
    if (!geocodeResp.ok) return null;
    const geoData = await geocodeResp.json();
    const lat = geoData.result?.latitude;
    const lng = geoData.result?.longitude;
    if (!lat || !lng) return null;

    const datasets = [
      "conservation-area",
      "article-4-direction-area",
      "listed-building-outline",
      "tree-preservation-zone",
      "scheduled-monument",
      "world-heritage-site",
      "world-heritage-site-buffer-zone",
      "park-and-garden",
      "battlefield",
      "heritage-at-risk",
      "brownfield-land",
      "locally-listed-building",
      "heritage-coast",
      "special-area-of-conservation",
    ];

    const results: Record<string, any[]> = {};

    const [, planningApps] = await Promise.all([
      Promise.all(
        datasets.map(async (dataset) => {
          try {
            const resp = await fetch(
              `https://www.planning.data.gov.uk/entity.json?dataset=${dataset}&longitude=${lng}&latitude=${lat}&limit=10`,
              { signal: AbortSignal.timeout(15000) }
            );
            if (!resp.ok) return;
            const data = await resp.json();
            if (data.entities?.length > 0) {
              results[dataset] = data.entities.map((e: any) => ({
                name: e.name || e.reference,
                reference: e.reference,
                dataset: e.dataset,
                startDate: e["start-date"],
                documentUrl: e["document-url"] || e["documentation-url"],
                designationDate: e["designation-date"],
              }));
            }
          } catch {
          }
        })
      ),
      lookupPlanningApplications(lat, lng),
    ]);

    return {
      conservationAreas: results["conservation-area"] || [],
      article4Directions: results["article-4-direction-area"] || [],
      listedBuildingOutlines: results["listed-building-outline"] || [],
      treePreservationZones: results["tree-preservation-zone"] || [],
      scheduledMonuments: results["scheduled-monument"] || [],
      worldHeritageSites: results["world-heritage-site"] || [],
      worldHeritageBufferZones: results["world-heritage-site-buffer-zone"] || [],
      parksAndGardens: results["park-and-garden"] || [],
      battlefields: results["battlefield"] || [],
      heritageAtRisk: results["heritage-at-risk"] || [],
      brownfieldLand: results["brownfield-land"] || [],
      locallyListedBuildings: results["locally-listed-building"] || [],
      heritageCoast: results["heritage-coast"] || [],
      specialAreasOfConservation: results["special-area-of-conservation"] || [],
      planningApplications: planningApps || [],
      coordinates: { lat, lng },
    };
  } catch (e) {
    console.error("[property-lookup] Planning data error:", e);
    return null;
  }
}

async function lookupPlanningApplications(lat: number, lng: number): Promise<any[]> {
  try {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const fromDate = tenYearsAgo.toISOString().split("T")[0]; // YYYY-MM-DD

    // Query planning.data.gov.uk for planning applications within ~500m radius
    const url = `https://www.planning.data.gov.uk/entity.json?dataset=planning-application&longitude=${lng}&latitude=${lat}&geometry_relation=intersects&limit=100&entry_date_after=${fromDate}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const entities = data.entities || [];
    return entities.map((e: any) => ({
      reference: e.reference || e["application-reference"],
      address: e.name || e.address || e["site-address"] || "",
      description: e.description || e["development-description"] || e.proposal || "",
      status: e["application-status"] || e.status || "",
      type: e["application-type"] || e.type || "",
      decidedAt: e["decision-date"] || e["determined-date"] || "",
      receivedAt: e["entry-date"] || e["received-date"] || e["start-date"] || "",
      decision: e.decision || "",
      documentUrl: e["document-url"] || e["documentation-url"] || "",
    })).filter((p: any) => p.reference || p.description);
  } catch (e) {
    console.error("[property-lookup] Planning applications lookup error:", e);
    return [];
  }
}

async function lookupTflNearby(postcode: string): Promise<any> {
  try {
    const geocodeResp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
    if (!geocodeResp.ok) return null;
    const geoData = await geocodeResp.json();
    const lat = geoData.result?.latitude;
    const lng = geoData.result?.longitude;
    if (!lat || !lng) return null;

    const stopTypes = "NaptanMetroStation,NaptanRailStation";
    const radius = 1500;
    const url = `https://api.tfl.gov.uk/StopPoint?lat=${lat}&lon=${lng}&stopTypes=${stopTypes}&radius=${radius}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const stops = (data.stopPoints || []).map((s: any) => ({
      name: s.commonName,
      distance: Math.round(s.distance || 0),
      modes: s.modes || [],
      lines: (s.lines || []).map((l: any) => l.name),
      lat: s.lat,
      lon: s.lon,
    }));
    stops.sort((a: any, b: any) => a.distance - b.distance);
    if (stops.length === 0) return null;
    return { stations: stops, searchRadius: radius };
  } catch (e) {
    console.error("[property-lookup] TFL nearby error:", e);
    return null;
  }
}

const PROPERTYDATA_CORE_ENDPOINTS = [
  { key: "freeholds" },
  { key: "leaseholds" },
  { key: "planning-applications", extra: { max_age: "3650" } },
];

const PROPERTYDATA_MARKET_ENDPOINTS = [
  { key: "sold-prices" },
  { key: "rents-commercial", extra: { type: "retail" } },
  { key: "growth" },
  { key: "demand" },
  { key: "postcode-key-stats" },
  { key: "prices" },
  { key: "prices-per-sqf" },
  { key: "rents" },
  { key: "sold-prices-per-sqf" },
  { key: "demand-rent" },
  { key: "growth-psf" },
  { key: "yields" },
  { key: "floor-areas" },
];

const PROPERTYDATA_AREA_ENDPOINTS = [
  { key: "ptal" },
  { key: "crime" },
  { key: "schools" },
  { key: "internet-speed" },
  { key: "restaurants" },
  { key: "agents" },
  { key: "council-tax" },
  { key: "household-income" },
  { key: "population" },
  { key: "demographics" },
  { key: "politics" },
  { key: "area-type" },
];

const PROPERTYDATA_PLANNING_ENDPOINTS = [
  { key: "conservation-area" },
  { key: "green-belt" },
  { key: "aonb" },
  { key: "national-park" },
  { key: "listed-buildings" },
  { key: "national-hmo-register" },
];

const PROPERTYDATA_RESIDENTIAL_ENDPOINTS = [
  { key: "tenure-types" },
  { key: "property-types" },
  { key: "rents-hmo" },
  { key: "flood-risk" },
  { key: "uprns" },
  { key: "energy-efficiency" },
];

type PropertyDataLayer = "core" | "market" | "area" | "planning" | "residential";

const PROPERTYDATA_LAYER_MAP: Record<PropertyDataLayer, Array<{ key: string; extra?: Record<string, string> }>> = {
  core: PROPERTYDATA_CORE_ENDPOINTS,
  market: PROPERTYDATA_MARKET_ENDPOINTS,
  area: PROPERTYDATA_AREA_ENDPOINTS,
  planning: PROPERTYDATA_PLANNING_ENDPOINTS,
  residential: PROPERTYDATA_RESIDENTIAL_ENDPOINTS,
};

async function lookupPropertyDataCoUk(postcode: string, layers?: PropertyDataLayer[]): Promise<any> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  if (!apiKey) return null;
  try {
    const cleanPc = postcode.replace(/\s+/g, "");
    const activeLayers = layers || ["core"];
    const endpoints: Array<{ key: string; extra?: Record<string, string> }> = [];
    for (const layer of activeLayers) {
      const layerEndpoints = PROPERTYDATA_LAYER_MAP[layer];
      if (layerEndpoints) endpoints.push(...layerEndpoints);
    }
    if (endpoints.length === 0) return null;

    const results: any = {};
    const BATCH_SIZE = 4;
    const BATCH_DELAY = 2800;
    for (let i = 0; i < endpoints.length; i += BATCH_SIZE) {
      const batch = endpoints.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (ep) => {
        try {
          const params = new URLSearchParams({ key: apiKey, postcode: cleanPc, ...(ep.extra || {}) });
          const res = await fetch(`https://api.propertydata.co.uk/${ep.key}?${params}`, { signal: AbortSignal.timeout(20000) });
          if (!res.ok) { results[ep.key] = null; return; }
          const data = await res.json() as any;
          results[ep.key] = data.status === "error" ? null : data;
        } catch {
          results[ep.key] = null;
        }
      }));
      if (i + BATCH_SIZE < endpoints.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }
    const hasAnyData = Object.values(results).some(v => v !== null);
    if (!hasAnyData) return null;

    const enrichTitles = async (titles: any[]) => {
      if (!titles || titles.length === 0) return titles;
      const TITLE_BATCH = 3;
      const TITLE_DELAY = 1200;
      for (let i = 0; i < Math.min(titles.length, 15); i += TITLE_BATCH) {
        const batch = titles.slice(i, i + TITLE_BATCH);
        await Promise.all(batch.map(async (t) => {
          if (!t.title_number) return;
          try {
            const r = await fetch(`https://api.propertydata.co.uk/title?key=${apiKey}&title=${encodeURIComponent(t.title_number)}`, { signal: AbortSignal.timeout(12000) });
            if (!r.ok) return;
            const d = await r.json() as any;
            if (d.status !== "success" || !d.data) return;
            const ownership = d.data.ownership;
            if (ownership?.details?.owner) {
              t.proprietor_name_1 = ownership.details.owner;
              t.proprietor_category = ownership.type;
              if (ownership.details.company_reg) t.company_reg = ownership.details.company_reg;
              if (ownership.details.owner_address) t.proprietor_address = ownership.details.owner_address;
            }
            if (d.data.plot_size) t.plot_size = d.data.plot_size;
            if (d.data.uprns) t.uprns = d.data.uprns;
          } catch {}
        }));
        if (i + TITLE_BATCH < Math.min(titles.length, 15)) {
          await new Promise(r => setTimeout(r, TITLE_DELAY));
        }
      }
      return titles;
    };

    if (results["freeholds"]?.data) {
      results["freeholds"].data = await enrichTitles(results["freeholds"].data);
    }
    if (results["leaseholds"]?.data) {
      results["leaseholds"].data = await enrichTitles(results["leaseholds"].data);
    }

    return results;
  } catch {
    return null;
  }
}

export async function performPropertyLookup(params: {
  address?: string;
  postcode?: string;
  street?: string;
  buildingNameOrNumber?: string;
  uprn?: string;
  layers?: string[];
  propertyDataLayers?: string[];
}): Promise<PropertyLookupResult> {
  const { address, postcode, street, buildingNameOrNumber, layers, propertyDataLayers } = params;

  const pc = postcode || "";
  const st = street || "";
  const fullAddress = address || [buildingNameOrNumber, street, postcode].filter(Boolean).join(", ");

  const activeLayers = new Set(layers || ["core"]);
  const pdLayers = (propertyDataLayers || ["core"]) as PropertyDataLayer[];

  const shouldLoadCore = activeLayers.has("core");
  const shouldLoadExtended = activeLayers.has("extended");

  const [pricePaid, voaResults, epcResults, floodData, listedResults, planningResults, propertyDataResults, tflResults] = await Promise.all([
    shouldLoadExtended && pc ? lookupPricePaid(pc, st) : Promise.resolve([]),
    shouldLoadCore && pc ? lookupVOA(pc, st) : Promise.resolve([]),
    shouldLoadExtended && pc ? lookupEPC(pc, address || st) : Promise.resolve([]),
    shouldLoadExtended && pc ? lookupFloodRiskByPostcode(pc) : Promise.resolve(null),
    shouldLoadExtended && pc ? lookupListedBuildings(pc) : Promise.resolve([]),
    shouldLoadCore && pc ? lookupPlanningData(pc) : Promise.resolve(null),
    pc ? lookupPropertyDataCoUk(pc, pdLayers) : Promise.resolve(null),
    shouldLoadExtended && pc ? lookupTflNearby(pc) : Promise.resolve(null),
  ]);

  return {
    address: fullAddress,
    postcode: pc,
    pricePaid,
    voaRatings: voaResults,
    epc: epcResults,
    floodRisk: floodData,
    listedBuilding: listedResults,
    planningData: planningResults,
    propertyDataCoUk: propertyDataResults,
    tflNearby: tflResults,
    companiesHouse: [],
  };
}

export function formatPropertyReport(data: PropertyLookupResult): string {
  const sections: string[] = [];

  sections.push(`# Property Report: ${data.address}`);
  sections.push(`**Postcode:** ${data.postcode}`);

  if (data.floodRisk?.postcodeData) {
    const pd = data.floodRisk.postcodeData;
    sections.push(`**Location:** ${[pd.ward, pd.district, pd.region].filter(Boolean).join(", ")}`);
    if (data.floodRisk.coordinates) {
      sections.push(`**Coordinates:** ${data.floodRisk.coordinates.lat}, ${data.floodRisk.coordinates.lng}`);
    }
  }

  if (data.epc.length > 0) {
    sections.push("\n## Energy Performance (EPC)");
    for (const epc of data.epc.slice(0, 3)) {
      if (epc.type === "Domestic") {
        sections.push(`- **${epc.address}**: Rating **${epc.rating}** (score: ${epc.score}), Potential: ${epc.potentialRating} (${epc.potentialScore})`);
        sections.push(`  Property type: ${epc.propertyType}, Floor area: ${epc.floorArea}m², CO₂: ${epc.co2Emissions} tonnes/yr`);
        sections.push(`  Heating: ${epc.heatingType}, Walls: ${epc.wallType}`);
        sections.push(`  Inspected: ${epc.inspectionDate}`);
      } else {
        sections.push(`- **${epc.address}**: Asset Rating **${epc.ratingBand || epc.rating}**`);
        sections.push(`  Property type: ${epc.propertyType}, Floor area: ${epc.floorArea}m²`);
        sections.push(`  Building environment: ${epc.buildingEnvironment}, Main fuel: ${epc.mainHeatingFuel}`);
        sections.push(`  Inspected: ${epc.inspectionDate}`);
      }
    }
  }

  if (data.voaRatings.length > 0) {
    sections.push("\n## Rateable Values (VOA)");
    for (const voa of data.voaRatings.slice(0, 5)) {
      sections.push(`- **${voa.firmName || "N/A"}** — ${voa.address}`);
      sections.push(`  Description: ${voa.description}, Rateable Value: £${voa.rateableValue?.toLocaleString() || "N/A"}`);
    }
  }

  if (data.pricePaid.length > 0) {
    sections.push("\n## Transaction History (Price Paid)");
    for (const tx of data.pricePaid.slice(0, 10)) {
      sections.push(`- **£${tx.price?.toLocaleString()}** on ${tx.date} — ${tx.address} (${tx.propertyType}, ${tx.estateType})`);
    }
  }

  if (data.floodRisk) {
    sections.push("\n## Flood Risk");
    if (data.floodRisk.activeFloods > 0) {
      sections.push(`⚠️ **${data.floodRisk.activeFloods} active flood warning(s)**`);
      for (const w of data.floodRisk.floodWarnings) {
        sections.push(`- ${w.description} (Severity: ${w.severity})`);
      }
    } else {
      sections.push("No active flood warnings in this area.");
    }
    if (data.floodRisk.nearbyFloodAreas?.length > 0) {
      sections.push("**Nearby flood areas:**");
      for (const a of data.floodRisk.nearbyFloodAreas) {
        sections.push(`- ${a.name}${a.riverOrSea ? ` (${a.riverOrSea})` : ""}`);
      }
    }
  }

  if (data.listedBuilding.length > 0) {
    sections.push("\n## Listed Buildings Nearby");
    for (const lb of data.listedBuilding.slice(0, 5)) {
      sections.push(`- **${lb.name}** — Grade ${lb.grade} (Entry: ${lb.listEntry})`);
      if (lb.link) sections.push(`  [View details](${lb.link})`);
    }
  }

  if (data.planningData) {
    const pd = data.planningData;
    const allKeys = ['conservationAreas','article4Directions','listedBuildingOutlines','treePreservationZones','scheduledMonuments','worldHeritageSites','worldHeritageBufferZones','parksAndGardens','battlefields','heritageAtRisk','brownfieldLand','locallyListedBuildings','heritageCoast','specialAreasOfConservation'];
    const hasPlanning = allKeys.some(k => pd[k]?.length > 0);
    if (hasPlanning) {
      sections.push("\n## Planning Designations & Heritage");
      const entries: [string, string][] = [
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
      for (const [key, label] of entries) {
        if (pd[key]?.length > 0) {
          sections.push(`**${label}:**`);
          for (const item of pd[key]) {
            sections.push(`- ${item.name}${item.designationDate ? ` (designated ${item.designationDate})` : ""}`);
          }
        }
      }
    }
  }

  if (data.propertyDataCoUk) {
    const pd = data.propertyDataCoUk;
    if (pd["postcode-key-stats"]) {
      const ks = pd["postcode-key-stats"];
      sections.push("\n## Postcode Key Stats (PropertyData)");
      if (ks.data?.average_price) sections.push(`Average price: £${Number(ks.data.average_price).toLocaleString()}`);
      if (ks.data?.turnover) sections.push(`Annual turnover: ${ks.data.turnover}`);
      if (ks.data?.average_rent) sections.push(`Average rent (pcm): £${ks.data.average_rent}`);
      if (ks.data?.average_yield) sections.push(`Average yield: ${ks.data.average_yield}`);
      if (ks.data?.council_tax_band) sections.push(`Typical council tax band: ${ks.data.council_tax_band}`);
    }
    if (pd["growth"]) {
      const g = pd["growth"];
      sections.push("\n## Price Growth (PropertyData)");
      if (g.data) {
        const d = g.data;
        if (d.growth_1y !== undefined) sections.push(`1-year growth: ${d.growth_1y}%`);
        if (d.growth_3y !== undefined) sections.push(`3-year growth: ${d.growth_3y}%`);
        if (d.growth_5y !== undefined) sections.push(`5-year growth: ${d.growth_5y}%`);
      }
    }
    if (pd["demand"]) {
      const dm = pd["demand"];
      sections.push("\n## Market Demand (PropertyData)");
      if (dm.data) {
        const d = dm.data;
        if (d.demand_score !== undefined) sections.push(`Demand score: ${d.demand_score}/100`);
        if (d.supply !== undefined) sections.push(`Supply: ${d.supply} properties`);
        if (d.demand !== undefined) sections.push(`Demand: ${d.demand}`);
      }
    }
    if (pd["sold-prices"]?.data?.length > 0) {
      sections.push("\n## Recent Sold Prices (PropertyData)");
      for (const sp of pd["sold-prices"].data.slice(0, 5)) {
        sections.push(`- £${Number(sp.price || sp.result).toLocaleString()} — ${sp.address || "N/A"} (${sp.date || ""})`);
      }
    }
    if (pd["rents-commercial"]?.data) {
      sections.push("\n## Commercial Rents (PropertyData)");
      const rc = pd["rents-commercial"].data;
      if (rc.average_rent) sections.push(`Average commercial rent: £${rc.average_rent}/sq ft`);
      if (rc.min_rent) sections.push(`Range: £${rc.min_rent} – £${rc.max_rent}/sq ft`);
    }
    const planAppsRaw = pd["planning-applications"]?.data;
    const planApps = Array.isArray(planAppsRaw) ? planAppsRaw : (planAppsRaw?.planning_applications || []);
    if (planApps.length > 0) {
      sections.push(`\n## Planning Applications (${planApps.length} in last 10 years)`);
      for (const pa of planApps.slice(0, 20)) {
        sections.push(`- **${pa.proposal || pa.description || "Application"}** (${pa.status || "N/A"}) — ${pa.dates?.received_at || pa.date || ""}`);
        if (pa.address) sections.push(`  ${pa.address}`);
        if (pa.reference) sections.push(`  Ref: ${pa.reference}`);
      }
      if (planApps.length > 20) sections.push(`  ... and ${planApps.length - 20} more`);
    }
    if (pd["flood-risk"]?.data) {
      const fr = pd["flood-risk"].data;
      sections.push("\n## Flood Risk (PropertyData)");
      if (fr.flood_risk) sections.push(`Flood risk level: ${fr.flood_risk}`);
      if (fr.surface_water) sections.push(`Surface water risk: ${fr.surface_water}`);
    }
    if (pd["prices"]?.data) {
      const p = pd["prices"].data;
      sections.push("\n## Current Prices (PropertyData)");
      if (p.average) sections.push(`Average price: £${Number(p.average).toLocaleString()}`);
      if (p.detached) sections.push(`Detached: £${Number(p.detached).toLocaleString()}`);
      if (p.semi_detached) sections.push(`Semi-detached: £${Number(p.semi_detached).toLocaleString()}`);
      if (p.terraced) sections.push(`Terraced: £${Number(p.terraced).toLocaleString()}`);
      if (p.flat) sections.push(`Flat: £${Number(p.flat).toLocaleString()}`);
    }
    if (pd["prices-per-sqf"]?.data) {
      const p = pd["prices-per-sqf"].data;
      sections.push("\n## Prices Per Sq Ft (PropertyData)");
      if (p.average) sections.push(`Average: £${p.average}/sqft`);
      if (p.detached) sections.push(`Detached: £${p.detached}/sqft`);
      if (p.flat) sections.push(`Flat: £${p.flat}/sqft`);
    }
    if (pd["sold-prices-per-sqf"]?.data) {
      const p = pd["sold-prices-per-sqf"].data;
      sections.push("\n## Sold Prices Per Sq Ft (PropertyData)");
      if (p.average) sections.push(`Average: £${p.average}/sqft`);
    }
    if (pd["rents"]?.data) {
      const r = pd["rents"].data;
      sections.push("\n## Residential Rents (PropertyData)");
      if (r.average) sections.push(`Average rent: £${r.average} pcm`);
      if (r.studio) sections.push(`Studio: £${r.studio} pcm`);
      if (r.one_bed) sections.push(`1-bed: £${r.one_bed} pcm`);
      if (r.two_bed) sections.push(`2-bed: £${r.two_bed} pcm`);
      if (r.three_bed) sections.push(`3-bed: £${r.three_bed} pcm`);
    }
    if (pd["rents-hmo"]?.data) {
      const r = pd["rents-hmo"].data;
      sections.push("\n## HMO Rents (PropertyData)");
      if (r.average) sections.push(`Average HMO room rent: £${r.average} pcm`);
    }
    if (pd["demand-rent"]?.data) {
      const d = pd["demand-rent"].data;
      sections.push("\n## Rental Demand (PropertyData)");
      if (d.demand_score !== undefined) sections.push(`Rental demand score: ${d.demand_score}/100`);
      if (d.supply !== undefined) sections.push(`Rental supply: ${d.supply}`);
    }
    if (pd["growth-psf"]?.data) {
      const g = pd["growth-psf"].data;
      sections.push("\n## Price Growth Per Sq Ft (PropertyData)");
      if (g.growth_1y !== undefined) sections.push(`1-year: ${g.growth_1y}%`);
      if (g.growth_3y !== undefined) sections.push(`3-year: ${g.growth_3y}%`);
      if (g.growth_5y !== undefined) sections.push(`5-year: ${g.growth_5y}%`);
    }
    if (pd["yields"]?.data) {
      const y = pd["yields"].data;
      sections.push("\n## Yields (PropertyData)");
      if (y.long_let) sections.push(`Long let yield: ${y.long_let}%`);
      if (y.short_let) sections.push(`Short let yield: ${y.short_let}%`);
      if (y.hmo) sections.push(`HMO yield: ${y.hmo}%`);
    }
    if (pd["area-type"]) {
      sections.push("\n## Area Type (PropertyData)");
      if (pd["area-type"].result) sections.push(`Classification: ${pd["area-type"].result}`);
      if (pd["area-type"].description) sections.push(`${pd["area-type"].description}`);
    }
    if (pd["population"]?.result) {
      const p = pd["population"].result;
      sections.push("\n## Population (PropertyData)");
      if (p.population) sections.push(`Population: ${Number(p.population).toLocaleString()}`);
      if (p.density) sections.push(`Density: ${p.density} per hectare`);
      if (p.growth) sections.push(`Growth: ${p.growth}%`);
    }
    if (pd["household-income"]?.result) {
      const h = pd["household-income"].result;
      sections.push("\n## Household Income (PropertyData)");
      if (h.median_income) sections.push(`Median income: £${Number(h.median_income).toLocaleString()}`);
      if (h.mean_income) sections.push(`Mean income: £${Number(h.mean_income).toLocaleString()}`);
    }
    if (pd["demographics"]?.data) {
      const d = pd["demographics"].data;
      sections.push("\n## Demographics (PropertyData)");
      if (d.average_age) sections.push(`Average age: ${d.average_age}`);
      if (d.population_density) sections.push(`Density: ${d.population_density}`);
    }
    if (pd["tenure-types"]?.data) {
      const t = pd["tenure-types"].data;
      sections.push("\n## Tenure Types (PropertyData)");
      if (t.owned) sections.push(`Owned: ${t.owned}%`);
      if (t.social_rented) sections.push(`Social rented: ${t.social_rented}%`);
      if (t.private_rented) sections.push(`Private rented: ${t.private_rented}%`);
    }
    if (pd["property-types"]?.data) {
      const p = pd["property-types"].data;
      sections.push("\n## Property Types (PropertyData)");
      if (p.detached) sections.push(`Detached: ${p.detached}%`);
      if (p.semi_detached) sections.push(`Semi-detached: ${p.semi_detached}%`);
      if (p.terraced) sections.push(`Terraced: ${p.terraced}%`);
      if (p.flat) sections.push(`Flat: ${p.flat}%`);
    }
    if (pd["council-tax"]) {
      const ct = pd["council-tax"];
      sections.push("\n## Council Tax (PropertyData)");
      if (ct.council) sections.push(`Council: ${ct.council}`);
      if (ct.council_rating) sections.push(`Rating: ${ct.council_rating}`);
      if (ct.council_tax?.band_d) sections.push(`Band D: £${ct.council_tax.band_d}`);
    }
    if (pd["ptal"]) {
      sections.push("\n## Transport Accessibility (PropertyData)");
      if (pd["ptal"].ptal) sections.push(`PTAL score: ${pd["ptal"].ptal}`);
      if (pd["ptal"].description) sections.push(`${pd["ptal"].description}`);
    }
    if (pd["crime"]) {
      const c = pd["crime"];
      sections.push("\n## Crime (PropertyData)");
      if (c.crime_rate) sections.push(`Crime rate: ${c.crime_rate}`);
      if (c.crime_description) sections.push(`${c.crime_description}`);
    }
    if (pd["schools"]?.data?.length > 0) {
      sections.push("\n## Schools (PropertyData)");
      for (const s of pd["schools"].data.slice(0, 5)) {
        sections.push(`- **${s.name}** — ${s.type || ""}, Ofsted: ${s.ofsted || "N/A"}, ${s.distance || ""}m away`);
      }
    }
    if (pd["internet-speed"]?.internet) {
      const net = pd["internet-speed"].internet;
      sections.push("\n## Internet Speed (PropertyData)");
      if (net.download_speed) sections.push(`Download: ${net.download_speed} Mbps`);
      if (net.upload_speed) sections.push(`Upload: ${net.upload_speed} Mbps`);
      if (net.broadband_type) sections.push(`Type: ${net.broadband_type}`);
    }
    if (pd["restaurants"]?.data?.length > 0) {
      sections.push("\n## Restaurants (PropertyData)");
      for (const r of pd["restaurants"].data.slice(0, 5)) {
        sections.push(`- **${r.name}** — ${r.cuisine || ""}, Rating: ${r.rating || "N/A"}`);
      }
    }
    if (pd["agents"]?.data?.length > 0) {
      sections.push("\n## Local Agents (PropertyData)");
      for (const a of pd["agents"].data.slice(0, 5)) {
        sections.push(`- **${a.name}** — ${a.address || ""}`);
      }
    }
    if (pd["conservation-area"]) {
      sections.push("\n## Conservation Area (PropertyData)");
      sections.push(`In conservation area: ${pd["conservation-area"].conservation_area ? "Yes" : "No"}`);
      if (pd["conservation-area"].name) sections.push(`Name: ${pd["conservation-area"].name}`);
    }
    if (pd["green-belt"]) {
      sections.push("\n## Green Belt (PropertyData)");
      sections.push(`In green belt: ${pd["green-belt"].green_belt ? "Yes" : "No"}`);
    }
    if (pd["aonb"]) {
      sections.push("\n## AONB (PropertyData)");
      sections.push(`In AONB: ${pd["aonb"].aonb ? "Yes" : "No"}`);
      if (pd["aonb"].name) sections.push(`Name: ${pd["aonb"].name}`);
    }
    if (pd["national-park"]) {
      sections.push("\n## National Park (PropertyData)");
      sections.push(`In national park: ${pd["national-park"].national_park ? "Yes" : "No"}`);
      if (pd["national-park"].name) sections.push(`Name: ${pd["national-park"].name}`);
    }
    if (pd["listed-buildings"]?.data?.length > 0) {
      sections.push("\n## Listed Buildings (PropertyData)");
      for (const lb of pd["listed-buildings"].data.slice(0, 5)) {
        sections.push(`- **${lb.name || lb.address}** — Grade ${lb.grade || "N/A"}`);
      }
    }
    if (pd["politics"]?.data) {
      const p = pd["politics"].data;
      sections.push("\n## Politics (PropertyData)");
      if (p.constituency) sections.push(`Constituency: ${p.constituency}`);
      if (p.mp) sections.push(`MP: ${p.mp} (${p.party || ""})`);
    }
    if (pd["floor-areas"]?.data) {
      const fa = pd["floor-areas"].data;
      sections.push("\n## Floor Areas (PropertyData)");
      if (fa.average) sections.push(`Average: ${fa.average} sqft`);
      if (fa.median) sections.push(`Median: ${fa.median} sqft`);
    }
    if (pd["national-hmo-register"]?.data?.hmos?.length > 0) {
      sections.push("\n## HMO Register (PropertyData)");
      for (const h of pd["national-hmo-register"].data.hmos.slice(0, 5)) {
        sections.push(`- ${h.address} (licence expires: ${h.licence_expiry || "N/A"})`);
      }
    }
  }

  const allTitles = [
    ...(data.propertyDataCoUk?.["freeholds"]?.data || []).map((f: any) => ({ ...f, _tenure: "Freehold" })),
    ...(data.propertyDataCoUk?.["leaseholds"]?.data || []).map((f: any) => ({ ...f, _tenure: "Leasehold" })),
  ];
  if (allTitles.length > 0) {
    sections.push("\n## Ownership / Title Register (PropertyData)");
    const fCount = data.propertyDataCoUk?.["freeholds"]?.data?.length || 0;
    const lCount = data.propertyDataCoUk?.["leaseholds"]?.data?.length || 0;
    sections.push(`Registered titles: ${allTitles.length} (${fCount} freehold, ${lCount} leasehold)`);
    for (const f of allTitles.slice(0, 15)) {
      const owner = f.proprietor_name_1 || f.proprietor || "Unknown";
      const addr = f.address || f.property_address || "N/A";
      const details = [
        f.title_number ? `Title: ${f.title_number}` : null,
        f.tenure || f._tenure || null,
        f.date_proprietor_added ? `Since: ${f.date_proprietor_added}` : null,
        f.price_paid ? `Paid: £${Number(f.price_paid).toLocaleString()}` : null,
      ].filter(Boolean).join(" · ");
      sections.push(`- **${owner}** — ${addr}${details ? ` (${details})` : ""}`);
      if (f.proprietor_name_2) sections.push(`  Also: ${f.proprietor_name_2}`);
    }
  }

  if (data.propertyDataCoUk?.["uprns"]?.data?.length > 0) {
    const uprns = data.propertyDataCoUk["uprns"].data;
    sections.push("\n## Registered Properties/UPRNs (PropertyData)");
    sections.push(`Total registered addresses: ${uprns.length}`);
    const classCounts: Record<string, number> = {};
    for (const u of uprns) {
      const cls = u.classificationCodeDesc || "Unknown";
      classCounts[cls] = (classCounts[cls] || 0) + 1;
    }
    const sorted = Object.entries(classCounts).sort((a, b) => b[1] - a[1]);
    for (const [cls, count] of sorted.slice(0, 10)) {
      sections.push(`- ${cls}: ${count}`);
    }
  }

  if (data.propertyDataCoUk?.["energy-efficiency"]?.energy_efficiency?.length > 0) {
    const ee = data.propertyDataCoUk["energy-efficiency"].energy_efficiency;
    sections.push("\n## Energy Efficiency (PropertyData)");
    sections.push(`Recent EPC inspections: ${ee.length}`);
    const ratings: Record<string, number> = {};
    let totalScore = 0;
    for (const e of ee) {
      if (e.rating) ratings[e.rating] = (ratings[e.rating] || 0) + 1;
      if (e.score) totalScore += e.score;
    }
    const avgScore = Math.round(totalScore / ee.length);
    sections.push(`Average EPC score: ${avgScore}`);
    const ratingStr = Object.entries(ratings).sort((a, b) => a[0].localeCompare(b[0])).map(([r, c]) => `${r}: ${c}`).join(", ");
    sections.push(`Rating distribution: ${ratingStr}`);
  }

  if (data.tflNearby?.stations?.length > 0) {
    sections.push("\n## Transport Links (TfL)");
    for (const s of data.tflNearby.stations) {
      const walkMins = Math.round(s.distance / 80);
      const modeStr = s.modes.map((m: string) => m === "tube" ? "Tube" : m === "national-rail" ? "Rail" : m === "dlr" ? "DLR" : m === "overground" ? "Overground" : m === "elizabeth-line" ? "Elizabeth" : m).join(", ");
      sections.push(`- **${s.name}** — ${s.distance}m (~${walkMins} min walk) [${modeStr}]`);
      if (s.lines.length > 0) sections.push(`  Lines: ${s.lines.join(", ")}`);
    }
  }

  if (data.epc.length === 0 && data.voaRatings.length === 0 && data.pricePaid.length === 0 &&
      data.listedBuilding.length === 0 && !data.floodRisk && !data.planningData && !data.propertyDataCoUk && !data.tflNearby) {
    sections.push("\nNo data found for this address. Try providing a more specific postcode or address.");
  }

  return sections.join("\n");
}
