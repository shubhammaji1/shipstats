import { HttpClient } from './http';
import { Candidate, CountMetric, Day, Discovery, discoveryIdentity, NpmMetric, Product, dateAt, windows } from './model';

type Obj = Record<string, unknown>;
function obj(x: unknown): Obj { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new Error('Unexpected API response shape.'); return x as Obj; }
function arr(x: unknown): unknown[] { if (!Array.isArray(x)) throw new Error('Unexpected API list.'); return x; }
function count(x: unknown): number { if (typeof x !== 'number' || !Number.isSafeInteger(x) || x < 0) throw new Error('Source did not provide a valid count.'); return x; }
const string = (x: unknown): string => typeof x === 'string' ? x : '';

export class Providers {
  constructor(private http = new HttpClient()) {}
  async discover(identity: string, scope: boolean): Promise<Discovery> {
    const value = discoveryIdentity(identity, scope), found = new Map<string, Candidate>();
    let truncated = false, fallback = false;
    for (let from = 0; from < 1000; from += 250) {
      const query = new URLSearchParams({ text: scope ? fallback ? `@${value}/` : `scope:${value}` : `maintainer:${value}`, size: '250', from: String(from) });
      const data = obj(await this.http.json(`https://registry.npmjs.org/-/v1/search?${query}`));
      const entries = arr(data.objects), total = count(data.total);
      // Some current registry deployments return zero for the documented scope qualifier.
      // Retry a general namespace search, still filtering names to the exact scope.
      if (scope && !fallback && from === 0 && total === 0) { fallback = true; from = -250; continue; }
      for (const entry of entries) {
        const p = obj(obj(entry).package), name = string(p.name);
        const matches = scope ? name.startsWith(`@${value}/`) : Array.isArray(p.maintainers) && p.maintainers.some(m => string(obj(m).username).toLowerCase() === value);
        if (matches && name) found.set(name, { name, description: string(p.description).slice(0, 300) });
      }
      if (from + entries.length >= total || entries.length < 250) break;
      if (from === 750) truncated = true;
    }
    return {
      packages: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)),
      note: `${scope ? 'Namespace matches' : 'Public maintainer matches'}, not verified ownership. npm search can lag or omit packages; private packages are excluded. ${fallback ? 'Scope qualifier returned no results; using general search filtered to the exact namespace. This may omit packages. ' : ''}${truncated ? 'Search capped at 1,000 results. Add missing packages manually.' : 'Add missing packages manually.'}`
    };
  }
  async npm(id: string, now = new Date()): Promise<NpmMetric> {
    const start = dateAt(now, -180), end = dateAt(now, -1);
    const data = obj(await this.http.json(`https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(id)}`));
    if (data.package !== id) throw new Error('npm returned a different package.');
    const seen = new Set<string>();
    const daily: Day[] = arr(data.downloads).map(raw => {
      const row = obj(raw), day = string(row.day);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day || day < start || day > end || seen.has(day)) throw new Error('npm returned invalid or duplicate dates.');
      seen.add(day); return { day, downloads: count(row.downloads) };
    }).sort((a, b) => a.day.localeCompare(b.day));
    return { kind: 'npm', daily, windows: windows(daily, now), start, end };
  }
  async extension(p: Product): Promise<CountMetric> {
    if (p.source === 'openvsx') {
      const [namespace, name] = p.id.split('.');
      const data = obj(await this.http.json(`https://open-vsx.org/api/${namespace}/${name}`));
      if (string(data.namespace).toLowerCase() !== namespace || string(data.name).toLowerCase() !== name) throw new Error('Open VSX extension not found or response identity changed.');
      return { kind: 'count', label: 'Open VSX downloads · cumulative', value: count(data.downloadCount) };
    }
    const data = obj(await this.http.json('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=7.1-preview.1' },
      body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: p.id }], pageNumber: 1, pageSize: 1 }], flags: 256 })
    }));
    const result = obj(arr(data.results)[0]), extensions = arr(result.extensions);
    if (!extensions.length) throw new Error('Marketplace extension not found.');
    const extension = obj(extensions[0]);
    const actual = `${string(obj(extension.publisher).publisherName)}.${string(extension.extensionName)}`;
    if (actual.toLowerCase() !== p.id) throw new Error('Marketplace returned a different extension.');
    const stat = arr(extension.statistics).map(obj).find(s => s.statisticName === 'install');
    return { kind: 'count', label: 'Marketplace installs · cumulative', value: count(stat?.value) };
  }
  async reddit(id: string, token: string | undefined, userAgent: string): Promise<CountMetric> {
    if (!token) throw new Error('Reddit needs approved Data API access and an OAuth token. Use “Set Reddit Access Token”.');
    if (!userAgent.trim() || /[\r\n]/.test(userAgent)) throw new Error('Set shipstats.redditUserAgent (User-Agent) to a descriptive app/version and Reddit username.');
    const data = obj(await this.http.json(`https://oauth.reddit.com/api/info?id=t3_${id}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': userAgent }
    }));
    const children = arr(obj(data.data).children);
    if (!children.length) throw new Error('Post is unavailable, private, removed, or inaccessible to this token.');
    const post = obj(obj(children[0]).data);
    if (post.id !== id) throw new Error('Reddit returned a different post.');
    return { kind: 'count', label: 'Reddit comments · current count', value: count(post.num_comments), title: string(post.title).slice(0, 300) };
  }
}
