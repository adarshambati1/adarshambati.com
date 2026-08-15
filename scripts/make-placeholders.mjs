/**
 * Generates a placeholder thumbnail per project, so the layout reads as
 * finished before real images exist.
 *
 *   node scripts/make-placeholders.mjs
 *
 * Output: public/projects/<slug>.svg
 *
 * Each is deterministic from the slug — the same project always gets the same
 * image, so regenerating doesn't reshuffle the page. To replace one, drop your
 * own file in public/projects/ and point the `image:` field at it; this script
 * never overwrites a non-SVG, and skips any file you've marked as kept.
 */
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/projects/', import.meta.url));
const SRC = fileURLToPath(new URL('../src/content/projects/', import.meta.url));

const W = 1200;
const H = 750;

/** Stable 32-bit hash so a slug always maps to the same composition. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small deterministic PRNG seeded from the hash. */
function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function svg(slug) {
  const seed = hash(slug);
  const rand = rng(seed);

  // Muted, desaturated hues so the row of thumbnails reads as one family
  // rather than a bag of colours.
  const hue = seed % 360;
  const base = `hsl(${hue} 34% 92%)`;
  const mid = `hsl(${(hue + 22) % 360} 36% 78%)`;
  const ink = `hsl(${hue} 46% 30%)`;

  const parts = [];

  // Concentric arcs — reads as a field/trajectory without pretending to depict
  // anything specific.
  const cx = W * (0.28 + rand() * 0.44);
  const cy = H * (0.3 + rand() * 0.4);
  const rings = 6 + Math.floor(rand() * 4);
  for (let i = 0; i < rings; i++) {
    const r = 60 + i * (60 + rand() * 45);
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="${ink}" stroke-width="${(1 + rand() * 1.4).toFixed(2)}" opacity="${(0.16 + rand() * 0.2).toFixed(3)}"/>`,
    );
  }

  // A few straight chords for structure.
  const lines = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < lines; i++) {
    const y = H * (0.15 + rand() * 0.7);
    const x1 = W * rand() * 0.5;
    const x2 = x1 + W * (0.3 + rand() * 0.45);
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${(y + (rand() - 0.5) * 90).toFixed(1)}" stroke="${ink}" stroke-width="${(1.2 + rand() * 1.6).toFixed(2)}" opacity="${(0.2 + rand() * 0.22).toFixed(3)}"/>`,
    );
  }

  // Nodes.
  const dots = 8 + Math.floor(rand() * 8);
  for (let i = 0; i < dots; i++) {
    parts.push(
      `<circle cx="${(W * rand()).toFixed(1)}" cy="${(H * rand()).toFixed(1)}" r="${(2.5 + rand() * 5).toFixed(1)}" fill="${ink}" opacity="${(0.3 + rand() * 0.35).toFixed(3)}"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${base}"/>
      <stop offset="1" stop-color="${mid}"/>
    </linearGradient>
    <clipPath id="c"><rect width="${W}" height="${H}"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <g clip-path="url(#c)">${parts.join('')}</g>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });

const slugs = readdirSync(SRC)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''));

let written = 0;
let skipped = 0;
for (const slug of slugs) {
  // Never clobber a real image the user has added under the same name.
  const replaced = ['.png', '.jpg', '.jpeg', '.webp'].some((ext) => existsSync(`${OUT}${slug}${ext}`));
  if (replaced) {
    console.log(`skip   ${slug} (real image present)`);
    skipped++;
    continue;
  }
  writeFileSync(`${OUT}${slug}.svg`, svg(slug));
  written++;
}

console.log(`\n${written} placeholder(s) written to public/projects/${skipped ? `, ${skipped} skipped` : ''}`);
