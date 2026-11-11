#!/usr/bin/env python3
"""
Pick the reference photographs the world is checked against.

    python3 tools/geo/references.py      # writes tools/geo/references.json

WHY. The first data-driven Montmartre had every building in the right place and
was unrecognisable to someone who lives there: orange walls, blue tarmac, no
garden walls, no greenery. Footprints say where things are; only photographs
say what they look like. Panoramax (the French open street-level imagery
commons) holds the Ville de Paris's own 2024–25 survey of these streets, flat
95-degree frames with a recorded position and heading.

For each waypoint on the route this picks the photograph nearest to it that
looks the way the player travels, preferring that survey because its frames are
consistent with each other (same rig, same lens, same height). Only the
picture's id, position, heading and licence are committed;
tools/verify/compare.mjs downloads the pictures themselves into artifacts/
when it runs, and renders the game from the same spot beside each one.

Photos: CC-BY-SA 4.0, credited to their producer in references.json.
"""
import json, math, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "references.json")
API = "https://api.panoramax.xyz/api"
UA = {"User-Agent": "TimeClaudis/1.0 (open-data game research; github.com/William-muskus/Time-Claudis)"}
M_LAT, M_LON = 111320.0, 73224.0


def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f"  retry {i}: {e}", file=sys.stderr)
            time.sleep(2 ** i)
    raise SystemExit(f"giving up on {url}")


def waypoints():
    """The route, read from src/data/route.js without running it."""
    import re
    src = open(os.path.join(ROOT, "src", "data", "route.js"), encoding="utf8").read()
    block = src[src.index("export const WAYPOINTS"):src.index("export const LANDMARKS")]
    out = []
    for m in re.finditer(r"id: '([a-z0-9_]+)'[^}]*?lat: ([0-9.]+), lon: ([0-9.]+)", block, re.S):
        out.append(dict(id=m.group(1), lat=float(m.group(2)), lon=float(m.group(3))))
    return out


def bearing(a, b):
    dx = (b["lon"] - a["lon"]) * M_LON
    dy = (b["lat"] - a["lat"]) * M_LAT
    return (math.degrees(math.atan2(dx, dy)) + 360) % 360


def main():
    wps = waypoints()
    refs, seen = [], set()
    for i, w in enumerate(wps):
        ahead = wps[min(i + 2, len(wps) - 1)]
        want = bearing(w, ahead) if ahead is not w else bearing(wps[i - 1], w)
        d = 0.00022
        q = f"{API}/search?bbox={w['lon'] - d * 1.5},{w['lat'] - d},{w['lon'] + d * 1.5},{w['lat'] + d}&limit=200"
        best = None
        feats = get(q)["features"]
        # Two passes: along the route if possible, else the nearest frame facing
        # anywhere. The game camera takes the photo's own heading, so a frame
        # looking back up rue Ravignan compares just as well as one looking down.
        for strict in (True, False):
          if best:
            break
          for f in feats:
            p = f["properties"]
            io = p.get("pers:interior_orientation") or {}
            az, fov = p.get("view:azimuth"), io.get("field_of_view")
            if az is None or fov is None or fov >= 180 or fov < 60 or f["id"] in seen:
                continue
            lon, lat = f["geometry"]["coordinates"]
            dist = math.hypot((lon - w["lon"]) * M_LON, (lat - w["lat"]) * M_LAT)
            dang = abs((az - want + 180) % 360 - 180)
            if strict and dang > 35:
                continue
            if not strict and dist > 16:
                continue
            score = dist + (dang * 0.35 if strict else 0) + (0 if p.get("geovisio:producer") == "immergis" else 15)
            if best is None or score < best[0]:
                best = (score, f, dist, dang)
        if not best:
            print(f"{w['id']:22s} -")
            continue
        f = best[1]
        p = f["properties"]
        seen.add(f["id"])
        lon, lat = f["geometry"]["coordinates"]
        refs.append(dict(
            name=w["id"], picture=f["id"], lat=round(lat, 7), lon=round(lon, 7),
            heading=p["view:azimuth"], hfov=p["pers:interior_orientation"]["field_of_view"],
            taken=p.get("datetime", "")[:10], producer=p.get("geovisio:producer"),
            licence="CC-BY-SA-4.0", sd=f["assets"]["sd"]["href"],
            note=f"{best[2]:.0f} m from the waypoint, {best[3]:.0f} deg off the route heading"))
        print(f"{w['id']:22s} {f['id']}  {refs[-1]['note']}")
    with open(OUT, "w") as fh:
        json.dump(dict(source="https://api.panoramax.xyz", references=refs), fh, indent=1)
    print(f"wrote {len(refs)} references to {OUT}")


if __name__ == "__main__":
    main()
