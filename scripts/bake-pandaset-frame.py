"""
Decimates PandaSet LiDAR frames into compact binaries the hero can stream.

Run scripts/fetch-pandaset-frame.mjs first — it range-fetches frames out of the
44.5 GB archive without downloading it:

    node scripts/fetch-pandaset-frame.mjs 019/00 092/20 021/40 064/10
    python3 scripts/bake-pandaset-frame.py

Bakes every frame found in .cache/pandaset into public/data/lidar-<tag>.bin,
plus a manifest the hero reads to know which frames exist.

Format per file: "LIDR", uint32 count, 3 floats origin, 3 floats scale, then
count*3 uint16 quantised xyz, then count uint8 intensity. Streamed at runtime
rather than inlined, so the JS bundle stays small.

Needs numpy and pandas — PandaSet frames are pickled DataFrames. If your system
Python lacks them (or has them for the wrong CPU architecture, which is a common
state on Apple Silicon), a venv is the least invasive route:

    python3 -m venv .venv && ./.venv/bin/pip install "numpy<2" pandas
    ./.venv/bin/python scripts/bake-pandaset-frame.py

Data: PandaSet by Hesai and Scale AI, CC BY 4.0. https://pandaset.org
"""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "pandaset"
OUT_DIR = ROOT / "public" / "data"

# Beyond ~38 m the returns are sparse enough to read as noise at hero size.
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


def bake(pkl: Path) -> dict[str, object]:
    tag = pkl.stem  # e.g. "019-00"
    sequence, frame_index = tag.split("-")
    poses = json.loads((CACHE / f"{tag}.poses.json").read_text())

    # Points are in world coordinates and poses are per frame, so frame 20 must
    # use poses[20]. Using poses[0] would leave the scan rotated and offset.
    pose = poses[int(frame_index)]

    frame = pd.read_pickle(pkl)
    rotation = quaternion_to_matrix(
        pose["heading"]["w"], pose["heading"]["x"], pose["heading"]["y"], pose["heading"]["z"]
    )
    origin = np.array([pose["position"]["x"], pose["position"]["y"], pose["position"]["z"]])
    points = (frame[["x", "y", "z"]].to_numpy() - origin) @ rotation
    intensity = frame["i"].to_numpy()

    # Device 0 is the mechanical spinning Pandar64 — a full 360 degrees. The
    # forward-facing unit is denser but covers only a wedge, which looks
    # lopsided once the scene can be rotated.
    mechanical = frame["d"].to_numpy() == 0
    radius = np.hypot(points[:, 0], points[:, 1])
    keep = mechanical & (radius < MAX_RADIUS) & (points[:, 2] > Z_MIN) & (points[:, 2] < Z_MAX)
    points, intensity = points[keep], intensity[keep]

    # Voxel downsample: one representative per occupied cell, which preserves
    # spatial structure that uniform random sampling would thin unevenly.
    keys = np.floor(points / VOXEL).astype(np.int64)
    _, index = np.unique(keys, axis=0, return_index=True)
    index.sort()
    points, intensity = points[index], intensity[index]

    lo, hi = points.min(axis=0), points.max(axis=0)
    scale = (hi - lo) / 65535.0
    scale[scale == 0] = 1e-9
    quantised = np.clip(((points - lo) / scale).round(), 0, 65535).astype("<u2")
    inten = np.clip(intensity, 0, 255).astype(np.uint8)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"lidar-{tag}.bin"
    with out.open("wb") as fh:
        fh.write(MAGIC)
        fh.write(struct.pack("<I", len(points)))
        fh.write(struct.pack("<6f", *lo, *scale))
        fh.write(quantised.tobytes())
        fh.write(inten.tobytes())

    print(f"  {tag}: {len(points):>6,} points  {out.stat().st_size / 1024:>5.0f} KB")
    return {
        "id": tag,
        "sequence": sequence,
        "frame": int(frame_index),
        "points": int(len(points)),
        "file": f"/data/lidar-{tag}.bin",
    }


def main() -> None:
    frames = sorted(p for p in CACHE.glob("*.pkl") if re.fullmatch(r"\d+-\d+", p.stem))
    if not frames:
        raise SystemExit("no frames in .cache/pandaset — run fetch-pandaset-frame.mjs first")

    print(f"baking {len(frames)} frame(s)")
    manifest = [bake(p) for p in frames]

    (OUT_DIR / "lidar-frames.json").write_text(
        json.dumps(
            {
                "source": "PandaSet by Hesai and Scale AI",
                "license": "CC BY 4.0",
                "url": "https://pandaset.org",
                "frames": manifest,
            },
            indent=2,
        )
        + "\n"
    )
    total = sum(f["points"] for f in manifest)
    print(f"\nwrote manifest with {len(manifest)} frames, {total:,} points total")


if __name__ == "__main__":
    main()
