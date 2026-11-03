import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { Product, Reading, dateAt, keyOf } from './model';
import { Snapshot, readingHealth } from './history';
import { Comparison, Insights, ReleaseMarker, compare, targetProducts } from './insights';

export interface LaunchDailySeries { product: Product; before: { day: string; downloads: number | null }[]; after: { day: string; downloads: number | null }[] }
export interface LaunchReport { marker: ReleaseMarker; days: number; comparison: Comparison; mode?: 'complete' | 'early'; actualDays?: number; preliminary?: boolean; daily?: LaunchDailySeries[] }
export type RuleMetric = 'count' | 'npm7' | 'npm30' | 'npm90';
export type RuleKind = 'milestone' | 'increase' | 'decrease';
export interface AlertRule {
  id: string; key: string; name: string; metric: RuleMetric; kind: RuleKind; threshold: number; enabled: boolean;
  lastValue?: number; lastSampleAt?: string; lastTriggeredAt?: string; reached?: boolean;
}
export interface AlertEvent {
  id: string; ruleId: string; key: string; name: string; metric: RuleMetric; kind: RuleKind;
  threshold: number; value: number; createdAt: string; previousValue?: number; previousAt?: string; acknowledged: boolean;
}
export interface MonitorState { rules: AlertRule[]; alerts: AlertEvent[] }
const object = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const idIs = (v: unknown, prefix: string): v is string => typeof v === 'string' && v.length <= 64 && new RegExp(`^${prefix}_[a-z0-9-]+$`).test(v);
const timestamp = (v: unknown, now: Date): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && Date.parse(v) <= now.getTime();

export function launchReview(value: unknown, products: Product[], readings: Reading[], snapshots: Snapshot[], insights: Insights, now = new Date()): LaunchReport {
  const v = object(value), marker = insights.markers.find(m => m.id === v?.markerId);
  if (!v || !marker || typeof v.target !== 'string') throw new Error('Choose a saved release marker and a valid target.');
  if (typeof v.days !== 'number' || ![7, 14, 30, 60].includes(v.days)) throw new Error('Choose a 7-, 14-, 30- or 60-day launch window.');
  if (v.mode !== undefined && v.mode !== 'complete' && v.mode !== 'early') throw new Error('Choose a complete or early review.');
  const selected = targetProducts(v.target, products, insights.groups);
  if (!selected.products.some(p => keyOf(p) === marker.key)) throw new Error('The release product must belong to the selected target.');
  const release = new Date(marker.date), elapsed = Math.max(0, Math.floor((Date.parse(dateAt(now, 0)) - release.getTime()) / 86400_000));
  const mode = v.mode === 'early' ? 'early' : 'complete';
  const actualDays = mode === 'early' ? Math.min(v.days, elapsed) : v.days;
  if (!actualDays) throw new Error(`No completed UTC days since this release yet. Early review becomes available ${dateAt(release, 1)} UTC.`);
  const afterEnd = dateAt(release, actualDays - 1);
  if (afterEnd > dateAt(now, -1)) throw new Error(`The full after-launch window ends ${afterEnd} UTC. Choose a shorter window or review after it completes.`);
  const comparison = compare({ target: v.target,
    a: { start: marker.date, end: afterEnd }, b: { start: dateAt(release, -actualDays), end: dateAt(release, -1) }
  }, products, readings, snapshots, insights.groups, now);
  comparison.notes.push('After includes the release day. Before ends the day before release. Equal UTC windows do not establish causation.');
  const preliminary = actualDays < v.days;
  if (preliminary) comparison.notes.push(`PRELIMINARY: ${actualDays} of ${v.days} planned days completed. Both windows use ${actualDays} completed UTC days; results may change.`);
  const daily = selected.products.filter(p => p.source === 'npm').map(product => {
    const reading = readings.find(r => keyOf(r.product) === keyOf(product));
    const values = new Map(reading && !reading.error && readingHealth(reading, now) !== 'outdated' && reading.metric?.kind === 'npm' ? reading.metric.daily.map(d => [d.day, d.downloads]) : []);
    const period = (start: string) => Array.from({ length: actualDays }, (_, i) => { const day = dateAt(new Date(start), i); return { day, downloads: values.get(day) ?? null }; });
    return { product, before: period(comparison.request.b.start), after: period(comparison.request.a.start) };
  });
  return { marker: { ...marker }, days: v.days, comparison, mode, actualDays, preliminary, daily };
}

function ruleFields(value: unknown, products: Product[]): Omit<AlertRule, 'id'> {
  const v = object(value), p = products.find(p => keyOf(p) === v?.key);
  if (!v || !p || typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 60 || /[\x00-\x1f\x7f]/.test(v.name)) throw new Error('Choose a tracked product and a rule name of 1-60 characters.');
  if (typeof v.kind !== 'string' || !['milestone', 'increase', 'decrease'].includes(v.kind) || typeof v.enabled !== 'boolean') throw new Error('Choose a valid rule kind and enabled state.');
  if (typeof v.metric !== 'string' || !(p.source === 'npm' ? ['npm7', 'npm30', 'npm90'] : ['count']).includes(v.metric)) throw new Error('Choose a metric matching the product source.');
  if (typeof v.threshold !== 'number' || !Number.isFinite(v.threshold) || v.threshold <= 0 ||
      (v.kind === 'milestone' ? !Number.isSafeInteger(v.threshold) : v.threshold > 10000)) throw new Error('Milestones need a positive integer; change thresholds must be above 0 and at most 10,000 percent.');
  return { key: keyOf(p), name: v.name.trim(), kind: v.kind as RuleKind, metric: v.metric as RuleMetric, threshold: v.threshold, enabled: v.enabled };
}
export function metricLabel(metric: RuleMetric): string { return metric === 'count' ? 'source count' : `npm ${metric.slice(3)}-day rolling total`; }
function metricValue(reading: Reading, metric: RuleMetric): number | undefined {
  const value = metric === 'count' && reading.metric?.kind === 'count' ? reading.metric.value :
    metric !== 'count' && reading.metric?.kind === 'npm' ? reading.metric.windows.find(w => w.days === Number(metric.slice(3)))?.total : undefined;
  return count(value) ? value : undefined;
}
export function saveRule(state: MonitorState, value: unknown, products: Product[], readings: Reading[], now = new Date()): MonitorState {
  const v = object(value), fields = ruleFields(value, products), old = v?.id === undefined ? undefined : state.rules.find(r => r.id === v.id);
  if (v?.id !== undefined && !old) throw new Error('Monitoring rule no longer exists.');
  if (state.rules.some(r => r.id !== old?.id && r.key === fields.key && r.name.toLowerCase() === fields.name.toLowerCase())) throw new Error('Choose a unique rule name for this product.');
  if (!old && state.rules.length >= 50) throw new Error('Keep up to 50 monitoring rules.');
  const rule: AlertRule = { ...fields, id: old?.id ?? `m_${randomUUID()}`, reached: false };
  const reading = readings.find(r => keyOf(r.product) === rule.key);
  if (reading && !reading.error && timestamp(reading.fetchedAt, now) && readingHealth(reading, now) !== 'outdated') {
    const baseline = metricValue(reading, rule.metric);
    if (baseline !== undefined) { rule.lastValue = baseline; rule.lastSampleAt = reading.fetchedAt; }
  }
  return { ...state, rules: [...state.rules.filter(r => r.id !== rule.id), rule] };
}
export function deleteRule(state: MonitorState, id: unknown): MonitorState {
  if (!state.rules.some(r => r.id === id)) throw new Error('Monitoring rule no longer exists.');
  return { ...state, rules: state.rules.filter(r => r.id !== id) };
}
export function acknowledgeAlerts(state: MonitorState, id: unknown): MonitorState {
  if (id !== 'all' && !state.alerts.some(a => a.id === id)) throw new Error('Alert no longer exists.');
  return { ...state, alerts: state.alerts.map(a => id === 'all' || a.id === id ? { ...a, acknowledged: true } : a) };
}
export function restoreMonitor(value: unknown, products: Product[], now = new Date()): MonitorState {
  const v = object(value), state: MonitorState = { rules: [], alerts: [] };
  if (Array.isArray(v?.rules)) for (const raw of v.rules.slice(0, 200)) {
    const r = object(raw);
    if (!r || !idIs(r.id, 'm') || state.rules.some(x => x.id === r.id) || state.rules.length >= 50) continue;
    try {
      const rule: AlertRule = { ...ruleFields(r, products), id: r.id, reached: r.reached === true };
      if (state.rules.some(x => x.key === rule.key && x.name.toLowerCase() === rule.name.toLowerCase())) continue;
      if (count(r.lastValue) && timestamp(r.lastSampleAt, now)) { rule.lastValue = r.lastValue; rule.lastSampleAt = new Date(r.lastSampleAt).toISOString(); }
      if (timestamp(r.lastTriggeredAt, now)) rule.lastTriggeredAt = new Date(r.lastTriggeredAt).toISOString();
      state.rules.push(rule);
    } catch { /* Ignore invalid rules or removed products. */ }
  }
  if (Array.isArray(v?.alerts)) for (const raw of v.alerts.slice(-500)) {
    const a = object(raw);
    if (!a || !idIs(a.id, 'a') || !idIs(a.ruleId, 'm') || state.alerts.some(x => x.id === a.id) || !timestamp(a.createdAt, now) ||
        Date.parse(a.createdAt) < now.getTime() - 90 * 86400_000 || !count(a.value)) continue;
    try {
      const { key, name, kind, metric, threshold } = ruleFields({ ...a, enabled: true }, products);
      const alert: AlertEvent = { key, name, kind, metric, threshold, id: a.id, ruleId: a.ruleId, value: a.value, createdAt: new Date(a.createdAt).toISOString(), acknowledged: a.acknowledged === true };
      if (count(a.previousValue) && timestamp(a.previousAt, now)) { alert.previousValue = a.previousValue; alert.previousAt = new Date(a.previousAt).toISOString(); }
      state.alerts.push(alert);
    } catch { /* Invalid or obsolete saved event. */ }
  }
  state.alerts.sort((a, b) => a.createdAt.localeCompare(b.createdAt)); state.alerts = state.alerts.slice(-100);
  return state;
}
export function evaluateRules(value: MonitorState, products: Product[], readings: Reading[], now = new Date()): MonitorState {
  const state = restoreMonitor(value, products, now);
  for (const rule of state.rules) {
    if (!rule.enabled) continue;
    const reading = readings.find(r => keyOf(r.product) === rule.key);
    if (!reading || reading.error || reading.cached || !timestamp(reading.fetchedAt, now) || readingHealth(reading, now) === 'outdated' ||
        (rule.lastSampleAt && Date.parse(reading.fetchedAt) <= Date.parse(rule.lastSampleAt))) continue;
    const current = metricValue(reading, rule.metric);
    if (current === undefined) continue;
    const before = rule.lastValue, previousAt = rule.lastSampleAt;
    const percent = before !== undefined && before > 0 ? (current - before) / before * 100 : undefined;
    const cool = !rule.lastTriggeredAt || now.getTime() - Date.parse(rule.lastTriggeredAt) >= 3600_000;
    const triggered = rule.kind === 'milestone' ? !rule.reached && current >= rule.threshold : cool && percent !== undefined &&
      (rule.kind === 'increase' ? percent >= rule.threshold : -percent >= rule.threshold);
    rule.lastValue = current; rule.lastSampleAt = reading.fetchedAt;
    if (triggered) {
      if (rule.kind === 'milestone') rule.reached = true;
      rule.lastTriggeredAt = now.toISOString();
      state.alerts.push({ id: `a_${randomUUID()}`, ruleId: rule.id, key: rule.key, name: rule.name, metric: rule.metric, kind: rule.kind,
        threshold: rule.threshold, value: current, previousValue: before, previousAt, createdAt: now.toISOString(), acknowledged: false });
    }
  }
  state.alerts = state.alerts.slice(-100); return state;
}

const format = (v: number | null): string => v === null ? 'Unavailable' : new Intl.NumberFormat('en-US').format(v);
const md = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_[\]{}()|#!]/g, '\\$&');
export function launchMarkdown(report: LaunchReport): string {
  const c = report.comparison, lines = [`# ${report.preliminary ? 'PRELIMINARY ' : ''}Launch Review: ${md(c.targetName)}`, '', `Release: ${md(report.marker.label)} / ${report.marker.date} UTC`,
    `After: ${c.request.a.start} to ${c.request.a.end} UTC`, `Before: ${c.request.b.start} to ${c.request.b.end} UTC`, `Computed: ${c.computedAt}`, '',
    '| Product / metric | After | Before | Difference | Percent |', '| --- | --- | --- | --- | --- |'];
  if (report.marker.notes) lines.splice(4, 0, `Release notes: ${md(report.marker.notes.replace(/\r?\n/g, ' '))}`, '');
  if (report.preliminary) lines.splice(2, 0, `PRELIMINARY: ${report.actualDays} of ${report.days} planned days. Equal completed-day windows; results may change.`, '');
  for (const row of c.rows) {
    lines.push(`| ${md(row.product.source + ':' + row.product.id + ' / ' + row.metric)} | ${format(row.a.value)} | ${format(row.b.value)} | ${format(row.difference)} | ${row.percent === null ? 'Unavailable' : row.percent.toFixed(1) + '%'} |`);
  }
  if (c.npmTotals) lines.push('', `npm only (${c.npmTotals.products} packages): after ${format(c.npmTotals.a)}, before ${format(c.npmTotals.b)}.`);
  lines.push('', '## Coverage', '');
  for (const row of c.rows) for (const [label, period] of [['After', row.a], ['Before', row.b]] as const) {
    lines.push(`- ${md(row.product.source + ':' + row.product.id)} ${label}: ${md(period.coverage)}${period.firstAt ? `; observed ${period.firstAt} to ${period.lastAt}` : ''}`);
  }
  for (const series of report.daily || []) {
    lines.push('', `## Daily comparison: ${md(series.product.id)}`, '', '| Day in window | Before (UTC) | Downloads | After (UTC) | Downloads |', '| --- | --- | --- | --- | --- |');
    for (let i = 0; i < series.after.length; i++) lines.push(`| ${i + 1} | ${series.before[i]!.day} | ${format(series.before[i]!.downloads)} | ${series.after[i]!.day} | ${format(series.after[i]!.downloads)} |`);
  }
  lines.push('', '## Interpretation', '', ...c.notes.map(note => `- ${md(note)}`), '', 'Generated locally by ShipStats 1.0.0. No causal attribution is implied.', '');
  return lines.join('\n');
}
const xml = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const clip = (v: string, max: number): string => [...v].length <= max ? v : [...v].slice(0, max - 3).join('') + '...';
export function shareCard(report: LaunchReport, metric: unknown): string {
  const c = report.comparison;
  const row = typeof metric === 'string' && metric.startsWith('product:') ? c.rows.find(r => keyOf(r.product) === metric.slice(8)) : undefined;
  if (!(metric === 'npm-total' && c.npmTotals) && !row) throw new Error('Choose a share-card metric from the current launch report.');
  const a = row ? row.a.value : c.npmTotals!.a, b = row ? row.b.value : c.npmTotals!.b;
  const rawDifference = a !== null && b !== null ? a - b : null;
  const difference = rawDifference !== null && Number.isSafeInteger(rawDifference) ? rawDifference : null;
  const percent = difference !== null && b !== null && b > 0 ? `${difference > 0 ? '+' : ''}${(difference / b * 100).toFixed(1)}%` : 'Unavailable';
  const name = row ? `${row.product.source}:${row.product.id} / ${row.metric}` : `Daily npm downloads / ${c.npmTotals!.products} package(s)`;
  const endpoints = (period: 'a' | 'b'): string => {
    const point = row?.[period];
    return point ? point.coverage + (point.firstAt ? ` / ${point.firstAt} to ${point.lastAt}` : '') : 'All selected npm packages and days must have complete coverage.';
  };
  const accent = difference === null || difference >= 0 ? '#71f0c3' : '#ffb6ab';
  const delta = difference !== null && difference > 0 ? '+' + format(difference) : format(difference);
  const text = (x: number, y: number, value: string, size = 18, fill = '#f0f6fa', weight = 400): string => {
    const units = [...value].reduce((sum, char) => sum + (/[MW@#%]/.test(char) ? 1 : /[ilI1.,: /|'-]/.test(char) ? 0.35 : 0.7), 0);
    const fitted = Math.min(size, Math.floor((1152 - x) / Math.max(1, units)));
    return `<text x="${x}" y="${y}" font-size="${fitted}" fill="${fill}" font-weight="${weight}">${xml(value)}</text>`;
  };
  const valueText = (x: number, value: number | null, width: number, size: number, fill: string): string => {
    const label = format(value), fitted = Math.min(size, Math.floor(width / (label.length * 0.65)));
    return text(x, 350, label, fitted, fill, 650);
  };
  const baseline = b === 0 ? 'Before is zero; no percentage baseline.' : percent === 'Unavailable' ? 'Needs complete values in both windows.' : 'Compared with the before window.';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${xml(c.targetName + ' Launch Review')}">
<title>${xml((report.preliminary ? 'PRELIMINARY / ' : '') + name)}</title><desc>${xml(`${report.preliminary ? `PRELIMINARY: ${report.actualDays} of ${report.days} planned days. ` : ''}Release ${report.marker.label} on ${report.marker.date} UTC. ${report.marker.notes || ''} After ${format(a)}; before ${format(b)}; difference ${delta}; percent ${percent}. After coverage: ${endpoints('a')}. Before coverage: ${endpoints('b')}. Timing does not establish causation.`)}</desc>
<defs>
<clipPath id="cardBounds"><rect width="1200" height="630" rx="28"/></clipPath>
<linearGradient id="background" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#080e1a"/><stop offset="1" stop-color="#122b32"/></linearGradient>
<radialGradient id="glow"><stop stop-color="#34d9b0" stop-opacity=".15"/><stop offset="1" stop-color="#34d9b0" stop-opacity="0"/></radialGradient>
<linearGradient id="after" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#173c3e"/><stop offset="1" stop-color="#122b33"/></linearGradient>
</defs>
<rect width="1200" height="630" rx="28" fill="url(#background)"/><rect x="1" y="1" width="1198" height="628" rx="27" fill="none" stroke="#ffffff" stroke-opacity=".1"/>
<ellipse cx="1060" cy="85" rx="350" ry="240" fill="url(#glow)" clip-path="url(#cardBounds)"/>
<g font-family="Segoe UI, Arial, sans-serif">
<rect x="48" y="33" width="30" height="30" rx="9" fill="#71f0c3"/>
<path d="M56 54V48M63 54V42M70 54V45" stroke="#0b2428" stroke-width="3" stroke-linecap="round"/>
${text(90, 55, 'SHIPSTATS', 17, '#d9f7ef', 700)}${text(209, 55, '/  LAUNCH REVIEW', 14, '#99b3bf', 500)}
<rect x="945" y="33" width="207" height="32" rx="16" fill="#ffffff" fill-opacity=".05" stroke="#ffffff" stroke-opacity=".12"/>
${text(966, 54, report.preliminary ? `PRELIMINARY / ${report.actualDays} OF ${report.days} DAYS` : `${report.actualDays ?? report.days} DAYS / EACH WINDOW`, 12, '#c6dce3', 600)}
${text(48, 128, clip(c.targetName, 38), 42, '#f0f6fa', 650)}
${text(50, 167, clip(name, 77), 18, '#a9c0cb')}
<rect x="48" y="185" width="4" height="18" rx="2" fill="#71f0c3"/>
${text(64, 200, clip(report.marker.label, 34) + '  /  RELEASED ' + report.marker.date + ' UTC', 14, '#b2c7cf', 500)}
${report.marker.notes || report.preliminary ? text(50, 222, clip((report.preliminary ? 'PRELIMINARY · ' : '') + (report.marker.notes?.replace(/\r?\n/g, ' ') || 'Equal completed-day windows; results may change.'), 135), 12, '#b2c7cf') : ''}
<rect x="48" y="236" width="674" height="168" rx="20" fill="url(#after)" stroke="#71f0c3" stroke-opacity=".28"/>
<rect x="746" y="236" width="406" height="168" rx="20" fill="#14212e" stroke="#ffffff" stroke-opacity=".09"/>
${text(72, 272, 'AFTER RELEASE', 13, '#71f0c3', 700)}${text(770, 272, 'BEFORE RELEASE', 13, '#a9becd', 700)}
${valueText(72, a, 606, 76, '#f0fff9')}${valueText(770, b, 354, 58, '#d4e1ec')}
${text(72, 382, `${c.request.a.start} — ${c.request.a.end} UTC`, 14, '#b1d2cc')}${text(770, 382, `${c.request.b.start} — ${c.request.b.end} UTC`, 14, '#99afc0')}
<rect x="48" y="422" width="1104" height="74" rx="16" fill="#ffffff" fill-opacity=".035" stroke="#ffffff" stroke-opacity=".07"/>
<path d="M598 438V480" stroke="#ffffff" stroke-opacity=".1"/>
${text(72, 446, 'DIFFERENCE / AFTER MINUS BEFORE', 11, '#93aebb', 600)}${text(72, 479, delta, delta.length > 19 ? 24 : 28, accent, 650)}
${text(622, 446, 'PERCENT CHANGE', 11, '#93aebb', 600)}${text(622, 479, percent, Math.min(26, Math.floor(162 / (percent.length * 0.7))), percent === 'Unavailable' ? '#b0c0cc' : accent, 650)}
${text(806, 477, baseline, 11, '#9db2c0')}
${text(50, 522, clip('After coverage: ' + endpoints('a'), 139), 12, '#a2b7c2')}${text(50, 543, clip('Before coverage: ' + endpoints('b'), 139), 12, '#a2b7c2')}
${text(50, 566, row && row.product.source !== 'npm' ? 'Observed count changes use saved endpoints, not exact period boundaries. Gaps are not estimated.' : 'Missing coverage stays unavailable. Source metrics are never mixed.', 12, '#a2b7c2')}
<path d="M48 583H1152" stroke="#ffffff" stroke-opacity=".09"/>
${text(50, 608, 'Timing does not establish causation. Full coverage is in the report.', 12, '#9cb0bd')}
${text(830, 608, 'Computed ' + c.computedAt, 11, '#93cdbd')}
</g></svg>`;
}
export function validateCardPng(data: unknown): Buffer {
  if (typeof data !== 'string' || data.length > 3_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid share-card PNG data.');
  const png = Buffer.from(data, 'base64');
  if (png.length < 45 || png.length > 2_000_000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(8) !== 13 || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630 ||
      png[24] !== 8 || ![2, 6].includes(png[25]!) || png[26] !== 0 || png[27] !== 0 || png[28] !== 0) throw new Error('Share cards must be 1200 x 630 PNG images.');
  const chunks: Buffer[] = []; let ended = false;
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('Truncated share-card PNG.');
    const length = png.readUInt32BE(offset), end = offset + length + 12;
    if (end > png.length) throw new Error('Truncated share-card PNG.');
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, end - 4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    if (((crc ^ 0xffffffff) >>> 0) !== png.readUInt32BE(end - 4)) throw new Error('Corrupt share-card PNG.');
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR' && offset !== 8) throw new Error('Multiple PNG headers are not allowed.');
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, end - 4));
    if (type === 'IEND') { if (length !== 0 || end !== png.length) throw new Error('Invalid PNG ending.'); ended = true; }
    offset = end;
  }
  if (!ended || !chunks.length) throw new Error('Incomplete share-card PNG.');
  const stride = 1200 * (png[25] === 6 ? 4 : 3) + 1;
  const pixels = inflateSync(Buffer.concat(chunks), { maxOutputLength: stride * 630 });
  if (pixels.length !== stride * 630) throw new Error('Invalid PNG pixel length.');
  for (let y = 0; y < 630; y++) if (pixels[y * stride]! > 4) throw new Error('Invalid PNG filter.');
  return png;
}
