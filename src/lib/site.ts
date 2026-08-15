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
export type Profile = CollectionEntry<'profile'>;

export type SectionKey = Project['data']['section'];

export interface SectionSpec {
  readonly key: SectionKey;
  readonly id: string;
  readonly title: string;
  readonly note?: string;
}

export const SECTIONS: readonly SectionSpec[] = [
  { key: 'research', id: 'research', title: 'Research' },
  { key: 'ventures', id: 'companies', title: 'Companies' },
  { key: 'earlier', id: 'earlier', title: 'Earlier', note: 'Work from before the robotics turn.' },
];

export async function getProfile(): Promise<Profile> {
  const [profile] = await getCollection('profile');
  if (!profile) throw new Error('Missing src/content/site/profile.md');
  return profile;
}

export async function getProjects(): Promise<Project[]> {
  const all = await getCollection('projects');
  return all
    .filter((p) => p.data.published)
    .sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title));
}

/** Newest first. */
export async function getNotes(): Promise<Note[]> {
  const all = await getCollection('notes');
  return all
    .filter((n) => n.data.published)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/**
 * Where a project's title should link.
 *
 * A written-up project gets its own page; one without a body links straight
 * out, so there are no stub pages that just repeat the summary.
 */
export function projectTarget(p: Project): { href: string | undefined; internal: boolean } {
  if (p.body?.trim()) return { href: `/projects/${p.id}`, internal: true };
  return { href: p.data.href, internal: false };
}

/** Explicit image if set, else the generated placeholder for that slug. */
export function projectImage(p: Project): string {
  return p.data.image || `/projects/${p.id}.svg`;
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
