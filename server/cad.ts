import { Router, Request, Response } from "express";
import multer from "multer";
import { requireAuth } from "./auth";
import path from "path";
import { pathToFileURL } from "url";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

let wasmModule: any = null;

async function getWasmModule() {
  if (wasmModule) return wasmModule;
  // Import the raw WASM glue code directly — the dist/ build doesn't work
  // in Node.js because Vite replaces node:module/node:fs with empty stubs.
  const wasmJsPath = path.resolve("node_modules/@mlightcad/libredwg-web/wasm/libredwg-web.js");
  const wasmJsUrl = pathToFileURL(wasmJsPath).href;
  const mod = await import(wasmJsUrl);
  const createModule = mod.default || mod.createModule || mod;
  if (typeof createModule !== "function") {
    throw new Error("Could not find createModule in libredwg-web WASM module");
  }
  const wasmDir = path.resolve("node_modules/@mlightcad/libredwg-web/wasm/");
  wasmModule = await createModule({
    locateFile: (filename: string) => path.join(wasmDir, filename),
  });
  return wasmModule;
}

interface SimpleEntity {
  type: string;
  layer?: string;
  color?: number;
  startPoint?: { x: number; y: number };
  endPoint?: { x: number; y: number };
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  vertices?: { x: number; y: number }[];
}

function extractEntities(db: any): SimpleEntity[] {
  const entities: SimpleEntity[] = [];
  if (!db?.entities) return entities;

  for (const e of db.entities) {
    const base: Partial<SimpleEntity> = {
      type: e.type,
      layer: e.layer,
      color: e.colorIndex ?? e.color,
    };

    switch (e.type) {
      case "LINE":
        entities.push({
          ...base,
          type: "LINE",
          startPoint: { x: e.startPoint?.x ?? 0, y: e.startPoint?.y ?? 0 },
          endPoint: { x: e.endPoint?.x ?? 0, y: e.endPoint?.y ?? 0 },
        });
        break;

      case "LWPOLYLINE":
      case "POLYLINE":
        if (e.vertices?.length) {
          entities.push({
            ...base,
            type: e.type,
            vertices: e.vertices.map((v: any) => ({ x: v.x ?? 0, y: v.y ?? 0 })),
          });
        }
        break;

      case "CIRCLE":
        entities.push({
          ...base,
          type: "CIRCLE",
          center: { x: e.center?.x ?? 0, y: e.center?.y ?? 0 },
          radius: e.radius ?? 0,
        });
        break;

      case "ARC":
        entities.push({
          ...base,
          type: "ARC",
          center: { x: e.center?.x ?? 0, y: e.center?.y ?? 0 },
          radius: e.radius ?? 0,
          startAngle: e.startAngle ?? 0,
          endAngle: e.endAngle ?? 360,
        });
        break;

      case "ELLIPSE":
        entities.push({
          ...base,
          type: "ELLIPSE",
          center: { x: e.center?.x ?? 0, y: e.center?.y ?? 0 },
          radius: e.majorAxisEndPoint
            ? Math.sqrt(e.majorAxisEndPoint.x ** 2 + e.majorAxisEndPoint.y ** 2)
            : (e.radius ?? 1),
        });
        break;

      case "SOLID": {
        const verts = [];
        if (e.corner1) verts.push({ x: e.corner1.x, y: e.corner1.y });
        if (e.corner2) verts.push({ x: e.corner2.x, y: e.corner2.y });
        if (e.corner3) verts.push({ x: e.corner3.x, y: e.corner3.y });
        if (e.corner4) verts.push({ x: e.corner4.x, y: e.corner4.y });
        if (verts.length >= 3) {
          entities.push({ ...base, type: "LWPOLYLINE", vertices: verts });
        }
        break;
      }

      case "SPLINE": {
        if (e.fitPoints?.length) {
          entities.push({
            ...base,
            type: "LWPOLYLINE",
            vertices: e.fitPoints.map((p: any) => ({ x: p.x, y: p.y })),
          });
        } else if (e.controlPoints?.length) {
          entities.push({
            ...base,
            type: "LWPOLYLINE",
            vertices: e.controlPoints.map((p: any) => ({ x: p.x, y: p.y })),
          });
        }
        break;
      }

      default:
        break;
    }
  }

  return entities;
}

function extractRawEntities(wasm: any, data: any): { entities: SimpleEntity[] } {
  const entities: SimpleEntity[] = [];
  try {
    const numObjects = wasm.dwg_get_num_objects(data);
    for (let i = 0; i < numObjects; i++) {
      const obj = wasm.dwg_get_object(data, i);
      if (!obj) continue;
      const tio = wasm.dwg_object_to_entity_tio(obj);
      if (!tio) continue;
      const fixedtype = wasm.dwg_object_get_fixedtype(obj);
      // LINE = 20, CIRCLE = 18, ARC = 17, LWPOLYLINE = 77, ELLIPSE = 35
      try {
        if (fixedtype === 20) { // LINE
          const start = wasm.dwg_dynapi_entity_value(tio, "start")?.data;
          const end = wasm.dwg_dynapi_entity_value(tio, "end")?.data;
          if (start && end) {
            entities.push({ type: "LINE", startPoint: { x: start.x, y: start.y }, endPoint: { x: end.x, y: end.y } });
          }
        } else if (fixedtype === 18) { // CIRCLE
          const center = wasm.dwg_dynapi_entity_value(tio, "center")?.data;
          const radius = wasm.dwg_dynapi_entity_value(tio, "radius")?.data;
          if (center) {
            entities.push({ type: "CIRCLE", center: { x: center.x, y: center.y }, radius: radius || 0 });
          }
        } else if (fixedtype === 17) { // ARC
          const center = wasm.dwg_dynapi_entity_value(tio, "center")?.data;
          const radius = wasm.dwg_dynapi_entity_value(tio, "radius")?.data;
          const sa = wasm.dwg_dynapi_entity_value(tio, "start_angle")?.data;
          const ea = wasm.dwg_dynapi_entity_value(tio, "end_angle")?.data;
          if (center) {
            entities.push({ type: "ARC", center: { x: center.x, y: center.y }, radius: radius || 0, startAngle: sa || 0, endAngle: ea || 360 });
          }
        } else if (fixedtype === 77) { // LWPOLYLINE
          const numPts = wasm.dwg_dynapi_entity_value(tio, "num_points")?.data || 0;
          const ptsPtr = wasm.dwg_dynapi_entity_value(tio, "points")?.data;
          if (numPts > 0 && ptsPtr) {
            const pts = wasm.dwg_ptr_to_point2d_array(ptsPtr, numPts);
            entities.push({ type: "LWPOLYLINE", vertices: pts.map((p: any) => ({ x: p.x, y: p.y })) });
          }
        }
      } catch { /* skip unparseable entity */ }
    }
  } catch (e) {
    console.error("Raw entity extraction error:", e);
  }
  return { entities };
}

router.post("/api/cad/convert-dwg", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const wasm = await getWasmModule();
    const fileBuffer = req.file.buffer;

    // Write DWG binary to WASM virtual filesystem, then read it
    const tmpName = `upload_${Date.now()}.dwg`;
    wasm.FS.writeFile(tmpName, new Uint8Array(fileBuffer));
    const result = wasm.dwg_read_file(tmpName);
    wasm.FS.unlink(tmpName);

    if (result.error !== 0 && !result.data) {
      return res.status(422).json({ message: `Failed to parse DWG file (error code ${result.error})` });
    }

    const data = result.data;

    // Use the higher-level wrapper to convert if available, otherwise
    // extract entities directly from the raw WASM objects
    let db: any;
    try {
      const distPath = path.resolve("node_modules/@mlightcad/libredwg-web/dist/libredwg-web.js");
      const distUrl = pathToFileURL(distPath).href;
      const { LibreDwg } = await import(distUrl);
      const wrapper = LibreDwg.createByWasmInstance(wasm);
      db = wrapper.convert(data);
      wrapper.dwg_free(data);
    } catch {
      // If the wrapper fails, extract raw entity data manually
      db = extractRawEntities(wasm, data);
      wasm.dwg_free(data);
    }

    const entities = extractEntities(db);
    res.json({ entities, entityCount: entities.length });
  } catch (err: any) {
    console.error("DWG conversion error:", err);
    res.status(500).json({ message: "Failed to convert DWG file: " + (err.message || "unknown error") });
  }
});

export default router;
