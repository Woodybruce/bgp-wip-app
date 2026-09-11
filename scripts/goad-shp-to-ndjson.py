#!/usr/bin/env python3
"""
Convert an Experian Goad MasterMap shapefile bundle (the *_WGS84 .shp/.dbf set)
into newline-delimited JSON that scripts/import-goad-units.ts loads into
goad_units. Keeps the fiddly shapefile/DBF parsing in Python (pyshp) and hands
the TS importer clean records.

Usage:
  pip install pyshp
  python3 scripts/goad-shp-to-ndjson.py /path/to/unzipped/9033 > goad-units.ndjson

Point it at the directory holding the *_GF_/_F1_/_F2_/_LG_ layers, or at a
single .shp. Geometry is already WGS84 in these files (points are [lng, lat]),
so no reprojection is needed here.
"""
import sys, os, glob, json
import shapefile  # pyshp

FLOOR = {"retailgf": "GF", "retailf1": "F1", "retailf2": "F2", "retaillg": "LG"}


def rings_to_geometry(shape):
    parts = list(shape.parts) + [len(shape.points)]
    rings = [shape.points[parts[i]:parts[i + 1]] for i in range(len(parts) - 1)]
    # pyshp points are (x, y) == (lng, lat) for these WGS84 files → GeoJSON order.
    coords = [[[round(x, 7), round(y, 7)] for (x, y) in ring] for ring in rings]
    # First ring is outer; treat any extras as holes of a single Polygon.
    return {"type": "Polygon", "coordinates": coords}


def emit(shp_path, out):
    r = shapefile.Reader(shp_path, encoding="utf-8", encodingErrors="replace")
    for sr in r.iterShapeRecords():
        d = sr.record.as_dict()
        shape = sr.shape
        if not shape.points:
            continue
        sub = (d.get("Subclass") or "").lower()
        floor = FLOOR.get(sub, "GF")
        fascia = (d.get("Fascia") or d.get("FasciaMas") or "").replace("#", " ").strip()
        activity = (d.get("Activity") or "").upper()
        category = d.get("Category") or ""
        vacant = "VACANT" in category.upper() or activity == "VACANT"
        name = fascia if fascia else (d.get("PrimaryAc") or d.get("Activity") or "").replace("#", " ").strip()
        rec = {
            "source": "experian",
            "goadNumber": str(d.get("GoadNumber") or "") or None,
            "centreCode": d.get("CentreCode") or None,
            "floorLevel": floor,
            "occupierName": (name or None),
            "classification": "vacant" if vacant else "occupied",
            "category": category or None,
            "useClass": d.get("UseClass") or None,
            "tradeType": d.get("TradeType") or None,
            "streetNum": str(d.get("StreetNum") or "") or None,
            "streetName": d.get("StreetName") or None,
            "postcode": d.get("Postcode") or None,
            "precName": d.get("PrecName") or None,
            "areaFt2": int(d["Area_ft2"]) if d.get("Area_ft2") not in (None, "") else None,
            "areaM2": int(d["Area_m2"]) if d.get("Area_m2") not in (None, "") else None,
            "surveyDate": str(d.get("SurveyDate") or "") or None,
            "pubDate": str(d.get("PubDate") or "") or None,
            "geometry": rings_to_geometry(shape),
        }
        out.write(json.dumps(rec) + "\n")


def main():
    if len(sys.argv) < 2:
        print("usage: goad-shp-to-ndjson.py <dir-or-shp>", file=sys.stderr)
        sys.exit(1)
    target = sys.argv[1]
    shps = ([target] if target.endswith(".shp")
            else sorted(glob.glob(os.path.join(target, "*.shp"))))
    if not shps:
        print("no .shp found", file=sys.stderr)
        sys.exit(1)
    n = 0
    for shp in shps:
        base = os.path.basename(shp).lower()
        if "_lg_" in base or base.endswith("_lg_wgs84.shp"):
            # The LG layer is a legend/large-format overlay in some bundles; skip
            # if it duplicates GF. Comment out this guard to include it.
            pass
        before = n
        emit(shp, sys.stdout)
    sys.stderr.write("done\n")


if __name__ == "__main__":
    main()
