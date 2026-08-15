/**
 * Drives the Flexiv arm through its full pick cycle and asserts it never enters
 * a configuration a real robot would refuse.
 *
 *   npm run test:arm
 *
 * Checks, per frame:
 *   - every joint inside its real URDF limit
 *   - no link below the bench
 *   - no self-collision between non-adjacent links
 *
 * Also asserts the guard actually rejects two deliberately bad poses, so a
 * pass can't be vacuous.
 *
 * Compiles src/lib/rizon.ts on the fly — there's no test runner in this project
 * and adding one for a single file isn't worth it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'rizon-'));
try {
  execFileSync(
    'npx',
    [
      'tsc', 'src/lib/rizon.ts',
      '--ignoreConfig',
      '--outDir', out,
      '--module', 'esnext',
      '--target', 'es2022',
      '--resolveJsonModule',
      '--moduleResolution', 'bundler',
      '--skipLibCheck',
    ],
    { stdio: 'inherit' },
  );

  // Node's ESM loader requires an explicit attribute for JSON imports.
  const compiled = join(out, 'lib/rizon.js');
  writeFileSync(
    compiled,
    readFileSync(compiled, 'utf8').replace(
      "from '../data/rizon4s.json'",
      "from '../data/rizon4s.json' with { type: 'json' }",
    ),
  );

  const { forward, stepOSC, isSafe, CHAIN, HOME } = await import(pathToFileURL(compiled).href);

  const GRAPE_R = 0.028;
  const HOVER = 0.18;
  const CYCLE = 6.4;
  const REST = [...HOME];
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

  // Mirrors station() and armScene() in src/components/HeroScene.astro. The
  // placement is pseudo-random but reproducible, so the sequence tested here is
  // the sequence that ships.
  function station(n) {
    let h = Math.imul(n + 1, 2654435761) >>> 0;
    const rand = () => {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
      return h / 4294967296;
    };
    const bearing = (rand() - 0.5) * 2.6;
    const reach = 0.34 + rand() * 0.19;
    return [Math.cos(bearing) * reach, Math.sin(bearing) * reach, GRAPE_R];
  }

  function target(t) {
    const n = Math.floor(t / CYCLE);
    const u = (t % CYCLE) / CYCLE;
    const from = station(n);
    const to = station(n + 1);
    const overFrom = [from[0], from[1], from[2] + HOVER];
    const overTo = [to[0], to[1], to[2] + HOVER];

    if (u < 0.14) return mix(overFrom, from, ease(u / 0.14));
    if (u < 0.22) return from;
    if (u < 0.36) return mix(from, overFrom, ease((u - 0.22) / 0.14));
    if (u < 0.64) return mix(overFrom, overTo, ease((u - 0.36) / 0.28));
    if (u < 0.78) return mix(overTo, to, ease((u - 0.64) / 0.14));
    if (u < 0.86) return to;
    return mix(to, overTo, ease((u - 0.86) / 0.14));
  }

  const angles = [...REST];
  // Same warm-up the component does, so the test measures steady-state
  // tracking rather than the opening swoop.
  for (let i = 0; i < 600; i++) stepOSC(angles, target(0), 1 / 60);
  let unsafe = 0;
  let violations = 0;
  let minSurface = Infinity;
  let minTcpZ = Infinity;
  // Mirrors LINK_RADII in src/lib/rizon.ts.
  const LINK_RADII = [0.085, 0.075, 0.065, 0.058, 0.05, 0.045, 0.04];
  let graspErr = 0;
  const FPS = 60;
  const FRAMES = Math.round(CYCLE * 12 * FPS); // twelve different random stations

  for (let f = 0; f < FRAMES; f++) {
    const t = f / FPS;
    const goal = target(t);
    stepOSC(angles, goal, 1 / FPS);

    if (!isSafe(angles)) unsafe++;
    CHAIN.forEach((spec, i) => {
      if (angles[i] < spec.limit[0] - 1e-9 || angles[i] > spec.limit[1] + 1e-9) violations++;
    });

    const { joints, tcp } = forward(angles);
    // Clearance is surface-to-bench, and the links taper, so each joint is
    // measured against its own radius. The tool is exempt: reaching down to
    // something resting on the bench is the task.
    joints.slice(1).forEach((j, k) => {
      minSurface = Math.min(minSurface, j.p[2] - (LINK_RADII[Math.min(k + 1, LINK_RADII.length - 1)] ?? 0.05));
    });
    minTcpZ = Math.min(minTcpZ, tcp[2]);

    const u = (t % CYCLE) / CYCLE;
    if ((u >= 0.17 && u <= 0.22) || (u >= 0.80 && u <= 0.86)) {
      graspErr = Math.max(graspErr, Math.hypot(tcp[0] - goal[0], tcp[1] - goal[1], tcp[2] - goal[2]));
    }
  }

  // A guard that accepts everything would pass the loop above trivially.
  const rejectsFolded = !isSafe([0, 2.3, 0, 2.7, 0, 4.6, 0]);
  const rejectsFloor = !isSafe([0, 2.35, 0, -1.9, 0, -1.4, 0]);

  const results = [
    ['frames simulated', FRAMES, true],
    ['unsafe frames', unsafe, unsafe === 0],
    ['joint-limit violations', violations, violations === 0],
    ['lowest link surface (m)', minSurface.toFixed(4), minSurface >= 0.0199],
    ['lowest tool z (m)', minTcpZ.toFixed(4), minTcpZ >= -0.005],
    ['grasp/release error (m)', graspErr.toFixed(4), graspErr < 0.02],
    ['rejects folded pose', rejectsFolded, rejectsFolded],
    ['rejects floor crash', rejectsFloor, rejectsFloor],
  ];

  let failed = 0;
  for (const [label, value, ok] of results) {
    if (!ok) failed++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(24)} ${value}`);
  }
  console.log(failed === 0 ? '\narm safety: all checks passed' : `\narm safety: ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  rmSync(out, { recursive: true, force: true });
}
