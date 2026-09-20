"""
First-person weapon models.

ORIENTATION CONTRACT. Every gun is built with the barrel along Blender +Y and
the grip hanging down Blender -Z. The glTF exporter's Y-up conversion maps
Blender +Y to glTF -Z, which is exactly Three.js camera-forward, so a weapon
loads pointing down the barrel with no fix-up rotation in the game code. Get
this wrong and every gun arrives sideways.

WHY THESE CARRY MORE GEOMETRY THAN THE STREET. A viewmodel sits half a metre
from the camera and fills a corner of the frame at all times. It is the single
most-looked-at object in the game, so the polygon budget is better spent here
than on a façade twenty metres away. They are still flat-shaded and still
low-poly — just less coarse.

THE SILHOUETTE IS THE POINT. The player must know which weapon they are holding
from peripheral vision while looking at an enemy, so the four read completely
differently in outline: the handgun is small and blocky, the machine gun has a
long magazine hanging below, the shotgun has a fat barrel and a pump, and the
grenade launcher has a drum.
"""

import math
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from lib import (  # noqa: E402
    reset_scene, material, box, cylinder, join, export_glb, PALETTE,
)

# Shared palette for gunmetal and furniture.
#
# THESE ARE LIGHTER THAN A GUN IS. That is deliberate, and it is the second
# time this file has had to learn it.
#
# A viewmodel is not lit like the world; it is lit for READABILITY, and its
# base colours have to be chosen for the same goal. The first pass used
# honest gunmetal values (#3A3D4A, #565A6B) and the weapon rendered as a
# black wedge with two yellow dots on it — measured, 55% of the gun's pixels
# landed in a single 32-wide luminance band against a background twice as
# bright. There was no internal contrast left to read a shape out of, so the
# player got a silhouette instead of a weapon.
#
# The cause is compounding: a dark base colour, then ACES tone mapping, then
# the grade's shadow tint, then a gun that spends most of the level on the
# shadow side of a six-metre street. Each step is individually reasonable and
# together they bottom out anything that did not start bright.
#
# So these are keyed roughly a stop and a half up from real steel and real
# walnut, and the spread BETWEEN them is widened too — the light/dark pairing
# is what draws the slide away from the frame and the grip away from both.
# Silhouette tells the player which weapon they hold; this is what tells them
# they are holding a weapon at all.
GUNMETAL = "#6E7488"
GUNMETAL_LIGHT = "#9298AC"
WOOD = "#8A6340"
BRASS = "#E0B93A"

# The hands. Warm, and several steps lighter than the gun, because their job is
# to be the one part of the viewmodel that never disappears: the gunmetal can
# fall into a shadowed street and still be found by its outline, but hands read
# as hands only if you can see their shape.
GLOVE = "#8A5A3C"
GLOVE_DARK = "#6B4630"
SLEEVE = "#3E4A63"
CUFF = "#C8B89A"


def _mats():
    # Metalness is kept moderate rather than physically "correct" for steel.
    # A fully metallic surface has no diffuse term at all, so it depends
    # entirely on an environment probe; at 0.72 the guns were extremely
    # sensitive to that probe and rendered black without one. Around 0.45 they
    # still read as metal, still take a specular hit from the muzzle flash, and
    # degrade gracefully if the probe ever fails to build.
    return {
        "metal": material("gun_metal", GUNMETAL, roughness=0.38, metallic=0.45),
        "light": material("gun_metal_light", GUNMETAL_LIGHT, roughness=0.32, metallic=0.42),
        "wood": material("gun_wood", WOOD, roughness=0.72),
        # Brass rounds in the grenade drum. Same reasoning as the gunmetal
        # above: kept off the fully-metallic end so the base colour still
        # carries them if the environment probe is ever missing.
        "brass": material("gun_brass", BRASS, roughness=0.26, metallic=0.55),
        "sight": material("gun_sight", PALETTE["guimardAmber"], roughness=0.25, emission=0.7),
    }


def _hand_mats():
    return {
        "glove": material("hand_glove", GLOVE, roughness=0.78),
        "glove_dark": material("hand_glove_dark", GLOVE_DARK, roughness=0.8),
        "sleeve": material("hand_sleeve", SLEEVE, roughness=0.84),
        "cuff": material("hand_cuff", CUFF, roughness=0.88),
    }


def _trigger_hand(grip_loc, rake, h, scale=1.0, mirror=False):
    """
    The firing hand wrapped round the grip, plus the forearm behind it.

    WHY THE GUN NEEDED HANDS. It was modelled and lit as an object and it
    rendered as one: a pistol hanging unsupported in the lower right of the
    frame. A viewmodel is not a picture of a gun, it is the player's own body
    in shot, and the arm is what connects the weapon to the person holding it.
    Without it the weapon reads as a HUD element the player looks past rather
    than a thing they are pointing.

    Built from four masses, in the same blocky vocabulary as the enemies so the
    two never look like they came from different games: the fist round the
    grip, a thumb laid along the frame, the sleeve running back and down out of
    frame, and a pale cuff between them. The cuff earns its place by being the
    one hard light-on-dark edge in the arm — it is what separates glove from
    sleeve when both are in shadow, which is most of the time.

    `grip_loc` and `rake` come from the weapon's own grip so the hand lands on
    it rather than near it; a hand floating a centimetre off the grip is worse
    than no hand at all.
    """
    gx, gy, gz = grip_loc
    side = -1.0 if mirror else 1.0
    s = scale
    return [
        # The fist. Slightly proud of the grip on both sides — a hand is wider
        # than what it holds, and if it is not, it reads as a block glued on.
        box("hand_fist", (0.115 * s, 0.155 * s, 0.20 * s),
            (gx + 0.004 * side, gy - 0.012, gz + 0.012), rot=(rake, 0, 0), mat=h["glove"]),
        # The thumb, laid forward along the frame. This is the detail that
        # makes the fist read as a hand rather than as a lump.
        box("hand_thumb", (0.036 * s, 0.10 * s, 0.05 * s),
            (gx - 0.055 * s * side, gy + 0.055, gz + 0.075),
            rot=(rake - 0.25, 0, 0), mat=h["glove_dark"]),
        # Knuckles: one raised band across the front of the fist.
        box("hand_knuckles", (0.118 * s, 0.048 * s, 0.055 * s),
            (gx + 0.004 * side, gy + 0.050, gz + 0.085), rot=(rake, 0, 0), mat=h["glove"]),
        # The cuff, then the sleeve running back out of frame.
        box("hand_cuff", (0.125 * s, 0.055 * s, 0.13 * s),
            (gx + 0.010 * side, gy - 0.105, gz - 0.075), rot=(rake, 0, 0), mat=h["cuff"]),
        box("hand_forearm", (0.135 * s, 0.34 * s, 0.145 * s),
            (gx + 0.026 * side, gy - 0.275, gz - 0.175), rot=(rake, 0, 0), mat=h["sleeve"]),
    ]


def _support_hand(loc, rake, h, scale=1.0):
    """
    The off hand on a foregrip, pump or handguard.

    Every weapon but the handgun is held in two hands, and which hand goes
    where is part of how the four read apart at a glance: the machine gun is
    gripped under the magazine, the shotgun is wrapped round the pump, and the
    launcher hangs off a foregrip in front of the drum. Getting this wrong is
    conspicuous in a way a wrong barrel length is not — people know what
    holding a thing looks like.
    """
    lx, ly, lz = loc
    s = scale
    return [
        box("support_fist", (0.105 * s, 0.135 * s, 0.175 * s),
            (lx - 0.035 * s, ly, lz), rot=(rake, 0, 0), mat=h["glove"]),
        box("support_thumb", (0.032 * s, 0.09 * s, 0.045 * s),
            (lx + 0.030 * s, ly + 0.035, lz + 0.055), rot=(rake - 0.2, 0, 0), mat=h["glove_dark"]),
        box("support_cuff", (0.115 * s, 0.05 * s, 0.12 * s),
            (lx - 0.055 * s, ly - 0.075, lz - 0.065), rot=(rake, 0, 0), mat=h["cuff"]),
        box("support_forearm", (0.125 * s, 0.30 * s, 0.135 * s),
            (lx - 0.105 * s, ly - 0.215, lz - 0.145), rot=(rake, 0, 0), mat=h["sleeve"]),
    ]


def handgun():
    """
    The default. Six rounds, infinite magazines, never taken away.

    Kept deliberately compact so it occupies as little of the frame as
    possible — the player looks past this weapon for most of the game and it
    must not become furniture they learn to ignore around.
    """
    reset_scene()
    m = _mats()
    h = _hand_mats()
    parts = [
        # slide
        box("slide", (0.075, 0.46, 0.085), (0, 0.10, 0.0), mat=m["metal"]),
        # frame under the slide
        box("frame", (0.068, 0.40, 0.055), (0, 0.06, -0.072), mat=m["light"]),
        # barrel protruding at the muzzle
        cylinder("muzzle", r1=0.022, depth=0.07, verts=8,
                 loc=(0, 0.35, 0.0), rot=(math.pi / 2, 0, 0), mat=m["metal"]),
        # grip, raked back the way a pistol grip is
        box("grip", (0.062, 0.10, 0.24), (0, -0.10, -0.17), rot=(0.28, 0, 0), mat=m["wood"]),
        # trigger guard
        box("guard", (0.05, 0.11, 0.018), (0, -0.02, -0.155), mat=m["light"]),
        box("trigger", (0.016, 0.03, 0.05), (0, -0.025, -0.125), mat=m["metal"]),
        # sights: the rear notch and the front blade
        box("rear_sight", (0.05, 0.02, 0.022), (0, -0.08, 0.055), mat=m["sight"]),
        box("front_sight", (0.016, 0.02, 0.028), (0, 0.31, 0.055), mat=m["sight"]),
        # ejection port
        box("port", (0.078, 0.11, 0.03), (0.004, 0.15, 0.03), mat=m["light"]),
        # One hand. A pistol at this angle is held one-handed in every arcade
        # light-gun game there has ever been, and the second hand would only
        # cover the frame the player is meant to be reading.
        *_trigger_hand((0, -0.10, -0.17), 0.28, h),
    ]
    join(parts, "handgun")
    return export_glb("public/assets/models/weapon_handgun.glb", "weapon_handgun")


def machine_gun():
    """Long magazine hanging below — the silhouette cue. Timed pickup."""
    reset_scene()
    m = _mats()
    h = _hand_mats()
    parts = [
        box("receiver", (0.082, 0.52, 0.10), (0, 0.10, 0), mat=m["metal"]),
        cylinder("barrel", r1=0.026, depth=0.42, verts=8,
                 loc=(0, 0.52, 0.012), rot=(math.pi / 2, 0, 0), mat=m["metal"]),
        # perforated handguard, faked as three rings
        *[cylinder(f"ring_{i}", r1=0.042, depth=0.035, verts=8,
                   loc=(0, 0.40 + i * 0.10, 0.012), rot=(math.pi / 2, 0, 0), mat=m["light"])
          for i in range(3)],
        # the magazine: the thing you recognise it by
        box("magazine", (0.06, 0.11, 0.30), (0, 0.04, -0.19), rot=(0.16, 0, 0), mat=m["light"]),
        box("grip", (0.06, 0.10, 0.22), (0, -0.14, -0.14), rot=(0.30, 0, 0), mat=m["wood"]),
        box("stock", (0.07, 0.30, 0.13), (0, -0.32, -0.03), mat=m["wood"]),
        box("guard", (0.05, 0.12, 0.018), (0, -0.06, -0.12), mat=m["light"]),
        box("rear_sight", (0.05, 0.025, 0.03), (0, -0.10, 0.07), mat=m["sight"]),
        box("front_sight", (0.018, 0.025, 0.035), (0, 0.70, 0.055), mat=m["sight"]),
        cylinder("flash_hider", r1=0.034, r2=0.028, depth=0.06, verts=8,
                 loc=(0, 0.75, 0.012), rot=(math.pi / 2, 0, 0), mat=m["metal"]),
        *_trigger_hand((0, -0.14, -0.14), 0.30, h),
        # The off hand grips the magazine well, which is how this weapon is
        # actually held and which puts the second arm across the low centre of
        # the frame — the dead space the viewmodel exists to fill.
        *_support_hand((0, 0.05, -0.30), 0.16, h),
    ]
    join(parts, "machine_gun")
    return export_glb("public/assets/models/weapon_machine_gun.glb", "weapon_machine_gun")


def shotgun():
    """Fat barrel and a pump under it. Drops a grunt in one."""
    reset_scene()
    m = _mats()
    h = _hand_mats()
    parts = [
        box("receiver", (0.088, 0.34, 0.105), (0, 0.06, 0), mat=m["metal"]),
        cylinder("barrel", r1=0.040, depth=0.62, verts=10,
                 loc=(0, 0.54, 0.020), rot=(math.pi / 2, 0, 0), mat=m["metal"]),
        # tube magazine under the barrel — the second half of the silhouette
        cylinder("tube", r1=0.028, depth=0.52, verts=8,
                 loc=(0, 0.48, -0.052), rot=(math.pi / 2, 0, 0), mat=m["light"]),
        # the pump
        box("pump", (0.072, 0.17, 0.072), (0, 0.36, -0.052), mat=m["wood"]),
        box("grip", (0.065, 0.11, 0.21), (0, -0.14, -0.13), rot=(0.30, 0, 0), mat=m["wood"]),
        box("stock", (0.075, 0.30, 0.15), (0, -0.32, -0.04), mat=m["wood"]),
        box("guard", (0.05, 0.12, 0.018), (0, -0.05, -0.115), mat=m["light"]),
        box("bead", (0.02, 0.02, 0.03), (0, 0.84, 0.058), mat=m["sight"]),
        *_trigger_hand((0, -0.14, -0.13), 0.30, h),
        # Wrapped round the pump, well forward. The long reach is the pose that
        # says "shotgun" before the barrel does.
        *_support_hand((0, 0.36, -0.052), 0.0, h),
    ]
    join(parts, "shotgun")
    return export_glb("public/assets/models/weapon_shotgun.glb", "weapon_shotgun")


def grenade_launcher():
    """The drum is the silhouette. Rare, and the answer to the boss."""
    reset_scene()
    m = _mats()
    h = _hand_mats()
    parts = [
        box("receiver", (0.09, 0.30, 0.11), (0, 0.05, 0), mat=m["metal"]),
        cylinder("barrel", r1=0.058, depth=0.40, verts=10,
                 loc=(0, 0.44, 0.02), rot=(math.pi / 2, 0, 0), mat=m["metal"]),
        # the drum magazine
        cylinder("drum", r1=0.155, depth=0.11, verts=12,
                 loc=(0, 0.10, -0.10), rot=(0, math.pi / 2, 0), mat=m["light"]),
        # visible rounds in the drum
        *[cylinder(f"round_{i}", r1=0.030, depth=0.125, verts=6,
                   loc=(0,
                        0.10 + math.cos(i * math.pi / 2) * 0.10,
                        -0.10 + math.sin(i * math.pi / 2) * 0.10),
                   rot=(0, math.pi / 2, 0), mat=m["brass"])
          for i in range(4)],
        box("grip", (0.065, 0.11, 0.22), (0, -0.15, -0.14), rot=(0.30, 0, 0), mat=m["wood"]),
        box("foregrip", (0.06, 0.09, 0.17), (0, 0.30, -0.11), rot=(-0.2, 0, 0), mat=m["wood"]),
        box("guard", (0.05, 0.12, 0.018), (0, -0.06, -0.12), mat=m["light"]),
        box("ladder_sight", (0.045, 0.025, 0.09), (0, -0.07, 0.10), mat=m["sight"]),
        *_trigger_hand((0, -0.15, -0.14), 0.30, h),
        # On the foregrip ahead of the drum. Keeping it clear of the drum
        # matters: the drum is the whole silhouette and a hand across it costs
        # the player the one cue that says they are holding the boss answer.
        *_support_hand((0, 0.30, -0.11), -0.2, h),
    ]
    join(parts, "grenade_launcher")
    return export_glb("public/assets/models/weapon_grenade.glb", "weapon_grenade")


ASSETS = {
    "weapon_handgun": handgun,
    "weapon_machine_gun": machine_gun,
    "weapon_shotgun": shotgun,
    "weapon_grenade": grenade_launcher,
}
