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

Moved to its own repo: **[kanbantime](https://github.com/adarshambati1/kanbantime)**, deployed at `todo.adarshambati.com`. Board, timetable, and agent
are all built (see its README) — what's left there:

- [ ] **Deploy it**: Vercel project, Google OAuth client, Turso database. Same
      kind of account sign-in blocker as this site's Vercel/DNS items above.
- [ ] **OpenRouter key** for the agent (`OPENROUTER_API_KEY`). Get one at
      openrouter.ai/keys. The previous one was pasted into a chat by accident
      and was revoked — this needs a fresh one. Without it the agent stays
      disabled (the endpoint reports 503, the UI doesn't render the entry
      point) rather than breaking.
- [ ] Once a key exists, the actual OpenRouter round trip has never been
      tested live — everything else about the agent (tool execution, the
      propose/confirm flow, the client UI) was verified by mocking that one
      call in a real browser.
- [ ] Web push for due reminders — plumbing exists, feature doesn't.
- [ ] Rate limiting on the OAuth callback (the agent endpoint has its own
      limiter already; the callback doesn't).

## Content

- [ ] **Check the credential line** in `src/content/site/profile.md`. I left out
      anything I couldn't verify; the Applied Intuition year is a guess.
- [ ] **Suturebot hardware disagrees with itself** — the README says Flexiv
      Rizon 4s, the GitHub description says Franka FR3. The site follows the
      README. Fix whichever is wrong.
- [ ] **Publish a first note and a first thought.** Notes now live in topic
      folders — copy `src/content/notes/example-topic/2026-08-15-template.md`
      into a new or existing topic folder, rename it to the date, set
      `published: true`. Thoughts are flat — same idea, from
      `src/content/thoughts/2026-08-15-template.md`. Both sections stay
      hidden on the homepage until there's something published.
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
