export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export class HttpClient {
  private cooldown = new Map<string, number>();
  constructor(private fetcher: Fetcher = fetch, private timeoutMs = 15000) {}
  async json(url: string, init: RequestInit = {}): Promise<unknown> {
    const host = new URL(url).host;
    if ((this.cooldown.get(host) ?? 0) > Date.now()) throw new Error(`${host} is rate limited. Wait before refreshing.`);
    try {
      const response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after') ?? '';
        const seconds = /^\d+$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000;
        this.cooldown.set(host, Date.now() + Math.min(86400, Math.max(60, Number.isFinite(seconds) ? seconds : 60)) * 1000);
        throw new Error(`${host} rate limit reached (429). Respect Retry-After and try later.`);
      }
      if (!response.ok) {
        const hint = response.status === 404 ? 'Not found or not publicly available.' : response.status === 401 || response.status === 403 ? 'Access denied. Check access permissions and credentials.' : 'Please retry later.';
        throw new Error(`${host} returned ${response.status}. ${hint}`);
      }
      // Bound untrusted API payloads; no remote HTML or scripts enter the webview.
      const reader = response.body?.getReader();
      if (!reader) throw new Error(`${host} returned an empty response.`);
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 5_000_000) { await reader.cancel(); throw new Error(`${host} response is too large.`); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error(`${host} returned invalid JSON.`); }
    } catch (e) {
      if (e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name)) throw new Error(`${host} request timed out. Please retry.`);
      if (e instanceof TypeError) throw new Error(`Cannot reach ${host}. Check your connection, firewall, or proxy. Native fetch does not automatically use VS Code's http.proxy setting.`);
      throw e;
    }
  }
}
