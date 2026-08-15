"""
Decimates one PandaSet LiDAR frame into a compact binary the hero can stream.

Run scripts/fetch-pandaset-frame.mjs first — it range-fetches the frame out of
the 44.5 GB archive without downloading it.

    python3 scripts/bake-pandaset-frame.py

Needs numpy and pandas (the frames are pickled DataFrames). If your system
Python is missing them, a throwaway venv is the least invasive route:

    python3 -m venv .venv && ./.venv/bin/pip install "numpy<2" pandas
    ./.venv/bin/python scripts/bake-pandaset-frame.py

Writes public/data/lidar-frame.bin — int16 quantised xyz plus uint8 intensity
behind a small header, so the hero fetches ~130 KB rather than inlining a
megabyte of base64 into the JS bundle.

Data: PandaSet by Hesai and Scale AI, CC BY 4.0. https://pandaset.org
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "pandaset"
OUT = ROOT / "public" / "data" / "lidar-frame.bin"

# Keep the scene tight enough to read at hero size; beyond ~38 m the returns are
# sparse enough to look like noise.
MAX_RADIUS = 38.0
Z_MIN, Z_MAX = -3.0, 5.0
VOXEL = 0.28  # metres; lands around 18k points
MAGIC = b"LIDR"


def quaternion_to_matrix(w: float, x: float, y: float, z: float) -> np.ndarray:
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def main() -> None:
    frame = pd.read_pickle(CACHE / "frame.pkl")
    poses = json.loads((CACHE / "poses.json").read_text())
    pose = poses[0]

    # PandaSet points are in world coordinates; rotate into the ego frame so the
    # vehicle sits at the origin and the scan reads as a sensor view.
    rotation = quaternion_to_matrix(
        pose["heading"]["w"], pose["heading"]["x"], pose["heading"]["y"], pose["heading"]["z"]
    )
    origin = np.array([pose["position"]["x"], pose["position"]["y"], pose["position"]["z"]])
    points = (frame[["x", "y", "z"]].to_numpy() - origin) @ rotation
    intensity = frame["i"].to_numpy()

    # Device 0 is the mechanical spinning Pandar64 — the 360 degree scan. The
    # forward-facing unit is denser but only covers a wedge, which looks
    # lopsided once you can rotate the scene.
    mechanical = frame["d"].to_numpy() == 0
    radius = np.hypot(points[:, 0], points[:, 1])
    keep = mechanical & (radius < MAX_RADIUS) & (points[:, 2] > Z_MIN) & (points[:, 2] < Z_MAX)
    points = points[keep]
    intensity = intensity[keep]
    print(f"after crop:      {len(points):,} points")

    # Voxel downsample: one representative per occupied cell. Keeps the spatial
    # structure that random sampling would thin out unevenly.
    keys = np.floor(points / VOXEL).astype(np.int64)
    _, index = np.unique(keys, axis=0, return_index=True)
    index.sort()
    points = points[index]
    intensity = intensity[index]
    print(f"after voxel {VOXEL}m: {len(points):,} points")

    lo = points.min(axis=0)
    hi = points.max(axis=0)
    scale = (hi - lo) / 65535.0
    scale[scale == 0] = 1e-9
    quantised = np.clip(((points - lo) / scale).round(), 0, 65535).astype("<u2")

    # Intensity is 0..255 in PandaSet, but clamp rather than trust it.
    inten = np.clip(intensity, 0, 255).astype(np.uint8)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack("<I", len(points)))
        fh.write(struct.pack("<6f", *lo, *scale))
        fh.write(quantised.tobytes())
        fh.write(inten.tobytes())

    size = OUT.stat().st_size
    print(f"wrote {OUT.relative_to(ROOT)}  {size / 1024:.0f} KB")
    print(f"extent  x {lo[0]:.1f}..{hi[0]:.1f}  y {lo[1]:.1f}..{hi[1]:.1f}  z {lo[2]:.1f}..{hi[2]:.1f}")


if __name__ == "__main__":
    main()
