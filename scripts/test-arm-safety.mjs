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

  const { forward, solveIK, isSafe, CHAIN } = await import(pathToFileURL(compiled).href);

  const GRAPE_R = 0.028;
  const SPOTS = [
    [0.5, 0.16, GRAPE_R],
    [0.42, -0.26, GRAPE_R],
    [0.3, 0.34, GRAPE_R],
    [0.54, -0.05, GRAPE_R],
  ];
  const CYCLE = 7.6;
  const REST = [0, 0.5, 0, 1.2, 0, 0.9, 0];
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

  // Mirrors armScene() in src/components/HeroScene.astro.
  function target(t) {
    const u = (t % CYCLE) / CYCLE;
    const spot = SPOTS[Math.floor(t / CYCLE) % SPOTS.length];
    const drop = [0.16, -0.46, GRAPE_R];
    const home = [0.34, 0.02, 0.46];
    const above = [spot[0], spot[1], spot[2] + 0.17];
    if (u < 0.26) return mix(home, above, ease(u / 0.26));
    if (u < 0.4) return mix(above, spot, ease((u - 0.26) / 0.14));
    if (u < 0.48) return spot;
    if (u < 0.68) return mix(spot, above, ease((u - 0.48) / 0.2));
    if (u < 0.86) return mix(above, [drop[0], drop[1], drop[2] + 0.02], ease((u - 0.68) / 0.18));
    return mix([drop[0], drop[1], drop[2] + 0.02], home, ease((u - 0.86) / 0.14));
  }

  const angles = [...REST];
  let unsafe = 0;
  let violations = 0;
  let minZ = Infinity;
  let graspErr = 0;
  const FPS = 60;
  const FRAMES = Math.round(CYCLE * 4 * FPS);

  for (let f = 0; f < FRAMES; f++) {
    const t = f / FPS;
    const goal = target(t);
    solveIK(angles, goal, 3);

    if (!isSafe(angles)) unsafe++;
    CHAIN.forEach((spec, i) => {
      if (angles[i] < spec.limit[0] - 1e-9 || angles[i] > spec.limit[1] + 1e-9) violations++;
    });

    const { joints, tcp } = forward(angles);
    for (const j of joints.slice(1)) minZ = Math.min(minZ, j.p[2]);
    minZ = Math.min(minZ, tcp[2]);

    const u = (t % CYCLE) / CYCLE;
    if (u >= 0.4 && u <= 0.68) {
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
    ['lowest joint z (m)', minZ.toFixed(4), minZ >= 0.0349],
    ['grasp-phase error (m)', graspErr.toFixed(4), graspErr < 0.02],
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
