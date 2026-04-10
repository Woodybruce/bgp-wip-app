import type { Express } from "express";
import { requireAuth } from "./auth";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { landRegistrySearches } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";

const LR_BASE = "https://landregistry.data.gov.uk/data";

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

export function registerLandRegistryRoutes(app: Express) {
  // Bootstrap: ensure crm_property_id column exists
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS crm_property_id varchar`).catch(() => {});

  app.get("/api/land-registry/price-paid", requireAuth, async (req, res) => {
    try {
      const { street, postcode, town, district, pageSize } = req.query;
      const params = new URLSearchParams();
      if (street) params.set("propertyAddress.street", String(street).toUpperCase());
      if (postcode) params.set("propertyAddress.postcode", String(postcode).toUpperCase());
      if (town) params.set("propertyAddress.town", String(town).toUpperCase());
      if (district) params.set("propertyAddress.district", String(district).toUpperCase());
      params.set("_pageSize", String(pageSize || "50"));
      params.set("_sort", "-transactionDate");

      const url = `${LR_BASE}/ppi/transaction-record.json?${params}`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(response.status).json({ error: "Land Registry API error" });
      }
      const data = await response.json();
      const items = (data.result?.items || []).map((item: any) => ({
        id: item.transactionId || item._about,
        pricePaid: item.pricePaid,
        date: item.transactionDate,
        address: item.propertyAddress
          ? {
              paon: item.propertyAddress.paon || "",
              saon: item.propertyAddress.saon || "",
              street: item.propertyAddress.street || "",
              town: item.propertyAddress.town || "",
              district: item.propertyAddress.district || "",
              county: item.propertyAddress.county || "",
              postcode: item.propertyAddress.postcode || "",
            }
          : null,
        propertyType: extractLabel(item.propertyType),
        estateType: extractLabel(item.estateType),
        newBuild: item.newBuild || false,
        category: extractLabel(item.transactionCategory),
      }));
      const total = data.result?.totalResults || items.length;
      res.json({ items, total });
    } catch (err: any) {
      console.error("Land Registry price paid error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/land-registry/ukhpi", requireAuth, async (req, res) => {
    try {
      const { region, months } = req.query;
      const regionSlug = String(region || "city-of-london")
        .toLowerCase()
        .replace(/\s+/g, "-");
      const pageSize = Number(months) || 12;

      const url = `${LR_BASE}/ukhpi/region/${regionSlug}.json?_pageSize=${pageSize}&_sort=-refMonth`;
      const response = await fetch(url);
      if (!response.ok) {
        return res.status(response.status).json({ error: "UKHPI API error" });
      }
      const data = await response.json();
      const itemUrls = data.result?.items || [];

      const details = await Promise.all(
        itemUrls.map(async (itemUrl: string) => {
          try {
            const r = await fetch(itemUrl + ".json");
            if (!r.ok) return null;
            const d = await r.json();
            const t = d.result?.primaryTopic;
            if (!t) return null;
            return {
              month: t.refMonth,
              averagePrice: t.averagePrice,
              housePriceIndex: t.housePriceIndex,
              annualChange: t.percentageAnnualChange,
              monthlyChange: t.percentageChange,
              averagePriceFlat: t.averagePriceFlatMaisonette,
              averagePriceDetached: t.averagePriceDetached,
              averagePriceSemiDetached: t.averagePriceSemiDetached,
              averagePriceTerraced: t.averagePriceTerraced,
              averagePriceCash: t.averagePriceCash,
              averagePriceMortgage: t.averagePriceMortgage,
              averagePriceFirstTimeBuyer: t.averagePriceFirstTimeBuyer,
              region: t.refRegion
                ? extractLabel(t.refRegion)
                : regionSlug,
            };
          } catch {
            return null;
          }
        })
      );

      res.json({
        region: regionSlug,
        data: details.filter(Boolean).sort((a: any, b: any) =>
          (a.month || "").localeCompare(b.month || "")
        ),
      });
    } catch (err: any) {
      console.error("UKHPI error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/land-registry/regions", requireAuth, async (_req, res) => {
    const regions = [
      { slug: "city-of-london", name: "City of London" },
      { slug: "city-of-westminster", name: "City of Westminster" },
      { slug: "kensington-and-chelsea", name: "Kensington and Chelsea" },
      { slug: "camden", name: "Camden" },
      { slug: "islington", name: "Islington" },
      { slug: "hackney", name: "Hackney" },
      { slug: "tower-hamlets", name: "Tower Hamlets" },
      { slug: "southwark", name: "Southwark" },
      { slug: "lambeth", name: "Lambeth" },
      { slug: "wandsworth", name: "Wandsworth" },
      { slug: "hammersmith-and-fulham", name: "Hammersmith and Fulham" },
      { slug: "richmond-upon-thames", name: "Richmond upon Thames" },
      { slug: "barnet", name: "Barnet" },
      { slug: "bromley", name: "Bromley" },
      { slug: "croydon", name: "Croydon" },
      { slug: "ealing", name: "Ealing" },
      { slug: "greenwich", name: "Greenwich" },
      { slug: "hounslow", name: "Hounslow" },
      { slug: "kingston-upon-thames", name: "Kingston upon Thames" },
      { slug: "merton", name: "Merton" },
      { slug: "england-and-wales", name: "England and Wales" },
      { slug: "london", name: "London" },
    ];
    res.json(regions);
  });

  app.get("/api/property-lookup", requireAuth, async (req, res) => {
    try {
      const { postcode, street, buildingNameOrNumber, address, layers, propertyDataLayers } = req.query;
      if (!postcode) return res.status(400).json({ error: "Postcode is required" });

      const parsedLayers = layers ? String(layers).split(",") : undefined;
      const parsedPdLayers = propertyDataLayers ? String(propertyDataLayers).split(",") : undefined;

      const { performPropertyLookup, formatPropertyReport } = await import("./property-lookup");
      const result = await performPropertyLookup({
        postcode: String(postcode),
        street: street ? String(street) : undefined,
        buildingNameOrNumber: buildingNameOrNumber ? String(buildingNameOrNumber) : undefined,
        address: address ? String(address) : undefined,
        layers: parsedLayers,
        propertyDataLayers: parsedPdLayers,
      });
      res.json(result);
    } catch (e: any) {
      console.error("[property-lookup] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/address-search", requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (!q || q.length < 2) return res.json({ results: [] });

      const results: { label: string; postcode: string; type: "postcode" | "place"; addressType?: string; lat?: number; lng?: number }[] = [];
      const isPostcodeish = /^[A-Z]{1,2}\d/i.test(q);

      if (isPostcodeish) {
        try {
          const resp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete`);
          if (resp.ok) {
            const data = await resp.json();
            const postcodes = (data.result || []).slice(0, 8);
            await Promise.all(postcodes.map(async (pc: string) => {
              try {
                const geoResp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
                if (geoResp.ok) {
                  const geoData = await geoResp.json();
                  const r = geoData.result;
                  const label = r ? `${pc} — ${[r.admin_ward, r.admin_district].filter(Boolean).join(", ")}` : pc;
                  results.push({ label, postcode: pc, type: "postcode", lat: r?.latitude, lng: r?.longitude });
                } else {
                  results.push({ label: pc, postcode: pc, type: "postcode" });
                }
              } catch { results.push({ label: pc, postcode: pc, type: "postcode" }); }
            }));
          }
        } catch (e) {
          console.error("[address-search] Postcodes.io error:", e);
        }
      }

      if (process.env.GOOGLE_API_KEY) {
        const googleQuery = q.toLowerCase().includes("london") || q.toLowerCase().includes("uk") ? q : `${q}, London, UK`;
        const addGoogleResult = (label: string, postcode: string, lat: number, lng: number, addressType: string) => {
          const existing = results.find(r =>
            r.lat && lat && Math.abs(r.lat - lat) < 0.0003 && Math.abs((r.lng || 0) - lng) < 0.0003
          );
          if (!existing && label && (postcode || (lat && lng))) {
            results.push({
              label: postcode ? `${label} — ${postcode}` : label,
              postcode: postcode || "",
              type: "place" as const,
              addressType,
              lat,
              lng,
            });
          }
        };

        try {
          const fpUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(googleQuery)}&inputtype=textquery&fields=formatted_address,name,geometry,place_id,types&locationbias=circle:50000@51.5074,-0.1278&key=${process.env.GOOGLE_API_KEY}`;
          const fpResp = await fetch(fpUrl, { signal: AbortSignal.timeout(5000) });
          if (fpResp.ok) {
            const fpData = await fpResp.json() as any;
            for (const c of (fpData.candidates || []).slice(0, 3)) {
              const addr = c.formatted_address || "";
              const pcMatch = addr.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i);
              const postcode = pcMatch ? pcMatch[1].toUpperCase() : "";
              const lat = c.geometry?.location?.lat;
              const lng = c.geometry?.location?.lng;
              const name = c.name || "";
              const types = c.types || [];
              const isPrecise = types.includes("premise") || types.includes("subpremise") || types.includes("street_address") || types.includes("establishment") || types.includes("point_of_interest");
              const cleanAddr = addr.replace(/, UK$/i, "").replace(/, United Kingdom$/i, "").trim();
              const label = name && !cleanAddr.toLowerCase().startsWith(name.toLowerCase()) ? `${name}, ${cleanAddr}` : cleanAddr;
              if (lat && lng) addGoogleResult(label, postcode, lat, lng, isPrecise ? "address" : "place");
            }
          }
        } catch (e) {
          console.error("[address-search] Google FindPlace error:", e);
        }

        try {
          const tsUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(googleQuery)}&key=${process.env.GOOGLE_API_KEY}&region=uk`;
          const tsResp = await fetch(tsUrl, { signal: AbortSignal.timeout(5000) });
          if (tsResp.ok) {
            const tsData = await tsResp.json() as any;
            for (const place of (tsData.results || []).slice(0, 5)) {
              const addr = place.formatted_address || "";
              const pcMatch = addr.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i);
              const postcode = pcMatch ? pcMatch[1].toUpperCase() : "";
              const name = place.name || "";
              const lat = place.geometry?.location?.lat;
              const lng = place.geometry?.location?.lng;
              const label = name ? `${name}, ${addr.replace(/, UK$/i, "").replace(/, United Kingdom$/i, "")}` : addr;
              if (lat && lng) addGoogleResult(label, postcode, lat, lng, "address");
            }
          }
        } catch (e) {
          console.error("[address-search] Google Places TextSearch error:", e);
        }

        if (results.length < 5) {
          try {
            const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(googleQuery)}&key=${process.env.GOOGLE_API_KEY}&region=uk&components=country:GB`;
            const gResp = await fetch(gUrl, { signal: AbortSignal.timeout(5000) });
            if (gResp.ok) {
              const gData = await gResp.json() as any;
              for (const place of (gData.results || []).slice(0, 5)) {
                const addr = place.formatted_address || "";
                const pcMatch = addr.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i);
                const postcode = pcMatch ? pcMatch[1].toUpperCase() : "";
                const lat = place.geometry?.location?.lat;
                const lng = place.geometry?.location?.lng;
                const cleanAddr = addr.replace(/, UK$/i, "").replace(/, United Kingdom$/i, "").trim();
                const locType = place.geometry?.location_type;
                const types = place.types || [];
                const isPrecise = locType === "ROOFTOP" || locType === "RANGE_INTERPOLATED" || types.includes("premise") || types.includes("subpremise") || types.includes("street_address");
                if (lat && lng) addGoogleResult(cleanAddr, postcode, lat, lng, isPrecise ? "address" : "place");
              }
            }
          } catch (e) {
            console.error("[address-search] Google Geocoding error:", e);
          }
        }
      }

      if (results.length < 3) {
        try {
          const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + (q.toLowerCase().includes("uk") || q.toLowerCase().includes("london") || q.toLowerCase().includes("england") ? "" : ", UK"))}&format=json&countrycodes=gb&addressdetails=1&limit=6`;
          const resp = await fetch(nominatimUrl, {
            headers: { "User-Agent": "BGPDashboard/1.0 (chatbgp.app)" },
          });
          if (resp.ok) {
            const places = await resp.json();
            for (const place of places) {
              const postcode = place.address?.postcode || "";
              const addr = place.address || {};
              const namePart = addr.house_number
                ? `${addr.house_number} ${addr.road || ""}`.trim()
                : (place.name && place.name !== addr.road ? place.name : addr.road || "");
              const areaPart = [addr.suburb || addr.neighbourhood || "", addr.city || addr.town || addr.village || ""].filter(Boolean).join(", ");
              const label = [namePart, areaPart].filter(Boolean).join(", ");
              const lat = parseFloat(place.lat);
              const lng = parseFloat(place.lon);
              const existing = results.find(r => r.lat && Math.abs(r.lat - lat) < 0.0005 && Math.abs((r.lng || 0) - lng) < 0.0005);
              if (!existing && label) {
                results.push({
                  label: postcode ? `${label} — ${postcode}` : label,
                  postcode: postcode || "",
                  type: "place",
                  addressType: place.address?.house_number ? "address" : "place",
                  lat,
                  lng,
                });
              }
            }
          }
        } catch (e) {
          console.error("[address-search] Nominatim fallback error:", e);
        }
      }

      res.json({ results: results.slice(0, 10) });
    } catch (e: any) {
      console.error("[address-search] Error:", e);
      res.status(500).json({ error: e.message, results: [] });
    }
  });

  app.get("/api/reverse-geocode", requireAuth, async (req, res) => {
    try {
      const lat = parseFloat(String(req.query.lat || ""));
      const lng = parseFloat(String(req.query.lng || ""));
      if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: "lat and lng required" });

      let displayAddr = "";
      let postcode = "";
      let buildingName = "";

      if (process.env.GOOGLE_API_KEY) {
        try {
          const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_API_KEY}&result_type=premise|street_address|subpremise|establishment`;
          const gResp = await fetch(gUrl, { signal: AbortSignal.timeout(5000) });
          if (gResp.ok) {
            const gData = await gResp.json() as any;
            const result = gData.results?.[0];
            if (result) {
              const components = result.address_components || [];
              const getPart = (type: string) => components.find((c: any) => c.types?.includes(type))?.long_name || "";
              postcode = getPart("postal_code");
              const premise = getPart("premise");
              const streetNum = getPart("street_number");
              const route = getPart("route");
              const sublocality = getPart("sublocality") || getPart("neighborhood");
              buildingName = premise || "";
              const streetParts = [streetNum, route].filter(Boolean).join(" ");
              displayAddr = [premise, streetParts].filter(Boolean).join(", ");
              if (!displayAddr) {
                displayAddr = result.formatted_address?.replace(/, UK$/i, "").replace(/, United Kingdom$/i, "").split(",").slice(0, 2).join(",").trim() || "";
              }
            }
          }
        } catch (e) {
          console.error("[reverse-geocode] Google error:", e);
        }
      }

      if (!postcode) {
        try {
          const pcResp = await fetch(`https://api.postcodes.io/postcodes?lon=${lng}&lat=${lat}&limit=1`, { signal: AbortSignal.timeout(5000) });
          if (pcResp.ok) {
            const pcData = await pcResp.json();
            postcode = pcData.result?.[0]?.postcode || "";
          }
        } catch {}
      }

      if (!displayAddr) {
        try {
          const nomResp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
            { headers: { "User-Agent": "BGPDashboard/1.0 (chatbgp.app)" }, signal: AbortSignal.timeout(5000) }
          );
          if (nomResp.ok) {
            const nomData = await nomResp.json();
            const addr = nomData.address || {};
            if (!postcode) postcode = addr.postcode || "";
            const building = addr.building || addr.amenity || addr.shop || "";
            const houseNumber = addr.house_number || "";
            const road = addr.road || "";
            displayAddr = [building, houseNumber, road].filter(Boolean).join(" ");
            if (!displayAddr) displayAddr = nomData.display_name?.split(",").slice(0, 2).join(",").trim() || "";
          }
        } catch {}
      }

      if (!buildingName && process.env.GOOGLE_API_KEY) {
        try {
          const nUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=30&key=${process.env.GOOGLE_API_KEY}`;
          const nResp = await fetch(nUrl, { signal: AbortSignal.timeout(5000) });
          if (nResp.ok) {
            const nData = await nResp.json() as any;
            const nearby = nData.results || [];
            const building = nearby.find((p: any) =>
              p.name && !p.name.match(/^\d/) && p.types?.some((t: string) =>
                ["premise", "establishment", "point_of_interest", "real_estate_agency", "finance", "accounting", "health", "store"].includes(t)
              )
            );
            if (building?.name) {
              buildingName = building.name;
              displayAddr = `${building.name}, ${displayAddr}`;
            }
          }
        } catch {}
      }

      res.json({ displayAddr, postcode, buildingName, lat, lng });
    } catch (e: any) {
      console.error("[reverse-geocode] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/propertydata/:endpoint", requireAuth, async (req, res) => {
    try {
      const PD_KEY = process.env.PROPERTYDATA_API_KEY;
      if (!PD_KEY) return res.status(503).json({ error: "PropertyData API key not configured" });

      const endpoint = req.params.endpoint;
      const ALLOWED = new Set(["freeholds", "leaseholds", "uprn", "uprn-title", "address-match-uprn", "flood-risk", "planning-applications", "energy-efficiency", "floor-areas", "demographics", "postcode-key-stats", "sold-prices", "rents-commercial", "yields", "growth", "demand", "ptal", "crime", "conservation-area", "listed-buildings", "land-registry-documents", "analyse-buildings", "rebuild-cost", "valuation-commercial-sale", "valuation-commercial-rent"]);
      if (!ALLOWED.has(endpoint)) return res.status(400).json({ error: `Endpoint "${endpoint}" not allowed` });

      const params = new URLSearchParams({ key: PD_KEY });
      for (const [k, v] of Object.entries(req.query)) {
        if (k !== "key" && v && typeof v === "string") params.set(k, v);
      }

      const url = `https://api.propertydata.co.uk/${endpoint}?${params.toString()}`;
      const pdRes = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!pdRes.ok) {
        let errBody = "";
        try { errBody = await pdRes.text(); } catch {}
        return res.status(pdRes.status).json({ error: `PropertyData API returned HTTP ${pdRes.status}`, detail: errBody.slice(0, 500) });
      }
      const data = await pdRes.json();
      res.json(data);
    } catch (e: any) {
      console.error(`[propertydata/${req.params.endpoint}] Error:`, e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/property-summary", requireAuth, async (req, res) => {
    try {
      const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
      const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
      if (!apiKey) {
        return res.status(503).json({ error: "AI service not configured" });
      }

      const { propertyAddress, postcode, freeholds, leaseholds, intelligence } = req.body;
      if (!propertyAddress || typeof propertyAddress !== "string" || propertyAddress.length > 1000) {
        return res.status(400).json({ error: "Property address required" });
      }
      const safeFreeholds = Array.isArray(freeholds) ? freeholds.slice(0, 30) : [];
      const safeLeaseholds = Array.isArray(leaseholds) ? leaseholds.slice(0, 30) : [];

      const anthropic = new Anthropic({ apiKey, baseURL });

      const freeholdSummary = safeFreeholds.slice(0, 15).map((f: any, i: number) => {
        const tn = f.title_number || f.title || "unknown";
        const parts = [
          `[${i}] Title: ${tn}`,
          f.address ? `Address: ${f.address}` : null,
          f.proprietor_name_1 ? `Owner: ${f.proprietor_name_1}` : null,
          f.proprietor_category ? `Owner type: ${f.proprietor_category}` : null,
          f.company_reg ? `Co Reg: ${f.company_reg}` : null,
          f.date_proprietor_added ? `Registered: ${f.date_proprietor_added}` : null,
          f.price_paid ? `Price paid: £${Number(f.price_paid).toLocaleString()}` : null,
          f.polygons?.[0]?.leaseholds != null ? `Leaseholds under this freehold: ${f.polygons[0].leaseholds}` : null,
          f.plot_size ? `Plot: ${f.plot_size}` : null,
        ].filter(Boolean).join(", ");
        return parts;
      }).join("\n");

      const leaseholdSummary = safeLeaseholds.slice(0, 20).map((l: any, i: number) => {
        const tn = l.title_number || l.title || "unknown";
        const parts = [
          `[${i}] Title: ${tn}`,
          l.address ? `Address: ${l.address}` : null,
          l.proprietor_name_1 ? `Leaseholder: ${l.proprietor_name_1}` : null,
          l.proprietor_category ? `Type: ${l.proprietor_category}` : null,
          l.date_proprietor_added ? `Since: ${l.date_proprietor_added}` : null,
        ].filter(Boolean).join(", ");
        return parts;
      }).join("\n");

      const intel = intelligence || {};
      const intelParts: string[] = [];

      if (intel.rents) {
        const r = intel.rents;
        intelParts.push(`COMMERCIAL RENTS: Avg £${r.avg_quoting_rent_per_sqft || "?"}/sqft, Avg total £${r.avg_quoting_rent || "?"}/yr, Avg size ${r.avg_size || "?"}sqft, Sample: ${r.points_analysed || "?"} offices`);
      }
      if (intel.yields) {
        const y = intel.yields;
        if (y.long_let) intelParts.push(`YIELDS: Long let gross ${y.long_let.gross_yield || "?"}, Points: ${y.long_let.points_analysed || "?"}`);
        if (y.short_let) intelParts.push(`Short let gross: ${y.short_let.gross_yield || "?"}`);
        if (y.area_yield) intelParts.push(`Area yield: ${y.area_yield}%`);
      }
      if (intel.demand) {
        const d = intel.demand;
        intelParts.push(`DEMAND: Rating ${d.demand_rating || "?"}, For sale: ${d.total_for_sale || "?"}, Inventory: ${d.months_of_inventory || "?"} months, Avg days on market: ${d.days_on_market || "?"}`);
      }
      if (intel.growth) {
        const rows = Array.isArray(intel.growth) ? intel.growth : [];
        const latest = rows[rows.length - 1];
        if (latest?.[1]) intelParts.push(`GROWTH: Current avg price £${Number(latest[1]).toLocaleString()}`);
      }
      if (intel.demographics) {
        const d = intel.demographics;
        intelParts.push(`DEMOGRAPHICS: Pop ${d.population || "?"}, Avg age ${d.average_age || "?"}, Avg income £${d.average_income || "?"}`);
      }
      if (intel.conservation) {
        intelParts.push(`CONSERVATION AREA: ${intel.conservation.conservation_area ? "Yes" : "No"}`);
      }
      if (intel.listed) {
        const bldgs = intel.listed.listed_buildings || intel.listed.buildings || [];
        intelParts.push(`LISTED BUILDINGS NEARBY: ${bldgs.length}`);
      }
      if (intel.planning) {
        const apps = intel.planning.planning_applications || intel.planning.data?.planning_applications || [];
        intelParts.push(`PLANNING: ${apps.length} applications in last 10 years`);
        for (const a of apps.slice(0, 3)) {
          intelParts.push(`  - ${a.description || a.proposal || "Application"} (${a.status || "?"}) ${a.address || ""}`);
        }
      }
      if (intel.sold) {
        const prices = intel.sold.raw_data || intel.sold.sold_prices || intel.sold.prices || [];
        if (Array.isArray(prices) && prices.length > 0) {
          intelParts.push(`RECENT SALES: ${prices.length} transactions nearby`);
          for (const s of prices.slice(0, 5)) {
            intelParts.push(`  - £${Number(s.price || s.amount || 0).toLocaleString()} ${s.address || ""} (${s.date || s.sold_date || ""})`);
          }
        }
      }
      if (intel.stats) {
        intelParts.push(`MARKET: Avg price £${Number(intel.stats.average_price || 0).toLocaleString()}, ${intel.stats.points_analysed || "?"} sales analysed`);
      }

      const dataBlock = [
        `PROPERTY: ${propertyAddress}`,
        `POSTCODE: ${postcode || "unknown"}`,
        freeholdSummary ? `\nFREEHOLD TITLES AT THIS POSTCODE:\n${freeholdSummary}` : "\nNo freehold data available.",
        leaseholdSummary ? `\nLEASEHOLD TITLES AT THIS POSTCODE:\n${leaseholdSummary}` : "",
        intelParts.length > 0 ? `\nMARKET INTELLIGENCE:\n${intelParts.join("\n")}` : "",
      ].filter(Boolean).join("\n");

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        system: `You are a senior commercial property analyst at a London commercial property agency (Bruce Gillingham Pollard). You are given raw property data from PropertyData.co.uk APIs and Land Registry sources. Your job is to:

1. OWNERSHIP STRUCTURE (most important — always provide this first):
   - Identify the FREEHOLDER(s): who owns the freehold? Name the entity, their type (company/individual/government), company registration if available, and when they acquired it.
   - Identify the LEASEHOLDERS: list the leaseholders by name with their title numbers. Group by entity if the same leaseholder holds multiple leases.
   - If a freehold has many leaseholds under it, note this — it indicates a multi-let investment building.
   - Be specific: "The freehold is held by XYZ Ltd (Company No. 12345678), registered since 2019" not "A company owns the freehold".

2. Write a concise PROPERTY SUMMARY (3-5 sentences) explaining what this property/building appears to be — its use, ownership structure, and key characteristics. Use the freehold/leasehold data and market intelligence to paint a picture. Speak as a property professional to another property professional.

3. Analyse the freehold titles and recommend which specific titles are worth purchasing the full title register for, and WHY. Consider:
   - Which freehold likely covers the actual building being searched (match by address, number of leaseholds, owner type)
   - Whether the freeholder is a company (might indicate an investment) vs. an individual
   - Whether the title has many leaseholds under it (suggests multi-let building)
   - Whether the price paid / registration date suggests a recent transaction worth investigating
   - Any titles that look like adjacent land, car parks, or airspace that might be acquisition opportunities

4. Note any important flags: conservation area, listed building, flood risk, recent planning applications that might affect value.

Respond with ONLY a JSON object (no markdown, no backticks):
{
  "ownership": {
    "freeholders": [
      {
        "name": "Entity name",
        "titleNumber": "XX123456",
        "type": "Company|Individual|Government|Corporate Body",
        "companyReg": "if available or null",
        "registeredSince": "date or null",
        "pricePaid": "if available or null",
        "leaseholdsUnder": number or null
      }
    ],
    "leaseholders": [
      {
        "name": "Entity name",
        "titleNumbers": ["XX123456"],
        "type": "Company|Individual",
        "registeredSince": "date or null"
      }
    ],
    "summary": "1-2 sentence plain English ownership summary e.g. 'The freehold is held by ABC Ltd, a Jersey-registered company. There are 12 leaseholders including several national retailers.'"
  },
  "summary": "3-5 sentence property summary as described above",
  "recommendedTitles": [
    {
      "titleNumber": "XX123456",
      "priority": "high" | "medium" | "low",
      "reason": "Brief explanation of why this title is worth investigating"
    }
  ],
  "flags": ["any important warnings or notes"],
  "investmentAngle": "1-2 sentences on potential investment angle or opportunity if apparent from the data"
}`,
        messages: [{
          role: "user",
          content: dataBlock,
        }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return res.json({
          summary: result.summary || "",
          ownership: result.ownership || null,
          recommendedTitles: Array.isArray(result.recommendedTitles) ? result.recommendedTitles : [],
          flags: Array.isArray(result.flags) ? result.flags : [],
          investmentAngle: result.investmentAngle || "",
        });
      }
      return res.json({ summary: text.slice(0, 1000), ownership: null, recommendedTitles: [], flags: [], investmentAngle: "" });
    } catch (e: any) {
      console.error("[property-summary] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/title-search/ai-match", requireAuth, async (req, res) => {
    try {
      const { propertyAddress, freeholds } = req.body;
      if (!propertyAddress || typeof propertyAddress !== "string" || propertyAddress.length > 500) {
        return res.json({ match: null, reason: "Invalid address" });
      }
      if (!Array.isArray(freeholds) || freeholds.length === 0) {
        return res.json({ match: null, reason: "No freeholds provided" });
      }

      const PD_KEY = process.env.PROPERTYDATA_API_KEY;
      const capped = freeholds.slice(0, 10);
      const validTitles = new Set<string>();

      const titleData: any[] = [];
      for (const f of capped) {
        const tn = String(f.title_number || f.title || "").slice(0, 30);
        if (!tn) { titleData.push({ ...f, title_number: tn }); continue; }
        validTitles.add(tn);
        if (f.address || f.property_address || !PD_KEY) { titleData.push({ ...f, title_number: tn }); continue; }
        try {
          if (titleData.length > 0) await new Promise(r => setTimeout(r, 3000));
          const r = await fetch(`https://api.propertydata.co.uk/title?key=${PD_KEY}&title=${encodeURIComponent(tn)}`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) { titleData.push({ ...f, title_number: tn }); continue; }
          const d = await r.json();
          if (d.status === "error") { titleData.push({ ...f, title_number: tn }); continue; }
          const uprns: number[] = d.data?.uprns || [];
          const sampleUprns = uprns.slice(0, 2);
          const addresses: string[] = [];
          for (const uprn of sampleUprns) {
            try {
              await new Promise(r => setTimeout(r, 3000));
              const ur = await fetch(`https://api.propertydata.co.uk/uprn?key=${PD_KEY}&uprn=${uprn}`, { signal: AbortSignal.timeout(10000) });
              if (ur.ok) {
                const ud = await ur.json();
                if (ud.status === "success" && ud.data?.address) addresses.push(ud.data.address);
              }
            } catch {}
          }
          const polyCoords = f.polygons?.[0] ? `lat=${f.polygons[0].lat}, lng=${f.polygons[0].lng}` : null;
          titleData.push({
            ...f,
            title_number: tn,
            address: addresses[0] || null,
            uprn_addresses: addresses,
            ownership_type: d.data?.ownership || null,
            plot_size: d.data?.plot_size || null,
            estate_interest: d.data?.estate_interest || null,
            uprn_count: uprns.length,
            polygon_location: polyCoords,
          });
          console.log(`[ai-match] Title ${tn}: ${addresses.length} sample addresses, ${uprns.length} UPRNs, plot=${d.data?.plot_size}`);
        } catch {
          titleData.push({ ...f, title_number: tn });
        }
      }

      const freeholdSummary = titleData.map((f: any, i: number) => {
        const parts = [
          `[${i}] Title: ${f.title_number || "unknown"}`,
          f.address ? `Address: ${f.address}` : null,
          f.uprn_addresses?.length > 1 ? `Also covers: ${f.uprn_addresses.slice(1, 4).join("; ")}` : null,
          f.proprietor_name_1 ? `Owner: ${String(f.proprietor_name_1).slice(0, 100)}` : null,
          f.ownership_type ? `Ownership: ${f.ownership_type}` : null,
          f.estate_interest ? `Estate: ${f.estate_interest}` : null,
          f.plot_size ? `Plot: ${f.plot_size} acres` : null,
          f.uprn_count ? `UPRNs: ${f.uprn_count}` : null,
          f.polygon_location ? `Location: ${f.polygon_location}` : null,
          f.polygons?.[0]?.leaseholds ? `Leaseholds: ${f.polygons[0].leaseholds}` : null,
        ].filter(Boolean).join(", ");
        return parts;
      }).join("\n");

      console.log(`[ai-match] Enriched ${titleData.length} titles for matching against "${propertyAddress}"`);

      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
      });

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: `You are a UK property address matching expert. Given a property address and a list of Land Registry freehold titles (with their addresses and UPRNs), identify which title number is the best match for that property. Consider street names, building numbers, UPRN addresses, and proximity. If no title is a confident match, say so. Respond with ONLY a JSON object: { "matchIndex": <number or null>, "titleNumber": "<string or null>", "confidence": "high"|"medium"|"low"|"none", "reason": "<brief explanation>" }`,
        messages: [{
          role: "user",
          content: `Property address: ${propertyAddress.slice(0, 500)}\n\nFreehold titles:\n${freeholdSummary}`,
        }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        const confidence = ["high", "medium", "low", "none"].includes(result.confidence) ? result.confidence : "none";
        const titleNumber = result.titleNumber && validTitles.has(result.titleNumber) ? result.titleNumber : null;
        return res.json({
          match: {
            matchIndex: titleNumber ? result.matchIndex : null,
            titleNumber,
            confidence: titleNumber ? confidence : "none",
            reason: String(result.reason || "").slice(0, 300),
          },
        });
      }
      return res.json({ match: null, reason: "Could not parse AI response" });
    } catch (e: any) {
      console.error("[ai-match] Error:", e);
      res.status(500).json({ match: null, error: e.message });
    }
  });

  app.get("/api/land-registry/searches", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const rows = await db.select().from(landRegistrySearches)
        .where(eq(landRegistrySearches.userId, userId))
        .orderBy(desc(landRegistrySearches.createdAt))
        .limit(50);
      res.json(rows);
    } catch (e: any) {
      console.error("[land-registry-searches] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/land-registry/searches", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { address, postcode, freeholds, leaseholds, intelligence, aiSummary, ownership } = req.body;
      if (!address) return res.status(400).json({ error: "Address required" });
      const [row] = await db.insert(landRegistrySearches).values({
        userId,
        address,
        postcode: postcode || null,
        freeholdsCount: Array.isArray(freeholds) ? freeholds.length : 0,
        leaseholdsCount: Array.isArray(leaseholds) ? leaseholds.length : 0,
        freeholds: freeholds || [],
        leaseholds: leaseholds || [],
        intelligence: intelligence || {},
        aiSummary: aiSummary || null,
        ownership: ownership || null,
      }).returning();
      res.json(row);
    } catch (e: any) {
      console.error("[land-registry-searches] Save error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/land-registry/searches/:id/link-property", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const searchId = parseInt(req.params.id);
      if (isNaN(searchId)) return res.status(400).json({ error: "Invalid search id" });
      const { crmPropertyId } = req.body;
      const [updated] = await db.update(landRegistrySearches)
        .set({ crmPropertyId: crmPropertyId ?? null })
        .where(eq(landRegistrySearches.id, searchId))
        .returning();
      if (!updated) return res.status(404).json({ error: "Search not found" });
      res.json(updated);
    } catch (e: any) {
      console.error("[land-registry-link] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/land-registry/property-searches/:crmPropertyId", requireAuth, async (req: any, res) => {
    try {
      const { crmPropertyId } = req.params;
      const rows = await db.select().from(landRegistrySearches)
        .where(eq(landRegistrySearches.crmPropertyId, crmPropertyId))
        .orderBy(desc(landRegistrySearches.createdAt));
      res.json(rows);
    } catch (e: any) {
      console.error("[land-registry-property-searches] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });
}
