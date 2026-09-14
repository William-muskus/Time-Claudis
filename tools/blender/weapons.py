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
GUNMETAL = "#3A3D4A"
GUNMETAL_LIGHT = "#565A6B"
WOOD = "#6B4A2F"
BRASS = "#C9A227"


def _mats():
    return {
        "metal": material("gun_metal", GUNMETAL, roughness=0.42, metallic=0.72),
        "light": material("gun_metal_light", GUNMETAL_LIGHT, roughness=0.38, metallic=0.66),
        "wood": material("gun_wood", WOOD, roughness=0.72),
        "brass": material("gun_brass", BRASS, roughness=0.3, metallic=0.85),
        "sight": material("gun_sight", PALETTE["guimardAmber"], roughness=0.25, emission=0.7),
    }


def handgun():
    """
    The default. Six rounds, infinite magazines, never taken away.

    Kept deliberately compact so it occupies as little of the frame as
    possible — the player looks past this weapon for most of the game and it
    must not become furniture they learn to ignore around.
    """
    reset_scene()
    m = _mats()
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
    ]
    join(parts, "handgun")
    return export_glb("public/assets/models/weapon_handgun.glb", "weapon_handgun")


def machine_gun():
    """Long magazine hanging below — the silhouette cue. Timed pickup."""
    reset_scene()
    m = _mats()
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
    ]
    join(parts, "machine_gun")
    return export_glb("public/assets/models/weapon_machine_gun.glb", "weapon_machine_gun")


def shotgun():
    """Fat barrel and a pump under it. Drops a grunt in one."""
    reset_scene()
    m = _mats()
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
    ]
    join(parts, "shotgun")
    return export_glb("public/assets/models/weapon_shotgun.glb", "weapon_shotgun")


def grenade_launcher():
    """The drum is the silhouette. Rare, and the answer to the boss."""
    reset_scene()
    m = _mats()
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
    ]
    join(parts, "grenade_launcher")
    return export_glb("public/assets/models/weapon_grenade.glb", "weapon_grenade")


ASSETS = {
    "weapon_handgun": handgun,
    "weapon_machine_gun": machine_gun,
    "weapon_shotgun": shotgun,
    "weapon_grenade": grenade_launcher,
}
