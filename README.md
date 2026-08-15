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

Lives at `/todo`, and at `todo.adarshambati.com` via a middleware rewrite — same
deployment, same code. The subdomain exists so the app gets its own home-screen
identity instead of living at a path.

**Local-first.** The UI reads only from IndexedDB and never awaits the network.
Offline isn't a mode, it's sync not having run yet.

**Sync.** Every row carries a server-assigned monotonic `seq`. A client
remembers the highest it has seen and asks for everything above it — a change
token, not a timestamp cursor, so there's no dependence on device clocks for
ordering and no boundary bug when two records share a millisecond.

Clocks are still used, but only for conflict resolution and **per field**.
Checking a box on your phone while editing the same task's title on your laptop
merges cleanly; per-record last-write-wins would discard one of the two.

Deletes are tombstones. A hard delete is invisible to a device that was offline
when it happened.

```
POST /api/sync   { cursor, changes[] }  ->  { cursor, changes[] }
```

The response includes the post-merge version of the caller's own writes, so
clients converge without special-casing.

## Auth

Google OAuth with an email allowlist. No signup, no password, no user table —
exactly the addresses in `ALLOWED_EMAILS` get in, and the allowlist is
re-checked on every request, so removing one takes effect immediately rather
than at session expiry.

The point isn't hiding a todo list from a determined attacker. It's that an
unauthenticated app is an open write endpoint on the internet, and Certificate
Transparency logs get scraped within minutes of a cert issuing.

Two credentials, deliberately separate:

- **Session cookie** — browsers. Signed, `HttpOnly`, `SameSite=Lax`, one year.
  Writes additionally require a matching `Origin`, because browsers attach
  cookies to cross-site requests whether you meant it or not.
- **Bearer token** (`SHORTCUTS_TOKEN`) — iOS Shortcuts, which can't perform an
  OAuth flow. Exempt from the origin check, since non-browser clients don't send
  `Origin` at all. Separate from the session because it sits in plaintext inside
  an iCloud-synced shortcut and must be rotatable on its own.

Astro's built-in `checkOrigin` is disabled in `astro.config.mjs` because it
rejects *every* non-GET without an `Origin`, which would break Shortcuts. The
equivalent check is reimplemented in `src/middleware.ts`, applied only where
it's load-bearing.

## Siri, share sheet, and Apple Watch

A PWA can't register with Siri — App Intents is native-only. Shortcuts bridges
it by calling the API directly, so Apple Reminders is never involved.

**"What's on my list"** — Get Contents of URL → `GET /api/list?format=text` with
header `Authorization: Bearer <SHORTCUTS_TOKEN>` → Speak Text. Siri invokes any
shortcut by its name.

**"Add to my list"** — Ask for Input → `POST /api/quick-add`, same header, body
is the dictated text. Accepts raw text or `{"title": "..."}`.

Enable "receive input from share sheet" on the second one for share-to-todo.
Shortcuts runs on watchOS, so both work from your wrist.

## PWA install

Manifests are per-page, so the site serves two: `/` installs the site, `/todo`
installs an app that cold-launches into the list. Install from the page you want
the icon to open — landing on a homepage and navigating every time is enough
friction to kill the habit.

iOS web push requires the PWA be added to the home screen; it does not work from
a Safari tab.

## Environment

See `.env.example`. In production these are set in the Vercel dashboard, never
in a file.

| Variable | What it's for |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client, from Google Cloud Console |
| `ALLOWED_EMAILS` | Comma-separated allowlist |
| `AUTH_SECRET` | Signs the session cookie (`openssl rand -hex 32`) |
| `SHORTCUTS_TOKEN` | Bearer token for Siri (`openssl rand -hex 32`) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Blank locally — falls back to a SQLite file in `data/` |

Authorised OAuth redirect URIs must include
`http://localhost:4321/api/auth/callback` and
`https://todo.adarshambati.com/api/auth/callback`.

## Deploying

Vercel, not GitHub Pages — Pages is static-only and can't run the sync API or an
OAuth callback.

Storage is libSQL rather than a local SQLite file because Vercel's filesystem is
ephemeral. The same client speaks to a local file in development and Turso in
production, so there's one code path.

## Testing

```bash
npm run dev            # one terminal
bash scripts/smoke.sh  # another
```

64 checks: public rendering, route gating, the OAuth handshake, the sync
protocol, field-level merge, tombstones, the Siri endpoints, and PWA wiring. The
Google round-trip itself isn't covered — it needs a real browser and account.

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
| `/?scene=arm` | Flexiv Rizon 4s picking a grape, FK + CCD IK |

Without the parameter it picks one at random per visit. `?frame=092-20` pins a
specific scan; the ids are in `public/data/lidar-frames.json`.

**Controls:** drag to rotate, shift-drag or shift-scroll to zoom, double-click to
reset. Plain scrolling is left alone deliberately — hijacking the wheel on a
full-viewport hero traps the reader. Both scenes hold still under
`prefers-reduced-motion`.

`npm run test:arm` drives the arm through four full pick cycles and asserts it
never self-collides, never drops a link below the bench, and never leaves a
joint limit — plus that the guard rejects two deliberately bad poses, so a pass
can't be vacuous.

## Known gaps

- No due dates or notes in the todo UI, though the schema and sync carry both.
- No web push wired up; the installed-PWA plumbing is in place for it.
- No rate limiting on the OAuth callback.
