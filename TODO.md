# TODO

Where things stand and what's left. Everything below is deliberately deferred,
not forgotten.

## Blocked on your accounts

These need sign-ins, so they can't be done for you.

- [ ] **Vercel** — sign in with GitHub, import this repo. Astro is auto-detected.
      The site needs no environment variables at all.
- [ ] **DNS** — point `adarshambati.com` at this project. Currently on Wix
      (`ns12.wixdns.net`), so this is the step that takes the existing site
      down; do it when you're happy with the new one.

## Todo app

Moved to its own repo: **[kanbantime](https://github.com/adarshambati1/kanbantime)**, deployed at `todo.adarshambati.com`. Its board, timetable and agent
work is tracked in that repo's README, not here.

Its deployment is separate and is where the Google OAuth client and the Turso
database are needed — this site needs neither.

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
