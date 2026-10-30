import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Analytics, parallelMap } from './service';
import { Providers } from './providers';
import { Discovery, Product, Reading, Source, discoveryIdentity, errorMessage, keyOf, product, restoreProducts, selectedPackages, sourceUrl } from './model';

const TOKEN = 'shipstats.reddit.accessToken';
export function activate(context: vscode.ExtensionContext): void {
  const app = new ShipStats(context);
  context.subscriptions.push(app);
  for (const [id, fn] of Object.entries({
    open: () => app.open(), discover: () => app.chooseIdentity(), add: () => app.add(),
    refresh: () => app.refresh(), redditToken: () => app.setToken(), clearRedditToken: () => app.clearToken()
  })) context.subscriptions.push(vscode.commands.registerCommand(`shipstats.${id}`, () => app.run(async () => { await fn(); })));
}

class ProductsTree implements vscode.TreeDataProvider<vscode.TreeItem> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  constructor(private getProducts: () => Product[]) {}
  refresh(): void { this.emitter.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(): vscode.TreeItem[] {
    const products = this.getProducts();
    return (products.length ? products.map(p => ({ label: p.id, description: p.source })) : [{ label: 'Discover your npm packages', description: 'Get started' }]).map(p => {
      const item = new vscode.TreeItem(p.label); item.description = p.description;
      item.command = { command: 'shipstats.open', title: 'Open Dashboard' }; return item;
    });
  }
  dispose(): void { this.emitter.dispose(); }
}

class ShipStats implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private products: Product[];
  private readings: Reading[] = [];
  private discovery?: Discovery;
  private discoveryKey?: string;
  private busy = false;
  private notice = '';
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private providers = new Providers();
  private analytics = new Analytics(this.providers);
  private tree: ProductsTree;
  private disposables: vscode.Disposable[] = [];
  constructor(private context: vscode.ExtensionContext) {
    this.products = restoreProducts(context.globalState.get('products'));
    this.discoveryKey = context.globalState.get<string>('npmDiscoveryIdentity');
    if (!this.discoveryKey) {
      // Older builds stored the identity only in settings. Preserve that account's
      // selection on upgrade; a genuinely different search still clears it.
      const scope = this.config().get<string>('npmScope', '').trim();
      const username = this.config().get<string>('npmUsername', '').trim();
      if (scope || username) {
        try { this.discoveryKey = `${scope ? 'scope' : 'username'}:${discoveryIdentity(scope || username, !!scope)}`; }
        catch { /* Invalid settings will be reported when discovery is requested. */ }
      }
    }
    this.tree = new ProductsTree(() => this.products);
    this.disposables.push(this.tree, vscode.window.registerTreeDataProvider('shipstats.products', this.tree));
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 20);
    status.text = '$(graph) ShipStats'; status.command = 'shipstats.open'; status.tooltip = 'Open developer product analytics'; status.show();
    this.disposables.push(status, vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('shipstats')) {
        this.analytics.clearReddit(); this.schedule(); this.send();
      }
    }));
  }
  private config(): vscode.WorkspaceConfiguration { return vscode.workspace.getConfiguration('shipstats'); }
  run(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      this.busy = true; this.notice = ''; this.send();
      try { await fn(); }
      catch (e) {
        this.notice = errorMessage(e);
        if (!this.panel) void vscode.window.showErrorMessage(`ShipStats: ${this.notice}`);
      } finally { this.busy = false; this.send(); }
    });
    return this.queue;
  }
  open(): void {
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel('shipstats.dashboard', 'ShipStats', vscode.ViewColumn.One, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    });
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const m = message as Record<string, unknown>;
      if (typeof m.type !== 'string') return;
      void this.run(async () => {
        switch (m.type) {
          case 'ready': {
            await this.refresh();
            const scope = this.config().get<string>('npmScope', '').trim(), username = this.config().get<string>('npmUsername', '').trim();
            if (scope || username) await this.discover(scope || username, !!scope);
            break;
          }
          case 'discover':
            if (typeof m.identity !== 'string' || typeof m.scope !== 'boolean') throw new Error('Invalid discovery request.');
            await this.discover(m.identity, m.scope); break;
          case 'select':
            if (!Array.isArray(m.names) || m.names.length > 1000 || m.names.some(n => typeof n !== 'string')) throw new Error('Invalid package selection.');
            await this.select(m.names as string[]); break;
          case 'add':
            if (m.source !== undefined && !['npm', 'marketplace', 'openvsx', 'reddit'].includes(m.source as string)) throw new Error('Invalid product source.');
            await this.add(m.source as Source | undefined); break;
          case 'refresh': await this.refresh(); break;
          case 'remove': {
            const p = this.find(m.key); if (!p) return;
            await this.save(this.products.filter(item => keyOf(item) !== keyOf(p))); break;
          }
          case 'source': { const p = this.find(m.key); if (p) await vscode.env.openExternal(vscode.Uri.parse(sourceUrl(p))); break; }
          case 'token': await this.setToken(); break;
          case 'clearToken': await this.clearToken(); break;
          case 'settings': await vscode.commands.executeCommand('workbench.action.openSettings', 'shipstats'); break;
        }
      });
    });
    this.panel.onDidDispose(() => { this.panel = undefined; if (this.timer) clearInterval(this.timer); this.timer = undefined; });
    this.schedule();
  }
  private find(key: unknown): Product | undefined { return typeof key === 'string' ? this.products.find(p => keyOf(p) === key) : undefined; }
  async chooseIdentity(): Promise<void> {
    this.open();
    const kind = await vscode.window.showQuickPick(['npm username', 'npm scope'], { title: 'Discover public npm packages' });
    if (!kind) return;
    const value = await vscode.window.showInputBox({ title: kind, prompt: 'Search public packages. Results do not establish ownership.', ignoreFocusOut: true });
    if (value !== undefined) {
      await this.discover(value, kind === 'npm scope');
      void this.panel?.webview.postMessage({ type: 'navigate', page: 'packages' });
    }
  }
  private async discover(identity: string, scope: boolean): Promise<void> {
    const normalized = discoveryIdentity(identity, scope);
    const nextKey = `${scope ? 'scope' : 'username'}:${normalized}`;
    if (nextKey !== this.discoveryKey) {
      this.discoveryKey = nextKey;
      this.discovery = undefined;
      // Account changes are a new npm dashboard, including when the new search
      // is empty or fails. Pruning also prevents cached prior-account readings.
      await this.save(this.products.filter(p => p.source !== 'npm'));
    }
    await this.context.globalState.update('npmDiscoveryIdentity', nextKey);
    await this.config().update(scope ? 'npmScope' : 'npmUsername', normalized, vscode.ConfigurationTarget.Global);
    if (!scope) await this.config().update('npmScope', '', vscode.ConfigurationTarget.Global);
    const result = await this.providers.discover(normalized, scope);
    this.discovery = result;
    this.notice = `${result.packages.length} public package matches. Choose the ones you want to track.`;
    this.send();
  }
  private async select(names: string[]): Promise<void> {
    if (!this.discovery) throw new Error('Discover packages first.');
    await this.save(selectedPackages(this.products, this.discovery.packages.map(p => p.name), names));
    await this.refresh();
  }
  private async save(products: Product[]): Promise<void> {
    const unique = [...new Map(products.map(p => [keyOf(p), p])).values()];
    if (unique.length > 50) throw new Error('Track up to 50 products. Remove one before adding another.');
    await this.context.globalState.update('products', unique);
    this.products = unique;
    this.readings = this.readings.filter(r => unique.some(p => keyOf(p) === keyOf(r.product)));
    this.analytics.prune(unique); this.tree.refresh(); this.send();
  }
  async add(source?: Source): Promise<void> {
    this.open();
    const options: { label: string; description: string; source: Source }[] = [
      { label: 'npm package', description: '7 / 30 / 90-day download trends', source: 'npm' },
      { label: 'VS Code Marketplace', description: 'Public cumulative install count', source: 'marketplace' },
      { label: 'Open VSX', description: 'Public cumulative download count', source: 'openvsx' },
      { label: 'Reddit post', description: 'Optional · requires approved OAuth API access', source: 'reddit' }
    ];
    const choice = source ? options.find(option => option.source === source) : await vscode.window.showQuickPick(options, { title: 'Add a product to ShipStats' });
    if (!choice) return;
    const value = await vscode.window.showInputBox({
      title: `Track ${choice.label}`,
      prompt: choice.source === 'npm' ? 'Package name, e.g. @scope/package' : choice.source === 'reddit' ? 'Full Reddit post URL or post ID. Only comment counts are read.' : 'Extension identifier, e.g. redhat.vscode-yaml',
      ignoreFocusOut: true,
      validateInput: input => { try { product(choice.source, input); return undefined; } catch (e) { return errorMessage(e); } }
    });
    if (value === undefined) return;
    await this.save([...this.products, product(choice.source, value)]); await this.refresh();
    void this.panel?.webview.postMessage({ type: 'navigate', page: 'overview' });
  }
  async refresh(): Promise<void> {
    const hasReddit = this.products.some(p => p.source === 'reddit');
    const token = hasReddit ? await this.context.secrets.get(TOKEN) : undefined;
    const ua = this.config().get<string>('redditUserAgent', '');
    this.readings = await parallelMap(this.products, p => this.analytics.read(p, token, ua));
    this.send();
  }
  async setToken(): Promise<void> {
    const token = await vscode.window.showInputBox({ title: 'Reddit OAuth access token', password: true, ignoreFocusOut: true, prompt: 'Requires approved Reddit Data API access. Stored in VS Code SecretStorage. Short-lived tokens must be replaced manually.' });
    if (token === undefined) return;
    if (!token.trim() || /\s/.test(token.trim())) throw new Error('Enter the access token only, without “Bearer” or whitespace.');
    await this.context.secrets.store(TOKEN, token.trim()); this.analytics.clearReddit(); await this.refresh();
    this.notice = 'Reddit token saved securely. Access still depends on approval, token validity, and User-Agent configuration.';
  }
  async clearToken(): Promise<void> {
    await this.context.secrets.delete(TOKEN); this.analytics.clearReddit();
    this.readings = this.readings.filter(r => r.product.source !== 'reddit'); await this.refresh();
    this.notice = 'Reddit access token cleared.';
  }
  private schedule(): void {
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    const minutes = this.config().get<number>('refreshMinutes', 0);
    if (this.panel && Number.isFinite(minutes) && minutes > 0) this.timer = setInterval(() => {
      if (this.panel?.visible && !this.busy) void this.run(() => this.refresh());
    }, Math.max(5, Math.min(1440, minutes)) * 60000);
  }
  private send(): void {
    if (!this.panel || this.disposed) return;
    const scope = this.config().get<string>('npmScope', '');
    const identity = this.discoveryKey?.slice(this.discoveryKey.indexOf(':') + 1);
    void this.panel.webview.postMessage({ type: 'state', products: this.products, readings: this.readings,
      discovery: this.discovery, busy: this.busy, notice: this.notice,
      discoveryKey: this.discoveryKey,
      identity: identity ?? (scope || this.config().get<string>('npmUsername', '')),
      scope: this.discoveryKey ? this.discoveryKey.startsWith('scope:') : !!scope });
  }
  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64');
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', name)).toString();
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource};">
      <link rel="stylesheet" href="${asset('dashboard.css')}"><title>ShipStats</title></head><body>
      <main id="app" data-logo="${asset('shipstats-icon.png')}"></main><script nonce="${nonce}" src="${asset('dashboard.js')}"></script></body></html>`;
  }
  dispose(): void { this.disposed = true; if (this.timer) clearInterval(this.timer); this.panel?.dispose(); this.disposables.forEach(d => d.dispose()); }
}
