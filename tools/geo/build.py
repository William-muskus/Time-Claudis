#!/usr/bin/env python3
"""
Turn the raw IGN / Paris / OSM downloads into the compact dataset the game reads.

    pip install shapely          # build-time only; the game never needs it
    python3 tools/geo/fetch.py   # once, or with --force to refresh
    python3 tools/geo/build.py   # writes src/data/geo/montmartre.json

Everything is converted into the game's local frame here — metres, origin at
the Dalida bust, +X east, +Y up, +Z south — using EXACTLY the constants in
src/data/route.js. tests/geo.test.js asserts the two agree, because a frame
mismatch of a single metre would put every wall a metre into the street.

WHAT IS COMPUTED HERE RATHER THAN AT RUNTIME, AND WHY
  - Street-facing walls. A wall only gets windows, shutters and a shopfront if
    a real street lies in front of it before another building does. Deciding
    that needs polygon unions and ray casts, which shapely does well and the
    browser would do slowly on every load.
  - Roof insets. A mansard or hip roof is lofted from the footprint to a ring
    inset from it. An inset too deep for a narrow footprint self-intersects
    and renders as a spike. The safe inset is found here, by running the same
    vertex-miter offset the runtime runs and asking shapely whether the result
    is still a valid polygon.
  - Shops onto walls. OSM shop and café nodes are snapped to the street-facing
    wall they stand against, so the boulangerie gets its awning on the right
    building rather than floating in the road.

PROVENANCE is carried into the output: every top-level block names its source
and licence, and docs/ROUTE.md describes the pipeline.
"""
import json, math, os, sys, xml.etree.ElementTree as ET

try:
    from shapely.geometry import Polygon, LineString, Point, shape
    from shapely.ops import unary_union
    from shapely.strtree import STRtree
except ImportError:
    raise SystemExit("tools/geo/build.py needs shapely: pip install shapely")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(ROOT, "src", "data", "geo", "montmartre.json")

# MUST match src/data/route.js. Asserted by tests/geo.test.js.
ORIGIN = dict(lat=48.8885450, lon=2.3380676, elev=104.0)
M_LAT = 111320.0
M_LON = 73224.0


def L(lon, lat):
    return ((lon - ORIGIN["lon"]) * M_LON, -(lat - ORIGIN["lat"]) * M_LAT)


def r1(v):
    return round(v, 1)


def load(name):
    with open(os.path.join(RAW, name + ".json")) as f:
        return json.load(f)


# --------------------------------------------------------------------- terrain
class Terrain:
    """Bilinear RGE ALTI sampler: the 2.5 m grid where it exists, 10 m elsewhere."""

    def __init__(self):
        self.grids = [self._grid(load("altimetrie_fine"))] if os.path.exists(
            os.path.join(RAW, "altimetrie_fine.json")) else []
        self.grids.append(self._grid(load("altimetrie")))

    @staticmethod
    def _grid(g):
        x0, _ = L(g["west"], g["south"])
        _, z0 = L(g["west"], g["south"])
        dx = g["dlon"] * M_LON
        dz = -g["dlat"] * M_LAT
        # The service returns -99999 for "no data"; there is none inside the
        # corridor, but a hole would put a crater in the street, so patch any.
        z = [v if v > -1000 else None for v in g["z"]]
        good = [v for v in z if v is not None]
        mean = sum(good) / len(good)
        z = [v if v is not None else mean for v in z]
        return dict(x0=x0, z0=z0, dx=dx, dz=dz, cols=g["cols"], rows=g["rows"], y=z)

    def at(self, x, z):
        for g in self.grids:
            fx = (x - g["x0"]) / g["dx"]
            fz = (z - g["z0"]) / g["dz"]
            if 0 <= fx < g["cols"] - 1 and 0 <= fz < g["rows"] - 1:
                i, j = int(fz), int(fx)
                tx, tz = fx - j, fz - i
                c = g["cols"]
                y = g["y"]
                a = y[i * c + j] * (1 - tx) + y[i * c + j + 1] * tx
                b = y[(i + 1) * c + j] * (1 - tx) + y[(i + 1) * c + j + 1] * tx
                return a * (1 - tz) + b * tz
        return None

    def export(self):
        out = []
        for g in self.grids:
            out.append(dict(x0=r1(g["x0"]), z0=r1(g["z0"]), dx=round(g["dx"], 4), dz=round(g["dz"], 4),
                            cols=g["cols"], rows=g["rows"],
                            y=[round(v - ORIGIN["elev"], 2) for v in g["y"]]))
        return out


# -------------------------------------------------------------- roof offsets
def miter_offset(ring, d):
    """Inset every vertex of a CCW ring by d along its corner bisector.

    The runtime (src/world/realbuildings.js insetRing) does exactly this, so
    whatever survives validation here is what the game will build.
    """
    n = len(ring)
    out = []
    for i in range(n):
        px, pz = ring[i - 1]
        cx, cz = ring[i]
        nx_, nz_ = ring[(i + 1) % n]
        e1 = (cx - px, cz - pz)
        e2 = (nx_ - cx, nz_ - cz)
        l1 = math.hypot(*e1) or 1e-9
        l2 = math.hypot(*e2) or 1e-9
        # Inward normal. "CCW" here means counter-clockwise seen from above
        # with north up, which in x/z (+Z south) is NEGATIVE signed area — and
        # for that winding the inward normal of edge e is (e.z, -e.x). The
        # first version had this flipped, so every "inset" grew outward and
        # every roof would have been a flat lid; tests/geo.test.js now pins it.
        n1 = (e1[1] / l1, -e1[0] / l1)
        n2 = (e2[1] / l2, -e2[0] / l2)
        bx, bz = n1[0] + n2[0], n1[1] + n2[1]
        bl = math.hypot(bx, bz)
        if bl < 1e-6:
            return None
        bx, bz = bx / bl, bz / bl
        cos_half = bx * n1[0] + bz * n1[1]
        if cos_half <= 0.05:
            return None
        # MITER LIMIT. At a needle corner the miter shoots off toward infinity;
        # clamp it instead of refusing the whole roof, and let the validity
        # check below decide whether the result is still a polygon. Refusing
        # outright cost Saint-Jean its slate roof over one shallow corner.
        k = d / max(cos_half, 0.35)
        out.append((cx + bx * k, cz + bz * k))
    return out


def safe_inset(ring, want):
    outer = Polygon(ring)
    d = want
    while d >= 0.6:
        inner = miter_offset(ring, d)
        if inner:
            p = Polygon(inner)
            if p.is_valid and p.area > 1.5 and outer.contains(p) and orient_ccw(inner) == inner:
                return d
        d *= 0.75
    return 0.0


def signed_area(ring):
    a = 0.0
    for i in range(len(ring)):
        x1, z1 = ring[i - 1]
        x2, z2 = ring[i]
        a += x1 * z2 - x2 * z1
    return a / 2


def orient_ccw(ring):
    """CCW as seen from above (+Y down onto x/z with +Z south) = negative x*z area."""
    return ring if signed_area(ring) < 0 else list(reversed(ring))


# ------------------------------------------------------------------- styling
WALL = {"1": "stone", "2": "meuliere", "3": "plaster", "4": "brick", "5": "plaster", "6": "wood"}
ROOF = {"1": "tile", "2": "slate", "3": "zinc", "4": "flat"}


def wall_style(code, seed):
    """Wall finish from the cadastral material code, with Montmartre's plaster
    variety layered on where the code says only "rendered" or nothing at all."""
    first = (code or "0")[:1]
    if first in WALL and WALL[first] != "plaster":
        return WALL[first]
    # Rendered or unknown: the Butte is cream, ochre, pink and grey render.
    return ["plaster", "plaster", "ochre", "pink", "grey", "plaster", "ochre"][seed % 7]


def roof_kind(code, floors, area, short):
    first = (code or "0")[:1]
    if first == "4" or area > 900:
        return "flat"
    if first == "1":
        return "hip"
    if first in ("2", "3"):
        return "mansard"
    return "mansard" if (floors or 3) >= 3 and short > 6 else "hip"


# --------------------------------------------------------------------- build
def main():
    terrain = Terrain()

    # ----- roads (needed first: they decide which walls face a street) -----
    roads_out = []
    road_geoms = []
    for f in load("troncon_de_route"):
        p = f["properties"]
        pts = [L(x, y) for x, y, *_ in f["geometry"]["coordinates"]]
        if len(pts) < 2:
            continue
        nature = p["nature"]
        w = p.get("largeur_de_chaussee")
        if not w:
            w = {"Escalier": 4.0, "Sentier": 3.0}.get(nature, 5.0)
        name = p.get("nom_voie_ban_gauche") or p.get("nom_collaboratif_gauche") or ""
        ys = [terrain.at(x, z) for x, z in pts]
        if any(y is None for y in ys):
            continue
        roads_out.append(dict(
            n=name, k={"Escalier": "stairs", "Sentier": "path"}.get(nature, "road"), w=r1(w),
            p=[v for (x, z), y in zip(pts, ys) for v in (r1(x), round(y - ORIGIN["elev"], 2), r1(z))]))
        road_geoms.append(LineString(pts).buffer(w / 2 + 1.2, cap_style=2))
    streets = unary_union(road_geoms)

    # ----- buildings -----
    feats = load("batiment")
    polys = []
    for f in feats:
        g = shape(f["geometry"])
        geoms = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
        for poly in geoms:
            ext = [L(x, y) for x, y, *_ in poly.exterior.coords][:-1]
            holes = [[L(x, y) for x, y, *_ in h.coords][:-1] for h in poly.interiors]
            lp = Polygon(ext, holes)
            if not lp.is_valid:
                lp = lp.buffer(0)
                if lp.geom_type != "Polygon":
                    continue
            lp = lp.simplify(0.3, preserve_topology=True)
            if lp.area < 5:
                continue
            polys.append((lp, f["properties"]))
    tree = STRtree([p for p, _ in polys])

    # Shops and entrances from OSM, snapped onto walls below.
    osm = ET.parse(os.path.join(RAW, "osm.xml")).getroot()
    shop_nodes, entrance_nodes, pois = [], [], dict(
        metro=[], wallace=[], bench=[], lamp=[], bollard=[], art=[], fountain=[], basket=[], bike=[])
    SHOP_KIND = {"cafe": "cafe", "restaurant": "restaurant", "bar": "bar", "pub": "bar",
                 "fast_food": "restaurant", "ice_cream": "cafe", "pharmacy": "pharmacy", "bank": "bank"}
    for n in osm.iter("node"):
        tg = {x.get("k"): x.get("v") for x in n.findall("tag")}
        if not tg:
            continue
        x, z = L(float(n.get("lon")), float(n.get("lat")))
        y = terrain.at(x, z)
        if y is None:
            continue
        y = round(y - ORIGIN["elev"], 2)
        if "shop" in tg:
            kind = "bakery" if tg["shop"] in ("bakery", "pastry") else "shop"
            shop_nodes.append((x, z, kind, tg.get("name", "")))
        elif tg.get("amenity") in SHOP_KIND:
            shop_nodes.append((x, z, SHOP_KIND[tg["amenity"]], tg.get("name", "")))
        if "entrance" in tg or tg.get("door"):
            entrance_nodes.append((x, z))
        if tg.get("railway") == "subway_entrance":
            pois["metro"].append([r1(x), y, r1(z), tg.get("name", "")])
        if tg.get("fountain") == "wallace":
            pois["wallace"].append([r1(x), y, r1(z)])
        elif tg.get("amenity") in ("fountain", "drinking_water"):
            pois["fountain"].append([r1(x), y, r1(z)])
        if tg.get("amenity") == "bench":
            pois["bench"].append([r1(x), y, r1(z)])
        if tg.get("highway") == "street_lamp":
            pois["lamp"].append([r1(x), y, r1(z)])
        if tg.get("barrier") == "bollard":
            pois["bollard"].append([r1(x), y, r1(z)])
        if tg.get("amenity") == "waste_basket":
            pois["basket"].append([r1(x), y, r1(z)])
        if tg.get("amenity") == "bicycle_parking":
            pois["bike"].append([r1(x), y, r1(z)])
        if tg.get("tourism") == "artwork" and tg.get("artwork_type") in ("statue", "sculpture", "bust") \
                or tg.get("memorial") in ("bust", "statue"):
            pois["art"].append([r1(x), y, r1(z), tg.get("name", "")])

    buildings_out = []
    skipped = dict(windmill=0)
    for idx, (poly, p) in enumerate(polys):
        nature = p.get("nature") or ""
        if nature == "Moulin à vent":
            # Both mills are authored models at their real positions; the
            # cadastral footprint of a hollow mill on a roof is not a building.
            skipped["windmill"] += 1
            continue
        # Rounded to the 10 cm the JSON stores BEFORE anything is computed
        # from it. The roof insets were first validated on the full-precision
        # ring and then written rounded, and the rounding turned one shallow
        # corner of Saint-Jean into a needle the runtime refused to inset.
        ring = orient_ccw([(r1(x), r1(z)) for x, z in list(poly.exterior.coords)[:-1]])
        holes = [list(reversed(orient_ccw([(x, z) for x, z in list(h.coords)[:-1]]))) for h in poly.interiors]

        # Ground: the lower of the cadastral minimum and the DTM under the
        # footprint, less a little, so a building on a slope never floats.
        samples = [terrain.at(x, z) for x, z in ring]
        samples = [s for s in samples if s is not None]
        if not samples:
            continue
        g_cad = p.get("altitude_minimale_sol")
        ground = min(samples + ([g_cad] if g_cad and g_cad > 0 else [])) - 0.3

        floors = p.get("nombre_d_etages") or 0
        h = p.get("hauteur")
        toit = p.get("altitude_minimale_toit")
        if toit and toit > ground + 2.2:
            eaves = toit
        elif h:
            eaves = ground + h
        elif floors:
            eaves = ground + floors * 3.0
        else:
            eaves = ground + 7.0
        # A two-storey house recorded at 1.6 m (the Maison Rose is one) is a
        # survey error, not a building; trust the storey count over the height.
        if floors and eaves - ground < floors * 2.5:
            eaves = ground + floors * 3.0
        if not floors:
            floors = max(1, round((eaves - ground) / 3.0))
        # A handful of annexes are recorded under a metre tall — sheds and
        # garden structures — and render as a slab on the ground. Nothing
        # enclosed is lower than a door.
        eaves = max(eaves, ground + 2.2)

        mrr = poly.minimum_rotated_rectangle
        rx, rz = mrr.exterior.coords.xy
        sides = sorted(math.hypot(rx[i + 1] - rx[i], rz[i + 1] - rz[i]) for i in range(2))
        short = sides[0]
        kind = roof_kind(p.get("materiaux_de_la_toiture"), floors, poly.area, short)
        if nature == "Eglise":
            kind = "church"
        inset = 0.0
        if kind == "mansard":
            inset = safe_inset(ring, min(1.5, short * 0.22))
            if inset < 0.6:
                kind = "flat"
        elif kind in ("hip", "church"):
            # A church gets the same lofted roof, steeper (see realbuildings.js).
            inset = safe_inset(ring, min(short * 0.42, 6.0 if kind == "church" else 5.0))
            if inset < 0.6:
                kind = "flat"

        # Which walls face a street, and how far away it is.
        others = [polys[j][0] for j in tree.query(poly.buffer(18)) if polys[j][0] is not poly]
        street_edges = []
        n = len(ring)
        for i in range(n):
            ax, az = ring[i]
            bx, bz = ring[(i + 1) % n]
            el = math.hypot(bx - ax, bz - az)
            if el < 2.4:
                continue
            # Outward normal for the CCW-from-above winding: (-e.z, e.x).
            ox, oz = -(bz - az) / el, (bx - ax) / el
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            hit = None
            for k in (0.8, 2, 3.5, 5, 7, 9, 12, 15):
                px, pz = mx + ox * k, mz + oz * k
                pt = Point(px, pz)
                if any(o.contains(pt) for o in others) or poly.contains(pt):
                    break
                if streets.contains(pt):
                    hit = k
                    break
            if hit is not None:
                street_edges.append([i, r1(hit)])

        # Snap shops and doors onto the street-facing wall they stand against.
        shops, doors = [], []
        if street_edges:
            se = {e[0] for e in street_edges}
            for (sx, sz, skind, sname) in shop_nodes:
                if poly.distance(Point(sx, sz)) > 6:
                    continue
                best = None
                for i in se:
                    a = ring[i]; b = ring[(i + 1) % n]
                    seg = LineString([a, b])
                    dd = seg.distance(Point(sx, sz))
                    if dd < 6 and (best is None or dd < best[0]):
                        best = (dd, i, seg.project(Point(sx, sz), normalized=True))
                if best:
                    shops.append([best[1], round(best[2], 2), skind, sname[:28]])
            for (ex, ez) in entrance_nodes:
                if poly.distance(Point(ex, ez)) > 2.5:
                    continue
                for i in se:
                    a = ring[i]; b = ring[(i + 1) % n]
                    seg = LineString([a, b])
                    if seg.distance(Point(ex, ez)) < 2.5:
                        doors.append([i, round(seg.project(Point(ex, ez), normalized=True), 2)])
                        break

        seed = int(p.get("cleabs", "0")[-6:] or 0) if p.get("cleabs", "")[-6:].isdigit() else idx
        b = dict(
            id=p.get("cleabs", "")[-9:],
            o=[v for xz in ring for v in (r1(xz[0]), r1(xz[1]))],
            g=round(ground - ORIGIN["elev"], 2),
            e=round(eaves - ORIGIN["elev"], 2),
            f=int(floors),
            s=wall_style(p.get("materiaux_des_murs"), seed),
            r=kind,
            i=round(inset, 2),
            u={"Résidentiel": "res", "Commercial et services": "com", "Religieux": "rel",
               "Annexe": "ann"}.get(p.get("usage_1"), "res"),
            se=street_edges,
            seed=seed % 100000,
        )
        if holes:
            b["h"] = [[v for xz in hole for v in (r1(xz[0]), r1(xz[1]))] for hole in holes]
        if shops:
            b["sh"] = shops
        if doors:
            b["dr"] = doors
        buildings_out.append(b)

    # ----- trees: the Ville de Paris inventory, topped up from OSM -----
    trees = []
    GENUS = {"Platanus": "plane", "Aesculus": "chestnut", "Tilia": "lime", "Styphnolobium": "sophora",
             "Sophora": "sophora", "Acer": "maple", "Robinia": "robinia", "Cupressus": "cypress",
             "Morus": "mulberry", "Prunus": "cherry", "Olea": "olive", "Carpinus": "hornbeam",
             "Celtis": "celtis", "Fraxinus": "ash", "Paulownia": "paulownia", "Ailanthus": "robinia"}
    seen = []
    for r in load("arbres"):
        gp = r.get("geo_point_2d") or {}
        if not gp:
            continue
        x, z = L(gp["lon"], gp["lat"])
        y = terrain.at(x, z)
        if y is None:
            continue
        hgt = r.get("hauteurenm") or 0
        circ = r.get("circonferenceencm") or 0
        if hgt < 1.5:
            hgt = max(3.0, circ / 12.0)
        hgt = min(hgt, 24)
        trees.append([r1(x), round(y - ORIGIN["elev"], 2), r1(z), r1(hgt),
                      GENUS.get(r.get("genre") or "", "other")])
        seen.append((x, z))
    osm_trees = 0
    for n in osm.iter("node"):
        tg = {x.get("k"): x.get("v") for x in n.findall("tag")}
        if tg.get("natural") != "tree":
            continue
        x, z = L(float(n.get("lon")), float(n.get("lat")))
        if any((x - a) ** 2 + (z - b) ** 2 < 9 for a, b in seen):
            continue
        y = terrain.at(x, z)
        if y is None:
            continue
        hgt = float(tg.get("height", "0") or 0) or 8.0
        trees.append([r1(x), round(y - ORIGIN["elev"], 2), r1(z), r1(min(hgt, 22)), "other"])
        osm_trees += 1

    # ----- vegetation zones and walls -----
    greens = []
    for f in load("zone_de_vegetation"):
        g = shape(f["geometry"])
        for poly in (list(g.geoms) if g.geom_type == "MultiPolygon" else [g]):
            ring = [L(x, y) for x, y, *_ in poly.exterior.coords][:-1]
            lp = Polygon(ring).simplify(0.5)
            if lp.area < 20 or lp.geom_type != "Polygon":
                continue
            greens.append([v for xz in list(lp.exterior.coords)[:-1] for v in (r1(xz[0]), r1(xz[1]))])
    walls = []
    for f in load("construction_lineaire"):
        p = f["properties"]
        pts = [L(x, y) for x, y, *_ in f["geometry"]["coordinates"]]
        ys = [terrain.at(x, z) for x, z in pts]
        if any(y is None for y in ys):
            continue
        walls.append(dict(k=p.get("nature"), hgt=p.get("hauteur") or 2.5,
                          p=[v for (x, z), y in zip(pts, ys) for v in (r1(x), round(y - ORIGIN["elev"], 2), r1(z))]))

    out = dict(
        origin=ORIGIN,
        frame="metres; +X east, +Y up, +Z south; origin at the Dalida bust",
        sources=dict(
            buildings="IGN BD TOPO v3 batiment — Licence Ouverte Etalab 2.0",
            roads="IGN BD TOPO v3 troncon_de_route — Licence Ouverte Etalab 2.0",
            terrain="IGN RGE ALTI via Géoplateforme altimetry — Licence Ouverte Etalab 2.0",
            trees="Ville de Paris, Les arbres — ODbL; OpenStreetMap contributors — ODbL",
            pois="OpenStreetMap contributors — ODbL",
        ),
        terrain=terrain.export(),
        buildings=buildings_out,
        roads=roads_out,
        trees=trees,
        greens=greens,
        walls=walls,
        pois=pois,
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"buildings {len(buildings_out)} (skipped {skipped}), street-facing walls "
          f"{sum(len(b['se']) for b in buildings_out)}, shops {sum(len(b.get('sh', [])) for b in buildings_out)}, "
          f"doors {sum(len(b.get('dr', [])) for b in buildings_out)}")
    print(f"roads {len(roads_out)}, trees {len(trees)} ({osm_trees} from OSM), greens {len(greens)}, "
          f"walls {len(walls)}, pois " + ", ".join(f"{k} {len(v)}" for k, v in pois.items()))
    print(f"roofs: " + ", ".join(f"{k} {sum(1 for b in buildings_out if b['r'] == k)}"
                                  for k in ("mansard", "hip", "flat", "church")))
    print(f"wrote {OUT} ({os.path.getsize(OUT) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
