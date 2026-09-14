"""
Shared Blender helpers for the Time Claudis asset pipeline.

Runs against Blender as a Python module (`pip install bpy`), so there is no
Blender install to manage and no .blend files in the repository. Every asset is
generated from code and exported to GLB, which means the models are reviewable
in a diff, regenerable from scratch, and incapable of drifting away from the
palette the renderer uses.

THE PALETTE IS MIRRORED FROM src/render/palette.js. It has to be: an asset
exported with a colour the renderer does not share would break the amber/violet
contract the whole look rests on. `test_palette_sync.py` asserts the two stay
identical, so a colour changed in one place fails the build rather than quietly
desaturating a landmark.
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector

# --- palette, mirrored from src/render/palette.js ---------------------------
PALETTE = {
    "limestoneLit":   "#EBC89B",
    "limestoneMid":   "#D9AE7E",
    "limestoneDeep":  "#B98A63",
    "plasterCream":   "#F0D9B5",
    "plasterOchre":   "#D9A05B",
    "plasterPink":    "#DCAAA1",
    "plasterGrey":    "#C4B5A8",
    "zincLit":        "#9AA0B8",
    "zincShadow":     "#5A5F7D",
    "slateDark":      "#43455E",
    "chimneyTerra":   "#B05F45",
    "shutterBlue":    "#5E7A94",
    "shutterGreen":   "#5A6B4A",
    "shutterGrey":    "#7D8595",
    "ironwork":       "#32334A",
    "guimardGreen":   "#2F5A48",
    "guimardAmber":   "#E8B25C",
    "bronzeDalida":   "#8C6A3F",
    "bronzePolish":   "#D9A850",
    "cobbleWarm":     "#B09883",
    "pavement":       "#C7B49C",
    "stairStone":     "#BFA890",
    "foliageSun":     "#8F9B4A",
    "foliageMid":     "#5F7038",
    "foliageDeep":    "#3D4A2A",
    "trunkBark":      "#5C4632",
    "ivyGreen":       "#4A5C33",
    "awningRed":      "#B3413C",
    "awningGreen":    "#3E5F47",
    "awningCream":    "#E5D2AE",
    "metroGreen":     "#1F4A3A",
    "signWhite":      "#F2E9D8",
    "enemyGrunt":     "#D9932F",
    "enemySoldier":   "#4A6A94",
    "enemyRed":       "#C4322E",
    "enemyHeavy":     "#3A3A44",
    "enemySniper":    "#3E5236",
    "enemyBomber":    "#E8702A",
}


def srgb_to_linear(c):
    """glTF stores baseColorFactor in LINEAR space; our palette is sRGB hex."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear_rgba(h, alpha=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


_material_cache = {}


def reset_scene():
    """
    Empty the file. Called before every asset so exports cannot contaminate.

    The material cache MUST be cleared here. Blender invalidates every existing
    StructRNA when the file is reset, and a cached material from the previous
    asset is then a dangling pointer that throws "StructRNA of type Material
    has been removed" on any access — including on the `.name` lookup that was
    supposed to be the liveness check. There is no way to test such a reference
    safely, so the only correct move is to drop them all at the point the reset
    happens.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _material_cache.clear()


def material(name, hex_color, roughness=0.86, metallic=0.0, emission=0.0, alpha=1.0):
    """
    A flat-shaded Principled material.

    Flat shading is set on the MESH (via `shade_flat` and no custom normals),
    not here — glTF has no "flat shading" flag, so the faceting has to be baked
    into split vertex normals at export time or the look is lost on load.
    """
    key = (name, hex_color, roughness, metallic, emission, alpha)
    cached = _material_cache.get(key)
    if cached is not None:
        try:
            if cached.name in bpy.data.materials:
                return cached
        except ReferenceError:
            # Stale across a scene reset. reset_scene() clears the cache, so
            # this is belt and braces for a caller that resets by other means.
            _material_cache.pop(key, None)

    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    rgba = hex_to_linear_rgba(hex_color, alpha)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = rgba
        bsdf.inputs["Emission Strength"].default_value = emission
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    _material_cache[key] = mat
    return mat


def _finish(obj, mat, flat=True):
    obj.data.materials.append(mat)
    if flat:
        for p in obj.data.polygons:
            p.use_smooth = False
    return obj


def box(name, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
    """
    An axis-aligned box of the given SIZE (not half-size).

    `primitive_cube_add(size=1)` already produces a unit cube spanning -0.5 to
    +0.5 on each axis, so the scale factor is `size` directly. Halving it here
    — which is what this did originally — makes every part half its intended
    dimensions while leaving the positions alone, so an assembly built from
    boxes comes apart into a cloud of disconnected pieces with gaps between
    them. The first-person handgun rendered as an exploded diagram.
    """
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = (size[0], size[1], size[2])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, mat)


def cylinder(name, r1=0.5, r2=None, depth=1.0, verts=8, loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
    """A cone primitive with two radii — covers cylinders, cones and frusta."""
    r2 = r1 if r2 is None else r2
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return _finish(o, mat)


def sphere(name, r=0.5, segments=10, rings=6, loc=(0, 0, 0), mat=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=r, location=loc)
    o = bpy.context.object
    o.name = name
    return _finish(o, mat)


def torus(name, major=0.5, minor=0.06, mseg=12, minseg=6, loc=(0, 0, 0), rot=(0, 0, 0), mat=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor,
        major_segments=mseg, minor_segments=minseg, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    return _finish(o, mat)


def join(objs, name):
    """Join a list of objects into one. Returns the survivor."""
    objs = [o for o in objs if o is not None]
    if not objs:
        return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    out = bpy.context.object
    out.name = name
    return out


def export_glb(path, name=None):
    """
    Export the whole scene to GLB.

    `export_normals` keeps the split normals that carry the flat shading;
    without it the faceting is smoothed away on import and every low-poly
    surface turns into a soft blob.
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_normals=True,
        export_materials="EXPORT",
        export_yup=True,          # glTF is Y-up; Blender is Z-up
        use_selection=False,
    )
    size = os.path.getsize(path)
    print(f"  exported {name or os.path.basename(path)}  {size/1024:.1f} KB")
    return size
