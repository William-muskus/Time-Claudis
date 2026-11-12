#!/usr/bin/env python3
"""
Crop each wall out of the survey photograph that shows it best.

    python3 tools/geo/wall_crops.py walls.txt [--refdir DIR] [--out DIR]

walls.txt holds one '<building id>:<edge>' per line. For each wall, every
reference in tools/geo/references.json is tried; the one where the wall
projects largest (with most of it in frame) is chosen, and the wall is cropped
out with its ground line, eaves line, and marks at every tenth of its length
labelled 0.1 ... 0.9, which is the unit src/data/geo/facades.json records
positions in. Crops are written one per wall and as contact sheets of four.

This is the reading half of recording a facade; facade_overlay.py shows the
whole photo with every wall on it, for deciding which wall is which.
"""
import json, math, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from facade_overlay import ground_at, M_LAT, M_LON  # noqa: E402


def camera(r, geo, W, H):
    o = geo["origin"]
    cx = (r["lon"] - o["lon"]) * M_LON
    cz = -(r["lat"] - o["lat"]) * M_LAT
    cy = (ground_at(geo, cx, cz) or 0) + 2.3
    h = math.radians(r["heading"])
    pitch = math.radians(r.get("pitch", -4.0))
    fx, fz = math.sin(h), -math.cos(h)
    rx, rz = math.cos(h), math.sin(h)
    focal = (W / 2) / math.tan(math.radians(r["hfov"] / 2))
    cp, sp = math.cos(pitch), math.sin(pitch)

    def proj(x, y, z):
        dx, dy, dz = x - cx, y - cy, z - cz
        zf = dx * fx + dz * fz
        xc, yc, zc = dx * rx + dz * rz, dy * cp - zf * sp, zf * cp + dy * sp
        if zc < 0.5:
            return None
        return (W / 2 + focal * xc / zc, H / 2 - focal * yc / zc)
    return proj, (cx, cz)


def main():
    args = sys.argv[1:]
    refdir = os.path.join(ROOT, "artifacts", "compare", "ref")
    out = os.path.join(ROOT, "artifacts", "wallcrops")
    if "--refdir" in args:
        i = args.index("--refdir"); refdir = args[i + 1]; del args[i:i + 2]
    if "--out" in args:
        i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
    os.makedirs(out, exist_ok=True)
    keys = [l.strip() for l in open(args[0]) if l.strip()]
    geo = json.load(open(os.path.join(ROOT, "src", "data", "geo", "montmartre.json")))
    refs = json.load(open(os.path.join(HERE, "references.json")))["references"]
    byid = {b["id"]: b for b in geo["buildings"]}
    sizes = {}
    crops = []
    for key in keys:
        bid, ei = key.split(":"); ei = int(ei)
        b = byid[bid]
        ring = [(b["o"][i], b["o"][i + 1]) for i in range(0, len(b["o"]), 2)]
        (ax, az), (bx, bz) = ring[ei], ring[(ei + 1) % len(ring)]
        ga = ground_at(geo, ax, az) or b["g"]; gb = ground_at(geo, bx, bz) or b["g"]
        best = None
        for r in refs:
            f = os.path.join(refdir, r["name"] + ".jpg")
            if not os.path.exists(f):
                continue
            if f not in sizes:
                sizes[f] = Image.open(f).size
            W, H = sizes[f]
            proj, (cx, cz) = camera(r, geo, W, H)
            # wall must face the camera
            if (-(bz - az)) * (cx - ax) + (bx - ax) * (cz - az) <= 0:
                continue
            q = [proj(ax, ga, az), proj(bx, gb, bz), proj(bx, b["e"], bz), proj(ax, b["e"], az)]
            if any(p is None for p in q):
                continue
            xs = [p[0] for p in q]; ys = [p[1] for p in q]
            inx = max(0, min(W, max(xs)) - max(0, min(xs)))
            full = max(xs) - min(xs)
            if full <= 0 or inx / full < 0.6:
                continue
            # Width in frame, weighted by how head-on the view is: an
            # edge-on wall is tall in the picture and unreadable.
            L = math.hypot(bx - ax, bz - az)
            mx, mz = (ax + bx) / 2, (az + bz) / 2
            dist = math.hypot(cx - mx, cz - mz) or 1
            facing = ((-(bz - az)) * (cx - mx) + (bx - ax) * (cz - mz)) / (L * dist)
            if dist > 32:
                continue
            area = inx * facing ** 2
            if not best or area > best[0]:
                best = (area, r, q, f)
        if not best:
            print(key, "no photo"); continue
        _, r, q, f = best
        im = Image.open(f).convert("RGB")
        W, H = im.size
        proj, _ = camera(r, geo, W, H)
        d = ImageDraw.Draw(im, "RGBA")
        d.line([q[0], q[1]], fill=(255, 40, 200, 255), width=3)
        d.line([q[3], q[2]], fill=(40, 220, 255, 255), width=3)
        for k in range(1, 10):
            t = k / 10
            x, z = ax + (bx - ax) * t, az + (bz - az) * t
            p0 = proj(x, ga + (gb - ga) * t, z); p1 = proj(x, b["e"], z)
            if p0 and p1:
                d.line([p0, p1], fill=(255, 255, 0, 110), width=1)
                d.text((p0[0] - 8, p0[1] + 4), f".{k}", fill=(255, 255, 0, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        for p, lab in ((q[0], "0"), (q[1], "1")):
            d.text((p[0] - 4, p[1] + 4), lab, fill=(255, 80, 80, 255), stroke_width=2, stroke_fill=(0, 0, 0))
        xs = [p[0] for p in q]; ys = [p[1] for p in q]
        box = (max(0, int(min(xs)) - 60), max(0, int(min(ys)) - 60), min(W, int(max(xs)) + 60), min(H, int(max(ys)) + 60))
        c = im.crop(box)
        c.thumbnail((900, 600))
        label = f"{key}  len {math.hypot(bx - ax, bz - az):.1f} m  h {b['e'] - min(ga, gb):.1f} m  floors {b['f']}  from {r['name']}"
        canvas = Image.new("RGB", (900, 630), (17, 17, 17))
        canvas.paste(c, (0, 30))
        ImageDraw.Draw(canvas).text((6, 8), label, fill=(255, 255, 255))
        canvas.save(os.path.join(out, key.replace(":", "_") + ".jpg"), quality=85)
        crops.append(canvas)
        print(label)
    for k in range(0, len(crops), 4):
        sheet = Image.new("RGB", (1800, 1260), (17, 17, 17))
        for j, c in enumerate(crops[k:k + 4]):
            sheet.paste(c, ((j % 2) * 900, (j // 2) * 630))
        sheet.save(os.path.join(out, f"sheet_{k // 4 + 1:02d}.jpg"), quality=85)


if __name__ == "__main__":
    main()
