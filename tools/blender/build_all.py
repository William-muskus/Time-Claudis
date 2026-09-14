#!/usr/bin/env python3
"""
Build every GLB asset.

    npm run assets          (or: python3 tools/blender/build_all.py)

Blender runs as a Python module, so this needs no Blender install and no GUI.
Each asset resets the scene first, so an export can never pick up geometry left
behind by the previous one.
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
os.chdir(ROOT)


def main():
    import landmarks
    import characters
    import weapons

    registry = {}
    registry.update(landmarks.ASSETS)
    registry.update(characters.ASSETS)
    registry.update(weapons.ASSETS)

    only = sys.argv[1:] or None
    total_bytes = 0
    built = []
    t0 = time.time()

    print(f"Building {len(only or registry)} asset(s) into public/assets/models/\n")
    for name, fn in registry.items():
        if only and name not in only:
            continue
        try:
            size = fn()
            total_bytes += size or 0
            built.append(name)
        except Exception as e:              # noqa: BLE001
            print(f"  FAILED {name}: {e}")
            raise

    print(f"\n{len(built)} assets, {total_bytes/1024:.1f} KB total, "
          f"{time.time()-t0:.1f}s")
    manifest = os.path.join(ROOT, "public/assets/models/manifest.json")
    import json
    with open(manifest, "w") as f:
        json.dump({"assets": sorted(built)}, f, indent=2)
    print(f"wrote {os.path.relpath(manifest, ROOT)}")


if __name__ == "__main__":
    main()
