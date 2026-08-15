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

/**
 * How much of each joint's real range to actually use.
 *
 * The URDF limits are what the hardware allows, not what looks composed. Near
 * the extremes the arm folds back on itself and the wrist flips, so the usable
 * range is pulled in around each joint's midpoint.
 */
const LIMIT_MARGIN = 0.62;

function tighten([lo, hi]: [number, number]): [number, number] {
  const mid = (lo + hi) / 2;
  const half = ((hi - lo) / 2) * LIMIT_MARGIN;
  return [mid - half, mid + half];
}

export const CHAIN: JointSpec[] = model.chain.map((j) => ({
  xyz: j.xyz as Vec3,
  rot: rpy(j.rpy[0] ?? 0, j.rpy[1] ?? 0, j.rpy[2] ?? 0),
  axis: j.axis === 'y' ? 'y' : 'z',
  limit: tighten(j.limit as [number, number]),
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

/**
 * Per-link radius, shoulder to wrist.
 *
 * Clearance has to be measured against the link surface, not the centreline —
 * testing joint origins alone is what let the arm sit visibly on the bench
 * while every check passed. The taper matters too: a Rizon's shoulder is roughly
 * twice the girth of its wrist, and treating them alike makes the wrist links
 * appear to collide with each other in perfectly ordinary poses.
 */
const LINK_RADII: readonly number[] = [0.085, 0.075, 0.065, 0.058, 0.05, 0.045, 0.04];

const radiusOf = (segment: number): number =>
  LINK_RADII[Math.min(segment, LINK_RADII.length - 1)] ?? 0.05;

/** Structural links stay clear of the bench by this much, surface to surface. */
const FLOOR_CLEARANCE = 0.02;
/** Non-adjacent links keep this much air between their surfaces. */
const SELF_CLEARANCE = 0.03;

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
 * Links are capsules of LINK_RADIUS around the segment between consecutive
 * joint origins. The final segment — the wrist and gripper — is exempt from the
 * floor rule, because reaching down to something resting on the bench is the
 * whole task; everything structural above it is not.
 */
export function isSafe(angles: readonly number[]): boolean {
  const { joints, tcp } = forward(angles);
  const points: Vec3[] = [...joints.map((j) => j.p), tcp];

  // Every joint but the last must keep its surface off the bench.
  for (let i = 1; i < points.length - 1; i++) {
    if ((points[i]?.[2] ?? 0) - radiusOf(i) < FLOOR_CLEARANCE) return false;
  }
  // The tool may come down to the work, but not through it.
  if ((tcp[2] ?? 0) < -0.005) return false;

  for (let i = 0; i < points.length - 1; i++) {
    for (let k = i + 2; k < points.length - 1; k++) {
      const a0 = points[i];
      const a1 = points[i + 1];
      const b0 = points[k];
      const b1 = points[k + 1];
      if (!a0 || !a1 || !b0 || !b1) continue;
      const gap = segmentDistance(a0, a1, b0, b1) - radiusOf(i) - radiusOf(k);
      if (gap < SELF_CLEARANCE) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------- operational space -- */

/**
 * Position Jacobian, 3 x 7.
 *
 * For a revolute joint, moving it sweeps the tool around that joint's axis, so
 * the column is simply axis x (tcp - jointOrigin).
 */
function jacobian(pose: Pose): number[][] {
  const J: number[][] = [[], [], []];
  for (let i = 0; i < CHAIN.length; i++) {
    const j = pose.joints[i];
    if (!j) continue;
    const r = sub(pose.tcp, j.p);
    const c = cross(j.axis, r);
    J[0]!.push(c[0]);
    J[1]!.push(c[1]);
    J[2]!.push(c[2]);
  }
  return J;
}

/** Inverse of a symmetric 3x3, by cofactors. Returns null if near-singular. */
function invert3(m: number[][]): number[][] | null {
  const [a, b, c] = [m[0]![0]!, m[0]![1]!, m[0]![2]!];
  const [d, e, f] = [m[1]![0]!, m[1]![1]!, m[1]![2]!];
  const [g, h, i] = [m[2]![0]!, m[2]![1]!, m[2]![2]!];

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;

  const inv = 1 / det;
  return [
    [A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv],
    [C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv],
  ];
}

/**
 * Damping for the pseudo-inverse. Bounds joint speed near singularities, but
 * it's deliberately small: damping also stops (I - J+J) being a clean
 * projector, which lets the posture task bleed into the tool's motion. At 0.06
 * that leak cost 0.5 m of tracking error.
 */
const DAMPING = 0.01;
/** Task-space gain: how hard the tool is pulled toward the target. */
const TASK_GAIN = 12;
/** Ceiling on commanded tool speed, m/s. */
const MAX_TOOL_SPEED = 2.5;
/**
 * Nullspace gain. Low on purpose — this only has to keep the elbow tidy and
 * the joints off their stops, and turning it up fights the task rather than
 * complementing it.
 */
const POSTURE_GAIN = 0.15;
/** Ceiling on any single joint's rate, rad/s. */
const MAX_JOINT_RATE = 5;

/** The posture the nullspace drifts toward — elbow up, wrist clear. */
export const HOME: readonly number[] = [0, 0.42, 0, 1.15, 0, 0.86, 0];

/**
 * Operational-space control step.
 *
 * Solves for joint rates that move the tool toward `target`, using a damped
 * least-squares pseudo-inverse so the arm stays well behaved near
 * singularities. The redundancy of a 7-DOF arm is resolved in the nullspace:
 * whatever joint motion doesn't affect the tool is used to pull the arm back
 * toward a comfortable posture and away from its limits.
 *
 * That nullspace term is the difference between this and CCD. CCD is greedy —
 * it takes whatever joint angles reach the target first, which is why it
 * produces contorted poses. Here the arm reaches the same point in the pose a
 * person would pick.
 *
 * Any step that would end in an unsafe configuration is rejected, so the tool
 * stalls short rather than driving a link through the bench.
 */
export function stepOSC(angles: number[], target: Vec3, dt: number): void {
  const step = clamp(dt, 0, 0.05);
  const pose = forward(angles);

  // Task: velocity toward the target, capped.
  const err = sub(target, pose.tcp);
  const dist = Math.hypot(err[0], err[1], err[2]);
  if (dist < 1e-5) return;
  const speed = Math.min(TASK_GAIN * dist, MAX_TOOL_SPEED);
  const v: Vec3 = [(err[0] / dist) * speed, (err[1] / dist) * speed, (err[2] / dist) * speed];

  const J = jacobian(pose);
  const n = CHAIN.length;

  // JJ^T + lambda^2 I, a 3x3.
  const JJt: number[][] = [[], [], []];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += (J[r]![k] ?? 0) * (J[c]![k] ?? 0);
      JJt[r]![c] = sum + (r === c ? DAMPING * DAMPING : 0);
    }
  }
  const inv = invert3(JJt);
  if (!inv) return;

  // qdot_task = J^T (JJ^T + l^2 I)^-1 v
  const w: Vec3 = [
    (inv[0]![0] ?? 0) * v[0] + (inv[0]![1] ?? 0) * v[1] + (inv[0]![2] ?? 0) * v[2],
    (inv[1]![0] ?? 0) * v[0] + (inv[1]![1] ?? 0) * v[1] + (inv[1]![2] ?? 0) * v[2],
    (inv[2]![0] ?? 0) * v[0] + (inv[2]![1] ?? 0) * v[1] + (inv[2]![2] ?? 0) * v[2],
  ];
  const qTask: number[] = [];
  for (let k = 0; k < n; k++) {
    qTask.push((J[0]![k] ?? 0) * w[0] + (J[1]![k] ?? 0) * w[1] + (J[2]![k] ?? 0) * w[2]);
  }

  // Posture task, projected into the nullspace: qdot += (I - J^+ J) qdot_null.
  const qNull: number[] = [];
  for (let k = 0; k < n; k++) {
    const spec = CHAIN[k]!;
    const mid = (spec.limit[0] + spec.limit[1]) / 2;
    // Blend "return to home" with "flee the nearest limit".
    const toHome = (HOME[k] ?? 0) - (angles[k] ?? 0);
    const toCentre = mid - (angles[k] ?? 0);
    qNull.push(POSTURE_GAIN * (0.7 * toHome + 0.3 * toCentre));
  }

  // J^+ J qdot_null, via the same damped inverse.
  const Jq: Vec3 = [0, 0, 0];
  for (let r = 0; r < 3; r++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += (J[r]![k] ?? 0) * (qNull[k] ?? 0);
    Jq[r] = sum;
  }
  const u: Vec3 = [
    (inv[0]![0] ?? 0) * Jq[0] + (inv[0]![1] ?? 0) * Jq[1] + (inv[0]![2] ?? 0) * Jq[2],
    (inv[1]![0] ?? 0) * Jq[0] + (inv[1]![1] ?? 0) * Jq[1] + (inv[1]![2] ?? 0) * Jq[2],
    (inv[2]![0] ?? 0) * Jq[0] + (inv[2]![1] ?? 0) * Jq[1] + (inv[2]![2] ?? 0) * Jq[2],
  ];

  const proposed = angles.slice();
  for (let k = 0; k < n; k++) {
    const projected =
      (qNull[k] ?? 0) -
      ((J[0]![k] ?? 0) * u[0] + (J[1]![k] ?? 0) * u[1] + (J[2]![k] ?? 0) * u[2]);
    const rate = clamp((qTask[k] ?? 0) + projected, -MAX_JOINT_RATE, MAX_JOINT_RATE);
    const spec = CHAIN[k]!;
    proposed[k] = clamp((angles[k] ?? 0) + rate * step, spec.limit[0], spec.limit[1]);
  }

  // Reject the whole step if it lands somewhere the arm shouldn't be. Halving
  // it a few times finds the largest safe move along the same direction.
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = 1 / 2 ** attempt;
    const candidate = angles.map((a, k) => a + ((proposed[k] ?? a) - a) * scale);
    if (isSafe(candidate)) {
      for (let k = 0; k < n; k++) angles[k] = candidate[k] ?? angles[k]!;
      return;
    }
  }
}

export const MODEL_NAME: string = model.model;
export const TRIANGLES: number = model.links.reduce((n, l) => n + l.counts.tris, 0);
