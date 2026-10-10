#!/usr/bin/env python3
"""
Fetch the real Montmartre: IGN BD TOPO + Paris open data, for the route corridor.

    python3 tools/geo/fetch.py            # writes raw responses to tools/geo/raw/

WHY THIS EXISTS. Until October 2026 this project could not reach a single
vector source — the development container's proxy refused IGN, OSM, the Paris
open-data portal and Wikipedia alike — so every building on the route was
procedural and every coordinate was cited from search snippets. Those sources
are reachable now, and this script is the whole of the difference: real
footprints, real measured heights, real 3D street centrelines, real trees.

Sources, all open licence:
  - IGN BD TOPO v3 (Licence Ouverte Etalab 2.0) via the Géoplateforme WFS
      batiment            footprints, hauteur, altitude sol/toit, étages, matériaux
      troncon_de_route    3D centrelines, nature (Escalier, Sentier...), names
      construction_lineaire  walls (Mur), railings
      construction_ponctuelle  monuments, antennas, crosses
      zone_de_vegetation  gardens, wooded patches
      equipement_de_transport  métro entrances
  - Ville de Paris, "Les arbres" (ODbL) — every street tree, with height and girth
  - IGN RGE ALTI via the Géoplateforme altimetry service — terrain heights

Raw responses go to tools/geo/raw/ (gitignored); tools/geo/build.py turns them
into the committed, compact src/data/geo/montmartre.json the game reads.
"""
import json, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

# The corridor: Lamarck–Caulaincourt to Abbesses with ~120 m of margin, which
# is further than any street on the route lets you see except over the Ravignan
# drop, where the distant rooftop sea takes over.
SOUTH, WEST, NORTH, EAST = 48.8836, 2.3350, 48.8902, 2.3412

UA = {"User-Agent": "TimeClaudis/1.0 (open-data game research; github.com/William-muskus/Time-Claudis)"}

def fetch(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read()
        except Exception as e:
            print(f"  retry {i}: {e}", file=sys.stderr)
            time.sleep(2 ** i)
    raise SystemExit(f"giving up on {url}")

def wfs(layer, page=2000):
    """Every feature of a BD TOPO layer inside the corridor, paged."""
    out, start = [], 0
    while True:
        q = dict(SERVICE="WFS", VERSION="2.0.0", REQUEST="GetFeature", TYPENAMES=layer,
                 SRSNAME="EPSG:4326", OUTPUTFORMAT="application/json",
                 # Axis order: WFS 2.0 with the URN form of EPSG:4326 is lat,lon.
                 # The bare "EPSG:4326" form silently returns nothing.
                 BBOX=f"{SOUTH},{WEST},{NORTH},{EAST},urn:ogc:def:crs:EPSG::4326",
                 COUNT=str(page), STARTINDEX=str(start), SORTBY="cleabs")
        d = json.loads(fetch("https://data.geopf.fr/wfs/ows?" + urllib.parse.urlencode(q)))
        feats = d.get("features", [])
        out += feats
        print(f"  {layer}: {len(out)} / {d.get('numberMatched')}")
        if len(feats) < page:
            return out
        start += page

def paris_trees():
    """Ville de Paris tree inventory inside the corridor."""
    out, offset = [], 0
    where = (f"in_bbox(geo_point_2d, {SOUTH}, {WEST}, {NORTH}, {EAST})")
    while True:
        q = dict(where=where, limit="100", offset=str(offset))
        url = ("https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/records?"
               + urllib.parse.urlencode(q))
        d = json.loads(fetch(url))
        rows = d.get("results", [])
        out += rows
        print(f"  trees: {len(out)} / {d.get('total_count')}")
        if len(rows) < 100:
            return out
        offset += 100

def altimetry(step_m=10.0):
    """RGE ALTI terrain heights on a grid over the corridor."""
    import math
    dlat = step_m / 111320.0
    dlon = step_m / (111320.0 * math.cos(math.radians((SOUTH + NORTH) / 2)))
    lats = [SOUTH + i * dlat for i in range(int((NORTH - SOUTH) / dlat) + 1)]
    lons = [WEST + j * dlon for j in range(int((EAST - WEST) / dlon) + 1)]
    pts = [(la, lo) for la in lats for lo in lons]
    heights = []
    for i in range(0, len(pts), 150):
        chunk = pts[i:i + 150]
        q = dict(lon="|".join(f"{p[1]:.7f}" for p in chunk), lat="|".join(f"{p[0]:.7f}" for p in chunk),
                 resource="ign_rge_alti_wld", zonly="true", delimiter="|")
        d = json.loads(fetch("https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?"
                             + urllib.parse.urlencode(q)))
        heights += d["elevations"]
        print(f"  altimetry: {len(heights)} / {len(pts)}")
    return dict(south=SOUTH, west=WEST, dlat=dlat, dlon=dlon, rows=len(lats), cols=len(lons), z=heights)

def altimetry_fine():
    """2.5 m RGE ALTI grid over the walk itself.

    The 10 m corridor grid is fine for the city beyond the street walls and
    useless inside them: rue Pierre-Dac drops nine metres in twenty-five, and a
    10 m DTM smears that flight into a ramp that buries the bottom steps. This
    covers the route's own bounding box, which is where the player stands.
    """
    import math
    S, Wb, N, Eb = 48.88405, 2.33665, 48.88998, 2.33945
    step = 2.5
    dlat = step / 111320.0
    dlon = step / (111320.0 * math.cos(math.radians((S + N) / 2)))
    lats = [S + i * dlat for i in range(int((N - S) / dlat) + 1)]
    lons = [Wb + j * dlon for j in range(int((Eb - Wb) / dlon) + 1)]
    pts = [(la, lo) for la in lats for lo in lons]
    heights = []
    for i in range(0, len(pts), 150):
        chunk = pts[i:i + 150]
        q = dict(lon="|".join(f"{p[1]:.7f}" for p in chunk), lat="|".join(f"{p[0]:.7f}" for p in chunk),
                 resource="ign_rge_alti_wld", zonly="true", delimiter="|")
        d = json.loads(fetch("https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?"
                             + urllib.parse.urlencode(q)))
        heights += d["elevations"]
        if (i // 150) % 20 == 0:
            print(f"  altimetry fine: {len(heights)} / {len(pts)}")
    return dict(south=S, west=Wb, dlat=dlat, dlon=dlon, rows=len(lats), cols=len(lons), z=heights)

if __name__ == "__main__":
    os.makedirs(RAW, exist_ok=True)
    jobs = {
        "batiment": lambda: wfs("BDTOPO_V3:batiment"),
        "troncon_de_route": lambda: wfs("BDTOPO_V3:troncon_de_route"),
        "construction_lineaire": lambda: wfs("BDTOPO_V3:construction_lineaire"),
        "construction_ponctuelle": lambda: wfs("BDTOPO_V3:construction_ponctuelle"),
        "zone_de_vegetation": lambda: wfs("BDTOPO_V3:zone_de_vegetation"),
        "equipement_de_transport": lambda: wfs("BDTOPO_V3:equipement_de_transport"),
        "arbres": paris_trees,
        "altimetrie": altimetry,
        "altimetrie_fine": altimetry_fine,
    }
    only = sys.argv[1:] or list(jobs)
    for name in only:
        path = os.path.join(RAW, name + ".json")
        if os.path.exists(path) and "--force" not in sys.argv:
            print(f"{name}: cached"); continue
        print(name)
        data = jobs[name]()
        with open(path, "w") as f:
            json.dump(data, f)
