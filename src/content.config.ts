import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Everything editable on the site lives in src/content as Markdown.
 *
 * Edit a file on GitHub, commit, and Vercel rebuilds and deploys. No CMS, no
 * admin panel, no database — the repo is the source of truth.
 */

const profile = defineCollection({
  loader: glob({ pattern: 'profile.md', base: './src/content/site' }),
  schema: z.object({
    name: z.string(),
    /** Small line above the name, e.g. "Stanford · Applied Intuition". */
    eyebrow: z.string().default(''),
    /** The one line under your name. Keep it short. */
    tagline: z.string(),
    /** Shown under the tagline in the hero. */
    location: z.string().default(''),
    /** Used for <meta description> and link previews. */
    description: z.string(),
    /**
     * The run-on credential line under the name. Each entry is one clause;
     * entries with an `href` render in the accent colour as links, which is what
     * gives the line its rhythm. Keep clauses short.
     */
    credentials: z
      .array(z.object({ text: z.string(), href: z.string().url().optional() }))
      .default([]),
    /** Wordmarks in the strip under the hero. Text, not logo images. */
    affiliations: z.array(z.string()).default([]),
    /** Where you work now. */
    current: z
      .object({
        role: z.string(),
        org: z.string(),
        href: z.string().url().optional(),
      })
      .optional(),
    /** Filename of a square image in public/. Empty string renders no image. */
    portrait: z.string().default(''),
    emails: z.array(z.string().email()),
    links: z.array(z.object({ label: z.string(), href: z.string().url() })),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    /** Free text: "2026", "2024–2025". Shown with the entry. */
    period: z.string(),
    section: z.enum(['research', 'ventures', 'earlier']),
    /** One or two sentences. This is what shows in listings. */
    summary: z.string(),
    /** External link, if the project has one. */
    href: z.string().url().optional(),
    /**
     * Thumbnail path under public/. Defaults to the generated placeholder at
     * /projects/<filename>.svg — drop your own image in and point this at it.
     */
    image: z.string().default(''),
    /** Surfaced on the homepage. Everything else lives on /projects. */
    featured: z.boolean().default(false),
    /** Lower sorts first within a section. */
    order: z.number().default(50),
    /** Set false to hide without deleting the file. */
    published: z.boolean().default(true),
  }),
});

/**
 * Research notes — one file per session, named by date.
 *
 * Filename becomes the URL, so `2026-08-15-diffusion-policy.md` lands at
 * /notes/2026-08-15-diffusion-policy.
 */
const notes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    /** Sorts the index, newest first. */
    date: z.coerce.date(),
    /** One line — what you'd tell someone who asked what you read today. */
    summary: z.string().default(''),
    /** The papers this session covered. */
    papers: z
      .array(
        z.object({
          title: z.string(),
          href: z.string().url().optional(),
          authors: z.string().optional(),
        }),
      )
      .default([]),
    tags: z.array(z.string()).default([]),
    published: z.boolean().default(true),
  }),
});

export const collections = { profile, projects, notes };
