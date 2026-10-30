import { Product, Reading, keyOf, errorMessage, dateAt } from './model';
import { Providers } from './providers';
export class Analytics {
  private cache = new Map<string, Reading>();
  constructor(private providers: Providers, private clock = () => new Date()) {}
  clearReddit(): void { for (const key of this.cache.keys()) if (key.startsWith('reddit:')) this.cache.delete(key); }
  prune(products: Product[]): void { const keys = new Set(products.map(keyOf)); for (const key of this.cache.keys()) if (!keys.has(key)) this.cache.delete(key); }
  async read(p: Product, token?: string, userAgent = ''): Promise<Reading> {
    const key = keyOf(p), cached = this.cache.get(key), now = this.clock();
    const correctDay = cached?.metric?.kind !== 'npm' || cached.metric.end === dateAt(now, -1);
    if (cached?.fetchedAt && correctDay && now.getTime() - Date.parse(cached.fetchedAt) < 600_000) return cached;
    try {
      const metric = p.source === 'npm' ? await this.providers.npm(p.id, now) : p.source === 'reddit' ? await this.providers.reddit(p.id, token, userAgent) : await this.providers.extension(p);
      const reading = { product: p, metric, fetchedAt: now.toISOString() }; this.cache.set(key, reading); return reading;
    } catch (e) { return { ...cached, product: p, error: errorMessage(e), stale: !!cached?.metric }; }
  }
}
export async function parallelMap<T, R>(items: T[], task: (item: T) => Promise<R>, limit = 4): Promise<R[]> {
  const result: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await task(items[index]!); }
  }));
  return result;
}
