import { Router, Request, Response } from "express";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

let libredwgInstance: any = null;

async function getLibreDwg() {
  if (libredwgInstance) return libredwgInstance;
  const { LibreDwg } = await import("@mlightcad/libredwg-web");
  libredwgInstance = await LibreDwg.create(
    "./node_modules/@mlightcad/libredwg-web/wasm/"
  );
  return libredwgInstance;
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

router.post("/api/cad/convert-dwg", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const libredwg = await getLibreDwg();
    const fileBuffer = req.file.buffer;
    const data = libredwg.dwg_read_data(fileBuffer.buffer, 0); // 0 = DWG
    if (!data) {
      return res.status(422).json({ message: "Failed to parse DWG file — unsupported version or corrupt file" });
    }

    const db = libredwg.convert(data);
    libredwg.dwg_free(data);

    const entities = extractEntities(db);
    res.json({ entities, entityCount: entities.length });
  } catch (err: any) {
    console.error("DWG conversion error:", err);
    res.status(500).json({ message: "Failed to convert DWG file: " + (err.message || "unknown error") });
  }
});

export default router;
