import { Product, Reading, dateAt, keyOf, restoreProducts } from './model';
import { History, Snapshot, HISTORY_DAYS, HISTORY_PER_PRODUCT, readingHealth } from './history';
import { Insights, restoreInsights } from './insights';
import { MonitorState, launchReview, restoreMonitor } from './launch';

export interface Backup { type: 'shipstats-backup'; version: 1; createdAt: string; products: Product[]; history: Snapshot[]; insights: Insights; monitoring: MonitorState }
export const BACKUP_BYTES = 5_000_000;
const obj = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;
export function makeBackup(products: Product[], history: Snapshot[], insights: Insights, monitoring: MonitorState, now = new Date()): Backup {
  return { type: 'shipstats-backup', version: 1, createdAt: now.toISOString(), products, history: new History(history, products, () => now).entries(), insights: restoreInsights(insights, products, now), monitoring: restoreMonitor(monitoring, products, now) };
}
export function parseBackup(text: string, now = new Date()): Backup {
  if (Buffer.byteLength(text, 'utf8') > BACKUP_BYTES) throw new Error('Backup exceeds the 5 MB limit.');
  let raw: Record<string, unknown> | undefined;
  try { raw = obj(JSON.parse(text.replace(/^\ufeff/, ''))); } catch { throw new Error('Choose a valid ShipStats JSON backup.'); }
  const v = raw;
  if (!v || v.type !== 'shipstats-backup' || v.version !== 1 || typeof v.createdAt !== 'string' || !Number.isFinite(Date.parse(v.createdAt)) || Date.parse(v.createdAt) > now.getTime()) throw new Error('Unsupported or invalid ShipStats backup.');
  const insights = obj(v.insights), monitoring = obj(v.monitoring);
  if (!Array.isArray(v.products) || v.products.length > 50 || !Array.isArray(v.history) || v.history.length > 5000 ||
      !Array.isArray(insights?.groups) || insights.groups.length > 20 || !Array.isArray(insights.markers) || insights.markers.length > 200 ||
      !Array.isArray(monitoring?.rules) || monitoring.rules.length > 50 || !Array.isArray(monitoring.alerts) || monitoring.alerts.length > 100) throw new Error('Backup exceeds tracking or retention limits.');
  const products = restoreProducts(v.products);
  if (products.length !== v.products.length) throw new Error('Backup contains invalid or duplicate products.');
  const result = makeBackup(products, v.history as Snapshot[], insights as unknown as Insights, monitoring as unknown as MonitorState, now);
  if (result.insights.groups.length !== insights.groups.length || result.insights.markers.length !== insights.markers.length || result.monitoring.rules.length !== monitoring.rules.length) throw new Error('Backup contains invalid groups, release markers or monitoring rules.');
  // Old observations/alerts are intentionally pruned through the normal retention policy.
  result.createdAt = new Date(v.createdAt).toISOString();
  return result;
}
export function storageHealth(products: Product[], history: Snapshot[], insights: Insights, monitoring: MonitorState) {
  const bytes = Buffer.byteLength(JSON.stringify({ products, history, insights, monitoring }), 'utf8');
  return { bytes, snapshots: history.length, maxSnapshots: products.length * HISTORY_PER_PRODUCT, days: HISTORY_DAYS, perProduct: HISTORY_PER_PRODUCT, maxProducts: 50,
    warning: bytes > 2_000_000 ? 'Tracking data exceeds 2 MB. Export a backup and review tracked products.' : '',
    note: 'Serialized tracking-data size; excludes source cache, credentials and VS Code database overhead.' };
}
export function inspectLaunch(request: unknown, products: Product[], readings: Reading[], history: Snapshot[], insights: Insights, now = new Date()) {
  const v = obj(request), marker = insights.markers.find(m => m.id === v?.markerId);
  if (!v || !marker) throw new Error('Choose a saved release marker.');
  const retained=new History(history,products,()=>now).entries();
  const report = launchReview(request, products, readings, retained, insights, now);
  return { rows: report.comparison.rows.map(row => ({ key: keyOf(row.product), before: row.b.coverage, after: row.a.coverage,
    beforeAvailable: row.b.value !== null, afterAvailable: row.a.value !== null,
    firstRecordedAt: retained.filter(s => keyOf(s.product) === keyOf(row.product)).sort((a,b) => a.fetchedAt.localeCompare(b.fetchedAt))[0]?.fetchedAt })),
    preliminary: report.preliminary, start: report.comparison.request.b.start, end: report.comparison.request.a.end };
}
export interface CurrentValue { product: Product; value: number; label: string; fetchedAt: string; range?: string }
export function currentValue(products: Product[], readings: Reading[], key: unknown, days: unknown = 30, now = new Date()): CurrentValue {
  const product = products.find(p => keyOf(p) === key), reading = readings.find(r => keyOf(r.product) === key);
  if (!product || !reading?.metric || !reading.fetchedAt || !['fresh', 'cached', 'partial'].includes(readingHealth(reading, now))) throw new Error('Refresh this product to get a current value.');
  if (reading.metric.kind === 'npm') {
    if (typeof days !== 'number' || ![7,30,90].includes(days)) throw new Error('Choose a 7-, 30- or 90-day npm total.');
    const value = reading.metric.windows.find(w => w.days === days)?.total;
    if (value == null) throw new Error('This npm window has incomplete daily coverage. Choose another window or refresh.');
    return { product, value, label: `npm downloads / ${days} completed UTC days`, fetchedAt: reading.fetchedAt, range: `${dateAt(new Date(reading.metric.end), 1 - days)} to ${reading.metric.end} UTC` };
  }
  return { product, value: reading.metric.value, label: product.source === 'marketplace' ? 'Marketplace installs / cumulative' : product.source === 'openvsx' ? 'Open VSX downloads / cumulative' : 'Reddit comments / current count', fetchedAt: reading.fetchedAt };
}
const xml = (value: string): string => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
const clip = (value: string, length: number): string => [...value].length > length ? [...value].slice(0,length-3).join('') + '...' : value;
export function currentShareCard(value: CurrentValue): string {
  const number = new Intl.NumberFormat('en-US').format(value.value);
  const t = (x:number,y:number,v:string,size=20,color='#eaf7f3',weight=400) => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${xml(v)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-label="${xml(value.product.id+' current metric')}"><title>${xml(value.label)}</title><desc>${xml(`${value.product.id}: ${number} ${value.label}. As of ${value.fetchedAt}. ${value.range || ''}. This is a current value, not a release comparison or unique-user count.`)}</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0a1320"/><stop offset="1" stop-color="#164138"/></linearGradient></defs><rect width="1200" height="630" rx="28" fill="url(#bg)"/><g font-family="Segoe UI, Arial, sans-serif">${t(52,58,'SHIPSTATS / CURRENT METRIC',18,'#71f0c3')}${t(52,132,clip(value.product.id,38),Math.min(36,Math.floor(1100/(Math.min(38,value.product.id.length)*0.95))),'#f0f9f6',650)}${t(52,178,value.label,22,'#b7cbc7')}<rect x="48" y="218" width="1104" height="222" rx="22" fill="#173a3c" stroke="#71f0c3" stroke-opacity=".3"/>${t(80,264,value.product.source==='npm'?'WINDOW TOTAL':'CURRENT COUNT',15,'#71f0c3')}${t(80,374,number,Math.min(92,Math.floor(1000/(number.length*.65))),'#f0fff9',650)}${t(52,484,'As of '+value.fetchedAt,18,'#b7cbc7')}${t(52,520,value.range || 'Cumulative/current source metric. Historical observations are not required.',17,'#b7cbc7')}<path d="M52 559H1148" stroke="#44615c"/>${t(52,597,'Current value only. Downloads, installs and comments are not unique users.',17,'#b7cbc7')}</g></svg>`;
}
export function progressSummary(products: Product[], readings: Reading[], history: Snapshot[], monitoring: MonitorState, now = new Date()) {
  const start = dateAt(now,-7), end = dateAt(now,-1);
  const rows = products.map(product => {
    const reading = readings.find(r => keyOf(r.product) === keyOf(product)), health = reading ? readingHealth(reading,now) : 'empty';
    if (product.source === 'npm') {
      const w = reading?.metric?.kind === 'npm' && ['fresh','cached','partial'].includes(health) ? reading.metric.windows.find(w => w.days === 7) : undefined;
      const difference = w?.total != null && w.previous != null ? w.total-w.previous : null;
      return { product, value: w?.total ?? null, difference: difference !== null && Number.isSafeInteger(difference) ? difference : null, health,
        meaning: 'npm downloads: last 7 completed UTC days versus the preceding 7; not unique users.', coverage: w?.total != null && w.previous != null ? 'Both daily windows complete' : 'Missing daily coverage or refresh required', asOf: reading?.fetchedAt };
    }
    const samples = history.filter(s => keyOf(s.product) === keyOf(product) && s.fetchedAt.slice(0,10)>=start && s.fetchedAt.slice(0,10)<=end && s.metric.kind==='count').sort((a,b)=>a.fetchedAt.localeCompare(b.fetchedAt));
    const first=samples[0], last=samples.at(-1), difference=first?.metric.kind==='count' && last?.metric.kind==='count' && first!==last ? last.metric.value-first.metric.value : null;
    return { product, value: last?.metric.kind==='count' ? last.metric.value : null, difference: difference !== null && Number.isSafeInteger(difference) ? difference : null, health,
      meaning: 'Last saved count and observed change inside the last 7 completed UTC days; not a full-period acquisition total.', coverage: `${samples.length} saved observations${first&&last ? ` / ${first.fetchedAt} to ${last.fetchedAt}` : '; no historical data'}`, asOf:last?.fetchedAt };
  });
  return { start,end,computedAt:now.toISOString(),rows,failures:readings.filter(r=>r.error).length,
    milestones:monitoring.alerts.filter(a=>a.kind==='milestone' && a.createdAt>=new Date(now.getTime()-7*86400_000).toISOString()).length };
}
