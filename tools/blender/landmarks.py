"""
The named Montmartre landmarks, authored in Blender and exported as GLB.

These are the assets the level is *about*. Everything else on the street is
generated; these are modelled, because a procedural system will never give you
the specific silhouette of Aslan's bust of Dalida or the exact splay of a
Guimard stem, and those silhouettes are the entire reason the level is set here.
"""

import bpy
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
    # The bronze carries a little emission of its own.
    #
    # She stands against open sky at the top of a rise, so at golden hour the
    # camera sees her almost entirely backlit and she was rendering as a dark
    # lump on a post — the one landmark on the route that a resident actually
    # checks, reduced to a silhouette. A small self-illumination is the
    # stylised-film answer to a backlit hero: it keeps the form readable
    # without pretending there is a light source that is not there.
    bronze = material("bronze", PALETTE["bronzeDalida"],
                      roughness=0.42, metallic=0.45, emission=0.16)
    # The rubbed band is brighter still. Thirty years of tourists have polished
    # the chest to bright gold while the rest went flat brown, and that
    # two-tone is the detail people photograph.
    polish = material("bronze_polished", PALETTE["bronzePolish"],
                      roughness=0.14, metallic=0.55, emission=0.5)
    stone = material("plinth", PALETTE["limestoneMid"], roughness=0.92)
    stone_dark = material("plinth_base", PALETTE["limestoneDeep"], roughness=0.95)

    # Bronze catches the sun on its upper surfaces and goes flat brown
    # everywhere else, so the hair — which is all upper surface — gets its own
    # lighter material. This is doing legibility work, not realism work: at any
    # distance past a few metres the head and the torso are the same colour and
    # the same value, and two dark masses stacked on each other read as one
    # dark mass. Her hair is the most recognisable thing about her and it has
    # to be a separate shape in the silhouette, not a bump on top of a drum.
    # A THIRD bronze, between the weathered body and the rubbed chest — not the
    # same gold as the rub.
    #
    # The hair was given bronzePolish outright, to separate it from the torso.
    # It separated it and wrecked the read: the rubbed chest is bright gold too,
    # so the silhouette became light-dark-light-dark up its whole height and the
    # bust came back looking like a striped marker post. Exactly ONE thing on
    # this object is polished gold, because exactly one thing on the real one is
    # — thirty years of hands on the chest. The hair just needs to be a step
    # lighter than the body, which is what the sun does to the top of a bronze.
    bronze_lit = material("bronze_lit", "#A8814E",
                          roughness=0.52, metallic=0.4, emission=0.14)

    parts = [
        box("base", (1.05, 0.95, 0.20), (0, 0, 0.10), mat=stone_dark),
        # A SLIMMER PLINTH THAN BEFORE, and this is the main fix.
        #
        # It was 0.95 x 0.80 x 1.50 — wider than the bust's own shoulders and
        # more than half the total height, in pale limestone against a bronze
        # that reads dark. The composition put the brightest, largest mass
        # under the subject, and from six metres the whole thing read as a
        # chimney with a lump on it. The plinth is furniture; it should be the
        # narrowest thing here, not the widest.
        # FIVE BLOCKS OF CUT GRANITE, which is what she actually stands on.
        #
        # It was one smooth 1.34 m shaft. The real plinth is five separate
        # blocks stacked and stepping inward, and the joints between them are
        # the thing that reads: five hard horizontal shadow lines up a pale
        # stone column, at the one height where nothing else in the frame has
        # any horizontal detail at all. A smooth shaft of the same size is a
        # bollard.
        # ONE STONE, five blocks. The first version alternated two materials
        # to make the courses read and produced a barber's pole: the level's
        # title landmark came back looking like a striped marker post with a
        # knob on top. Real granite courses are the same stone and it is the
        # JOINT that reads — so the blocks step inward instead, and the shadow
        # each step casts on the one below is the line that carries it.
        *[
            box(f"granite_{i}", (0.78 - i * 0.052, 0.70 - i * 0.046, 0.262),
                (0, 0, 0.20 + 0.270 * i), mat=stone)
            for i in range(5)
        ],
        # The cornice. A plinth ends in an overhanging cap, and the shadow line
        # under it is what separates stone from bronze at a glance.
        box("cornice", (0.76, 0.68, 0.13), (0, 0, 1.63), mat=stone),

        # --- the bust itself, built as three distinct masses ----------------
        # Shoulders first, and wide. A bust reads as a person because the
        # shoulder line is the widest thing in it; without that it is a pillar.
        cylinder("shoulders", r1=0.52, r2=0.50, depth=0.26, verts=10,
                 loc=(0, 0, 1.80), mat=bronze),
        # Chest, tapering up and cut off the way a bust is.
        cylinder("chest", r1=0.49, r2=0.30, depth=0.52, verts=10,
                 loc=(0, 0, 2.19), mat=bronze),
        # A longer neck than is strictly anatomical. It exists to put a gap
        # between two dark masses so the head is its own shape.
        cylinder("neck", r1=0.145, r2=0.13, depth=0.24, verts=8,
                 loc=(0, 0, 2.57), mat=bronze),
    ]

    # The polished band across the chest. Thirty years of tourists have rubbed
    # it to bright gold while the rest went flat brown, and that two-tone is
    # the detail people photograph.
    parts.append(cylinder("rub", r1=0.44, r2=0.40, depth=0.26, verts=10,
                          loc=(0, 0.02, 2.10), mat=polish))

    head = sphere("head", r=0.215, segments=10, rings=8, loc=(0, 0, 2.86), mat=bronze)
    head.scale = (0.90, 0.94, 1.10)
    parts.append(head)

    # The hair. Big, swept, and most of the silhouette — so it is built as two
    # masses rather than one sphere: the crown, and the fall of it down the
    # back and to her left. The asymmetry is what makes it hair rather than a
    # helmet, and it is the thing a resident would actually recognise.
    crown = sphere("hair_crown", r=0.315, segments=10, rings=8,
                   loc=(0, -0.03, 2.94), mat=bronze_lit)
    crown.scale = (1.12, 1.10, 0.96)
    parts.append(crown)
    fall = sphere("hair_fall", r=0.245, segments=8, rings=6,
                  loc=(0.115, -0.145, 2.70), mat=bronze_lit)
    fall.scale = (0.95, 0.90, 1.25)
    parts.append(fall)

    bust = join(parts, "dalida_bust")
    # Hero scale. The real bust is about 2.6 m to the crown of the head, which
    # at the distance this is actually viewed from is barely thirty pixels —
    # an honest dimension that makes the level's title landmark unreadable.
    # Arcade games scale their hero objects and this one earns it. Smaller than
    # it was, because the rebuild above puts more of the height into the bust
    # and less into the plinth, so it needs less help.
    bust.scale = (1.26, 1.26, 1.26)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return export_glb("public/assets/models/dalida_bust.glb", "dalida_bust")


def guimard_edicule():
    """
    The Abbesses metro entrance: Hector Guimard, cast iron and amber glass.

    One of only two survivors anywhere with the glass roof intact. The level
    ends on it, so it gets the most geometry of anything in the project.
    """
    reset_scene()
    iron = material("guimard_iron", PALETTE["guimardGreen"], roughness=0.42, metallic=0.5)
    # Amber glass, not a light fitting.
    #
    # At 0.45 emission the roof cleared the bloom threshold on its own and came
    # back as a blown orange slab — brighter than the sky behind it, which
    # glass lit only by that sky cannot be. It needs just enough glow to say
    # "lit from within" at dusk without competing with the sun.
    glass = material("guimard_glass", PALETTE["guimardAmber"],
                     roughness=0.18, metallic=0.1, emission=0.12, alpha=0.88)
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
        # The gallery. A tower mill has a working platform the miller walks to
        # reach the sails, and it is the detail that stops the tower reading as
        # a plain cone — it puts one hard horizontal across the silhouette at a
        # height nothing else occupies.
        # Kept close to the tower. At a metre proud these read as two black
        # hoops floating round the mill rather than as a deck attached to it —
        # the overhang has to be small enough that the eye reads it as part of
        # the tower's own profile.
        cylinder("gallery", r1=2.42, r2=2.42, depth=0.16, verts=8, loc=(0, 0, 3.3), mat=wood),
        cylinder("gallery_rail", r1=2.34, r2=2.34, depth=0.07, verts=8, loc=(0, 0, 4.0), mat=lattice),
        cylinder("cap", r1=2.2, r2=0.55, depth=1.9, verts=8, loc=(0, 0, 6.2), mat=zinc),
        cylinder("cap_finial", r1=0.34, r2=0.0, depth=0.6, verts=6, loc=(0, 0, 7.35), mat=zinc),
        # The windshaft, poking out of the cap toward the street. The sails
        # have to be attached to something or they read as floating.
        cylinder("windshaft", r1=0.30, depth=1.5, verts=6,
                 loc=(0, 1.7, 6.0), rot=(math.pi / 2, 0, 0), mat=wood),
        cylinder("hub", r1=0.62, depth=0.55, verts=8,
                 loc=(0, 2.35, 6.0), rot=(math.pi / 2, 0, 0), mat=wood),
    ]

    # --- the sails ----------------------------------------------------------
    #
    # THE SAILS ARE THE WHOLE LANDMARK, so they get built like sails.
    #
    # The first version was four planks in a cross: one 0.22 m spar and one
    # 1.0 m panel per arm. At the twenty metres this mill is actually viewed
    # from that is a few pixels of solid colour on a thin stick, and the crest
    # of the level — the thing the whole climb builds to — read as a rooftop
    # television aerial.
    #
    # Two changes fix it. The lattice is built as SLATS with gaps, because
    # what makes a mill sail recognisable is that you can see sky through it;
    # a solid panel of the same size is just a board. And the cross is set at
    # 45 degrees so it reads as an X rather than a +, which is both how mills
    # are almost always depicted and the orientation whose diagonals survive
    # being only a few pixels wide.
    SAIL_LEN = 6.4
    SAIL_WIDTH = 1.9
    SLATS = 7
    HUB_Z = 6.0
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        ux, uz = math.sin(a), math.cos(a)
        # The whip: one spar running the length of the arm.
        r = 0.7 + SAIL_LEN / 2
        parts.append(box(f"whip_{i}", (0.20, 0.16, SAIL_LEN),
                         (ux * r, 2.5, HUB_Z + uz * r), rot=(0, a, 0), mat=wood))
        # The bars, narrowing toward the tip the way a real sail does.
        for j in range(SLATS):
            t = (j + 0.5) / SLATS
            d = 0.9 + t * SAIL_LEN
            w = SAIL_WIDTH * (1.0 - 0.35 * t)
            parts.append(box(f"bar_{i}_{j}", (w, 0.06, 0.28),
                             (ux * d, 2.52, HUB_Z + uz * d), rot=(0, a, 0), mat=lattice))
        # A leading edge along one side, so each sail has a direction and the
        # four of them read as turning rather than as a static star.
        parts.append(box(f"edge_{i}", (0.14, 0.10, SAIL_LEN),
                         (ux * r + math.cos(a) * SAIL_WIDTH * 0.42, 2.52,
                          HUB_Z + uz * r - math.sin(a) * SAIL_WIDTH * 0.42),
                         rot=(0, a, 0), mat=wood))

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
