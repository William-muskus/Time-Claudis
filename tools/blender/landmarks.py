"""
The named Montmartre landmarks, authored in Blender and exported as GLB.

These are the assets the level is *about*. Everything else on the street is
generated; these are modelled, because a procedural system will never give you
the specific silhouette of Aslan's bust of Dalida or the exact splay of a
Guimard stem, and those silhouettes are the entire reason the level is set here.
"""

import math
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from lib import (  # noqa: E402
    reset_scene, material, box, cylinder, sphere, torus, join, export_glb, PALETTE,
)

TAU = math.pi * 2


def dalida_bust():
    """
    Place Dalida, the bronze by Alain Aslan, 1997.

    The detail that makes it: the chest is rubbed to bright gold by thirty
    years of tourists while everything else has gone the flat brown of
    weathered bronze. Two materials on one object. A uniformly bronze bust
    would be wrong in a way anyone who has stood there would catch instantly.
    """
    reset_scene()
    bronze = material("bronze", PALETTE["bronzeDalida"], roughness=0.42, metallic=0.65)
    polish = material("bronze_polished", PALETTE["bronzePolish"], roughness=0.16, metallic=0.9)
    stone = material("plinth", PALETTE["limestoneMid"], roughness=0.92)
    stone_dark = material("plinth_base", PALETTE["limestoneDeep"], roughness=0.95)

    parts = [
        box("base", (1.25, 1.10, 0.22), (0, 0, 0.11), mat=stone_dark),
        box("plinth", (0.95, 0.80, 1.50), (0, 0, 0.97), mat=stone),
        # Torso, cut at the chest the way a bust is.
        cylinder("torso", r1=0.44, r2=0.34, depth=0.62, verts=10, loc=(0, 0, 2.03), mat=bronze),
        cylinder("neck", r1=0.15, r2=0.12, depth=0.18, verts=8, loc=(0, 0, 2.42), mat=bronze),
    ]
    # The polished band across the chest.
    rub = cylinder("rub", r1=0.38, r2=0.356, depth=0.24, verts=10, loc=(0, 0.03, 2.18), mat=polish)
    parts.append(rub)

    head = sphere("head", r=0.21, segments=10, rings=8, loc=(0, 0, 2.64), mat=bronze)
    head.scale = (0.92, 0.95, 1.12)
    parts.append(head)

    # The hair. Big, swept, and most of the silhouette.
    hair = sphere("hair", r=0.29, segments=10, rings=8, loc=(0, -0.045, 2.69), mat=bronze)
    hair.scale = (1.08, 1.10, 1.02)
    parts.append(hair)

    join(parts, "dalida_bust")
    return export_glb("public/assets/models/dalida_bust.glb", "dalida_bust")


def guimard_edicule():
    """
    The Abbesses metro entrance: Hector Guimard, cast iron and amber glass.

    One of only two survivors anywhere with the glass roof intact. The level
    ends on it, so it gets the most geometry of anything in the project.
    """
    reset_scene()
    iron = material("guimard_iron", PALETTE["guimardGreen"], roughness=0.42, metallic=0.5)
    glass = material("guimard_glass", PALETTE["guimardAmber"],
                     roughness=0.18, metallic=0.1, emission=0.45, alpha=0.88)
    dark = material("stair_mouth", "#14131C", roughness=1.0)

    parts = [
        box("surround", (4.6, 3.0, 0.95), (0, 0, 0.48), mat=iron),
        box("mouth", (3.4, 2.0, 0.1), (0, 0, 0.03), mat=dark),
    ]

    # Four corner stems, each ending in Guimard's curling head.
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cylinder(f"stem_{sx}_{sy}", r1=0.16, r2=0.11, depth=3.3,
                                  verts=6, loc=(sx * 2.1, sy * 1.35, 1.65), mat=iron))
            parts.append(torus(f"curl_{sx}_{sy}", major=0.30, minor=0.07,
                               mseg=10, minseg=6,
                               loc=(sx * 2.1, sy * 1.35, 3.35),
                               rot=(0, math.pi / 2, 0), mat=iron))

    # The glass shell: a flat centre with a slope falling either side.
    parts.append(box("roof_flat", (5.4, 3.8, 0.16), (0, 0, 3.5), mat=glass))
    for s in (-1, 1):
        parts.append(box(f"roof_slope_{s}", (5.4, 1.5, 0.14),
                         (0, s * 2.4, 3.28), rot=(s * 0.42, 0, 0), mat=glass))
    for i in range(-2, 3):
        parts.append(box(f"rib_{i}", (0.08, 5.6, 0.2), (i * 1.25, 0, 3.56), mat=iron))

    # The METROPOLITAIN panel.
    parts.append(box("sign", (2.6, 0.1, 0.62), (0, -1.50, 4.1), mat=glass))
    parts.append(box("sign_frame", (2.85, 0.06, 0.85), (0, -1.56, 4.1), mat=iron))

    join(parts, "guimard_edicule")
    return export_glb("public/assets/models/guimard_edicule.glb", "guimard_edicule")


def moulin_galette():
    """The Blute-fin windmill on its mound — the crest of the route."""
    reset_scene()
    plaster = material("mill_plaster", PALETTE["plasterCream"], roughness=0.9)
    zinc = material("mill_cap", PALETTE["zincShadow"], roughness=0.6, metallic=0.3)
    wood = material("mill_wood", PALETTE["trunkBark"], roughness=0.85)
    lattice = material("mill_lattice", PALETTE["plasterGrey"], roughness=0.9)
    earth = material("mill_mound", PALETTE["foliageDeep"], roughness=1.0)

    parts = [
        cylinder("mound", r1=9.5, r2=7.0, depth=5.0, verts=8, loc=(0, 0, -2.5), mat=earth),
        cylinder("tower", r1=2.5, r2=1.9, depth=5.5, verts=8, loc=(0, 0, 2.75), mat=plaster),
        cylinder("cap", r1=2.2, r2=0.0, depth=1.8, verts=8, loc=(0, 0, 6.2), mat=zinc),
    ]

    # Four sails on a hub, tilted the way a mill's sails actually sit.
    for i in range(4):
        a = i * math.pi / 2
        dx, dz = math.sin(a) * 2.8, math.cos(a) * 2.8
        parts.append(box(f"arm_{i}", (0.22, 0.12, 5.6),
                         (dx, 2.5, 5.0 + dz), rot=(0, a, 0), mat=wood))
        parts.append(box(f"lattice_{i}", (1.0, 0.05, 4.4),
                         (dx, 2.52, 5.0 + dz), rot=(0, a, 0), mat=lattice))

    join(parts, "moulin_galette")
    return export_glb("public/assets/models/moulin_galette.glb", "moulin_galette")


def wallace_fountain():
    """
    A Wallace fountain. Dark green cast iron, four caryatids, a little dome.

    There are two on the route and they are pure Paris shorthand — the single
    cheapest object that says which city you are standing in.
    """
    reset_scene()
    iron = material("wallace_iron", PALETTE["metroGreen"], roughness=0.45, metallic=0.45)
    parts = [
        cylinder("base", r1=0.62, r2=0.52, depth=0.55, verts=8, loc=(0, 0, 0.28), mat=iron),
        cylinder("shaft", r1=0.38, r2=0.30, depth=0.85, verts=8, loc=(0, 0, 0.95), mat=iron),
    ]
    for i in range(4):
        a = i * TAU / 4
        parts.append(cylinder(f"caryatid_{i}", r1=0.14, r2=0.11, depth=1.5, verts=6,
                              loc=(math.cos(a) * 0.30, math.sin(a) * 0.30, 2.1), mat=iron))
    parts += [
        cylinder("dome", r1=0.58, r2=0.52, depth=0.22, verts=8, loc=(0, 0, 2.95), mat=iron),
        cylinder("cap", r1=0.50, r2=0.0, depth=0.50, verts=8, loc=(0, 0, 3.30), mat=iron),
        sphere("finial", r=0.10, segments=6, rings=5, loc=(0, 0, 3.62), mat=iron),
    ]
    join(parts, "wallace_fountain")
    return export_glb("public/assets/models/wallace_fountain.glb", "wallace_fountain")


def street_lamp():
    """Fluted cast-iron standard with a swan neck. Placed every ~20 m."""
    reset_scene()
    iron = material("lamp_iron", PALETTE["ironwork"], roughness=0.45, metallic=0.4)
    glass = material("lamp_glass", PALETTE["guimardAmber"], roughness=0.2, emission=0.3)
    parts = [
        cylinder("base", r1=0.26, r2=0.19, depth=0.50, verts=8, loc=(0, 0, 0.25), mat=iron),
        cylinder("column", r1=0.12, r2=0.075, depth=3.9, verts=8, loc=(0, 0, 2.40), mat=iron),
    ]

    # The swan neck, built from short straight segments rather than a torus.
    #
    # lib.torus() wraps primitive_torus_add, which only makes a COMPLETE ring —
    # there is no arc parameter — so the neck came out as a full 0.84 m hoop
    # sitting on top of the column instead of a quarter-turn curve. In frame it
    # read as a large dark slab leaning off the lamp at an angle, and it was
    # the most conspicuously wrong object on the street.
    #
    # Segments are also the more honest choice for this art direction: a
    # low-poly swan neck IS a few straight runs, and building it that way means
    # the silhouette is chosen rather than inherited from a primitive.
    NECK = [
        (0.00, 4.18, 0.00, 0.0),
        (0.00, 4.34, 0.14, 0.7),
        (0.00, 4.40, 0.40, 1.25),
        (0.00, 4.34, 0.66, 1.9),
    ]
    for i in range(len(NECK) - 1):
        ax, ay, az, _ = NECK[i]
        bx, by, bz, _ = NECK[i + 1]
        mx, my, mz = (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2
        length = math.dist((ax, ay, az), (bx, by, bz))
        # Blender is Z-up, so a segment lying in the Y/Z plane is pitched about X.
        pitch = math.atan2(bz - az, by - ay)
        parts.append(cylinder(f"neck_{i}", r1=0.055, depth=length, verts=6,
                              loc=(mx, my, mz),
                              rot=(math.pi / 2 - pitch, 0, 0), mat=iron))

    parts += [
        cylinder("lantern", r1=0.25, r2=0.17, depth=0.50, verts=6,
                 loc=(0, 0.80, 4.12), mat=glass),
        cylinder("lantern_cap", r1=0.28, r2=0.0, depth=0.22, verts=6,
                 loc=(0, 0.80, 4.44), mat=iron),
    ]
    join(parts, "street_lamp")
    return export_glb("public/assets/models/street_lamp.glb", "street_lamp")


def morris_column():
    """The round green advertising drum. Unmistakably Paris, and good cover."""
    reset_scene()
    green = material("morris_green", PALETTE["metroGreen"], roughness=0.55, metallic=0.2)
    poster_a = material("poster_red", PALETTE["awningRed"], roughness=0.9)
    gold = material("morris_finial", PALETTE["guimardAmber"], roughness=0.3, metallic=0.6)
    parts = [
        cylinder("morris_base", r1=0.92, r2=0.85, depth=0.30, verts=12, loc=(0, 0, 0.15), mat=green),
        cylinder("drum", r1=0.72, r2=0.72, depth=2.9, verts=12, loc=(0, 0, 1.60), mat=green),
        cylinder("poster", r1=0.735, r2=0.735, depth=0.80, verts=12, loc=(0, 0, 1.75), mat=poster_a),
        cylinder("dome", r1=0.74, r2=0.40, depth=0.42, verts=12, loc=(0, 0, 3.10), mat=green),
        cylinder("finial", r1=0.13, r2=0.0, depth=0.42, verts=6, loc=(0, 0, 3.50), mat=gold),
    ]
    join(parts, "morris_column")
    return export_glb("public/assets/models/morris_column.glb", "morris_column")


ASSETS = {
    "dalida_bust": dalida_bust,
    "guimard_edicule": guimard_edicule,
    "moulin_galette": moulin_galette,
    "wallace_fountain": wallace_fountain,
    "street_lamp": street_lamp,
    "morris_column": morris_column,
}
