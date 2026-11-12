#!/usr/bin/env python3
"""
Draw the game's building outlines on a survey photograph.

    python3 tools/geo/facade_overlay.py NAME [NAME...] [--out DIR] [--refdir DIR]

For each reference in tools/geo/references.json, projects every street-facing
wall of every real building (from src/data/geo/montmartre.json) into the
photograph with the photo's own position, compass heading and horizontal field
of view, and draws its ground line, eaves line and corners, labelled
`<building id>:<edge>`, with tick marks every metre along the wall.

This is how tools/geo/facades.json is authored: it says which wall in the
picture is which building, and where along it each window and door is, so the
facade can be recorded bay by bay as fractions of the wall's length.

Needs Pillow. Photos come from compare.mjs's download cache.
"""
import json, math, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
M_LAT, M_LON = 111320.0, 73224.0


def load():
    geo = json.load(open(os.path.join(ROOT, "src", "data", "geo", "montmartre.json")))
    refs = json.load(open(os.path.join(HERE, "references.json")))["references"]
    return geo, refs


def ground_at(geo, x, z):
    for g in geo["terrain"]:
        fx = (x - g["x0"]) / g["dx"]
        fz = (z - g["z0"]) / g["dz"]
        if fx < 0 or fz < 0 or fx >= g["cols"] - 1 or fz >= g["rows"] - 1:
            continue
        j, i = int(fx), int(fz)
        tx, tz = fx - j, fz - i
        c, y = g["cols"], g["y"]
        a = y[i * c + j] * (1 - tx) + y[i * c + j + 1] * tx
        b = y[(i + 1) * c + j] * (1 - tx) + y[(i + 1) * c + j + 1] * tx
        return a * (1 - tz) + b * tz
    return None


def main():
    args = sys.argv[1:]
    out = os.path.join(ROOT, "artifacts", "facades")
    refdir = os.path.join(ROOT, "artifacts", "compare", "ref")
    if "--out" in args:
        i = args.index("--out"); out = args[i + 1]; del args[i:i + 2]
    if "--refdir" in args:
        i = args.index("--refdir"); refdir = args[i + 1]; del args[i:i + 2]
    os.makedirs(out, exist_ok=True)
    geo, refs = load()
    o = geo["origin"]
    for name in args:
        r = next((x for x in refs if x["name"] == name), None)
        if not r:
            print("no reference", name); continue
        im = Image.open(os.path.join(refdir, name + ".jpg")).convert("RGB")
        W, H = im.size
        d = ImageDraw.Draw(im, "RGBA")
        cx = (r["lon"] - o["lon"]) * M_LON
        cz = -(r["lat"] - o["lat"]) * M_LAT
        cy = (ground_at(geo, cx, cz) or 0) + 2.3
        h = math.radians(r["heading"])
        # The survey rig points slightly down; ~4 degrees fits most frames
        # (the vanishing point of a level street sits below the centre).
        pitch = math.radians(r.get("pitch", -4.0))
        fx, fz = math.sin(h), -math.cos(h)
        rx, rz = math.cos(h), math.sin(h)
        focal = (W / 2) / math.tan(math.radians(r["hfov"] / 2))
        cp, sp = math.cos(pitch), math.sin(pitch)

        def cam(x, y, z):
            dx, dy, dz = x - cx, y - cy, z - cz
            zf = dx * fx + dz * fz
            # pitch about the camera's right axis
            return (dx * rx + dz * rz, dy * cp - zf * sp, zf * cp + dy * sp)

        def proj(x, y, z):
            xc, yc, zc = cam(x, y, z)
            if zc < 0.3:
                return None
            return (W / 2 + focal * xc / zc, H / 2 - focal * yc / zc, zc)

        def clip_t(ax, az, bx, bz, y):
            """Parameter range [t0, t1] of segment a-b in front of the camera."""
            za = cam(ax, y, az)[2]; zb = cam(bx, y, bz)[2]
            if za < 0.3 and zb < 0.3:
                return None
            if za >= 0.3 and zb >= 0.3:
                return 0.0, 1.0
            tc = (0.3 - za) / (zb - za)
            return (tc + 1e-3, 1.0) if za < 0.3 else (0.0, tc - 1e-3)

        drawn = []
        for b in geo["buildings"]:
            ring = [(b["o"][i], b["o"][i + 1]) for i in range(0, len(b["o"]), 2)]
            for ei, _dist in b["se"]:
                (ax, az), (bx, bz) = ring[ei], ring[(ei + 1) % len(ring)]
                if math.hypot(ax - cx, az - cz) > 70 and math.hypot(bx - cx, bz - cz) > 70:
                    continue
                # Facing the camera: outward normal (-e.z, e.x) toward it.
                ex, ez = bx - ax, bz - az
                if (-ez) * (cx - ax) + ex * (cz - az) <= 0:
                    continue
                L = math.hypot(ex, ez)
                ga0, gb0 = ground_at(geo, ax, az) or b["g"], ground_at(geo, bx, bz) or b["g"]
                ct = clip_t(ax, az, bx, bz, b["e"])
                if not ct:
                    continue
                t0, t1 = ct
                AX, AZ, BX, BZ = ax + ex * t0, az + ez * t0, ax + ex * t1, az + ez * t1
                ga, gb = ga0 + (gb0 - ga0) * t0, ga0 + (gb0 - ga0) * t1
                pts = [proj(AX, ga, AZ), proj(BX, gb, BZ), proj(BX, b["e"], BZ), proj(AX, b["e"], AZ)]
                if any(p is None for p in pts):
                    continue
                if max(p[0] for p in pts) < 0 or min(p[0] for p in pts) > W:
                    continue
                col = (255, 40, 200, 255)
                d.line([pts[0][:2], pts[1][:2]], fill=col, width=3)
                d.line([pts[3][:2], pts[2][:2]], fill=(40, 220, 255, 255), width=3)
                d.line([pts[0][:2], pts[3][:2]], fill=(255, 255, 0, 255), width=2)
                d.line([pts[1][:2], pts[2][:2]], fill=(255, 255, 0, 255), width=2)
                # metre ticks along the ground line, every 5 m bigger
                for k in range(1, int(L)):
                    t = k / L
                    if t < t0 or t > t1:
                        continue
                    gy = ga0 + (gb0 - ga0) * t
                    for yy, c2 in ((gy, col), (b["e"], (40, 220, 255, 255))):
                        p = proj(ax + ex * t, yy, az + ez * t)
                        q = proj(ax + ex * t, yy + (0.6 if k % 5 == 0 else 0.25) * (1 if yy == gy else -1), az + ez * t)
                        if p and q:
                            d.line([p[:2], q[:2]], fill=c2, width=2)
                            if k % 2 == 0 and yy != gy:
                                d.text((q[0] - 4, q[1] + 2), str(k), fill=(255, 255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
                lab = f"{b['id']}:{ei} {L:.1f}m e{b['e'] - min(ga, gb):.0f}m"
                mx = (pts[0][0] + pts[1][0]) / 2
                my = min(pts[2][1], pts[3][1])
                d.rectangle([mx - 4, my - 18, mx + 8 * len(lab), my - 2], fill=(0, 0, 0, 170))
                d.text((mx, my - 16), lab, fill=(255, 255, 255, 255))
                drawn.append(lab)
        im.save(os.path.join(out, name + ".jpg"), quality=88)
        print(name, "|", "; ".join(drawn))


if __name__ == "__main__":
    main()
