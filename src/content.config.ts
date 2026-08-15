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
    /** The one line under your name. Keep it short. */
    tagline: z.string(),
    /** Used for <meta description> and link previews. */
    description: z.string(),
    /** Where you work now. Rendered as a badge in the hero. */
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
    /** Free text: "2026", "2024–2025". Shown right-aligned. */
    period: z.string(),
    section: z.enum(['research', 'ventures', 'earlier']),
    /** One or two sentences. This is what shows on the homepage. */
    summary: z.string(),
    /** External link, if the project has one. */
    href: z.string().optional(),
    /** Lower sorts first within a section. */
    order: z.number().default(50),
    /** Set false to hide without deleting the file. */
    published: z.boolean().default(true),
  }),
});

export const collections = { profile, projects };
