/**
 * Bakes the Flexiv Rizon 4s visual meshes into a compact asset the hero can
 * render, and prints the kinematic chain alongside it.
 *
 * Source: https://github.com/flexivrobotics/flexiv_description (Apache-2.0)
 * The raw OBJs are ~3.5 MB and ~44k triangles across 8 links — far too heavy to
 * ship or to rasterise in canvas at 60fps. This decimates each link by vertex
 * clustering, then quantises positions to 16-bit with a per-link scale and
 * offset, so the whole arm lands in tens of kilobytes.
 *
 * Usage:
 *   1. Clone the meshes:
 *        gh repo clone flexivrobotics/flexiv_description /tmp/flexiv -- -b humble
 *   2. node scripts/bake-flexiv-arm.mjs /tmp/flexiv/meshes/Rizon4s/visual
 *
 * Writes src/data/rizon4s.json. Re-run only if you want a different budget.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = process.argv[2];
const TARGET_TRIS = Number(process.argv[3] || 420); // per link
const LINKS = 8;

if (!SRC) {
  console.error('usage: node scripts/bake-flexiv-arm.mjs <path-to-Rizon4s/visual> [trisPerLink]');
  process.exit(1);
}

/** Minimal OBJ reader: positions and triangulated faces. Ignores everything else. */
function parseObj(text) {
  const pos = [];
  const tris = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const [, x, y, z] = line.split(/\s+/);
      pos.push([Number(x), Number(y), Number(z)]);
    } else if (line.startsWith('f ')) {
      const idx = line
        .trim()
        .split(/\s+/)
        .slice(1)
        // Faces come as v, v/vt, or v/vt/vn — we only want v.
        .map((tok) => Number(tok.split('/')[0]) - 1);
      // Fan-triangulate any polygon.
      for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
    }
  }
  return { pos, tris };
}

/**
 * Vertex-clustering decimation.
 *
 * Snaps vertices to a uniform grid and collapses each cell to its centroid.
 * Cruder than quadric error metrics, but it's ~40 lines, has no dependency, and
 * at this triangle budget the silhouette is all that survives anyway.
 */
function decimate(pos, tris, grid) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of pos) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const sx = (maxX - minX) / grid || 1;
  const sy = (maxY - minY) / grid || 1;
  const sz = (maxZ - minZ) / grid || 1;

  const cells = new Map();
  const cellOf = new Int32Array(pos.length);

  pos.forEach((p, i) => {
    const key = `${Math.floor((p[0] - minX) / sx)},${Math.floor((p[1] - minY) / sy)},${Math.floor((p[2] - minZ) / sz)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { sum: [0, 0, 0], n: 0, index: cells.size };
      cells.set(key, cell);
    }
    cell.sum[0] += p[0];
    cell.sum[1] += p[1];
    cell.sum[2] += p[2];
    cell.n++;
    cellOf[i] = cell.index;
  });

  const verts = new Array(cells.size);
  for (const cell of cells.values()) {
    verts[cell.index] = [cell.sum[0] / cell.n, cell.sum[1] / cell.n, cell.sum[2] / cell.n];
  }

  const seen = new Set();
  const out = [];
  for (const [a, b, c] of tris) {
    const ia = cellOf[a];
    const ib = cellOf[b];
    const ic = cellOf[c];
    if (ia === ib || ib === ic || ia === ic) continue; // collapsed to a sliver
    const key = [ia, ib, ic].slice().sort((m, n) => m - n).join(',');
    if (seen.has(key)) continue; // duplicate face after collapse
    seen.add(key);
    out.push([ia, ib, ic]);
  }
  return { verts, tris: out };
}

/** Binary-search the grid resolution that lands nearest the triangle budget. */
function decimateToBudget(pos, tris, budget) {
  let lo = 3;
  let hi = 64;
  let best = null;
  for (let i = 0; i < 9; i++) {
    const grid = Math.round((lo + hi) / 2);
    const result = decimate(pos, tris, grid);
    if (!best || Math.abs(result.tris.length - budget) < Math.abs(best.tris.length - budget)) {
      best = result;
    }
    if (result.tris.length > budget) hi = grid - 1;
    else lo = grid + 1;
    if (lo > hi) break;
  }
  return best;
}

/** Quantise to uint16 with a per-link scale/offset, then base64. */
function pack(verts, tris) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) {
    for (let a = 0; a < 3; a++) {
      if (v[a] < min[a]) min[a] = v[a];
      if (v[a] > max[a]) max[a] = v[a];
    }
  }
  const scale = [0, 1, 2].map((a) => (max[a] - min[a]) / 65535 || 1e-9);

  const q = new Uint16Array(verts.length * 3);
  verts.forEach((v, i) => {
    for (let a = 0; a < 3; a++) {
      q[i * 3 + a] = Math.max(0, Math.min(65535, Math.round((v[a] - min[a]) / scale[a])));
    }
  });

  // Index width follows vertex count; these meshes stay well under 65k.
  const idx = new Uint16Array(tris.length * 3);
  tris.forEach((t, i) => {
    idx[i * 3] = t[0];
    idx[i * 3 + 1] = t[1];
    idx[i * 3 + 2] = t[2];
  });

  return {
    min,
    scale,
    verts: Buffer.from(q.buffer).toString('base64'),
    tris: Buffer.from(idx.buffer).toString('base64'),
    counts: { verts: verts.length, tris: tris.length },
  };
}

const links = [];
let totalIn = 0;
let totalOut = 0;

for (let i = 0; i < LINKS; i++) {
  const file = `${SRC}/link${i}.obj`;
  if (!existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  const { pos, tris } = parseObj(readFileSync(file, 'utf8'));
  const dec = decimateToBudget(pos, tris, TARGET_TRIS);
  const packed = pack(dec.verts, dec.tris);
  links.push(packed);
  totalIn += tris.length;
  totalOut += dec.tris.length;
  console.log(
    `link${i}: ${tris.length.toString().padStart(5)} tris -> ${dec.tris.length
      .toString()
      .padStart(4)}  (${dec.verts.length} verts)`,
  );
}

/**
 * Kinematic chain, transcribed from
 * config/Rizon4s/default_kinematics.yaml and config/Rizon4s/joint_limits.yaml.
 * Offsets are the joint origin in the parent frame; `axis` is the revolute
 * axis in the joint frame.
 */
const chain = [
  { xyz: [0, 0, 0.155], rpy: [0, 0, Math.PI], axis: 'z', limit: [-2.8798, 2.8798] },
  { xyz: [0, 0.03, 0.21], rpy: [0, 0, 0], axis: 'y', limit: [-2.3562, 2.3562] },
  { xyz: [0, 0.035, 0.205], rpy: [0, 0, 0], axis: 'z', limit: [-3.0543, 3.0543] },
  { xyz: [-0.02, -0.03, 0.19], rpy: [0, 0, Math.PI], axis: 'y', limit: [-1.9548, 2.7751] },
  { xyz: [-0.02, 0.025, 0.195], rpy: [0, 0, Math.PI], axis: 'z', limit: [-3.0543, 3.0543] },
  { xyz: [0, 0.03, 0.19], rpy: [0, 0, 0], axis: 'y', limit: [-1.4835, 4.6251] },
  { xyz: [-0.015, 0.073, 0.11], rpy: [0, -Math.PI / 2, 0], axis: 'z', limit: [-3.0543, 3.0543] },
];
const flange = { xyz: [0, 0, 0.124], rpy: [0, 0, Math.PI] };

const out = fileURLToPath(new URL('../src/data/rizon4s.json', import.meta.url));
mkdirSync(fileURLToPath(new URL('../src/data/', import.meta.url)), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    source: 'https://github.com/flexivrobotics/flexiv_description',
    license: 'Apache-2.0',
    model: 'Rizon 4s',
    chain,
    flange,
    links,
  }),
);

const bytes = readFileSync(out).length;
console.log(
  `\n${totalIn} tris -> ${totalOut} (${((totalOut / totalIn) * 100).toFixed(1)}%)\n` +
    `wrote src/data/rizon4s.json  ${(bytes / 1024).toFixed(0)} KB`,
);
