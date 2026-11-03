import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Insights, compare, deleteInsight, restoreInsights, saveGroup, saveMarker, utcDate } from '../src/insights';
import { Product, Reading, dateAt, windows } from '../src/model';
import { Snapshot } from '../src/history';

const now = new Date('2026-11-02T12:00:00.000Z');
const npm: Product = { source: 'npm', id: 'react' }, vsx: Product = { source: 'openvsx', id: 'pub.ext' };
const empty = (): Insights => ({ groups: [], markers: [] });
const request = { target: 'all', a: { start: '2026-10-26', end: '2026-11-01' }, b: { start: '2026-10-19', end: '2026-10-25' } };
function npmReading(p = npm): Reading {
  const daily = Array.from({ length: 180 }, (_, i) => ({ day: dateAt(now, i - 180), downloads: i >= 173 ? 2 : 1 }));
  return { product: p, fetchedAt: now.toISOString(), metric: { kind: 'npm', daily, windows: windows(daily, now), start: dateAt(now, -180), end: dateAt(now, -1) } };
}

test('groups support create, edit, overlapping membership, unique names, round trips and deletion without untracking', () => {
  const products = [npm, vsx];
  let state = saveGroup(empty(), { name: ' My product ', keys: ['npm:react', 'openvsx:pub.ext', 'npm:react'] }, products);
  const id = state.groups[0]!.id;
  assert.deepEqual(state.groups[0]!.keys, ['npm:react', 'openvsx:pub.ext']);
  state = saveGroup(state, { name: 'Other group', keys: ['npm:react'] }, products);
  assert.throws(() => saveGroup(state, { name: 'my PRODUCT', keys: [] }, products), /unique/);
  assert.throws(() => saveGroup(state, { name: 'x', keys: ['npm:unknown'] }, products), /currently tracked/);
  assert.throws(() => saveGroup(state, { id: 'g_missing', name: 'x', keys: [] }, products), /no longer exists/);
  state = saveGroup(state, { id, name: 'Renamed', keys: ['openvsx:pub.ext'] }, products);
  assert.equal(state.groups.length, 2);
  assert.deepEqual(restoreInsights(JSON.parse(JSON.stringify(state)), products, now), state);
  const pruned = restoreInsights(state, [vsx], now);
  assert.ok(pruned.groups.every(g => !g.keys.includes('npm:react')));
  assert.deepEqual(deleteInsight(state, 'group', id).groups.map(g => g.name), ['Other group']);
  assert.equal(products.length, 2);
  for (const name of ['', 'a'.repeat(61), 'bad\nname']) assert.throws(() => saveGroup(state, { name, keys: [] }, products));
});

test('release notes round trip, remain optional for older markers and reject invalid values', () => {
  let state=saveMarker(empty(),{key:'npm:react',date:'2026-10-30',label:'v1',notes:'Fixed startup\nReduced requests.'},[npm],now);
  assert.equal(restoreInsights(state,[npm],now).markers[0]!.notes,'Fixed startup\nReduced requests.');
  const marker=state.markers[0]!;
  state=saveMarker(state,{...marker,label:'v1.1'},[npm],now); assert.equal(state.markers[0]!.notes,marker.notes);
  state=saveMarker(state,{...marker,notes:''},[npm],now); assert.equal(state.markers[0]!.notes,undefined);
  for(const notes of ['x'.repeat(501),'bad\u0000notes',123]) assert.throws(()=>saveMarker(state,{...marker,notes},[npm],now),/notes/);
  const restored=restoreInsights({groups:[],markers:[{...marker,notes:123}]},[npm],now); assert.equal(restored.markers.length,1); assert.equal(restored.markers[0]!.notes,undefined);
});

test('release markers validate UTC dates, preserve IDs on restart, allow editing, prune removed products and enforce bounds', () => {
  let state = saveMarker(empty(), { key: 'npm:react', date: '2026-10-30', label: 'v1.0' }, [npm], now);
  const id = state.markers[0]!.id;
  assert.deepEqual(restoreInsights(state, [npm], now), state);
  for (const date of ['2026-02-30', '2026-11-03', '2026-10-30T00:00Z']) assert.throws(() => saveMarker(state, { key: 'npm:react', date, label: 'v2' }, [npm], now));
  assert.throws(() => utcDate('2026-13-01'));
  assert.throws(() => saveMarker(state, { key: 'npm:unknown', date: '2026-10-30', label: 'x' }, [npm], now));
  assert.throws(() => saveMarker(state, { key: 'npm:react', date: '2026-10-30', label: 'v1.0' }, [npm], now), /already exists/);
  state = saveMarker(state, { id, key: 'npm:react', date: '2026-10-31', label: 'v1.1' }, [npm], now);
  assert.equal(state.markers.length, 1); assert.equal(state.markers[0]!.id, id);
  assert.equal(restoreInsights(state, [], now).markers.length, 0);
  assert.equal(deleteInsight(state, 'marker', id).markers.length, 0);
  let many = empty();
  for (let i = 0; i < 200; i++) many = saveMarker(many, { key: 'npm:react', date: '2026-10-30', label: `v${i}` }, [npm], now);
  assert.throws(() => saveMarker(many, { key: 'npm:react', date: '2026-10-30', label: 'extra' }, [npm], now), /200/);
  let groups = empty();
  for (let i = 0; i < 20; i++) groups = saveGroup(groups, { name: `g${i}`, keys: [] }, [npm]);
  assert.throws(() => saveGroup(groups, { name: 'extra', keys: [] }, [npm]), /20/);
});

test('malformed saved insights cannot restore unknown members, duplicate IDs/names or invalid markers', () => {
  const restored = restoreInsights({ groups: [null, { id: '__proto__', name: 'bad', keys: [] }, { id: 'g_one', name: 'one', keys: ['npm:react', 'npm:missing'] }, { id: 'g_two', name: 'ONE', keys: [] }],
    markers: [null, { id: 'r_one', key: 'npm:react', date: '2026-02-30', label: 'bad' }, { id: 'r_two', key: 'npm:missing', date: '2026-10-30', label: 'bad' }] }, [npm], now);
  assert.deepEqual(restored, { groups: [{ id: 'g_one', name: 'one', keys: ['npm:react'] }], markers: [] });
});

test('custom npm comparisons sum complete daily values, support groups and individual products, and preserve real zeroes', () => {
  const reading = npmReading();
  const report = compare(request, [npm], [reading], [], [], now);
  assert.deepEqual(report.npmTotals, { a: 14, b: 7, products: 1 });
  assert.equal(report.rows[0]!.difference, 7); assert.equal(report.rows[0]!.percent, 100);
  const group = { id: 'g_product', name: 'Product', keys: ['npm:react'] };
  assert.equal(compare({ ...request, target: 'group:g_product' }, [npm, vsx], [reading], [], [group], now).rows.length, 1);
  assert.equal(compare({ ...request, target: 'product:npm:react' }, [npm], [reading], [], [], now).targetName, 'react');
  if (reading.metric?.kind !== 'npm') throw Error('fixture');
  reading.metric.daily = reading.metric.daily.map(d => ({ ...d, downloads: 0 }));
  const zero = compare(request, [npm], [reading], [], [], now).rows[0]!;
  assert.equal(zero.a.value, 0); assert.equal(zero.difference, 0); assert.equal(zero.percent, null);
});

test('comparisons reject missing/failed/stale data from totals rather than silently summing a subset', () => {
  const second: Product = { source: 'npm', id: 'other' }, reading = npmReading();
  const absent = compare(request, [npm, second], [reading], [], [], now);
  assert.equal(absent.npmTotals?.a, null); assert.equal(absent.rows[0]!.a.value, 14);
  const failed = compare(request, [npm], [{ ...reading, error: 'offline' }], [], [], now);
  assert.equal(failed.rows[0]!.a.value, null);
  const stale = compare(request, [npm], [{ ...reading, fetchedAt: '2026-11-02T11:00:00Z' }], [], [], now);
  assert.equal(stale.rows[0]!.a.value, null);
  if (reading.metric?.kind !== 'npm') throw Error('fixture');
  reading.metric.daily = reading.metric.daily.filter(d => d.day !== '2026-10-27');
  const partial = compare(request, [npm], [reading], [], [], now);
  assert.equal(partial.rows[0]!.a.value, null); assert.match(partial.rows[0]!.a.coverage, /6\/7/);
});

test('count comparisons use actual observation endpoints, permit decreases, and never combine source meanings', () => {
  const samples: Snapshot[] = [['2026-10-19T01:00:00.000Z', 100], ['2026-10-25T23:00:00.000Z', 110], ['2026-10-26T12:00:00.000Z', 120], ['2026-11-01T15:00:00.000Z', 115]].map(([fetchedAt, value]) => ({ product: vsx, fetchedAt: fetchedAt as string, metric: { kind: 'count', value: value as number } }));
  const report = compare(request, [npm, vsx], [npmReading()], samples, [], now);
  const row = report.rows[1]!;
  assert.equal(row.a.value, -5); assert.equal(row.b.value, 10); assert.equal(row.difference, -15);
  assert.equal(row.a.firstAt, '2026-10-26T12:00:00.000Z'); assert.equal(row.a.lastAt, '2026-11-01T15:00:00.000Z');
  assert.deepEqual(report.npmTotals, { a: 14, b: 7, products: 1 });
  assert.equal(compare(request, [vsx], [], samples.slice(0, 1), [], now).rows[0]!.b.value, null);
  assert.match(report.notes.join(' '), /not its exact boundaries/);
});

test('comparison validation handles impossible/reversed/future/out-of-bounds dates, missing targets, unequal lengths and overlap', () => {
  for (const a of [{ start: '2026-02-30', end: '2026-11-01' }, { start: '2026-11-01', end: '2026-10-31' }, { start: '2026-10-31', end: '2026-11-02' }, { start: '2020-01-01', end: '2026-11-01' }]) assert.throws(() => compare({ ...request, a }, [npm], [], [], [], now));
  assert.throws(() => compare({ ...request, target: 'group:missing' }, [npm], [], [], [], now), /no longer exists/);
  assert.throws(() => compare(request, [], [], [], [], now), /tracked products/);
  const warnings = compare({ ...request, a: { start: '2026-10-20', end: '2026-10-26' }, b: { start: '2026-10-25', end: '2026-10-26' } }, [npm], [npmReading()], [], [], now).notes.join(' ');
  assert.match(warnings, /different lengths/); assert.match(warnings, /overlap/);
});
