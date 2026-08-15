/**
 * Flexiv Rizon 4s: real geometry and real kinematics.
 *
 * Meshes and the kinematic chain come from
 * https://github.com/flexivrobotics/flexiv_description (Apache-2.0), decimated
 * and quantised by scripts/bake-flexiv-arm.mjs. See src/data/rizon4s.json.
 */
import model from '../data/rizon4s.json';

export type Vec3 = [number, number, number];
/** Row-major 3x3. */
export type Mat3 = number[];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        (a[r * 3] ?? 0) * (b[c] ?? 0) +
        (a[r * 3 + 1] ?? 0) * (b[3 + c] ?? 0) +
        (a[r * 3 + 2] ?? 0) * (b[6 + c] ?? 0);
    }
  }
  return out;
}

export const apply = (m: Mat3, v: Vec3): Vec3 => [
  (m[0] ?? 0) * v[0] + (m[1] ?? 0) * v[1] + (m[2] ?? 0) * v[2],
  (m[3] ?? 0) * v[0] + (m[4] ?? 0) * v[1] + (m[5] ?? 0) * v[2],
  (m[6] ?? 0) * v[0] + (m[7] ?? 0) * v[1] + (m[8] ?? 0) * v[2],
];

export const rotX = (t: number): Mat3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
export const rotY = (t: number): Mat3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
export const rotZ = (t: number): Mat3 => {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** URDF convention: yaw about Z, then pitch about Y, then roll about X. */
export const rpy = (r: number, p: number, y: number): Mat3 => mul(rotZ(y), mul(rotY(p), rotX(r)));

export interface LinkMesh {
  /** Interleaved xyz in link-local metres. */
  verts: Float32Array;
  tris: Uint16Array;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Dequantise a packed link back to metres. */
function decodeLink(link: (typeof model.links)[number]): LinkMesh {
  const q = new Uint16Array(decodeBase64(link.verts).buffer);
  const verts = new Float32Array(q.length);
  const [minX, minY, minZ] = link.min as [number, number, number];
  const [sx, sy, sz] = link.scale as [number, number, number];
  for (let i = 0; i < q.length; i += 3) {
    verts[i] = minX + (q[i] ?? 0) * sx;
    verts[i + 1] = minY + (q[i + 1] ?? 0) * sy;
    verts[i + 2] = minZ + (q[i + 2] ?? 0) * sz;
  }
  return { verts, tris: new Uint16Array(decodeBase64(link.tris).buffer) };
}

export const MESHES: LinkMesh[] = model.links.map(decodeLink);

export interface JointSpec {
  xyz: Vec3;
  rot: Mat3;
  axis: 'y' | 'z';
  limit: [number, number];
}

export const CHAIN: JointSpec[] = model.chain.map((j) => ({
  xyz: j.xyz as Vec3,
  rot: rpy(j.rpy[0] ?? 0, j.rpy[1] ?? 0, j.rpy[2] ?? 0),
  axis: j.axis === 'y' ? 'y' : 'z',
  limit: j.limit as [number, number],
}));

export const FLANGE = {
  xyz: model.flange.xyz as Vec3,
  rot: rpy(model.flange.rpy[0] ?? 0, model.flange.rpy[1] ?? 0, model.flange.rpy[2] ?? 0),
};

export interface Frame {
  R: Mat3;
  p: Vec3;
}

export interface Pose {
  /** World frame per link, index 0 = base. */
  frames: Frame[];
  /** World position and axis of each revolute joint, for IK. */
  joints: { p: Vec3; axis: Vec3 }[];
  /** Tool centre point, at the flange. */
  tcp: Vec3;
}

const addScaled = (p: Vec3, R: Mat3, v: Vec3): Vec3 => {
  const d = apply(R, v);
  return [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
};

const normalise = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
};

/** Forward kinematics over the real chain. */
export function forward(angles: readonly number[]): Pose {
  const frames: Frame[] = [{ R: IDENTITY, p: [0, 0, 0] }]; // base_link
  const joints: { p: Vec3; axis: Vec3 }[] = [];

  let R: Mat3 = IDENTITY;
  let p: Vec3 = [0, 0, 0];

  for (let i = 0; i < CHAIN.length; i++) {
    const spec = CHAIN[i]!;
    p = addScaled(p, R, spec.xyz);
    R = mul(R, spec.rot);

    const localAxis: Vec3 = spec.axis === 'y' ? [0, 1, 0] : [0, 0, 1];
    joints.push({ p, axis: normalise(apply(R, localAxis)) });

    R = mul(R, spec.axis === 'y' ? rotY(angles[i] ?? 0) : rotZ(angles[i] ?? 0));
    frames.push({ R, p });
  }

  const tcp = addScaled(p, mul(R, FLANGE.rot), [0, 0, 0]);
  return { frames, joints, tcp: addScaled(tcp, R, FLANGE.xyz) };
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/* -------------------------------------------------------------- safety -- */

/** Nothing may descend below this, so the arm never drives into the bench. */
const FLOOR_CLEARANCE = 0.035;
/** Link radius plus margin. Non-adjacent links must stay this far apart. */
const SELF_CLEARANCE = 0.11;

/** Shortest distance between two line segments. */
function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);

  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) return Math.hypot(r[0], r[1], r[2]);

  if (a <= 1e-9) {
    t = clamp(f / e, 0, 1);
  } else {
    const c = dot(d1, r);
    if (e <= 1e-9) {
      s = clamp(-c / a, 0, 1);
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }

  const c1: Vec3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: Vec3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  const diff = sub(c1, c2);
  return Math.hypot(diff[0], diff[1], diff[2]);
}

/**
 * Is this configuration safe to hold?
 *
 * Joint limits are already enforced by clamping, but staying inside them says
 * nothing about whether the arm has folded through itself or pushed a link into
 * the bench — both of which a real robot would refuse. Links are approximated
 * as segments between consecutive joint origins; adjacent pairs are skipped
 * because they share an endpoint by construction.
 */
export function isSafe(angles: readonly number[]): boolean {
  const { joints, tcp } = forward(angles);
  const points: Vec3[] = [...joints.map((j) => j.p), tcp];

  for (let i = 1; i < points.length; i++) {
    if ((points[i]?.[2] ?? 0) < FLOOR_CLEARANCE) return false;
  }

  for (let i = 0; i < points.length - 1; i++) {
    for (let k = i + 2; k < points.length - 1; k++) {
      const a0 = points[i];
      const a1 = points[i + 1];
      const b0 = points[k];
      const b1 = points[k + 1];
      if (!a0 || !a1 || !b0 || !b1) continue;
      if (segmentDistance(a0, a1, b0, b1) < SELF_CLEARANCE) return false;
    }
  }
  return true;
}

/**
 * Cyclic coordinate descent onto `target`, respecting the real joint limits
 * and refusing to settle in an unsafe pose.
 *
 * Each joint rotates about its own axis by the angle that best brings the tool
 * centre toward the target; steps are capped so the arm settles rather than
 * snapping. After every pass the configuration is checked for self-collision
 * and floor penetration, and reverted if it fails — so the arm stalls short of
 * an unreachable target rather than contorting to hit it.
 */
export function solveIK(angles: number[], target: Vec3, iterations: number): void {
  for (let pass = 0; pass < iterations; pass++) {
    const before = angles.slice();

    for (let i = CHAIN.length - 1; i >= 0; i--) {
      const { joints, tcp } = forward(angles);
      const j = joints[i];
      const spec = CHAIN[i];
      if (!j || !spec) continue;

      const axis = j.axis;
      const flat = (v: Vec3): Vec3 => {
        const k = dot(v, axis);
        return [v[0] - axis[0] * k, v[1] - axis[1] * k, v[2] - axis[2] * k];
      };
      const a = normalise(flat(sub(tcp, j.p)));
      const b = normalise(flat(sub(target, j.p)));
      if (Math.hypot(a[0], a[1], a[2]) < 1e-6 || Math.hypot(b[0], b[1], b[2]) < 1e-6) continue;

      const signed = Math.atan2(dot(cross(a, b), axis), clamp(dot(a, b), -1, 1));
      const proposed = clamp(
        (angles[i] ?? 0) + clamp(signed, -0.25, 0.25),
        spec.limit[0],
        spec.limit[1],
      );

      // Try the move; keep it only if the arm is still in a safe pose.
      const previous = angles[i] ?? 0;
      angles[i] = proposed;
      if (!isSafe(angles)) angles[i] = previous;
    }

    // Belt and braces: if a pass somehow ended unsafe, roll the whole pass back.
    if (!isSafe(angles)) {
      for (let i = 0; i < angles.length; i++) angles[i] = before[i] ?? 0;
      return;
    }
  }
}

export const MODEL_NAME: string = model.model;
export const TRIANGLES: number = model.links.reduce((n, l) => n + l.counts.tris, 0);
