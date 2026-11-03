import { Product, Reading, Source, dateAt, keyOf, restoreProducts } from './model';

export const HISTORY_DAYS = 90;
export const HISTORY_PER_PRODUCT = 100;
const PERIODS = [7, 30, 90] as const;
type Totals = Record<7 | 30 | 90, number | null>;
export type SnapshotMetric = { kind: 'count'; value: number } | { kind: 'npm'; end: string; totals: Totals };
export interface Snapshot { product: Product; fetchedAt: string; metric: SnapshotMetric }
export type Health = 'fresh' | 'cached' | 'outdated' | 'partial' | 'stale' | 'error' | 'empty';

export function readingHealth(reading: Reading, now = new Date()): Health {
  if (reading.error) return reading.metric ? 'stale' : 'error';
  if (!reading.metric || !reading.fetchedAt) return 'empty';
  if (now.getTime() - Date.parse(reading.fetchedAt) >= 600_000 ||
      (reading.metric.kind === 'npm' && reading.metric.end !== dateAt(now, -1))) return 'outdated';
  if (reading.metric.kind === 'npm' && reading.metric.windows.some(w => w.total === null)) return 'partial';
  return reading.cached ? 'cached' : 'fresh';
}

const validCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
}
function validDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}

/** Compact successful observations only: no tokens, remote titles, or repeated daily series. */
export class History {
  private snapshots: Snapshot[] = [];
  constructor(value: unknown, private products: Product[], private clock = () => new Date()) {
    const keys = new Set(products.map(keyOf)), now = clock().getTime();
    if (!Array.isArray(value)) return;
    // A bounded scan protects startup from oversized or malformed saved state.
    for (const raw of value.slice(-5000)) {
      const row = record(raw), metric = record(row?.metric);
      const p = restoreProducts([row?.product])[0];
      if (!row || !metric || !p || !keys.has(keyOf(p)) || typeof row.fetchedAt !== 'string') continue;
      const timestamp = Date.parse(row.fetchedAt);
      if (!Number.isFinite(timestamp) || timestamp > now || timestamp < now - HISTORY_DAYS * 86400_000) continue;
      const fetchedAt = new Date(timestamp).toISOString();
      if (p.source !== 'npm' && metric.kind === 'count' && validCount(metric.value)) {
        this.snapshots.push({ product: p, fetchedAt, metric: { kind: 'count', value: metric.value } });
      } else if (p.source === 'npm' && metric.kind === 'npm' && validDate(metric.end) && metric.end <= dateAt(new Date(timestamp), -1)) {
        const totals = record(metric.totals);
        if (totals && PERIODS.every(days => totals[days] === null || validCount(totals[days]))) {
          this.snapshots.push({ product: p, fetchedAt, metric: { kind: 'npm', end: metric.end,
            totals: { 7: totals[7] as number | null, 30: totals[30] as number | null, 90: totals[90] as number | null } } });
        }
      }
    }
    this.compact();
  }
  entries(): Snapshot[] { return this.snapshots; }
  record(readings: Reading[]): void {
    for (const reading of readings) {
      if (reading.error || reading.cached || !reading.metric || !reading.fetchedAt) continue;
      const metric: SnapshotMetric = reading.metric.kind === 'count' ? { kind: 'count', value: reading.metric.value } : {
        kind: 'npm', end: reading.metric.end, totals: {
          7: reading.metric.windows.find(w => w.days === 7)?.total ?? null,
          30: reading.metric.windows.find(w => w.days === 30)?.total ?? null,
          90: reading.metric.windows.find(w => w.days === 90)?.total ?? null
        }
      };
      this.snapshots.push({ product: reading.product, fetchedAt: reading.fetchedAt, metric });
    }
    // Reuse the saved-state validation for new observations too.
    this.snapshots = new History(this.snapshots, this.products, this.clock).entries();
  }
  private compact(): void {
    const counts = new Map<string, number>(), seen = new Set<string>();
    this.snapshots.sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    this.snapshots = this.snapshots.filter(s => {
      const key = keyOf(s.product), id = `${key}:${s.fetchedAt}`, count = counts.get(key) ?? 0;
      if (seen.has(id) || count >= HISTORY_PER_PRODUCT) return false;
      seen.add(id); counts.set(key, count + 1); return true;
    }).reverse();
  }
  clearSource(source: Source): void { this.snapshots = this.snapshots.filter(s => s.product.source !== source); }
}

/** Quote cells and neutralize formula-like text, including scoped package names. */
function csvCell(value: string | number | null): string {
  if (value === null) return '""';
  let text = String(value);
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function historyCsv(snapshots: Snapshot[]): string {
  const rows: (string | number | null)[][] = [[
    'source', 'product', 'observed_at_utc', 'metric', 'window_days', 'data_end_utc',
    'value', 'previous_observed_at_utc', 'change_since_previous_observation', 'meaning'
  ]];
  const previous = new Map<string, Snapshot>();
  for (const s of [...snapshots].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))) {
    const key = keyOf(s.product), before = previous.get(key);
    const periods = s.metric.kind === 'npm' ? PERIODS : [null];
    for (const days of periods) {
      const value = s.metric.kind === 'count' ? s.metric.value : s.metric.totals[days as 7 | 30 | 90];
      const prior = before?.metric.kind === 'count' && s.metric.kind === 'count' ? before.metric.value :
        before?.metric.kind === 'npm' && s.metric.kind === 'npm' ? before.metric.totals[days as 7 | 30 | 90] : null;
      rows.push([s.product.source, s.product.id, s.fetchedAt, s.metric.kind === 'npm' ? 'npm_downloads' :
        s.product.source === 'marketplace' ? 'cumulative_installs' : s.product.source === 'openvsx' ? 'cumulative_downloads' : 'current_comments',
      days, s.metric.kind === 'npm' ? s.metric.end : null, value, before?.fetchedAt ?? null,
      value !== null && prior !== null ? value - prior : null,
      s.metric.kind === 'npm' ? 'Rolling window total; change is not new downloads' : 'Observed count; may decrease; not unique users']);
    }
    previous.set(key, s);
  }
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
