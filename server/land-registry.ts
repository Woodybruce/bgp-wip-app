import type { Express } from "express";
import { requireAuth } from "./auth";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { landRegistrySearches } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import pLimit from "p-limit";

const LR_BASE = "https://landregistry.data.gov.uk/data";

// In-memory cache for ownership intelligence results (24-hour TTL)
const ownershipCache = new Map<string, { data: any; expiresAt: number }>();
const OWNERSHIP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCachedOwnership(key: string): any | null {
  const entry = ownershipCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    ownershipCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedOwnership(key: string, data: any): void {
  // Evict expired entries first, then enforce hard cap
  if (ownershipCache.size >= 500) {
    const now = Date.now();
    for (const [k, v] of ownershipCache) {
      if (now > v.expiresAt) ownershipCache.delete(k);
    }
    // If still over limit after evicting expired, remove oldest entries
    if (ownershipCache.size >= 500) {
      const keys = [...ownershipCache.keys()];
      for (let i = 0; i < 50 && i < keys.length; i++) {
        ownershipCache.delete(keys[i]);
      }
    }
  }
  ownershipCache.set(key, { data, expiresAt: Date.now() + OWNERSHIP_CACHE_TTL });
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

export function registerLandRegistryRoutes(app: Express) {
  // Bootstrap: ensure columns exist
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS crm_property_id varchar`).catch(() => {});
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS notes text`).catch(() => {});
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]'`).catch(() => {});
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS status varchar DEFAULT 'New'`).catch(() => {});
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS voa_rateable_value integer`).catch(() => {});
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS kyc_risk_level text`).catch(() => {});
  db.execute(sql`ALTER TABLE land_registry_searches ADD COLUMN IF NOT EXISTS kyc_investigation_id integer`).catch(() => {});

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

  // Gold-standard property resolver — single endpoint used by both the text
  // search and map clicks. Takes EITHER an address string OR lat/lng and
  // returns the specific UPRN + its titles (the exact property) plus the
  // wider postcode context.
  //
  // Previous flow queried PropertyData /freeholds by postcode only — in
  // central London that returns every title at the postcode including
  // neighbouring buildings, giving 'random ownerships'. This flow uses
  // Ordnance Survey's UPRN (the unique id Land Registry titles are
  // actually anchored to) so the matched titles are exactly the property
  // the user picked.
  app.post("/api/land-registry/resolve", requireAuth, async (req, res) => {
    try {
      const { address: inputAddress, postcode: inputPostcode, lat, lng } = req.body || {};
      const PD_KEY = process.env.PROPERTYDATA_API_KEY;
      if (!PD_KEY) return res.status(503).json({ error: "PropertyData API key not configured" });

      let resolvedAddress: string = typeof inputAddress === "string" ? inputAddress.trim() : "";
      let resolvedPostcode: string = typeof inputPostcode === "string" ? inputPostcode.trim().toUpperCase() : "";
      let buildingName = "";

      // Step 1: if no address was supplied but we have coordinates, reverse
      // geocode with Google to get the formatted address + postcode.
      if (!resolvedAddress && typeof lat === "number" && typeof lng === "number") {
        if (!process.env.GOOGLE_API_KEY) return res.status(503).json({ error: "Google API key not configured" });
        try {
          const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_API_KEY}&result_type=premise|street_address|subpremise|establishment`;
          const gResp = await fetch(gUrl, { signal: AbortSignal.timeout(5000) });
          if (gResp.ok) {
            const gData = await gResp.json() as any;
            const result = gData.results?.[0];
            if (result) {
              const components = result.address_components || [];
              const getPart = (type: string) => components.find((c: any) => c.types?.includes(type))?.long_name || "";
              if (!resolvedPostcode) resolvedPostcode = getPart("postal_code");
              const premise = getPart("premise");
              const streetNum = getPart("street_number");
              const route = getPart("route");
              buildingName = premise || "";
              const streetParts = [streetNum, route].filter(Boolean).join(" ");
              resolvedAddress = [premise, streetParts].filter(Boolean).join(", ") || (result.formatted_address || "").replace(/, UK$/i, "").replace(/, United Kingdom$/i, "");
            }
          }
        } catch (e: any) {
          console.error("[land-registry/resolve] reverse-geocode error:", e?.message);
        }
      }

      if (!resolvedAddress && !resolvedPostcode) {
        return res.status(400).json({ error: "Provide address, postcode, or lat+lng" });
      }

      const cleanPc = resolvedPostcode.replace(/\s+/g, "");

      // Step 2: ask PropertyData to resolve the address (plus postcode) to
      // the exact UPRN(s). If this returns one or more UPRNs we have an
      // exact match and can query /uprn-title for precision.
      let matchedUprns: string[] = [];
      if (resolvedAddress && cleanPc) {
        try {
          const umUrl = `https://api.propertydata.co.uk/address-match-uprn?key=${PD_KEY}&address=${encodeURIComponent(resolvedAddress)}&postcode=${encodeURIComponent(cleanPc)}`;
          const umResp = await fetch(umUrl, { signal: AbortSignal.timeout(8000) });
          if (umResp.ok) {
            const umData = await umResp.json() as any;
            const d = umData?.data ?? umData;
            if (Array.isArray(d?.uprns)) matchedUprns = d.uprns.map(String);
            else if (d?.uprn) matchedUprns = [String(d.uprn)];
            else if (Array.isArray(d)) matchedUprns = d.map((x: any) => String(x?.uprn || x)).filter(Boolean);
          }
        } catch (e: any) {
          console.warn("[land-registry/resolve] address-match-uprn failed:", e?.message);
        }
      }

      // Step 3: fetch exact titles via uprn-title (for each UPRN) AND the
      // wider postcode context in parallel so the MLRO sees both.
      const pdFetch = async (endpoint: string, params: Record<string, string>): Promise<any> => {
        const qs = new URLSearchParams({ key: PD_KEY, ...params }).toString();
        try {
          const r = await fetch(`https://api.propertydata.co.uk/${endpoint}?${qs}`, { signal: AbortSignal.timeout(15000) });
          if (!r.ok) return null;
          return await r.json();
        } catch { return null; }
      };

      const [uprnTitleResults, postcodeFreeholds, postcodeLeaseholds] = await Promise.all([
        matchedUprns.length > 0
          ? Promise.all(matchedUprns.slice(0, 5).map(uprn => pdFetch("uprn-title", { uprn })))
          : Promise.resolve([]),
        cleanPc ? pdFetch("freeholds", { postcode: cleanPc }) : Promise.resolve(null),
        cleanPc ? pdFetch("leaseholds", { postcode: cleanPc }) : Promise.resolve(null),
      ]);

      // Flatten uprn-title results — each may return { data: { freeholds: [], leaseholds: [] } }
      const matchedFreeholds: any[] = [];
      const matchedLeaseholds: any[] = [];
      for (const ut of uprnTitleResults as any[]) {
        const d = ut?.data ?? ut;
        if (!d) continue;
        for (const fh of (d.freeholds || [])) matchedFreeholds.push(fh);
        for (const lh of (d.leaseholds || [])) matchedLeaseholds.push(lh);
        // Some tenants return a flat 'titles' array with title.tenure
        for (const t of (d.titles || [])) {
          (t?.tenure === "L" || t?.tenure === "leasehold" ? matchedLeaseholds : matchedFreeholds).push(t);
        }
      }

      // De-duplicate by title number and tag matched rows so we can filter
      // postcode-wide lists to 'other titles' on the client.
      const matchedTitleNumbers = new Set<string>([
        ...matchedFreeholds.map(f => f.title_number).filter(Boolean),
        ...matchedLeaseholds.map(l => l.title_number).filter(Boolean),
      ]);

      const contextFreeholds = ((postcodeFreeholds as any)?.data || []).filter((f: any) => !matchedTitleNumbers.has(f.title_number));
      const contextLeaseholds = ((postcodeLeaseholds as any)?.data || []).filter((l: any) => !matchedTitleNumbers.has(l.title_number));

      // Fallback: if UPRN match failed but Google gave us a street number,
      // prioritise postcode titles whose address field starts with that
      // number. This is 'better than nothing' when PropertyData has no
      // UPRN record for a quirky address.
      let fallbackFreeholds: any[] = [];
      let fallbackLeaseholds: any[] = [];
      if (matchedFreeholds.length === 0 && matchedLeaseholds.length === 0 && resolvedAddress) {
        const streetNumMatch = resolvedAddress.match(/^(\d+[a-z]?)\b/i);
        const streetNum = streetNumMatch ? streetNumMatch[1].toLowerCase() : null;
        if (streetNum) {
          const pickByStreet = (rows: any[]) => rows.filter((r: any) => {
            const props: string[] = Array.isArray(r.property) ? r.property : (r.property ? [r.property] : []);
            return props.some((p: string) => p.toLowerCase().startsWith(streetNum + " ") || p.toLowerCase().startsWith(streetNum + ",") || p.toLowerCase().includes(" " + streetNum + " "));
          });
          fallbackFreeholds = pickByStreet(((postcodeFreeholds as any)?.data || []));
          fallbackLeaseholds = pickByStreet(((postcodeLeaseholds as any)?.data || []));
        }
      }

      res.json({
        resolvedAddress,
        resolvedPostcode,
        buildingName,
        lat: typeof lat === "number" ? lat : null,
        lng: typeof lng === "number" ? lng : null,
        uprns: matchedUprns,
        matched: {
          freeholds: matchedFreeholds,
          leaseholds: matchedLeaseholds,
          exact: matchedFreeholds.length > 0 || matchedLeaseholds.length > 0,
        },
        fallback: {
          freeholds: fallbackFreeholds,
          leaseholds: fallbackLeaseholds,
          usedStreetNumberMatch: fallbackFreeholds.length > 0 || fallbackLeaseholds.length > 0,
        },
        context: {
          freeholds: contextFreeholds,
          leaseholds: contextLeaseholds,
        },
        source: matchedFreeholds.length > 0 ? "uprn" : fallbackFreeholds.length > 0 ? "street_number" : "postcode_only",
      });
    } catch (e: any) {
      console.error("[land-registry/resolve] Error:", e?.message);
      res.status(500).json({ error: e?.message || "resolver failed" });
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
      const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "AI service not configured" });
      }

      const { propertyAddress, postcode, freeholds, leaseholds, intelligence } = req.body;
      if (!propertyAddress || typeof propertyAddress !== "string" || propertyAddress.length > 1000) {
        return res.status(400).json({ error: "Property address required" });
      }
      const safeFreeholds = Array.isArray(freeholds) ? freeholds.slice(0, 30) : [];
      const safeLeaseholds = Array.isArray(leaseholds) ? leaseholds.slice(0, 30) : [];

      const anthropic = new Anthropic({
        apiKey,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

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
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
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
        .where(sql`${landRegistrySearches.id} = ${searchId} AND user_id = ${userId}`)
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

  // PATCH /api/land-registry/searches/:id — Update notes, tags, or status on a saved search
  app.patch("/api/land-registry/searches/:id", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const searchId = parseInt(req.params.id);
      if (isNaN(searchId)) return res.status(400).json({ error: "Invalid search id" });

      const { notes, tags, status, freeholds, leaseholds } = req.body;
      const validStatuses = ["New", "Investigating", "Contacted Owner", "No Interest", "Acquired"];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
      }

      const updates: Record<string, any> = {};
      if (notes !== undefined) updates.notes = notes;
      if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : [];
      if (status !== undefined) updates.status = status;
      if (freeholds !== undefined) {
        updates.freeholds = Array.isArray(freeholds) ? freeholds : [];
        updates.freeholdsCount = Array.isArray(freeholds) ? freeholds.length : 0;
      }
      if (leaseholds !== undefined) {
        updates.leaseholds = Array.isArray(leaseholds) ? leaseholds : [];
        updates.leaseholdsCount = Array.isArray(leaseholds) ? leaseholds.length : 0;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const setParts: any[] = [];
      if (updates.notes !== undefined) setParts.push(sql`notes = ${updates.notes}`);
      if (updates.tags !== undefined) setParts.push(sql`tags = ${JSON.stringify(updates.tags)}::jsonb`);
      if (updates.status !== undefined) setParts.push(sql`status = ${updates.status}`);
      if (updates.freeholds !== undefined) setParts.push(sql`freeholds = ${JSON.stringify(updates.freeholds)}::jsonb`);
      if (updates.freeholdsCount !== undefined) setParts.push(sql`freeholds_count = ${updates.freeholdsCount}`);
      if (updates.leaseholds !== undefined) setParts.push(sql`leaseholds = ${JSON.stringify(updates.leaseholds)}::jsonb`);
      if (updates.leaseholdsCount !== undefined) setParts.push(sql`leaseholds_count = ${updates.leaseholdsCount}`);

      const result = await db.execute(sql`
        UPDATE land_registry_searches
        SET ${sql.join(setParts, sql`, `)}
        WHERE id = ${searchId} AND user_id = ${userId}
        RETURNING *
      `);

      const rows = result.rows || result;
      const updated = Array.isArray(rows) ? rows[0] : null;
      if (!updated) return res.status(404).json({ error: "Search not found" });
      res.json(updated);
    } catch (e: any) {
      console.error("[land-registry-search-update] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/land-registry/searches/recent — Return the 20 most recent searches with linked CRM property info
  app.get("/api/land-registry/searches/recent", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const rows = await db.execute(sql`
        SELECT
          lrs.id,
          lrs.address,
          lrs.postcode,
          lrs.freeholds_count,
          lrs.leaseholds_count,
          lrs.status,
          lrs.notes,
          lrs.crm_property_id,
          lrs.created_at,
          lrs.user_id,
          (
            SELECT json_build_object(
              'id', p.id,
              'name', COALESCE(p.name, ''),
              'address', COALESCE(p.address, ''),
              'postcode', COALESCE(p.postcode, '')
            )
            FROM crm_properties p
            WHERE lrs.crm_property_id IS NOT NULL
              AND p.id = lrs.crm_property_id
            LIMIT 1
          ) AS linked_property
        FROM land_registry_searches lrs
        WHERE lrs.user_id = ${userId}
        ORDER BY lrs.created_at DESC
        LIMIT 20
      `);

      res.json(rows.rows || rows);
    } catch (e: any) {
      console.error("[land-registry-searches-recent] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/ownership-intelligence/bulk — Bulk ownership intelligence for multiple addresses
  app.post("/api/ownership-intelligence/bulk", requireAuth, async (req: any, res) => {
    try {
      const { addresses } = req.body;
      if (!Array.isArray(addresses) || addresses.length === 0) {
        return res.status(400).json({ error: "addresses array required" });
      }
      if (addresses.length > 20) {
        return res.status(400).json({ error: "Maximum 20 addresses per bulk request" });
      }

      const limit = pLimit(2);
      const results: any[] = [];

      const tasks = addresses.map((addr: { address: string; postcode: string }) =>
        limit(async () => {
          const cacheKey = `ownership:${(addr.postcode || addr.address || "").toLowerCase().trim()}`;
          const cached = getCachedOwnership(cacheKey);
          if (cached) {
            return { ...cached, fromCache: true };
          }

          try {
            // Fetch freeholds for the postcode
            const PD_KEY = process.env.PROPERTYDATA_API_KEY;
            if (!PD_KEY || !addr.postcode) {
              return { address: addr.address, postcode: addr.postcode, error: "Missing API key or postcode", titles: [] };
            }

            const cleanPc = addr.postcode.replace(/\s+/g, "");
            const fhResp = await fetch(`https://api.propertydata.co.uk/freeholds?key=${PD_KEY}&postcode=${cleanPc}`, { signal: AbortSignal.timeout(15000) });
            if (!fhResp.ok) {
              return { address: addr.address, postcode: addr.postcode, error: `PropertyData API error ${fhResp.status}`, titles: [] };
            }
            const fhData = await fhResp.json();
            const titles = fhData.status === "success" ? (fhData.data || []) : [];

            // Call ownership-intelligence endpoint internally
            const companyTitles = titles.filter((t: any) => t.company_reg).slice(0, 4);
            let ownerName = null;
            if (companyTitles.length > 0) {
              ownerName = companyTitles[0].proprietor_name_1 || null;
            } else if (titles.length > 0) {
              ownerName = titles[0].proprietor_name_1 || null;
            }

            const result = {
              address: addr.address,
              postcode: addr.postcode,
              freeholdsCount: titles.length,
              ownerName,
              titles: titles.slice(0, 5).map((t: any) => ({
                titleNumber: t.title_number,
                owner: t.proprietor_name_1,
                ownerType: t.proprietor_category,
                companyReg: t.company_reg,
              })),
            };

            setCachedOwnership(cacheKey, result);
            return result;
          } catch (err: any) {
            return { address: addr.address, postcode: addr.postcode, error: err.message, titles: [] };
          }
        })
      );

      const taskResults = await Promise.allSettled(tasks);
      for (const r of taskResults) {
        if (r.status === "fulfilled") {
          results.push(r.value);
        } else {
          results.push({ error: r.reason?.message || "Unknown error" });
        }
      }

      res.json({ results, count: results.length });
    } catch (e: any) {
      console.error("[ownership-intelligence-bulk] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });
}
