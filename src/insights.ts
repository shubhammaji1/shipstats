import { randomUUID } from 'node:crypto';
import { Product, Reading, dateAt, keyOf } from './model';
import { Snapshot, readingHealth } from './history';

export interface ProductGroup { id: string; name: string; keys: string[] }
export interface ReleaseMarker { id: string; key: string; date: string; label: string; notes?: string }
export interface Insights { groups: ProductGroup[]; markers: ReleaseMarker[] }
export interface DateRange { start: string; end: string }
export interface ComparisonRequest { target: string; a: DateRange; b: DateRange }
export interface PeriodValue {
  value: number | null; coverage: string; firstAt?: string; lastAt?: string;
}
export interface ComparisonRow {
  product: Product; metric: string; a: PeriodValue; b: PeriodValue;
  difference: number | null; percent: number | null;
}
export interface Comparison {
  request: ComparisonRequest; targetName: string; computedAt: string;
  rows: ComparisonRow[]; npmTotals?: { a: number | null; b: number | null; products: number };
  notes: string[];
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} must be 1-${max} characters, without control characters.`);
  }
  return value.trim();
}
export function utcDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Enter a valid UTC date (YYYY-MM-DD).');
  return value;
}
const validId = (v: unknown, prefix: string): v is string => typeof v === 'string' && v.length <= 64 && new RegExp(`^${prefix}_[a-z0-9-]+$`).test(v);
function releaseNotes(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error('Release notes must be at most 500 characters, without control characters.');
  return value.trim() || undefined;
}
function members(value: unknown, products: Product[]): string[] {
  const allowed = new Set(products.map(keyOf));
  if (!Array.isArray(value) || value.length > 50 || value.some(k => typeof k !== 'string' || !allowed.has(k))) {
    throw new Error('Group members must be currently tracked products (up to 50).');
  }
  return [...new Set(value as string[])];
}
export function saveGroup(insights: Insights, value: unknown, products: Product[]): Insights {
  const v = obj(value);
  if (!v) throw new Error('Invalid product group.');
  const name = text(v.name, 'Group name', 60), keys = members(v.keys, products);
  const existing = v.id === undefined ? undefined : insights.groups.find(g => g.id === v.id);
  if (v.id !== undefined && !existing) throw new Error('Product group no longer exists.');
  if (insights.groups.some(g => g.id !== existing?.id && g.name.toLowerCase() === name.toLowerCase())) throw new Error('Choose a unique group name.');
  if (!existing && insights.groups.length >= 20) throw new Error('Keep up to 20 product groups.');
  const group = { id: existing?.id ?? `g_${randomUUID()}`, name, keys };
  return { ...insights, groups: [...insights.groups.filter(g => g.id !== group.id), group] };
}
export function saveMarker(insights: Insights, value: unknown, products: Product[], now = new Date()): Insights {
  const v = obj(value);
  if (!v || typeof v.key !== 'string' || !products.some(p => keyOf(p) === v.key)) throw new Error('Choose a tracked product for the release marker.');
  const label = text(v.label, 'Release label', 80), date = utcDate(v.date);
  if (date > dateAt(now, 0)) throw new Error('Release dates cannot be in the future.');
  const existing = v.id === undefined ? undefined : insights.markers.find(m => m.id === v.id);
  if (v.id !== undefined && !existing) throw new Error('Release marker no longer exists.');
  if (!existing && insights.markers.length >= 200) throw new Error('Keep up to 200 release markers.');
  if (insights.markers.some(m => m.id !== existing?.id && m.key === v.key && m.date === date && m.label === label)) throw new Error('This release marker already exists.');
  const notes = releaseNotes(v.notes === undefined ? existing?.notes : v.notes);
  const marker = { id: existing?.id ?? `r_${randomUUID()}`, key: v.key, date, label, ...(notes ? { notes } : {}) };
  return { ...insights, markers: [...insights.markers.filter(m => m.id !== marker.id), marker].sort((a, b) => a.date.localeCompare(b.date)) };
}
export function deleteInsight(insights: Insights, kind: 'group' | 'marker', id: unknown): Insights {
  if (kind === 'group') {
    if (!insights.groups.some(g => g.id === id)) throw new Error('Product group no longer exists.');
    return { ...insights, groups: insights.groups.filter(g => g.id !== id) };
  }
  if (!insights.markers.some(m => m.id === id)) throw new Error('Release marker no longer exists.');
  return { ...insights, markers: insights.markers.filter(m => m.id !== id) };
}
export function restoreInsights(value: unknown, products: Product[], now = new Date()): Insights {
  const v = obj(value), allowed = new Set(products.map(keyOf));
  const result: Insights = { groups: [], markers: [] };
  if (Array.isArray(v?.groups)) for (const raw of v.groups.slice(0, 100)) {
    const g = obj(raw);
    if (!g || !validId(g.id, 'g') || !Array.isArray(g.keys) || result.groups.some(x => x.id === g.id)) continue;
    try {
      const name = text(g.name, 'Group name', 60);
      const keys = [...new Set(g.keys.slice(0, 500).filter((k): k is string => typeof k === 'string' && allowed.has(k)))].slice(0, 50);
      if (!result.groups.some(x => x.name.toLowerCase() === name.toLowerCase()) && result.groups.length < 20) result.groups.push({ id: g.id, name, keys });
    } catch { /* Ignore invalid saved metadata. */ }
  }
  if (Array.isArray(v?.markers)) for (const raw of v.markers.slice(-1000)) {
    const m = obj(raw);
    if (!m || !validId(m.id, 'r') || typeof m.key !== 'string' || !allowed.has(m.key) || result.markers.some(x => x.id === m.id)) continue;
    try {
      const label = text(m.label, 'Release label', 80), date = utcDate(m.date);
      if (date <= dateAt(now, 0) && result.markers.length < 200 && !result.markers.some(x => x.key === m.key && x.label === label && x.date === date)) {
        let notes: string | undefined;
        try { notes = releaseNotes(m.notes); } catch { /* Keep the valid marker if its optional notes are corrupt. */ }
        result.markers.push({ id: m.id, key: m.key, label, date, ...(notes ? { notes } : {}) });
      }
    } catch { /* Removed products, duplicates and invalid dates are discarded. */ }
  }
  result.markers.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
export function targetProducts(target: string, products: Product[], groups: ProductGroup[]): { name: string; products: Product[] } {
  if (target === 'all') return { name: 'All tracked products', products };
  if (target.startsWith('group:')) {
    const g = groups.find(g => g.id === target.slice(6));
    if (g) return { name: g.name, products: products.filter(p => g.keys.includes(keyOf(p))) };
  } else if (target.startsWith('product:')) {
    const p = products.find(p => keyOf(p) === target.slice(8));
    if (p) return { name: p.id, products: [p] };
  }
  throw new Error('Comparison target no longer exists.');
}
function range(value: unknown, now: Date): DateRange {
  const v = obj(value), start = utcDate(v?.start), end = utcDate(v?.end);
  if (start > end) throw new Error('Range start must be on or before its end.');
  if (start < dateAt(now, -180) || end > dateAt(now, -1)) throw new Error('Choose completed UTC days within the last 180 days.');
  return { start, end };
}
const daysIn = (r: DateRange): number => Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86400_000) + 1;
function periodValue(product: Product, r: DateRange, reading: Reading | undefined, snapshots: Snapshot[], now: Date): PeriodValue {
  if (product.source === 'npm') {
    const totalDays = daysIn(r);
    if (!reading || reading.error || readingHealth(reading, now) === 'outdated' || reading.metric?.kind !== 'npm') return { value: null, coverage: `0/${totalDays} days; refresh source data` };
    const days = new Map(reading.metric.daily.map(d => [d.day, d.downloads]));
    let count = 0, sum = 0;
    for (let i = 0; i < totalDays; i++) {
      const day = dateAt(new Date(r.start), i), value = days.get(day);
      if (value !== undefined) { count++; sum += value; }
    }
    return { value: count === totalDays && Number.isSafeInteger(sum) ? sum : null, coverage: `${count}/${totalDays} complete days` };
  }
  const samples = snapshots.filter(s => keyOf(s.product) === keyOf(product) && s.metric.kind === 'count' && s.fetchedAt.slice(0, 10) >= r.start && s.fetchedAt.slice(0, 10) <= r.end)
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
  const first = samples[0], last = samples.at(-1);
  return { value: first && last && first !== last && first.metric.kind === 'count' && last.metric.kind === 'count' ? last.metric.value - first.metric.value : null,
    coverage: `${samples.length} saved observations${samples.length < 2 ? '; need at least two' : '; gaps not estimated'}`,
    firstAt: first?.fetchedAt, lastAt: last?.fetchedAt };
}
export function compare(value: unknown, products: Product[], readings: Reading[], snapshots: Snapshot[], groups: ProductGroup[], now = new Date()): Comparison {
  const v = obj(value);
  if (!v || typeof v.target !== 'string') throw new Error('Invalid comparison request.');
  const request = { target: v.target, a: range(v.a, now), b: range(v.b, now) };
  const target = targetProducts(request.target, products, groups);
  if (!target.products.length) throw new Error('Choose a target with tracked products.');
  const rows = target.products.map(product => {
    const reading = readings.find(r => keyOf(r.product) === keyOf(product));
    const a = periodValue(product, request.a, reading, snapshots, now), b = periodValue(product, request.b, reading, snapshots, now);
    const rawDifference = a.value !== null && b.value !== null ? a.value - b.value : null;
    const difference = rawDifference !== null && Number.isSafeInteger(rawDifference) ? rawDifference : null;
    return { product, metric: product.source === 'npm' ? 'Daily npm downloads' : product.source === 'marketplace' ? 'Observed install change' : product.source === 'openvsx' ? 'Observed download-count change' : 'Observed comment-count change',
      a, b, difference, percent: difference !== null && b.value !== null && b.value > 0 ? difference / b.value * 100 : null };
  });
  const npm = rows.filter(r => r.product.source === 'npm');
  const sum = (period: 'a' | 'b'): number | null => {
    if (!npm.every(row => row[period].value !== null)) return null;
    const total = npm.reduce((n, row) => n + row[period].value!, 0);
    return Number.isSafeInteger(total) ? total : null;
  };
  const notes = ['npm totals require every selected npm package and day to be available. Other source metrics stay separate.',
    'Count changes cover the first and last saved observations inside each range, not its exact boundaries. No observations are backfilled.',
    'Percent change is unavailable when the baseline is zero or negative. Release markers show timing, not causation.'];
  if (daysIn(request.a) !== daysIn(request.b)) notes.push('These ranges have different lengths. Values are raw totals/observed changes, not normalized daily rates.');
  if (request.a.start <= request.b.end && request.b.start <= request.a.end) notes.push('The selected ranges overlap.');
  return { request, targetName: target.name, computedAt: now.toISOString(), rows,
    npmTotals: npm.length ? { a: sum('a'), b: sum('b'), products: npm.length } : undefined, notes };
}
