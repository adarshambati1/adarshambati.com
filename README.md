# adarshambati.com

Personal site, plus a private local-first todo app on a subdomain. One Astro
project, one deploy, two domains.

## Editing the site

All content is Markdown in `src/content`. Edit a file on GitHub, commit, and
Vercel rebuilds and deploys. No CMS, no admin panel, no database.

```
src/content/site/profile.md      name, tagline, current role, links, intro prose
src/content/projects/*.md        one file per project
```

Markdown is only the input format — it renders to HTML. You never see `#` or `*`
on the live site.

**To add a project**, copy any file in `src/content/projects/` and edit the
frontmatter:

```yaml
---
title: Thing I built
period: '2026'
section: research # research | ventures | earlier
order: 10 # lower sorts first within its section
summary: One or two sentences. This is what shows on the homepage.
href: https://github.com/... # optional
published: true # set false to hide without deleting
---
```

Leave the body empty and the homepage links straight to `href`. Write a body and
it gets its own page at `/projects/<filename>`, with the homepage linking there
instead. That way there are no stub pages that just repeat the summary.

## Design

Tokens live in `src/styles/index.css` — colour, type scale, spacing, radii.
Components never hardcode a value; if you need one that doesn't exist, add a
token. Typeface is Hanken Grotesk, self-hosted via
`@fontsource-variable/hanken-grotesk`, so there's no request to Google Fonts.

Components are in `src/components`: `Nav`, `HeroFull`, `HeroScene`,
`Affiliations`, `Section`, `Card`, `NoteRow`, `Prose`, `LinkList`, `Footer`.

The hero is dark; the pages below it are light. Making the whole site dark means
duplicating the token block in `src/styles/index.css` — nothing else references
a raw colour.

## Running it

```bash
npm install
cp .env.example .env   # fill in, see below
npm run dev            # http://localhost:4321
npm run verify         # astro check (strictest) + build
```

`tsconfig.json` extends `astro/tsconfigs/strictest` with
`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. `npm run verify`
must report 0 errors.

## The todo app

It used to live here at `/todo`. It's now its own repo and its own deployment:
**[Kanban Time](https://github.com/adarshambati1/kanbantime)**, deployed at
`todo.adarshambati.com`

Split because it's about to grow a board, a timetable and an agent, and because
publishing a research note shouldn't redeploy an authed app — nor should a bug
in that app stop the site updating. The two share `src/styles/index.css` by
copy, which keeps them visually identical without a package for one person.

## Environment

None. The site is content and a hero animation — no database, no auth, no
secrets. `.env.example` exists only because the dev script reads a file if one
is present.

## Deploying

Vercel. Every page is prerendered, so GitHub Pages would also work now that the
app has moved out — Vercel is kept for the shared toolchain and preview deploys.

## Testing

```bash
npm run dev            # one terminal
npm test               # another
```

36 checks: rendering, content collections, the hero scenes, and PWA wiring.

`npm run verify` runs `astro check` (strictest), the build, and the arm safety
test together.

## Credits

The hero renders two things that aren't mine:

**Flexiv Rizon 4s** — meshes and kinematics from
[flexivrobotics/flexiv_description](https://github.com/flexivrobotics/flexiv_description),
Apache-2.0. Decimated and quantised by `scripts/bake-flexiv-arm.mjs`
(43,737 triangles to 3,177, 39 KB). Joint origins, axes and limits are the real
ones from `config/Rizon4s/`.

**LiDAR street scans** — four frames from [PandaSet](https://pandaset.org) by
Hesai and Scale AI, licensed **CC BY 4.0**. Sequences 019, 021, 064 and 092,
mechanical Pandar64 only, cropped to 38 m and voxel-downsampled to ~18k points
each (~125 KB per frame).

PandaSet was the only workable choice: KITTI, nuScenes and Argoverse are all
non-commercial, and this repo is public.

PandaSet is mirrored as a single 44.5 GB zip, so `scripts/fetch-pandaset-frame.mjs`
reads the archive's central directory over HTTP range requests and pulls just the
one member — about 12 MB rather than the whole thing. Then:

```bash
npm run lidar:fetch 019/00 092/20 021/40 064/10   # range-fetch (needs network)
npm run lidar:bake                                 # decimate -> public/data/
```

The fetch reads the 9 MB central directory once and pulls every requested frame
from that single pass.

The bake step needs numpy and pandas, since PandaSet frames are pickled
DataFrames. If your system Python lacks them, use a venv rather than fighting it:

```bash
python3 -m venv .venv && ./.venv/bin/pip install "numpy<2" pandas
./.venv/bin/python scripts/bake-pandaset-frame.py
```

## Hero scenes

The hero picks a scene per visit. Pin one with a query parameter:

| URL | Scene |
| --- | --- |
| `/?scene=scan` | A real PandaSet LiDAR frame |
| `/?scene=arm` | Flexiv Rizon 4s relaying a grape, FK + operational-space control |

Without the parameter it picks one at random per visit. `?frame=092-20` pins a
specific scan; the ids are in `public/data/lidar-frames.json`.

**Controls:** drag to rotate, shift-drag or shift-scroll to zoom, double-click to
reset. Plain scrolling is left alone deliberately — hijacking the wheel on a
full-viewport hero traps the reader. Both scenes hold still under
`prefers-reduced-motion`.

`npm run test:arm` drives the arm through twelve randomly placed pick-and-place
cycles and asserts it never self-collides, never drops a link surface below the
bench, and never leaves a joint limit — plus that the guard rejects two
deliberately bad poses, so a pass can't be vacuous.

The solver is operational-space control: a damped least-squares pseudo-inverse
of the position Jacobian moves the tool, and the 7-DOF arm's redundancy is
resolved in the nullspace to keep the elbow tidy and the joints off their stops.
That nullspace term is what separates this from CCD, which is greedy and takes
whichever joint angles reach the target first — hence the contorted poses.

## Known gaps

- No due dates or notes in the todo UI, though the schema and sync carry both.
- No web push wired up; the installed-PWA plumbing is in place for it.
- No rate limiting on the OAuth callback.
