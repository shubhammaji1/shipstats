import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, Snapshot, historyCsv, readingHealth } from '../src/history';
import { Analytics } from '../src/service';
import { Providers } from '../src/providers';
import { Product, Reading } from '../src/model';

const now = new Date('2026-11-02T12:00:00.000Z');
const clock = () => now;
const p: Product = { source: 'openvsx', id: 'pub.ext' };
const sample = (value: number, time = now.toISOString(), product = p): Snapshot => ({ product, fetchedAt: time, metric: { kind: 'count', value } });
const reading = (value: number, time = now.toISOString()): Reading => ({ product: p, fetchedAt: time, metric: { kind: 'count', value, label: 'Downloads' } });

test('history survives serialization, preserves zero and negative changes, deduplicates fetches, and excludes cache/failures', () => {
  const history = new History([], [p], clock);
  history.record([reading(4, '2026-11-01T12:00:00.000Z'), reading(0)]);
  history.record([reading(0), { ...reading(9), cached: true }, { ...reading(99), stale: true, error: 'offline' }]);
  const restored = new History(JSON.parse(JSON.stringify(history.entries())), [p], clock);
  assert.deepEqual(restored.entries().map(s => s.metric.kind === 'count' && s.metric.value), [4, 0]);
  const csv = historyCsv(restored.entries());
  assert.match(csv, /"0","2026-11-01T12:00:00.000Z","-4"/);
  assert.doesNotMatch(JSON.stringify(restored.entries()), /Downloads|offline|cached/);
});

test('history bounds retention and records per product, rejects malformed records and removes untracked or cleared sources', () => {
  const many = Array.from({ length: 150 }, (_, i) => sample(i, new Date(now.getTime() - i * 1000).toISOString()));
  const npm: Product = { source: 'npm', id: 'react' };
  const invalid = [null, {}, sample(-1), sample(NaN), sample(3, 'invalid'), sample(3, '2030-01-01'),
    sample(3, '2020-01-01'), sample(3, now.toISOString(), npm),
    { ...sample(1), product: { source: 'unexpected', id: 'x' } }];
  const history = new History([...many.reverse(), ...invalid], [p, npm], clock);
  assert.equal(history.entries().length, 100);
  assert.equal(history.entries().at(-1)?.metric.kind, 'count');
  assert.equal(new History(history.entries(), [], clock).entries().length, 0);
  history.clearSource('openvsx'); assert.equal(history.entries().length, 0);
});

test('npm snapshots keep missing windows unavailable and export rolling-window changes with clear semantics', () => {
  const product: Product = { source: 'npm', id: '@scope/package' };
  const first: Snapshot = { product, fetchedAt: '2026-11-01T12:00:00.000Z', metric: { kind: 'npm', end: '2026-10-31', totals: { 7: 10, 30: null, 90: 100 } } };
  const second: Snapshot = { product, fetchedAt: now.toISOString(), metric: { kind: 'npm', end: '2026-11-01', totals: { 7: 7, 30: 80, 90: null } } };
  const malformed = { ...second, metric: { kind: 'npm', end: '2026-02-30', totals: { 7: 7, 30: 80, 90: null } } };
  const history = new History([second, first, malformed], [product], clock);
  assert.equal(history.entries().length, 2);
  const csv = historyCsv(history.entries());
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(csv.trim().split('\r\n').length, 7); // header plus 3 windows per observation
  assert.match(csv, /"'@scope\/package"/); // safe to open in spreadsheets
  assert.match(csv, /"7","2026-11-01","7","2026-11-01T12:00:00.000Z","-3"/);
  assert.match(csv, /"30","2026-11-01","80","2026-11-01T12:00:00.000Z",""/);
  assert.match(csv, /Rolling window total; change is not new downloads/);
  assert.equal(historyCsv([]).trim().split('\r\n').length, 1);
});

test('CSV quotes embedded delimiters and neutralizes formula-like text', () => {
  const unsafe = sample(1, now.toISOString(), { source: 'openvsx', id: ' =HYPERLINK("bad", "click")' });
  assert.match(historyCsv([unsafe]), /"' =HYPERLINK\(""bad"", ""click""\)"/);
});

test('source health distinguishes fresh, cached, partial, expired, UTC rollover, stale and unavailable', () => {
  assert.equal(readingHealth(reading(0), now), 'fresh');
  assert.equal(readingHealth({ ...reading(0), cached: true }, now), 'cached');
  assert.equal(readingHealth(reading(0, '2026-11-02T11:50:00.000Z'), now), 'outdated');
  assert.equal(readingHealth({ ...reading(0), error: 'offline' }, now), 'stale');
  assert.equal(readingHealth({ product: p, error: '429' }, now), 'error');
  assert.equal(readingHealth({ product: p }, now), 'empty');
  const npm: Reading = { product: { source: 'npm', id: 'react' }, fetchedAt: now.toISOString(), metric: {
    kind: 'npm', start: '2026-10-26', end: '2026-11-01', daily: [], windows: [{ days: 7, total: null, previous: null, change: null }]
  } };
  assert.equal(readingHealth(npm, now), 'partial');
  assert.equal(readingHealth({ ...npm, metric: { ...npm.metric as Extract<NonNullable<Reading['metric']>, { kind: 'npm' }>, end: '2026-10-31' } }, now), 'outdated');
});

test('actual analytics fetches add observations only when TTL expires; failures retain history unchanged', async () => {
  let tick = now.getTime(), calls = 0, fail = false;
  const provider = new Providers();
  provider.extension = async () => { calls++; if (fail) throw new Error('offline'); return { kind: 'count', label: 'Downloads', value: calls }; };
  const service = new Analytics(provider, () => new Date(tick));
  const history = new History([], [p], () => new Date(tick));
  history.record([await service.read(p)]);
  tick += 60_000; history.record([await service.read(p)]);
  assert.equal(calls, 1); assert.equal(history.entries().length, 1);
  tick += 600_000; history.record([await service.read(p)]);
  assert.equal(history.entries().length, 2);
  tick += 600_000; fail = true;
  const failed = await service.read(p); history.record([failed]);
  assert.equal(readingHealth(failed, new Date(tick)), 'stale'); assert.equal(history.entries().length, 2);
});
