# TODO

Where things stand and what's left. Everything below is deliberately deferred,
not forgotten.

## Blocked on your accounts

These can't be done for you — they need sign-ins, and a couple involve
credentials that shouldn't pass through anyone else's hands.

- [ ] **Vercel** — sign in with GitHub, import this repo. Astro is auto-detected.
- [ ] **Google OAuth** — Cloud Console → Credentials → Web application.
      Authorised redirect URIs:
      `http://localhost:4321/api/auth/callback` and
      `https://todo.adarshambati.com/api/auth/callback`
- [ ] **Turso** — create a database, then `turso db show` and
      `turso db tokens create` for the two env vars.
- [ ] **DNS** — point `adarshambati.com` and `todo.adarshambati.com` at Vercel.
      Currently on Wix (`ns12.wixdns.net`). Do this last: it takes the existing
      site down.
- [ ] Paste all env vars into the Vercel dashboard. See `.env.example`.

## Todo app — next build

The app works (local-first sync, OAuth, Siri endpoints). The next chunk is the
board, and it's a genuine feature, not a tweak.

- [ ] **Jira-style board** — columns with a backlog through to "doing today".
      Needs a `column` and `rank` on each todo, which touches the schema, the
      sync protocol, and both merge functions.
- [ ] **Timetable view** — takes the last column and lays it on a draggable,
      sortable timetable from a start time. Needs `duration` and `startAt`.
- [ ] **Natural-language agent** — add tasks, move things between columns,
      reorder the timetable, change the start time. Needs tool definitions over
      the board model and a fresh OpenRouter key (the old one was revoked).
- [ ] Web push for due reminders. The installed-PWA plumbing is already there.
- [ ] Rate limiting on the OAuth callback.

## Content

- [ ] **Check the credential line** in `src/content/site/profile.md`. I left out
      anything I couldn't verify; the Applied Intuition year is a guess.
- [ ] **Suturebot hardware disagrees with itself** — the README says Flexiv
      Rizon 4s, the GitHub description says Franka FR3. The site follows the
      README. Fix whichever is wrong.
- [ ] **Publish a first research note.** Copy
      `src/content/notes/2026-08-15-template.md`, rename it to the date, set
      `published: true`. Until then the notes section is hidden on the homepage
      by design.
- [ ] **Real project images.** `public/projects/*.svg` are generated
      placeholders. Drop a real image in with the same slug and the generator
      skips it. A Suturebot rig photo would do more than anything procedural.
- [ ] Optional: a portrait. Set `portrait:` in `profile.md` and it replaces the
      hero scene.

## Known gaps

- No due dates or notes in the todo UI, though the schema and sync carry both.
- The site is light; only the hero is dark. Making it all dark means duplicating
  the token block in `src/styles/index.css` — nothing else references a raw
  colour.
- Your system Python had numpy and pandas installed for x86_64 on an arm64
  machine. Both are fixed, but ~40 other packages are still Intel-only —
  `torch`, `scipy`, `cv2`, `spacy` among them. They only break under arm64
  Python, so if your workflows run fine, leave them.
