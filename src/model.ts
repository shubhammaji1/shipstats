export type Source = 'npm' | 'marketplace' | 'openvsx' | 'reddit';
export interface Product { source: Source; id: string }
export interface Day { day: string; downloads: number }
export interface WindowMetric { days: 7 | 30 | 90; total: number | null; previous: number | null; change: number | null }
export interface NpmMetric { kind: 'npm'; daily: Day[]; windows: WindowMetric[]; start: string; end: string }
export interface CountMetric { kind: 'count'; label: string; value: number; title?: string }
export interface Reading { product: Product; metric?: NpmMetric | CountMetric; fetchedAt?: string; error?: string; stale?: boolean }
export interface Candidate { name: string; description: string }
export interface Discovery { packages: Candidate[]; note: string }
export const keyOf = (p: Product): string => `${p.source}:${p.id}`;
export const errorMessage = (e: unknown): string => e instanceof Error ? e.message : 'Unexpected error. Please retry.';

export function selectedPackages(existing: Product[], candidates: string[], names: string[]): Product[] {
  const available = new Set(candidates);
  if (names.some(name => !available.has(name))) throw new Error('Selection is outside the discovered package list.');
  const keep = existing.filter(p => p.source !== 'npm' || !available.has(p.id));
  const result = [...new Map([...keep, ...names.map(name => product('npm', name))].map(p => [keyOf(p), p])).values()];
  if (result.length > 50) throw new Error('Track up to 50 products. Remove one before adding another.');
  return result;
}

export function npmName(input: string): string {
  const name = input.trim();
  if (name.length > 214 || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error('Enter a lowercase npm package name, e.g. react or @scope/package.');
  }
  return name;
}
export function discoveryIdentity(input: string, scope: boolean): string {
  const value = input.trim().replace(scope ? /^@/ : /$^/, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(value)) throw new Error('Enter a valid npm username or scope, without spaces or slashes.');
  return value;
}
export function extensionId(input: string): string {
  const id = input.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/.test(id) || id.length > 214) {
    throw new Error('Enter publisher.extension, e.g. redhat.vscode-yaml.');
  }
  return id;
}
export function redditId(input: string): string {
  let id = input.trim();
  if (id.startsWith('https://')) {
    const url = new URL(id);
    if (!['reddit.com', 'www.reddit.com', 'old.reddit.com', 'redd.it'].includes(url.hostname)) throw new Error('Use a reddit.com post URL or post ID.');
    id = url.hostname === 'redd.it' ? url.pathname.split('/')[1] ?? '' : url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1] ?? '';
  }
  id = id.replace(/^t3_/, '').toLowerCase();
  if (!/^[a-z0-9]{3,12}$/.test(id)) throw new Error('Enter a Reddit post ID or full https://www.reddit.com/r/.../comments/... URL.');
  return id;
}
export function product(source: Source, input: string): Product {
  return { source, id: source === 'npm' ? npmName(input) : source === 'reddit' ? redditId(input) : extensionId(input) };
}
export function restoreProducts(value: unknown): Product[] {
  if (!Array.isArray(value)) return [];
  const result = new Map<string, Product>();
  for (const item of value) {
    try {
      if (!item || !['npm', 'marketplace', 'openvsx', 'reddit'].includes(item.source) || typeof item.id !== 'string') continue;
      const p = product(item.source, item.id); result.set(keyOf(p), p);
    } catch { /* Ignore invalid or obsolete saved records. */ }
    if (result.size === 50) break;
  }
  return [...result.values()];
}
export function dateAt(date: Date, offset: number): string {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
}
export function windows(daily: Day[], now: Date): WindowMetric[] {
  const counts = new Map(daily.map(d => [d.day, d.downloads]));
  const sum = (first: number, last: number): number | null => {
    let total = 0;
    for (let offset = first; offset <= last; offset++) {
      const n = counts.get(dateAt(now, offset));
      if (n === undefined) return null;
      total += n;
    }
    return total;
  };
  return ([7, 30, 90] as const).map(days => {
    const total = sum(-days, -1), previous = sum(-2 * days, -days - 1);
    return { days, total, previous, change: total !== null && previous !== null && previous > 0 ? (total - previous) / previous * 100 : null };
  });
}
export function sourceUrl(p: Product): string {
  switch (p.source) {
    case 'npm': return `https://www.npmjs.com/package/${p.id}`;
    case 'marketplace': return `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(p.id)}`;
    case 'openvsx': return `https://open-vsx.org/extension/${p.id.replace('.', '/')}`;
    case 'reddit': return `https://www.reddit.com/comments/${p.id}/`;
  }
}
