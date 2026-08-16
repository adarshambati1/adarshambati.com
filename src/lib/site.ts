import { getCollection, type CollectionEntry } from 'astro:content';
import type { NavAction } from '../components/Nav.astro';

/**
 * Shared content loading, so pages stay presentational.
 *
 * Every function here returns already-filtered, already-sorted data — a page
 * should never have to remember that `published: false` exists.
 */

export type Project = CollectionEntry<'projects'>;
export type Note = CollectionEntry<'notes'>;
export type Thought = CollectionEntry<'thoughts'>;
export type Profile = CollectionEntry<'profile'>;

export type Scale = Project['data']['scale'];
export type Kind = Project['data']['kind'];

export const KIND_LABEL: Readonly<Record<Kind, string>> = {
  research: 'Research',
  company: 'Company',
  build: 'Build',
};

/** Research first, then companies, then everything else. */
const KIND_RANK: readonly Kind[] = ['research', 'company', 'build'];
const kindRank = (k: Kind): number => KIND_RANK.indexOf(k);

export async function getProfile(): Promise<Profile> {
  const [profile] = await getCollection('profile');
  if (!profile) throw new Error('Missing src/content/site/profile.md');
  return profile;
}

export async function getProjects(): Promise<Project[]> {
  const all = await getCollection('projects');
  return all
    .filter((p) => p.data.published)
    .sort(
      (a, b) =>
        kindRank(a.data.kind) - kindRank(b.data.kind) ||
        a.data.order - b.data.order ||
        a.data.title.localeCompare(b.data.title),
    );
}

/** Newest first. */
export async function getNotes(): Promise<Note[]> {
  const all = await getCollection('notes');
  return all
    .filter((n) => n.data.published)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export interface NoteTopic {
  /** Folder name as it appears on disk — stable, used for keys/links. */
  slug: string;
  /** Humanized for display: "diffusion-policy" -> "Diffusion Policy". */
  label: string;
  notes: Note[];
}

/**
 * Notes live in topic folders (`src/content/notes/<topic>/*.md`), so the
 * index groups by folder rather than showing one long chronological feed.
 * A note directly in `content/notes/` with no folder falls back to a single
 * "General" group, so nothing disappears if the convention isn't followed.
 */
export function groupNotesByTopic(notes: readonly Note[]): NoteTopic[] {
  const groups = new Map<string, Note[]>();
  for (const note of notes) {
    const slug = note.id.includes('/') ? note.id.split('/')[0]! : 'general';
    const list = groups.get(slug);
    if (list) list.push(note);
    else groups.set(slug, [note]);
  }

  const humanize = (slug: string): string =>
    slug === 'general'
      ? 'General'
      : slug
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

  return [...groups.entries()]
    .map(([slug, list]) => ({ slug, label: humanize(slug), notes: list }))
    .sort((a, b) => b.notes[0]!.data.date.getTime() - a.notes[0]!.data.date.getTime());
}

/** Newest first. */
export async function getThoughts(): Promise<Thought[]> {
  const all = await getCollection('thoughts');
  return all
    .filter((t) => t.data.published)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** Big projects, in display order. */
export const bigProjects = (all: readonly Project[]): Project[] =>
  all.filter((p) => p.data.scale === 'big');

/** Everything else — the compact list. */
export const smallProjects = (all: readonly Project[]): Project[] =>
  all.filter((p) => p.data.scale === 'small');

/**
 * Only big projects earn a page of their own, and only once they have a body.
 * A stub page repeating a one-line summary helps nobody.
 */
export const hasOwnPage = (p: Project): boolean =>
  p.data.scale === 'big' && Boolean(p.body?.trim());

/** Where a project's title should link: its own page, or straight out. */
export function projectTarget(p: Project): { href: string | undefined; internal: boolean } {
  if (hasOwnPage(p)) return { href: `/projects/${p.id}`, internal: true };
  return { href: p.data.href, internal: false };
}

/** Explicit image if set, else the generated placeholder for that slug. */
export function projectImage(p: Project): string {
  return p.data.image || `/projects/${p.id}.svg`;
}

/**
 * The homepage selection, ranked across kinds rather than within one.
 *
 * `order` is scoped to a kind, so sorting featured entries by it alone lets a
 * company tie with research and win on an alphabetical tiebreak — which once
 * put Candor above Suturebot on a page about robotics.
 */
export async function getFeatured(limit = 3): Promise<Project[]> {
  const all = await getProjects();
  return all.filter((p) => p.data.featured).slice(0, limit);
}

/** Icon buttons in the hero. Falls back gracefully if a link is absent. */
export function heroLinks(
  profile: Profile,
): readonly { label: string; href: string; icon: 'linkedin' | 'github' | 'email' }[] {
  const out: { label: string; href: string; icon: 'linkedin' | 'github' | 'email' }[] = [];
  for (const link of profile.data.links) {
    if (/linkedin/i.test(link.label)) out.push({ ...link, icon: 'linkedin' });
    else if (/github/i.test(link.label)) out.push({ ...link, icon: 'github' });
  }
  const email = profile.data.emails[0];
  if (email) out.push({ label: 'Email', href: `mailto:${email}`, icon: 'email' });
  return out;
}

/** The contact pills in the header. */
export function navActions(profile: Profile): readonly NavAction[] {
  const linkedin = profile.data.links.find((l) => /linkedin/i.test(l.label));
  const email = profile.data.emails[0];

  const actions: NavAction[] = [];
  if (linkedin) actions.push({ label: 'LinkedIn', href: linkedin.href });
  if (email) actions.push({ label: 'Email', href: `mailto:${email}`, primary: true });
  return actions;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const formatDate = (date: Date): string => DATE_FORMAT.format(date);
