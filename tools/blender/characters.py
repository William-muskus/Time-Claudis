"""
The enemy figure.

ONE mesh, recoloured per class at runtime. That is a deliberate constraint:
every enemy in the game must have the same silhouette so the player reads CLASS
from colour and THREAT from the chest flash, never from the outline. Giving the
heavy a different shape would mean the player has two things to parse instead
of one, and at arcade speed they will parse neither.

The chest plate is a separate named object (`flashPlate`) so the runtime can
find it and drive its opacity for the telegraph.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from lib import (  # noqa: E402
    reset_scene, material, box, join, export_glb, PALETTE,
)


def enemy_figure():
    reset_scene()
    # Base colour is neutral; the runtime tints per class. Exported mid-grey so
    # a missed tint is obvious in review rather than silently looking fine.
    body = material("enemy_body", "#B0B0B0", roughness=0.72)
    dark = material("enemy_dark", PALETTE["ironwork"], roughness=0.68)
    skin = material("enemy_skin", PALETTE["plasterCream"], roughness=0.85)
    flash = material("enemy_flash", "#FFF3D0", roughness=0.1, emission=1.0)

    legs = box("legs", (0.42, 0.30, 0.78), (0, 0, 0.39), mat=dark)
    torso = box("torso", (0.62, 0.36, 0.78), (0, 0, 1.14), mat=body)
    head = box("head", (0.30, 0.30, 0.32), (0, 0, 1.62), mat=skin)
    cap = box("cap", (0.33, 0.33, 0.11), (0, 0, 1.80), mat=body)
    gun = box("gun", (0.09, 0.44, 0.11), (0.20, 0.50, 1.24), mat=dark)
    arms = [box(f"arm_{s}", (0.15, 0.52, 0.15), (s * 0.34, 0.22, 1.24), mat=body)
            for s in (-1, 1)]

    # Joined into the body; the plate stays separate and named.
    join([legs, torso, head, cap, gun, *arms], "enemy_body")
    plate = box("flashPlate", (0.40, 0.06, 0.34), (0, 0.20, 1.18), mat=flash)
    plate.name = "flashPlate"

    return export_glb("public/assets/models/enemy_figure.glb", "enemy_figure")


ASSETS = {
    "enemy_figure": enemy_figure,
}
